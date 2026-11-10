-- ─────────────────────────────────────────────────────────────────────────────
-- Ironlog database schema for Supabase (PostgreSQL)
--
-- How to use: Supabase dashboard → SQL Editor → New query → paste this whole
-- file → Run. It is safe to run more than once.
--
-- Design notes
--  • One row per workout. The exercises and sets of a workout live in a JSONB
--    column, so a workout is always saved or replaced as a single atomic unit —
--    it can never end up half-written.
--  • Personal records are NOT stored. The app derives them from the workouts
--    table, so editing or deleting a workout can never leave a stale record.
--  • Every table has row-level security: a signed-in user can only ever see or
--    change rows whose user_id is their own.
--  • Rows are soft-deleted (deleted_at) so a deletion reaches the user's other devices.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Tables ───────────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  prefs      jsonb       not null default '{}'::jsonb,   -- unit, rest timer, display name
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  synced_at  timestamptz not null default clock_timestamp()
);

-- Custom exercises. Built-in exercises ship with the app and use fixed text IDs
-- such as 'bench-press'; custom ones get a UUID. Workouts reference either by ID.
create table if not exists public.exercises (
  id           text primary key,
  user_id      uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  name         text        not null,
  muscle_group text        not null default 'Other',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  synced_at    timestamptz not null default clock_timestamp()
);

create table if not exists public.templates (
  id         uuid primary key,
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  name       text        not null,
  unit       text        not null default 'lb' check (unit in ('lb', 'kg')),
  sort       integer,
  exercises  jsonb       not null default '[]'::jsonb,   -- [{ uid, exerciseId, name, sets: [{ weight, reps }] }]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  synced_at  timestamptz not null default clock_timestamp()
);

create table if not exists public.workouts (
  id               uuid primary key,
  user_id          uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  name             text        not null,
  status           text        not null check (status in ('active', 'completed')),
  unit             text        not null default 'lb' check (unit in ('lb', 'kg')),
  started_at       timestamptz not null,                 -- stored in UTC, shown in the user's local time
  ended_at         timestamptz,
  duration_seconds integer     check (duration_seconds is null or duration_seconds >= 0),
  timer            jsonb,                                -- running clock of a workout in progress
  template_id      uuid,                                 -- informational only; no foreign key on purpose
  repeated_from_id uuid,                                 -- the workout this one was repeated from
  notes            text        not null default '',
  exercises        jsonb       not null default '[]'::jsonb,  -- [{ uid, exerciseId, name, notes, sets: [{ id, weight, reps, done }] }]
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  synced_at        timestamptz not null default clock_timestamp()
);

create index if not exists profiles_sync_idx  on public.profiles  (user_id, synced_at);
create index if not exists exercises_sync_idx on public.exercises (user_id, synced_at);
create index if not exists templates_sync_idx on public.templates (user_id, synced_at);
create index if not exists workouts_sync_idx  on public.workouts  (user_id, synced_at);
create index if not exists workouts_date_idx  on public.workouts  (user_id, started_at desc);

-- ── Write guards ─────────────────────────────────────────────────────────────
-- Applied to every insert/update, whatever the client sends:
--  1. An older copy can never overwrite a newer one (last write wins by updated_at).
--  2. A completed workout can never be turned back into an unfinished one.
--  3. The owner of a row can never be changed.
--  4. synced_at is stamped by the server so devices can ask "what changed since…".

create or replace function public.ironlog_guard_write()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'user_id cannot be changed';
    end if;
    if new.updated_at < old.updated_at then
      return old;  -- stale write: keep what is already saved
    end if;
  end if;
  new.synced_at := clock_timestamp();
  return new;
end;
$$;

create or replace function public.ironlog_guard_workout()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'completed' and new.status = 'active' then
    return old;  -- never un-finish a completed workout
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard  on public.profiles;
drop trigger if exists exercises_guard on public.exercises;
drop trigger if exists templates_guard on public.templates;
drop trigger if exists workouts_guard  on public.workouts;
drop trigger if exists workouts_a_keep_completed on public.workouts;

-- (Triggers on one table fire in name order, so this one runs before workouts_guard.)
create trigger workouts_a_keep_completed before update on public.workouts for each row execute function public.ironlog_guard_workout();
create trigger profiles_guard before insert or update on public.profiles  for each row execute function public.ironlog_guard_write();
create trigger exercises_guard before insert or update on public.exercises for each row execute function public.ironlog_guard_write();
create trigger templates_guard before insert or update on public.templates for each row execute function public.ironlog_guard_write();
create trigger workouts_guard  before insert or update on public.workouts  for each row execute function public.ironlog_guard_write();

-- ── Row-level security: each user can only reach their own rows ──────────────

alter table public.profiles  enable row level security;
alter table public.exercises enable row level security;
alter table public.templates enable row level security;
alter table public.workouts  enable row level security;

drop policy if exists "own profile"   on public.profiles;
drop policy if exists "own exercises" on public.exercises;
drop policy if exists "own templates" on public.templates;
drop policy if exists "own workouts"  on public.workouts;

create policy "own profile"   on public.profiles  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own exercises" on public.exercises for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own templates" on public.templates for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own workouts"  on public.workouts  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Signed-out visitors get nothing at all.
revoke all on public.profiles, public.exercises, public.templates, public.workouts from anon;
grant select, insert, update, delete on public.profiles, public.exercises, public.templates, public.workouts to authenticated;

-- ── Optional: a flat, one-row-per-set view for your own reporting in SQL ─────
-- (The app does not use it. security_invoker makes it obey the same privacy rules.)

create or replace view public.workout_sets
with (security_invoker = true) as
select
  w.user_id,
  w.id                                as workout_id,
  w.name                              as workout_name,
  w.started_at,
  w.unit,
  e.value ->> 'exerciseId'            as exercise_id,
  e.value ->> 'name'                  as exercise_name,
  e.ordinality                        as exercise_position,
  s.ordinality                        as set_number,
  (s.value ->> 'weight')::numeric     as weight,
  (s.value ->> 'reps')::integer       as reps
from public.workouts w
cross join lateral jsonb_array_elements(w.exercises) with ordinality as e (value, ordinality)
cross join lateral jsonb_array_elements(e.value -> 'sets') with ordinality as s (value, ordinality)
where w.status = 'completed'
  and w.deleted_at is null
  and coalesce((s.value ->> 'done')::boolean, false);

grant select on public.workout_sets to authenticated;
