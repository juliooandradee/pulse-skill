-- Minimal Supabase surface for local SQL tests (roles, auth, storage, vault). Not a migration.
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
grant usage on schema public to anon,authenticated,service_role;
alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
alter default privileges in schema public grant all on functions to anon,authenticated,service_role;
create schema extensions; create extension pgcrypto with schema extensions;
grant usage on schema extensions to anon,authenticated,service_role;
create schema auth; grant usage on schema auth to anon,authenticated,service_role;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean not null default false,banned_until timestamptz);
-- Same definition as the Supabase project: request.jwt.claim.sub wins over the claims JSON.
create function auth.uid() returns uuid language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub'))::uuid
$$;
create schema storage; grant usage on schema storage to anon,authenticated,service_role;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,created_at timestamptz default now(),unique(bucket_id,name));
alter table storage.objects enable row level security;
grant select,insert on storage.objects to authenticated; grant all on storage.objects to service_role;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
create function storage.extension(name text) returns text language sql immutable as $$ select reverse(split_part(reverse(name),'.',1)) $$;
create schema vault;
create table vault.secrets(id uuid primary key default gen_random_uuid(),name text unique,description text,secret text not null);
create view vault.decrypted_secrets as select id,name,description,secret as decrypted_secret from vault.secrets;
create function vault.create_secret(new_secret text,new_name text default null,new_description text default '',new_key_id uuid default null) returns uuid
 language sql as $$ insert into vault.secrets(name,description,secret) values(new_name,new_description,new_secret) returning id $$;
create function vault.update_secret(secret_id uuid,new_secret text default null,new_name text default null,new_description text default null,new_key_id uuid default null) returns void
 language sql as $$ update vault.secrets set secret=coalesce(new_secret,secret) where id=secret_id $$;
create table public.bootstrap_admins(email text primary key);
