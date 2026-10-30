-- New Meta apps only offer the Instagram API with Unified Login: the publish scope is instagram_content_publish
-- and the business integration token does not expire, so the daily token refresh is removed.
create or replace function public.pulse_meta_save_connection(p_account uuid,p_user uuid,p_ig_user_id text,p_username text,p_token text,p_scopes text[],p_expires_at timestamptz) returns void
language plpgsql security definer set search_path='' as $$
declare account public.pulse_editorial_accounts; secret_ref uuid; secret_name text:='pulse_meta_token_'||p_account::text;
begin
 select * into account from public.pulse_editorial_accounts a where a.id=p_account for update;
 if not found or not pulse_private.account_owner_user(p_account,p_user) then raise exception 'not_owner' using errcode='42501';end if;
 if account.instagram_handle is not null and lower(account.instagram_handle)<>lower(p_username) then raise exception 'handle_mismatch';end if;
 if exists(select 1 from pulse_private.pulse_meta_connections c where c.ig_user_id=p_ig_user_id and c.account_id<>p_account) then raise exception 'ig_in_use';end if;
 if not (p_scopes && array['instagram_content_publish','instagram_business_content_publish']) then raise exception 'missing_publish_scope';end if;
 if p_token is null or length(p_token)<20 or p_expires_at is null or p_expires_at<=now() then raise exception 'invalid_token';end if;
 select c.token_secret_id into secret_ref from pulse_private.pulse_meta_connections c where c.account_id=p_account;
 if secret_ref is null then
  delete from vault.secrets s where s.name=secret_name;
  secret_ref:=vault.create_secret(p_token,secret_name,'Token do Instagram usado pelo Pulse');
 else
  perform vault.update_secret(secret_ref,p_token);
 end if;
 insert into pulse_private.pulse_meta_connections(account_id,ig_user_id,username,token_secret_id,scopes,expires_at,refreshed_at,connected_by,connected_at)
 values(p_account,p_ig_user_id,p_username,secret_ref,p_scopes,p_expires_at,now(),p_user,now())
 on conflict (account_id) do update set ig_user_id=excluded.ig_user_id,username=excluded.username,token_secret_id=excluded.token_secret_id,
  scopes=excluded.scopes,expires_at=excluded.expires_at,refreshed_at=now(),connected_by=excluded.connected_by,connected_at=now();
 update public.pulse_editorial_accounts set connection_status='connected',instagram_handle=coalesce(instagram_handle,lower(p_username)),connection_expires_at=p_expires_at where id=p_account;
end;
$$;

drop function public.pulse_meta_tokens_due(interval);

create or replace function pulse_private.pulse_publisher_tick() returns void
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.pulse_publication_jobs j
           where (j.state='scheduled' and j.scheduled_at<=now() and coalesce(j.next_attempt_at,'-infinity')<=now())
              or (j.state='publishing' and j.lease_until<now())) then
  perform net.http_post(
   url:='https://YOUR_PROJECT.supabase.co/functions/v1/pulse-publisher',
   headers:=jsonb_build_object('Content-Type','application/json','x-pulse-cron',(select s.decrypted_secret from vault.decrypted_secrets s where s.name='pulse_publisher_cron_secret')),
   body:='{"action":"tick"}'::jsonb,
   timeout_milliseconds:=150000);
 end if;
end;
$$;
revoke all on function pulse_private.pulse_publisher_tick() from public,anon,authenticated;
