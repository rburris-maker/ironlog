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
  muscles      jsonb,                                    -- { primary: [...], secondary: [...] } muscle ids; null = assumed from muscle_group
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  synced_at    timestamptz not null default clock_timestamp()
);

-- Added in version 7. Safe to run on a database created by an earlier version.
alter table public.exercises add column if not exists muscles jsonb;

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
set search_path = ''
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
set search_path = ''
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
  (s.value ->> 'reps')::integer       as reps,
  coalesce((s.value ->> 'amrap')::boolean, false) as amrap,
  (s.value ->> 'seconds')::integer    as amrap_seconds,
  e.value ->> 'supersetId'            as superset_id
from public.workouts w
cross join lateral jsonb_array_elements(w.exercises) with ordinality as e (value, ordinality)
cross join lateral jsonb_array_elements(e.value -> 'sets') with ordinality as s (value, ordinality)
where w.status = 'completed'
  and w.deleted_at is null
  and coalesce((s.value ->> 'done')::boolean, false);

grant select on public.workout_sets to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- Groups (added in version 8). Safe to run on a database from an earlier version.
--
-- A group is a set of accounts that agree to share workouts with each other.
-- Nothing above changes: every table keeps its "only the owner" rules, and the
-- three tables below have row-level security with NO policies, so the app cannot
-- read or write them directly. Everything goes through the functions further
-- down, each of which checks that the caller is signed in and is a member.
--
-- What a member can see of another member:
--   • their display name in that group
--   • workouts they FINISHED after joining, while their "share" switch is on:
--     exercises, sets, weights, reps, time and records — never notes
-- Never shared: bodyweight, soreness check-ins, strength ratings, templates, email.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.workouts add column if not exists group_post_id uuid;   -- the group workout this session was started from
alter table public.workouts add column if not exists highlights    jsonb;  -- { unit, prs: [...] } records earned, saved when finished

create table if not exists public.groups (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null check (char_length(name) between 1 and 60),
  join_code   text        not null unique,
  owner_id    uuid        not null references auth.users (id) on delete cascade,
  weekly_goal int         not null default 3 check (weekly_goal between 1 and 14),
  created_at  timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id     uuid        not null references public.groups (id) on delete cascade,
  user_id      uuid        not null references auth.users (id) on delete cascade,
  display_name text        not null check (char_length(display_name) between 1 and 40),
  share        boolean     not null default true,
  joined_at    timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- A workout posted for the group to do. Same shape as a template; weights are left out.
create table if not exists public.group_posts (
  id         uuid        primary key default gen_random_uuid(),
  group_id   uuid        not null references public.groups (id) on delete cascade,
  author_id  uuid        not null references auth.users (id) on delete cascade,
  name       text        not null check (char_length(name) between 1 and 60),
  unit       text        not null default 'lb' check (unit in ('lb', 'kg')),
  exercises  jsonb       not null default '[]'::jsonb,
  note       text        not null default '' check (char_length(note) <= 280),
  created_at timestamptz not null default now()
);

create index if not exists group_members_user_idx  on public.group_members (user_id);
create index if not exists group_posts_group_idx   on public.group_posts (group_id, created_at desc);
create index if not exists workouts_group_post_idx on public.workouts (group_post_id) where group_post_id is not null;

alter table public.groups        enable row level security;
alter table public.group_members enable row level security;
alter table public.group_posts   enable row level security;
revoke all on public.groups, public.group_members, public.group_posts from anon, authenticated;

-- ---------- helpers (not callable from the app) ----------

-- The group as the caller sees it, or NULL when the caller is not a member.
create or replace function public.ironlog_group_json(p_group uuid, p_uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', g.id, 'name', g.name, 'join_code', g.join_code, 'owner_id', g.owner_id,
    'weekly_goal', g.weekly_goal, 'created_at', g.created_at,
    'display_name', m.display_name, 'share', m.share, 'joined_at', m.joined_at,
    'member_count', (select count(*) from public.group_members x where x.group_id = g.id))
  from public.groups g
  join public.group_members m on m.group_id = g.id and m.user_id = p_uid
  where g.id = p_group
$$;

-- One workout as other members may see it. p_full adds the exercises (without notes) and the records.
create or replace function public.ironlog_shared_workout(w public.workouts, p_full boolean) returns jsonb
language sql stable security definer set search_path = '' as $$
  with ex as (
    select t.e, t.n
    from jsonb_array_elements(case when jsonb_typeof(w.exercises) = 'array' then w.exercises else '[]'::jsonb end) with ordinality as t (e, n)
  )
  select jsonb_build_object(
    'id', w.id, 'user_id', w.user_id, 'name', w.name, 'unit', w.unit,
    'started_at', w.started_at, 'duration_seconds', w.duration_seconds, 'group_post_id', w.group_post_id,
    'sets', (select count(*) from ex,
               jsonb_array_elements(case when jsonb_typeof(ex.e -> 'sets') = 'array' then ex.e -> 'sets' else '[]'::jsonb end) s
             where s -> 'done' = 'true'::jsonb and jsonb_typeof(s -> 'reps') = 'number' and (s ->> 'reps')::numeric > 0),
    'exercise_names', (select coalesce(jsonb_agg(ex.e ->> 'name' order by ex.n), '[]'::jsonb) from ex),
    'prs', case when jsonb_typeof(w.highlights -> 'prs') = 'array' then jsonb_array_length(w.highlights -> 'prs') else 0 end)
  || case when p_full then jsonb_build_object(
       'exercises', (select coalesce(jsonb_agg(ex.e - 'notes' order by ex.n), '[]'::jsonb) from ex),
       'highlights', w.highlights)
     else '{}'::jsonb end
$$;

-- ---------- functions the app calls ----------

create or replace function public.group_create(p_name text, p_display_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_me   text := btrim(coalesce(p_display_name, ''));
  v_id   uuid;
  v_code text;
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  if char_length(v_name) not between 1 and 60 then raise exception 'Give the group a name (up to 60 characters)'; end if;
  if char_length(v_me) not between 1 and 40 then raise exception 'Enter the name the group will see for you (up to 40 characters)'; end if;
  if (select count(*) from public.group_members where user_id = v_uid) >= 20 then raise exception 'You are already in 20 groups'; end if;
  loop
    -- six characters from an alphabet without look-alikes (no I, L, O, 0 or 1)
    select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + get_byte(r.b, i) % 31, 1), '' order by i)
      into v_code
      from (select uuid_send(gen_random_uuid()) as b) r, generate_series(0, 5) as i;
    exit when not exists (select 1 from public.groups where join_code = v_code);
  end loop;
  insert into public.groups (name, join_code, owner_id) values (v_name, v_code, v_uid) returning id into v_id;
  insert into public.group_members (group_id, user_id, display_name) values (v_id, v_uid, v_me);
  return public.ironlog_group_json(v_id, v_uid);
end $$;

create or replace function public.group_join(p_code text, p_display_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := auth.uid();
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_me   text := btrim(coalesce(p_display_name, ''));
  v_id   uuid;
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  select id into v_id from public.groups where join_code = v_code;
  if v_id is null then raise exception 'No group has that code. Check it and try again.'; end if;
  if exists (select 1 from public.group_members where group_id = v_id and user_id = v_uid) then
    return public.ironlog_group_json(v_id, v_uid);
  end if;
  if char_length(v_me) not between 1 and 40 then raise exception 'Enter the name the group will see for you (up to 40 characters)'; end if;
  if (select count(*) from public.group_members where group_id = v_id) >= 50 then raise exception 'This group is full (50 members)'; end if;
  if (select count(*) from public.group_members where user_id = v_uid) >= 20 then raise exception 'You are already in 20 groups'; end if;
  insert into public.group_members (group_id, user_id, display_name) values (v_id, v_uid, v_me);
  return public.ironlog_group_json(v_id, v_uid);
end $$;

-- Leaving: the longest-standing member becomes the owner; an empty group is deleted.
create or replace function public.group_leave(p_group uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  delete from public.group_members where group_id = p_group and user_id = v_uid;
  if not found then return 'false'::jsonb; end if;
  if not exists (select 1 from public.group_members where group_id = p_group) then
    delete from public.groups where id = p_group;
  else
    update public.groups g
       set owner_id = (select user_id from public.group_members where group_id = p_group order by joined_at, user_id limit 1)
     where g.id = p_group and g.owner_id = v_uid;
  end if;
  return 'true'::jsonb;
end $$;

create or replace function public.group_update(p_group uuid, p_name text, p_weekly_goal int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_name text := btrim(coalesce(p_name, ''));
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  if not exists (select 1 from public.groups where id = p_group and owner_id = v_uid) then raise exception 'Only the group owner can change this'; end if;
  if char_length(v_name) not between 1 and 60 then raise exception 'Give the group a name (up to 60 characters)'; end if;
  if p_weekly_goal is null or p_weekly_goal not between 1 and 14 then raise exception 'The weekly goal must be between 1 and 14 workouts'; end if;
  update public.groups set name = v_name, weekly_goal = p_weekly_goal where id = p_group;
  return public.ironlog_group_json(p_group, v_uid);
end $$;

-- The caller's own name and sharing switch in one group.
create or replace function public.group_set_me(p_group uuid, p_display_name text, p_share boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_me text := btrim(coalesce(p_display_name, ''));
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  if char_length(v_me) not between 1 and 40 then raise exception 'Enter the name the group will see for you (up to 40 characters)'; end if;
  update public.group_members set display_name = v_me, share = coalesce(p_share, share) where group_id = p_group and user_id = v_uid;
  if not found then raise exception 'You are not in this group'; end if;
  return public.ironlog_group_json(p_group, v_uid);
end $$;

create or replace function public.group_remove_member(p_group uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  if not exists (select 1 from public.groups where id = p_group and owner_id = v_uid) then raise exception 'Only the group owner can remove members'; end if;
  if p_user = v_uid then raise exception 'Use “Leave group” to remove yourself'; end if;
  delete from public.group_members where group_id = p_group and user_id = p_user;
  return to_jsonb(found);
end $$;

create or replace function public.group_delete(p_group uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  delete from public.groups where id = p_group and owner_id = v_uid;
  if not found then raise exception 'Only the group owner can delete the group'; end if;
  return 'true'::jsonb;
end $$;

-- The caller's groups, with how many sharing members have trained since p_week_start.
create or replace function public.my_groups(p_week_start timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  return (
    select coalesce(jsonb_agg(public.ironlog_group_json(m.group_id, v_uid) || jsonb_build_object(
      'trained', (select count(distinct w.user_id)
                    from public.workouts w
                    join public.group_members x on x.user_id = w.user_id and x.group_id = m.group_id and x.share
                   where w.status = 'completed' and w.deleted_at is null
                     and w.started_at >= greatest(p_week_start, x.joined_at))
    ) order by m.joined_at), '[]'::jsonb)
    from public.group_members m
    where m.user_id = v_uid);
end $$;

-- Everything the group screen shows: members, their shared workouts since p_since (light rows), posted workouts.
create or replace function public.group_overview(p_group uuid, p_since timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_group jsonb;
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  v_group := public.ironlog_group_json(p_group, v_uid);
  if v_group is null then raise exception 'You are not in this group'; end if;
  return jsonb_build_object(
    'group', v_group,
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', x.user_id, 'display_name', x.display_name, 'share', x.share, 'joined_at', x.joined_at,
        'active_since', case when x.share then (
          select max(w.started_at) from public.workouts w
           where w.user_id = x.user_id and w.status = 'active' and w.deleted_at is null
             and w.updated_at > now() - interval '6 hours') end
      ) order by x.joined_at, x.user_id), '[]'::jsonb)
      from public.group_members x where x.group_id = p_group),
    'workouts', (
      select coalesce(jsonb_agg(s.item order by s.started_at desc), '[]'::jsonb)
      from (
        select public.ironlog_shared_workout(w, false) as item, w.started_at
          from public.workouts w
          join public.group_members x on x.user_id = w.user_id and x.group_id = p_group and x.share
         where w.status = 'completed' and w.deleted_at is null
           and w.started_at >= greatest(coalesce(p_since, now() - interval '56 days'), now() - interval '120 days', x.joined_at)
         order by w.started_at desc
         limit 500) s),
    'posts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'author_id', p.author_id, 'unit', p.unit, 'note', p.note,
        'created_at', p.created_at, 'exercises', p.exercises,
        'results', (select count(distinct w.user_id)
                      from public.workouts w
                      join public.group_members x on x.user_id = w.user_id and x.group_id = p_group and x.share
                     where w.group_post_id = p.id and w.status = 'completed' and w.deleted_at is null)
      ) order by p.created_at desc), '[]'::jsonb)
      from (select * from public.group_posts where group_id = p_group order by created_at desc limit 50) p));
end $$;

-- One shared workout in full.
create or replace function public.group_workout(p_group uuid, p_workout uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_out jsonb;
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  if not exists (select 1 from public.group_members where group_id = p_group and user_id = v_uid) then raise exception 'You are not in this group'; end if;
  select public.ironlog_shared_workout(w, true) into v_out
    from public.workouts w
    join public.group_members x on x.user_id = w.user_id and x.group_id = p_group and x.share
   where w.id = p_workout and w.status = 'completed' and w.deleted_at is null and w.started_at >= x.joined_at;
  if v_out is null then raise exception 'That workout is no longer shared with this group'; end if;
  return v_out;
end $$;

create or replace function public.group_post_create(p_group uuid, p_name text, p_unit text, p_exercises jsonb, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_name text := btrim(coalesce(p_name, '')); v_row public.group_posts;
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  if not exists (select 1 from public.group_members where group_id = p_group and user_id = v_uid) then raise exception 'You are not in this group'; end if;
  if char_length(v_name) not between 1 and 60 then raise exception 'Give the workout a name (up to 60 characters)'; end if;
  if p_unit not in ('lb', 'kg') then raise exception 'Unknown unit'; end if;
  if jsonb_typeof(p_exercises) is distinct from 'array' or jsonb_array_length(p_exercises) not between 1 and 40 then raise exception 'A group workout needs between 1 and 40 exercises'; end if;
  if pg_column_size(p_exercises) > 60000 then raise exception 'That workout is too large to post'; end if;
  if (select count(*) from public.group_posts where group_id = p_group) >= 200 then raise exception 'This group has 200 workouts already. Delete an old one first.'; end if;
  insert into public.group_posts (group_id, author_id, name, unit, exercises, note)
  values (p_group, v_uid, v_name, p_unit, p_exercises, left(btrim(coalesce(p_note, '')), 280))
  returning * into v_row;
  return to_jsonb(v_row);
end $$;

-- The author or the group owner can take a posted workout down. Results already logged stay in their owners' history.
create or replace function public.group_post_delete(p_post uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  delete from public.group_posts p
   where p.id = p_post
     and (p.author_id = v_uid or exists (select 1 from public.groups g where g.id = p.group_id and g.owner_id = v_uid));
  if not found then raise exception 'Only the person who posted it or the group owner can delete this'; end if;
  return 'true'::jsonb;
end $$;

-- A posted workout with every sharing member's result for it.
create or replace function public.group_post_results(p_post uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_post public.group_posts;
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  select * into v_post from public.group_posts where id = p_post;
  if v_post.id is null or not exists (select 1 from public.group_members where group_id = v_post.group_id and user_id = v_uid) then
    raise exception 'That group workout is not available';
  end if;
  return jsonb_build_object(
    'post', to_jsonb(v_post),
    'results', (
      select coalesce(jsonb_agg(public.ironlog_shared_workout(w, true) order by w.started_at desc), '[]'::jsonb)
        from public.workouts w
        join public.group_members x on x.user_id = w.user_id and x.group_id = v_post.group_id and x.share
       where w.group_post_id = p_post and w.status = 'completed' and w.deleted_at is null));
end $$;

-- Helpers are internal; the rest are for signed-in users only.
revoke execute on function public.ironlog_group_json(uuid, uuid), public.ironlog_shared_workout(public.workouts, boolean) from public, anon, authenticated;
revoke execute on function
  public.group_create(text, text), public.group_join(text, text), public.group_leave(uuid),
  public.group_update(uuid, text, int), public.group_set_me(uuid, text, boolean),
  public.group_remove_member(uuid, uuid), public.group_delete(uuid), public.my_groups(timestamptz),
  public.group_overview(uuid, timestamptz), public.group_workout(uuid, uuid),
  public.group_post_create(uuid, text, text, jsonb, text), public.group_post_delete(uuid), public.group_post_results(uuid)
  from public, anon;
grant execute on function
  public.group_create(text, text), public.group_join(text, text), public.group_leave(uuid),
  public.group_update(uuid, text, int), public.group_set_me(uuid, text, boolean),
  public.group_remove_member(uuid, uuid), public.group_delete(uuid), public.my_groups(timestamptz),
  public.group_overview(uuid, timestamptz), public.group_workout(uuid, uuid),
  public.group_post_create(uuid, text, text, jsonb, text), public.group_post_delete(uuid), public.group_post_results(uuid)
  to authenticated;
