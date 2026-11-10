-- Database-level tests for groups: who can see what, and who can change what.
-- Run after schema.sql:  psql -v ON_ERROR_STOP=1 -f tests/db/groups.test.sql
-- Every check raises an exception if it fails, so reaching the end means all passed.

\set ON_ERROR_STOP on
\set QUIET on

reset role;
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-0000000000a1', 'alice.grp@example.com'),
  ('bbbbbbbb-0000-4000-8000-0000000000b2', 'bob.grp@example.com'),
  ('cccccccc-0000-4000-8000-0000000000c3', 'carol.grp@example.com')
on conflict do nothing;
delete from public.groups;
delete from public.workouts where user_id in ('aaaaaaaa-0000-4000-8000-0000000000a1', 'bbbbbbbb-0000-4000-8000-0000000000b2', 'cccccccc-0000-4000-8000-0000000000c3');

create or replace function pg_temp.fails(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return true;
end $$;
create temp table t (k text primary key, v text);
grant all on t to authenticated, anon;

-- ── Bob trained BEFORE any group existed ─────────────────────────────────────
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-0000000000b2';
insert into public.workouts (id, name, status, unit, started_at, duration_seconds, exercises, updated_at)
values ('b0000000-0000-4000-8000-000000000001', 'Old Bob Workout', 'completed', 'lb', now() - interval '2 days', 1800,
        '[{"uid":"e1","exerciseId":"squat","name":"Back Squat","sets":[{"id":"s1","weight":225,"reps":5,"done":true}]}]', now());

-- ── Alice creates a group ────────────────────────────────────────────────────
set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-0000000000a1';
insert into t select 'group', public.group_create('  Morning Crew ', 'Alice') ->> 'id';
insert into t select 'code', (public.my_groups(now() - interval '7 days') -> 0) ->> 'join_code';

do $$
declare g jsonb := public.my_groups(now() - interval '7 days') -> 0;
begin
  if g ->> 'name' <> 'Morning Crew' then raise exception 'name should be trimmed'; end if;
  if g ->> 'join_code' !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$' then raise exception 'bad join code %', g ->> 'join_code'; end if;
  if (g ->> 'member_count')::int <> 1 then raise exception 'creator should be the only member'; end if;
  -- the tables themselves are closed to the app
  if not pg_temp.fails('select * from public.groups') then raise exception 'groups table is readable directly'; end if;
  if not pg_temp.fails('select * from public.group_members') then raise exception 'group_members table is readable directly'; end if;
  if not pg_temp.fails('insert into public.group_members (group_id, user_id, display_name) select id, auth.uid(), ''x'' from public.groups') then raise exception 'group_members is writable directly'; end if;
  if not pg_temp.fails('select public.ironlog_group_json(null, null)') then raise exception 'helper is callable'; end if;
  if not pg_temp.fails('select public.group_create('''', ''Alice'')') then raise exception 'empty group name accepted'; end if;
end $$;

-- ── Carol (never joins) and signed-out visitors see nothing ──────────────────
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-0000000000c3';
do $$
declare g uuid := (select v::uuid from t where k = 'group');
begin
  if public.my_groups(now()) <> '[]'::jsonb then raise exception 'Carol has groups'; end if;
  if not pg_temp.fails(format('select public.group_overview(%L, now() - interval ''7 days'')', g)) then raise exception 'outsider can read a group'; end if;
  if not pg_temp.fails(format('select public.group_post_create(%L, ''X'', ''lb'', ''[{}]'', '''')', g)) then raise exception 'outsider can post'; end if;
  if not pg_temp.fails(format('select public.group_update(%L, ''Hacked'', 3)', g)) then raise exception 'outsider can rename'; end if;
  if not pg_temp.fails(format('select public.group_delete(%L)', g)) then raise exception 'outsider can delete'; end if;
  if not pg_temp.fails('select public.group_join(''ZZZZZZ'', ''Carol'')') then raise exception 'a wrong code joined something'; end if;
end $$;
set role anon;
reset request.jwt.claim.sub;
do $$ begin
  if not pg_temp.fails('select public.my_groups(now())') then raise exception 'signed-out visitors can call group functions'; end if;
  if not pg_temp.fails('select public.group_join(''ABCDEF'', ''x'')') then raise exception 'signed-out visitors can join'; end if;
end $$;

-- ── Bob joins with the code (typed in lower case with a space) ───────────────
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-0000000000b2';
do $$
declare code text := (select v from t where k = 'code'); g jsonb;
begin
  g := public.group_join(lower(substr(code, 1, 3)) || ' ' || substr(code, 4), 'Bob');
  if g ->> 'id' <> (select v from t where k = 'group') then raise exception 'joined the wrong group'; end if;
  if (g ->> 'member_count')::int <> 2 then raise exception 'member count should be 2'; end if;
  -- joining twice changes nothing
  if (public.group_join(code, 'Bobby') ->> 'display_name') <> 'Bob' then raise exception 'second join should be a no-op'; end if;
  if not pg_temp.fails(format('select public.group_update(%L, ''Bobs Crew'', 3)', g ->> 'id')) then raise exception 'a member can rename the group'; end if;
  if not pg_temp.fails(format('select public.group_remove_member(%L, %L)', g ->> 'id', 'aaaaaaaa-0000-4000-8000-0000000000a1')) then raise exception 'a member can remove the owner'; end if;
end $$;

-- Bob finishes a workout after joining (with a private note), and has one in progress
insert into public.workouts (id, name, status, unit, started_at, duration_seconds, notes, exercises, highlights, updated_at)
values ('b0000000-0000-4000-8000-000000000002', 'Bob Legs', 'completed', 'kg', now(), 2400, 'private workout note',
        '[{"uid":"e1","exerciseId":"squat","name":"Back Squat","notes":"knee felt off","sets":[{"id":"s1","weight":100,"reps":5,"done":true},{"id":"s2","weight":100,"reps":5,"done":false},{"id":"s3","weight":null,"reps":null,"done":false}]}]',
        '{"unit":"kg","prs":[{"type":"weight","exerciseName":"Back Squat","weight":100,"reps":5}]}', now());
insert into public.workouts (id, name, status, unit, started_at, exercises, updated_at)
values ('b0000000-0000-4000-8000-000000000003', 'Bob Now', 'active', 'kg', now(), '[]', now());

-- ── What Alice can see of Bob ────────────────────────────────────────────────
set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-0000000000a1';
do $$
declare
  g uuid := (select v::uuid from t where k = 'group');
  o jsonb := public.group_overview(g, now() - interval '30 days');
  w jsonb;
  bob jsonb;
begin
  if (select count(*) from public.workouts) <> 0 then raise exception 'Alice can read Bob''s workouts table rows directly'; end if;
  if jsonb_array_length(o -> 'members') <> 2 then raise exception 'two members expected'; end if;
  if jsonb_array_length(o -> 'workouts') <> 1 then raise exception 'only the workout finished after joining is shared, got %', jsonb_array_length(o -> 'workouts'); end if;
  w := o -> 'workouts' -> 0;
  if w ->> 'name' <> 'Bob Legs' or (w ->> 'sets')::int <> 1 or (w ->> 'prs')::int <> 1 then raise exception 'wrong summary: %', w; end if;
  if w ? 'exercises' or w ? 'notes' then raise exception 'the list must not carry full detail'; end if;
  if w -> 'exercise_names' <> '["Back Squat"]'::jsonb then raise exception 'exercise names missing'; end if;
  select m into bob from jsonb_array_elements(o -> 'members') m where m ->> 'display_name' = 'Bob';
  if bob ->> 'active_since' is null then raise exception 'Bob should show as working out now'; end if;
  if (public.my_groups(now() - interval '7 days') -> 0 ->> 'trained')::int <> 1 then raise exception 'one member has trained this week'; end if;

  w := public.group_workout(g, 'b0000000-0000-4000-8000-000000000002');
  if w -> 'exercises' -> 0 -> 'sets' -> 0 ->> 'weight' <> '100' then raise exception 'full detail should include the sets'; end if;
  if w::text like '%knee felt off%' or w::text like '%private workout note%' then raise exception 'notes leaked: %', w; end if;
  if w -> 'highlights' -> 'prs' -> 0 ->> 'type' <> 'weight' then raise exception 'records should be included'; end if;
  if not pg_temp.fails(format('select public.group_workout(%L, %L)', g, 'b0000000-0000-4000-8000-000000000001')) then raise exception 'a workout from before joining is visible'; end if;
  if not pg_temp.fails(format('select public.group_workout(%L, %L)', g, 'b0000000-0000-4000-8000-000000000003')) then raise exception 'an unfinished workout is visible'; end if;
end $$;

-- ── Group workouts: Alice posts one, Bob does it ─────────────────────────────
insert into t select 'post', public.group_post_create((select v::uuid from t where k = 'group'), 'Saturday Legs', 'lb',
  '[{"uid":"p1","exerciseId":"squat","name":"Back Squat","sets":[{"weight":null,"reps":5}]}]', 'Go heavy') ->> 'id';
do $$ begin
  if not pg_temp.fails(format('select public.group_post_create(%L, ''Empty'', ''lb'', ''[]'', '''')', (select v from t where k = 'group'))) then raise exception 'an empty workout was posted'; end if;
end $$;

set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-0000000000b2';
update public.workouts set group_post_id = (select v::uuid from t where k = 'post'), updated_at = now() + interval '1 second'
 where id = 'b0000000-0000-4000-8000-000000000002';
do $$
declare r jsonb := public.group_post_results((select v::uuid from t where k = 'post'));
begin
  if r -> 'post' ->> 'name' <> 'Saturday Legs' or jsonb_array_length(r -> 'results') <> 1 then raise exception 'results board wrong: %', r; end if;
  -- Bob did not post it and is not the owner
  if not pg_temp.fails(format('select public.group_post_delete(%L)', (select v from t where k = 'post'))) then raise exception 'a member deleted someone else''s post'; end if;
end $$;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-0000000000c3';
do $$ begin
  if not pg_temp.fails(format('select public.group_post_results(%L)', (select v from t where k = 'post'))) then raise exception 'outsider can read results'; end if;
  if not pg_temp.fails(format('select public.group_workout(%L, %L)', (select v from t where k = 'group'), 'b0000000-0000-4000-8000-000000000002')) then raise exception 'outsider can read a shared workout'; end if;
end $$;

-- ── Bob switches sharing off: everything of his disappears for Alice ─────────
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-0000000000b2';
select public.group_set_me((select v::uuid from t where k = 'group'), 'Bob', false) \gset ignore_
set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-0000000000a1';
do $$
declare g uuid := (select v::uuid from t where k = 'group'); o jsonb := public.group_overview(g, now() - interval '30 days'); bob jsonb;
begin
  if jsonb_array_length(o -> 'workouts') <> 0 then raise exception 'workouts still shared after switching off'; end if;
  select m into bob from jsonb_array_elements(o -> 'members') m where m ->> 'display_name' = 'Bob';
  if bob ->> 'active_since' is not null then raise exception 'activity still shared after switching off'; end if;
  if (o -> 'posts' -> 0 ->> 'results')::int <> 0 then raise exception 'result count still includes Bob'; end if;
  if jsonb_array_length(public.group_post_results((select v::uuid from t where k = 'post')) -> 'results') <> 0 then raise exception 'result still shared'; end if;
  if not pg_temp.fails(format('select public.group_workout(%L, %L)', g, 'b0000000-0000-4000-8000-000000000002')) then raise exception 'workout still readable'; end if;
  -- owner powers
  if (public.group_update(g, 'Dawn Patrol', 4) ->> 'weekly_goal')::int <> 4 then raise exception 'owner could not update'; end if;
  if not pg_temp.fails(format('select public.group_update(%L, ''x'', 99)', g)) then raise exception 'silly weekly goal accepted'; end if;
end $$;

-- ── The owner leaves: Bob becomes the owner; when he leaves too the group is gone ──
select public.group_leave((select v::uuid from t where k = 'group')) \gset ignore_
do $$ begin
  if public.my_groups(now()) <> '[]'::jsonb then raise exception 'Alice still has the group'; end if;
  if not pg_temp.fails(format('select public.group_overview(%L, now())', (select v from t where k = 'group'))) then raise exception 'a former member can still read the group'; end if;
end $$;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-0000000000b2';
do $$
declare g jsonb := public.my_groups(now()) -> 0;
begin
  if g ->> 'owner_id' <> 'bbbbbbbb-0000-4000-8000-0000000000b2' then raise exception 'ownership was not handed on'; end if;
  perform public.group_leave((g ->> 'id')::uuid);
end $$;
reset role;
reset request.jwt.claim.sub;
do $$ begin
  if (select count(*) from public.groups) <> 0 then raise exception 'empty group was not deleted'; end if;
  if (select count(*) from public.group_posts) <> 0 then raise exception 'posts of a deleted group remain'; end if;
  if (select count(*) from public.workouts where id = 'b0000000-0000-4000-8000-000000000002') <> 1 then raise exception 'a member''s workout was deleted with the group'; end if;
end $$;
delete from public.workouts where user_id = 'bbbbbbbb-0000-4000-8000-0000000000b2';
\echo 'All group checks passed'
