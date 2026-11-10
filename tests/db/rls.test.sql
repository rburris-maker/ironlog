-- Database-level tests for schema.sql: privacy between users and the write guards.
-- Run with:  psql -v ON_ERROR_STOP=1 -f tests/db/rls.test.sql
-- Every check raises an exception if it fails, so reaching the end means all passed.

\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'alice.rls@example.com'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'bob.rls@example.com')
on conflict do nothing;

truncate public.workouts, public.templates, public.exercises, public.profiles;

-- ── Alice saves a workout ────────────────────────────────────────────────────
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001';

insert into public.workouts (id, name, status, unit, started_at, duration_seconds, exercises, updated_at)
values ('11111111-1111-4111-8111-111111111111', 'Push Day', 'completed', 'lb', now(), 4354,
        '[{"uid":"e1","exerciseId":"bench-press","name":"Bench Press","sets":[{"id":"s1","weight":195,"reps":5,"done":true}]}]', now());
insert into public.templates (id, name, updated_at) values ('22222222-2222-4222-8222-222222222222', 'Push Day', now());
insert into public.exercises (id, name, updated_at) values ('33333333-3333-4333-8333-333333333333', 'Landmine Press', now());
insert into public.profiles (prefs, updated_at) values ('{"unit":"lb"}', now());

do $$ begin
  if (select count(*) from public.workouts) <> 1 then raise exception 'Alice should see her own workout'; end if;
  if (select user_id from public.workouts limit 1) <> 'aaaaaaaa-0000-4000-8000-000000000001' then raise exception 'user_id should default to the signed-in user'; end if;
  if (select count(*) from public.workout_sets) <> 1 then raise exception 'reporting view should show Alice her set'; end if;
end $$;

-- ── Bob cannot see or touch any of it ────────────────────────────────────────
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';

do $$
declare n int;
begin
  if (select count(*) from public.workouts)  <> 0 then raise exception 'Bob can read Alice''s workouts'; end if;
  if (select count(*) from public.templates) <> 0 then raise exception 'Bob can read Alice''s templates'; end if;
  if (select count(*) from public.exercises) <> 0 then raise exception 'Bob can read Alice''s exercises'; end if;
  if (select count(*) from public.profiles)  <> 0 then raise exception 'Bob can read Alice''s profile'; end if;
  if (select count(*) from public.workout_sets) <> 0 then raise exception 'Bob can read Alice''s sets through the view'; end if;

  update public.workouts set name = 'hacked', updated_at = now() + interval '1 hour';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'Bob updated % of Alice''s rows', n; end if;

  delete from public.workouts;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'Bob deleted % of Alice''s rows', n; end if;

  -- inserting a row that claims to belong to Alice is rejected
  begin
    insert into public.workouts (id, user_id, name, status, started_at, updated_at)
    values ('44444444-4444-4444-8444-444444444444', 'aaaaaaaa-0000-4000-8000-000000000001', 'forged', 'completed', now(), now());
    raise exception 'Bob inserted a row owned by Alice';
  exception when insufficient_privilege then null;
  end;

  -- overwriting Alice's workout by reusing its ID is rejected
  begin
    insert into public.workouts (id, name, status, started_at, updated_at)
    values ('11111111-1111-4111-8111-111111111111', 'takeover', 'completed', now(), now() + interval '1 hour')
    on conflict (id) do update set name = excluded.name, updated_at = excluded.updated_at;
    raise exception 'Bob overwrote Alice''s workout via upsert';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ── Signed-out visitors get nothing ──────────────────────────────────────────
reset request.jwt.claim.sub;
set role anon;
do $$ begin
  begin
    perform count(*) from public.workouts;
    raise exception 'anonymous visitors can query workouts';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ── Write guards (as Alice) ──────────────────────────────────────────────────
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001';

do $$
declare before_sync timestamptz; r record;
begin
  select synced_at into before_sync from public.workouts where id = '11111111-1111-4111-8111-111111111111';

  -- a stale copy (older updated_at) must not overwrite the saved workout
  update public.workouts set name = 'stale copy', updated_at = now() - interval '1 day' where id = '11111111-1111-4111-8111-111111111111';
  select * into r from public.workouts where id = '11111111-1111-4111-8111-111111111111';
  if r.name <> 'Push Day' then raise exception 'stale write overwrote a newer workout'; end if;

  -- a completed workout can never go back to "active"
  update public.workouts set status = 'active', updated_at = now() + interval '1 minute' where id = '11111111-1111-4111-8111-111111111111';
  select * into r from public.workouts where id = '11111111-1111-4111-8111-111111111111';
  if r.status <> 'completed' then raise exception 'completed workout was un-finished'; end if;

  -- a genuine newer edit is accepted and re-stamped for sync
  update public.workouts set name = 'Push Day (edited)', updated_at = now() + interval '2 minutes' where id = '11111111-1111-4111-8111-111111111111';
  select * into r from public.workouts where id = '11111111-1111-4111-8111-111111111111';
  if r.name <> 'Push Day (edited)' then raise exception 'newer edit was not saved'; end if;
  if not (r.synced_at > before_sync) then raise exception 'synced_at was not advanced'; end if;

  -- sending the same workout again (same ID) updates in place: no duplicate
  insert into public.workouts (id, name, status, started_at, updated_at)
  values ('11111111-1111-4111-8111-111111111111', 'Push Day (edited)', 'completed', now(), now() + interval '2 minutes')
  on conflict (id) do update set name = excluded.name, updated_at = excluded.updated_at;
  if (select count(*) from public.workouts) <> 1 then raise exception 'duplicate submission created a second row'; end if;

  -- ownership cannot be reassigned
  begin
    update public.workouts set user_id = 'bbbbbbbb-0000-4000-8000-000000000002', updated_at = now() + interval '3 minutes';
    raise exception 'user_id was changed';
  exception when others then
    if sqlerrm = 'user_id was changed' then raise; end if;
  end;
end $$;

reset role;
reset request.jwt.claim.sub;
\echo 'All database checks passed'
