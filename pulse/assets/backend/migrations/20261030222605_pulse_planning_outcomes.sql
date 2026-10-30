-- Additive results only: editorial content, published posts, versions and access grants are preserved.
create table public.pulse_post_outcomes (
 post_id uuid primary key,
 account_id uuid not null,
 metrics jsonb not null default '{}' check(jsonb_typeof(metrics)='object'),
 collected_at timestamptz,
 last_error text,
 automation_state text not null default 'none' check(automation_state in ('none','pending','linked','failed','paused')),
 automation_flow_id text,
 automation_error text,
 updated_at timestamptz not null default now(),
 foreign key(post_id,account_id) references public.pulse_editorial_posts(id,account_id)
);
alter table public.pulse_post_outcomes enable row level security;
revoke all on public.pulse_post_outcomes from public,anon,authenticated;
grant select on public.pulse_post_outcomes to authenticated;
grant all on public.pulse_post_outcomes to service_role;
create policy pulse_outcomes_owner_read on public.pulse_post_outcomes for select to authenticated using(pulse_private.editorial_owner(account_id));
create index pulse_outcomes_account_idx on public.pulse_post_outcomes(account_id);

create function public.pulse_editorial_account_context(p_account uuid,p_user uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a public.pulse_editorial_accounts; owner_id uuid;
begin
 select * into a from public.pulse_editorial_accounts where id=p_account;
 if not found then raise exception 'not_owner' using errcode='42501';end if;
 select w.owner_id into owner_id from public.pulse_workspaces w where w.id=a.workspace_id;
 if (p_user is not null and p_user<>owner_id) or not pulse_private.account_owner_user(a.id,owner_id) then raise exception 'not_owner' using errcode='42501';end if;
 return jsonb_build_object('id',a.id,'workspace_id',a.workspace_id,'owner_id',owner_id,'username',a.instagram_handle);
end;
$$;
revoke all on function public.pulse_editorial_account_context(uuid,uuid) from public,anon,authenticated;
grant execute on function public.pulse_editorial_account_context(uuid,uuid) to service_role;
-- Dedicated server capability, stored in Vault. No user JWT can configure or read it.
create table pulse_private.pulse_crm_connection(singleton boolean primary key default true check(singleton),url text not null,secret_id uuid not null);
revoke all on pulse_private.pulse_crm_connection from public,anon,authenticated;
create function public.pulse_crm_configure(p_url text,p_secret text) returns boolean
language plpgsql security definer set search_path='' as $$
declare secret_id uuid;
begin
 if p_url !~ '^https://[A-Za-z0-9.-]+(/[^?#]*)?$' or length(p_secret)<48 then raise exception 'Configuração inválida.';end if;
 select c.secret_id into secret_id from pulse_private.pulse_crm_connection c where singleton;
 if secret_id is null then select vault.create_secret(p_secret,'pulse_crm_bridge','Pulse para CRM: uma conta Instagram') into secret_id;
 else perform vault.update_secret(secret_id,p_secret);end if;
 insert into pulse_private.pulse_crm_connection(singleton,url,secret_id) values(true,p_url,secret_id) on conflict(singleton) do update set url=excluded.url,secret_id=excluded.secret_id;
 return true;
end;
$$;
create function public.pulse_crm_connection() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('url',c.url,'key',s.decrypted_secret) from pulse_private.pulse_crm_connection c join vault.decrypted_secrets s on s.id=c.secret_id where singleton;
$$;
revoke all on function public.pulse_crm_configure(text,text),public.pulse_crm_connection() from public,anon,authenticated;
grant execute on function public.pulse_crm_configure(text,text),public.pulse_crm_connection() to service_role;
