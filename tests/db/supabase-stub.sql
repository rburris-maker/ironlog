-- Minimal stand-in for the parts of Supabase that schema.sql relies on, so the
-- schema and its privacy rules can be tested on a plain local PostgreSQL.
-- (Real Supabase projects already have all of this. Never run this file there.)

create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key,
  email text unique
);

-- Same contract as Supabase: the signed-in user's ID comes from the request's JWT claims.
create or replace function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

do $$
begin
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
end $$;

grant usage on schema public to authenticated, anon;
grant usage on schema auth to authenticated, anon;
