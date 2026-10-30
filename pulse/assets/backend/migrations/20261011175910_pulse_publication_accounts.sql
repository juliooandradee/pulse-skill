-- Add isolated editorial accounts without changing history or team grants.
create table public.pulse_editorial_accounts (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.pulse_workspaces(id),
 account_key text not null check (account_key ~ '^[a-z0-9-]{1,50}$'),
 name text not null check (length(name) between 1 and 100),
 instagram_handle text check (instagram_handle ~ '^[A-Za-z0-9_.]{1,30}$'),
 connection_status text not null default 'not_connected' check (connection_status in ('not_connected','connected','expired')),
 created_at timestamptz not null default now(),
 unique(workspace_id,account_key)
);
alter table public.pulse_editorial_accounts enable row level security;
revoke all on public.pulse_editorial_accounts from public,anon,authenticated;
grant select on public.pulse_editorial_accounts to authenticated;
grant all on public.pulse_editorial_accounts to service_role;

create function pulse_private.editorial_owner(target uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists (
  select 1 from public.pulse_editorial_accounts a
  join public.pulse_workspaces w on w.id=a.workspace_id
  join auth.users u on u.id=w.owner_id
  where a.id=target and w.owner_id=auth.uid() and u.email_confirmed_at is not null
    and not u.is_anonymous and (u.banned_until is null or u.banned_until<now())
 );
$$;
revoke all on function pulse_private.editorial_owner(uuid) from public,anon;
grant execute on function pulse_private.editorial_owner(uuid) to authenticated,service_role;
create policy pulse_editorial_accounts_owner on public.pulse_editorial_accounts for select to authenticated using (pulse_private.editorial_owner(id));

create table public.pulse_editorial_posts (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.pulse_editorial_accounts(id),
 content jsonb not null,
 origin jsonb,
 status text not null default 'draft' check(status in ('draft','review','planned')),
 planned_at timestamptz,
 revision integer not null default 1 check(revision>0),
 created_by uuid not null default auth.uid() references auth.users(id),
 updated_by uuid not null default auth.uid() references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(id,account_id),
 check ((status='planned')=(planned_at is not null))
);
create index pulse_editorial_posts_account_idx on public.pulse_editorial_posts(account_id,updated_at desc);
create index pulse_editorial_posts_calendar_idx on public.pulse_editorial_posts(account_id,planned_at) where planned_at is not null;
create index pulse_editorial_posts_creator_idx on public.pulse_editorial_posts(created_by);
create index pulse_editorial_posts_editor_idx on public.pulse_editorial_posts(updated_by);
alter table public.pulse_editorial_posts enable row level security;
revoke all on public.pulse_editorial_posts from public,anon,authenticated;
grant select on public.pulse_editorial_posts to authenticated;
grant insert(id,account_id,content,origin,status,planned_at) on public.pulse_editorial_posts to authenticated;
grant update(content,origin,status,planned_at,revision) on public.pulse_editorial_posts to authenticated;
grant all on public.pulse_editorial_posts to service_role;
create policy pulse_editorial_posts_read on public.pulse_editorial_posts for select to authenticated using(pulse_private.editorial_owner(account_id));
create policy pulse_editorial_posts_insert on public.pulse_editorial_posts for insert to authenticated with check(pulse_private.editorial_owner(account_id) and created_by=(select auth.uid()));
create policy pulse_editorial_posts_update on public.pulse_editorial_posts for update to authenticated using(pulse_private.editorial_owner(account_id)) with check(pulse_private.editorial_owner(account_id));

create table public.pulse_editorial_versions (
 post_id uuid not null,
 account_id uuid not null,
 revision integer not null,
 content jsonb not null,
 origin jsonb,
 status text not null,
 planned_at timestamptz,
 actor_id uuid not null references auth.users(id),
 recorded_at timestamptz not null default now(),
 primary key(post_id,revision),
 foreign key(post_id,account_id) references public.pulse_editorial_posts(id,account_id)
);
create index pulse_editorial_versions_account_idx on public.pulse_editorial_versions(account_id);
create index pulse_editorial_versions_actor_idx on public.pulse_editorial_versions(actor_id);
alter table public.pulse_editorial_versions enable row level security;
revoke all on public.pulse_editorial_versions from public,anon,authenticated;
grant select on public.pulse_editorial_versions to authenticated;
grant all on public.pulse_editorial_versions to service_role;
create policy pulse_editorial_versions_read on public.pulse_editorial_versions for select to authenticated using(pulse_private.editorial_owner(account_id));

create function pulse_private.validate_editorial_post() returns trigger
language plpgsql security invoker set search_path='' as $$
declare slide jsonb; source jsonb;
begin
 if auth.uid() is null or not pulse_private.editorial_owner(new.account_id) then raise exception 'Acesso editorial não autorizado.' using errcode='42501'; end if;
 if tg_op='INSERT' then
  new.revision:=1;new.created_by:=auth.uid();new.created_at:=now();
 else
  if new.account_id<>old.account_id or new.id<>old.id or new.created_by<>old.created_by or new.created_at<>old.created_at then raise exception 'A origem do rascunho é imutável.';end if;
  if new.revision<>old.revision+1 then raise exception 'A versão mudou. Reabra o rascunho antes de salvar.' using errcode='40001';end if;
 end if;
 if jsonb_typeof(new.content) is distinct from 'object' or octet_length(new.content::text)>150000 then raise exception 'Conteúdo inválido ou muito grande.';end if;
 if jsonb_typeof(new.content->'title') is distinct from 'string' or length(trim(new.content->>'title')) not between 1 and 160 then raise exception 'Informe um título de até 160 caracteres.';end if;
 if jsonb_typeof(new.content->'caption') is distinct from 'string' or length(new.content->>'caption')>2200 then raise exception 'Legenda inválida.';end if;
 if jsonb_typeof(new.content->'slides') is distinct from 'array' then raise exception 'Slides inválidos.';end if;
 if jsonb_array_length(new.content->'slides') not between 2 and 10 then raise exception 'Use de 2 a 10 slides.';end if;
 for slide in select value from jsonb_array_elements(new.content->'slides') loop
  if jsonb_typeof(slide->'headline') is distinct from 'string' or length(slide->>'headline')>120
     or jsonb_typeof(slide->'body') is distinct from 'string' or length(slide->>'body')>600
     or jsonb_typeof(slide->'alt') is distinct from 'string' or length(slide->>'alt')>500
     then raise exception 'Revise os campos do slide.';end if;
  if new.status<>'draft' and (length(trim(slide->>'headline'))=0 or length(trim(slide->>'alt'))=0) then raise exception 'Complete os títulos e textos alternativos.';end if;
 end loop;
 if jsonb_typeof(new.content->'sources') is distinct from 'array' then raise exception 'Fontes inválidas.';end if;
 if jsonb_array_length(new.content->'sources')>30 then raise exception 'Use até 30 fontes.';end if;
 for source in select value from jsonb_array_elements(new.content->'sources') loop
  if jsonb_typeof(source->'url') is distinct from 'string' or (source->>'url') !~ '^https://[^/[:space:]]+' or length(source->>'url')>2048 then raise exception 'Use uma fonte HTTPS válida.';end if;
 end loop;
 if new.status<>'draft' and (length(trim(new.content->>'caption'))=0 or jsonb_array_length(new.content->'sources')=0) then raise exception 'Complete a legenda e inclua uma fonte antes de revisar ou planejar.';end if;
 if new.origin is not null and (jsonb_typeof(new.origin)<>'object' or octet_length(new.origin::text)>20000) then raise exception 'Origem inválida.';end if;
 if new.status='planned' and (new.planned_at is null or new.planned_at<=now()) then raise exception 'Escolha um horário futuro para o planejamento.';end if;
 new.updated_by:=auth.uid();new.updated_at:=now();return new;
end;
$$;
revoke all on function pulse_private.validate_editorial_post() from public,anon,authenticated;
create trigger pulse_editorial_post_validation before insert or update on public.pulse_editorial_posts for each row execute function pulse_private.validate_editorial_post();

create function pulse_private.record_editorial_version() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not pulse_private.editorial_owner(new.account_id) then raise exception 'Acesso editorial não autorizado.' using errcode='42501';end if;
 insert into public.pulse_editorial_versions(post_id,account_id,revision,content,origin,status,planned_at,actor_id)
 values(new.id,new.account_id,new.revision,new.content,new.origin,new.status,new.planned_at,auth.uid());return new;
end;
$$;
revoke all on function pulse_private.record_editorial_version() from public,anon,authenticated;
create trigger pulse_editorial_version_record after insert or update on public.pulse_editorial_posts for each row execute function pulse_private.record_editorial_version();

-- Create your own editorial accounts after configuring the workspace.
