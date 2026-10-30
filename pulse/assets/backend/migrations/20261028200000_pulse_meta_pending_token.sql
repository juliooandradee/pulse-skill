-- When the Meta approves the login but no Instagram account is found, the token is kept as "pending" in Vault so the
-- server can look for the account without asking the owner for another SMS. It is never used to publish.
create table pulse_private.pulse_meta_pending (
 account_id uuid primary key references public.pulse_editorial_accounts(id),
 user_id uuid not null references auth.users(id),
 token_secret_id uuid not null,
 scopes text[] not null,
 created_at timestamptz not null default now()
);
create index pulse_meta_pending_user_idx on pulse_private.pulse_meta_pending(user_id);
revoke all on pulse_private.pulse_meta_pending from public,anon,authenticated;

create function public.pulse_meta_keep_pending(p_account uuid,p_user uuid,p_token text,p_scopes text[]) returns void
language plpgsql security definer set search_path='' as $$
declare secret_name text:='pulse_meta_pending_'||p_account::text; secret_ref uuid;
begin
 if not pulse_private.account_owner_user(p_account,p_user) then raise exception 'not_owner' using errcode='42501';end if;
 if p_token is null or length(p_token)<20 then raise exception 'invalid_token';end if;
 delete from pulse_private.pulse_meta_pending where account_id=p_account;
 delete from vault.secrets s where s.name=secret_name;
 secret_ref:=vault.create_secret(p_token,secret_name,'Token do Instagram aguardando a conta do Pulse');
 insert into pulse_private.pulse_meta_pending(account_id,user_id,token_secret_id,scopes) values(p_account,p_user,secret_ref,coalesce(p_scopes,'{}'));
end;
$$;

create function public.pulse_meta_take_pending(p_account uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('account_id',p.account_id,'user_id',p.user_id,'scopes',p.scopes,'created_at',p.created_at,
  'expected_handle',a.instagram_handle,'token',s.decrypted_secret)
 from pulse_private.pulse_meta_pending p
 join public.pulse_editorial_accounts a on a.id=p.account_id
 join vault.decrypted_secrets s on s.id=p.token_secret_id
 where p.account_id=p_account;
$$;

create function public.pulse_meta_drop_pending(p_account uuid) returns void
language plpgsql security definer set search_path='' as $$
declare secret_ref uuid;
begin
 delete from pulse_private.pulse_meta_pending p where p.account_id=p_account returning p.token_secret_id into secret_ref;
 if secret_ref is not null then delete from vault.secrets s where s.id=secret_ref;end if;
end;
$$;

do $$ declare fn text; begin
 foreach fn in array array['public.pulse_meta_keep_pending(uuid,uuid,text,text[])','public.pulse_meta_take_pending(uuid)','public.pulse_meta_drop_pending(uuid)'] loop
  execute format('revoke all on function %s from public,anon,authenticated',fn);
  execute format('grant execute on function %s to service_role',fn);
 end loop;
end $$;
