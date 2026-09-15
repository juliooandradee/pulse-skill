-- Pulse team access: additive to the existing owner policies.
create schema if not exists pulse_private;
revoke all on schema pulse_private from public, anon, authenticated;
grant usage on schema pulse_private to authenticated, service_role;

create table public.pulse_memberships (
 workspace_id uuid not null references public.pulse_workspaces(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 email text not null check (email = lower(trim(email)) and length(email) between 3 and 254),
 role text not null default 'viewer' check (role = 'viewer'),
 granted_by uuid not null references auth.users(id),
 granted_at timestamptz not null default now(),
 revoked_at timestamptz,
 revoked_by uuid references auth.users(id),
 primary key (workspace_id, user_id),
 unique (workspace_id, email)
);
create index pulse_memberships_user_idx on public.pulse_memberships(user_id,workspace_id) where revoked_at is null;
create index pulse_memberships_granter_idx on public.pulse_memberships(granted_by);
create index pulse_memberships_revoker_idx on public.pulse_memberships(revoked_by);
alter table public.pulse_memberships enable row level security;
revoke all on public.pulse_memberships from public,anon,authenticated;
grant select on public.pulse_memberships to authenticated;
grant all on public.pulse_memberships to service_role;

create function pulse_private.is_owner(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select auth.uid() is not null and exists (
  select 1 from public.pulse_workspaces w where w.id=target and w.owner_id=auth.uid()
 );
$$;
create function pulse_private.can_read(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select auth.uid() is not null and (
  exists (select 1 from public.pulse_workspaces w where w.id=target and w.owner_id=auth.uid())
  or exists (
   select 1 from public.pulse_memberships m join auth.users u on u.id=m.user_id
   where m.workspace_id=target and m.user_id=auth.uid() and m.revoked_at is null
   and u.email_confirmed_at is not null and not u.is_anonymous
   and (u.banned_until is null or u.banned_until < now())
  )
 );
$$;
revoke all on function pulse_private.is_owner(uuid),pulse_private.can_read(uuid) from public,anon;
grant execute on function pulse_private.is_owner(uuid),pulse_private.can_read(uuid) to authenticated;
create policy pulse_memberships_read on public.pulse_memberships for select to authenticated using (pulse_private.is_owner(workspace_id) or user_id=(select auth.uid()));
create policy pulse_team_read on public.pulse_workspaces for select to authenticated using (pulse_private.can_read(id));
create policy pulse_team_read on public.pulse_contents for select to authenticated using (pulse_private.can_read(workspace_id));
create policy pulse_team_read on public.pulse_comments for select to authenticated using (pulse_private.can_read(workspace_id));
create policy pulse_team_read on public.pulse_datasets for select to authenticated using (pulse_private.can_read(workspace_id));
create policy pulse_team_read on public.pulse_updates for select to authenticated using (pulse_private.can_read(workspace_id));
create policy pulse_team_files_read on storage.objects for select to authenticated using (
 bucket_id='pulse-private' and (storage.foldername(name))[1] in (select id::text from public.pulse_workspaces)
);

-- Account lookup is service-only. The Edge Function first verifies the caller and workspace ownership.
create function pulse_private.find_account(target_email text) returns jsonb
language sql stable security definer set search_path = '' as $$
 select jsonb_build_object(
  'user_id',(select id from auth.users where lower(email)=lower(trim(target_email)) limit 1),
  'reserved',false
 );
$$;
revoke all on function pulse_private.find_account(text) from public,anon,authenticated;
grant execute on function pulse_private.find_account(text) to service_role;
create function public.pulse_find_account(target_email text) returns jsonb
language sql stable security invoker set search_path = '' as $$ select pulse_private.find_account(target_email); $$;
revoke all on function public.pulse_find_account(text) from public,anon,authenticated;
grant execute on function public.pulse_find_account(text) to service_role;
