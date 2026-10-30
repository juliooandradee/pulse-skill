-- Retries CRM binding and refreshes aggregate results for confirmed publications only.
create function pulse_private.pulse_editorial_tick() returns void
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.pulse_publication_jobs j left join public.pulse_post_outcomes o on o.post_id=j.post_id where j.state='published' and j.media_id is not null and (o.collected_at is null or o.collected_at<now()-interval '1 hour' or o.automation_state='failed')) then
  perform net.http_post(url:='https://YOUR_PROJECT.supabase.co/functions/v1/pulse-editorial',headers:=jsonb_build_object('Content-Type','application/json','x-pulse-cron',(select s.decrypted_secret from vault.decrypted_secrets s where s.name='pulse_publisher_cron_secret')),body:='{"action":"tick"}'::jsonb,timeout_milliseconds:=150000);
 end if;
end;
$$;
revoke all on function pulse_private.pulse_editorial_tick() from public,anon,authenticated;
select cron.schedule('pulse-editorial-results','*/5 * * * *','select pulse_private.pulse_editorial_tick()');
