-- Image, reel and Insights queue. Runs inside a transaction and rolls back.
begin;
select set_config('test.pulse.owner',(select owner_id::text from public.pulse_workspaces where handle='perfil.exemplo'),true);
select set_config('test.pulse.workspace',(select id::text from public.pulse_workspaces where handle='perfil.exemplo'),true);
select set_config('test.pulse.julio',(select id::text from public.pulse_editorial_accounts where account_key='principal'),true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role anon;
do $$ begin
 begin perform public.pulse_queue_media(current_setting('test.pulse.julio')::uuid,'image','Legenda',now(),'[]'::jsonb); raise exception 'anon queued';
 exception when insufficient_privilege then null; end;
 begin perform 1 from public.pulse_media_insights; raise exception 'anon read insights';
 exception when insufficient_privilege then null; end;
 begin perform public.pulse_insights_due(1); raise exception 'anon triggered insights';
 exception when insufficient_privilege then null; end;
 begin perform public.pulse_publisher_claim(60); raise exception 'anon claimed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role service_role;
do $$ begin
 perform public.pulse_meta_save_connection(current_setting('test.pulse.julio')::uuid,current_setting('test.pulse.owner')::uuid,'17841400000000021','perfil.exemplo','token-de-teste-com-mais-de-20','{instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,business_management}',now()+interval '60 days');
end $$;
reset role;
do $$ begin
 if (select insights_granted from pulse_private.pulse_meta_connections where account_id=current_setting('test.pulse.julio')::uuid) then raise exception 'Insights marked without the scope'; end if;
end $$;
set local role service_role;
do $$ begin
 perform public.pulse_meta_save_connection(current_setting('test.pulse.julio')::uuid,current_setting('test.pulse.owner')::uuid,'17841400000000021','perfil.exemplo','token-de-teste-com-mais-de-20','{instagram_basic,instagram_content_publish,instagram_manage_insights,pages_show_list,pages_read_engagement,business_management}',now()+interval '60 days');
end $$;
reset role;
do $$ begin
 if not (select insights_granted from pulse_private.pulse_meta_connections where account_id=current_setting('test.pulse.julio')::uuid) then raise exception 'Insights scope not recorded'; end if;
end $$;
set local role service_role;
do $$ declare state text; job jsonb; again jsonb; listed record; begin
 state:=public.pulse_meta_oauth_begin_service(current_setting('test.pulse.julio')::uuid);
 if state !~ '^[0-9a-f]{64}$' then raise exception 'OAuth state invalid'; end if;
 if (select count(*) from public.pulse_meta_oauth_consume(state))<>1 then raise exception 'State not consumed'; end if;
 if (select count(*) from public.pulse_meta_oauth_consume(state))<>0 then raise exception 'State reused'; end if;
 perform set_config('test.pulse.job',gen_random_uuid()::text,true);
 insert into storage.objects(bucket_id,name) values('pulse-private',current_setting('test.pulse.workspace')||'/instagram/'||current_setting('test.pulse.job')||'/slide-01.jpg');
 begin
  perform public.pulse_queue_media(current_setting('test.pulse.julio')::uuid,'reel','Legenda',now(),jsonb_build_array(jsonb_build_object('path',current_setting('test.pulse.workspace')||'/instagram/'||current_setting('test.pulse.job')||'/slide-01.jpg')),current_setting('test.pulse.job')::uuid);
  raise exception 'JPEG accepted as reel';
 exception when raise_exception then if sqlerrm not like 'O Reels precisa%' then raise; end if; end;
 job:=public.pulse_queue_media(current_setting('test.pulse.julio')::uuid,'image','Legenda da imagem',now(),jsonb_build_array(jsonb_build_object('path',current_setting('test.pulse.workspace')||'/instagram/'||current_setting('test.pulse.job')||'/slide-01.jpg','bucket','pulse-private')),current_setting('test.pulse.job')::uuid);
 if job->>'media_type'<>'image' or job->>'state'<>'scheduled' then raise exception 'Image not queued'; end if;
 again:=public.pulse_publisher_claim(300);
 if again->>'media_type'<>'image' or again->>'caption'<>'Legenda da imagem' or again->>'token'<>'token-de-teste-com-mais-de-20' then raise exception 'Claim payload wrong'; end if;
 if public.pulse_publisher_claim(300) is not null then raise exception 'Leased image claimed twice'; end if;
 begin
  perform public.pulse_cancel_media((again->>'job_id')::uuid);
  raise exception 'Publishing image was cancelled';
 exception when object_not_in_prerequisite_state then null; end;
 update public.pulse_publication_jobs set state='scheduled',lease_id=null,lease_until=null where id=(again->>'job_id')::uuid;
 if (public.pulse_cancel_media((again->>'job_id')::uuid)->>'state')<>'cancelled' then raise exception 'Cancel failed'; end if;
 perform set_config('test.pulse.later',gen_random_uuid()::text,true);
 insert into storage.objects(bucket_id,name) values('pulse-private',current_setting('test.pulse.workspace')||'/instagram/'||current_setting('test.pulse.later')||'/reel.mp4');
 perform public.pulse_queue_media(current_setting('test.pulse.julio')::uuid,'reel','Legenda do Reels',now()+interval '2 days',jsonb_build_array(jsonb_build_object('path',current_setting('test.pulse.workspace')||'/instagram/'||current_setting('test.pulse.later')||'/reel.mp4','bucket','pulse-private')),current_setting('test.pulse.later')::uuid);
 if public.pulse_publisher_claim(300) is not null then raise exception 'Future reel claimed'; end if;
 select * into listed from public.pulse_list_publication_queue(current_setting('test.pulse.julio')::uuid) where job_id=current_setting('test.pulse.later')::uuid;
 if listed.media_type<>'reel' or listed.caption<>'Legenda do Reels' then raise exception 'Queue list missing reel'; end if;
 perform public.pulse_insights_save('17841400000000021',current_setting('test.pulse.julio')::uuid,current_setting('test.pulse.later')::uuid,'reel','https://www.instagram.com/reel/abc/',11,2,1,3,4,null,'{"reach":11}'::jsonb,null);
 if (select plays from public.pulse_media_insights where media_id='17841400000000021') is not null then raise exception 'Missing plays became a number'; end if;
 if (select reach from public.pulse_media_insights where media_id='17841400000000021')<>11 then raise exception 'Reach not stored'; end if;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.pulse.owner'),'role','authenticated')::text,true);
do $$ begin
 if (select reach from public.pulse_media_insights where media_id='17841400000000021')<>11 then raise exception 'Owner cannot read insights'; end if;
 insert into storage.objects(bucket_id,name) values('pulse-private',current_setting('test.pulse.workspace')||'/instagram/'||gen_random_uuid()::text||'/slide-01.jpg');
end $$;
reset role;
rollback;
select 'instagram-pipeline: ok' as result;
