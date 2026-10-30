-- Activation only: apply after pulse-publisher is deployed and its secrets are configured.
-- Every minute the database checks for due work and, only then, wakes the Edge Function.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

select vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'pulse_publisher_cron_secret','Chamada do agendador para a função pulse-publisher')
where not exists (select 1 from vault.secrets where name='pulse_publisher_cron_secret');

create function public.pulse_publisher_cron_ok(p_secret text) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(length(p_secret)>=64 and exists(select 1 from vault.decrypted_secrets s where s.name='pulse_publisher_cron_secret' and s.decrypted_secret=p_secret),false);
$$;
revoke all on function public.pulse_publisher_cron_ok(text) from public,anon,authenticated;
grant execute on function public.pulse_publisher_cron_ok(text) to service_role;

create function pulse_private.pulse_publisher_tick() returns void
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.pulse_publication_jobs j
           where (j.state='scheduled' and j.scheduled_at<=now() and coalesce(j.next_attempt_at,'-infinity')<=now())
              or (j.state='publishing' and j.lease_until<now()))
    or exists(select 1 from pulse_private.pulse_meta_connections c
              where c.expires_at>now() and c.expires_at<now()+interval '15 days' and c.refreshed_at<now()-interval '1 day') then
  perform net.http_post(
   url:='https://YOUR_PROJECT.supabase.co/functions/v1/pulse-publisher',
   headers:=jsonb_build_object('Content-Type','application/json','x-pulse-cron',(select s.decrypted_secret from vault.decrypted_secrets s where s.name='pulse_publisher_cron_secret')),
   body:='{"action":"tick"}'::jsonb,
   timeout_milliseconds:=150000);
 end if;
end;
$$;
revoke all on function pulse_private.pulse_publisher_tick() from public,anon,authenticated;

select cron.schedule('pulse-publisher','* * * * *','select pulse_private.pulse_publisher_tick()');
