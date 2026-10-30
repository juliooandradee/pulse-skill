-- Automatic publishing: ownership, queue, leases and Vault token. Runs inside a transaction and rolls back.
begin;
select set_config('test.pulse.owner',(select owner_id::text from public.pulse_workspaces where handle='perfil.exemplo'),true);
select set_config('test.pulse.workspace',(select id::text from public.pulse_workspaces where handle='perfil.exemplo'),true);
select set_config('test.pulse.julio',(select id::text from public.pulse_editorial_accounts where account_key='principal'),true);
select set_config('test.pulse.post',gen_random_uuid()::text,true);
select set_config('test.pulse.second',gen_random_uuid()::text,true);
select set_config('test.pulse.path',current_setting('test.pulse.workspace')||'/publication/'||current_setting('test.pulse.post')||'/test01/slide-',true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.pulse.owner'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare total integer; begin
 insert into public.pulse_editorial_posts(id,account_id,content) values
  (current_setting('test.pulse.post')::uuid,current_setting('test.pulse.julio')::uuid,'{"title":"Teste de publicação","caption":"Comenta GUIA que eu te mando o material","sources":[{"url":"https://example.com/source"}],"slides":[{"headline":"Capa","body":"Texto","alt":"Capa"},{"headline":"Contexto","body":"Texto","alt":"Contexto"}]}'),
  (current_setting('test.pulse.second')::uuid,current_setting('test.pulse.julio')::uuid,'{"title":"Segundo","caption":"Legenda","sources":[{"url":"https://example.com/source"}],"slides":[{"headline":"Capa","body":"Texto","alt":"Capa"},{"headline":"Contexto","body":"Texto","alt":"Contexto"}]}');
 begin
  update public.pulse_editorial_posts set status='scheduled',planned_at=now()+interval '1 day',revision=2 where id=current_setting('test.pulse.post')::uuid;
  raise exception 'Direct scheduled status allowed';
 exception when insufficient_privilege then null;end;
 begin
  perform public.pulse_schedule_publication(current_setting('test.pulse.post')::uuid,1,now()+interval '1 day','[]'::jsonb);
  raise exception 'Scheduling without a connection allowed';
 exception when object_not_in_prerequisite_state then null;end;
 begin
  perform public.pulse_publisher_claim(300);
  raise exception 'Owner could call the publisher';
 exception when insufficient_privilege then null;end;
 perform set_config('test.pulse.state',public.pulse_meta_oauth_begin(current_setting('test.pulse.julio')::uuid),true);
 insert into storage.objects(bucket_id,name) values
  ('pulse-private',current_setting('test.pulse.path')||'01.jpg'),('pulse-private',current_setting('test.pulse.path')||'02.jpg');
 begin
  insert into storage.objects(bucket_id,name) values('pulse-private','00000000-0000-4000-8000-000000000000/publication/x/test01/slide-01.jpg');
  raise exception 'Upload outside the workspace allowed';
 exception when insufficient_privilege then null;end;
 begin
  insert into storage.objects(bucket_id,name) values('pulse-private',current_setting('test.pulse.workspace')||'/dashboard/test.jpg');
  raise exception 'Upload outside publication/ allowed';
 exception when insufficient_privilege then null;end;
end $$;
reset role;

set local role service_role;
do $$ begin
 if (select count(*) from public.pulse_meta_oauth_consume(current_setting('test.pulse.state')))<>1 then raise exception 'State not consumed';end if;
 if (select count(*) from public.pulse_meta_oauth_consume(current_setting('test.pulse.state')))<>0 then raise exception 'State reused';end if;
 begin
  perform public.pulse_meta_save_connection(current_setting('test.pulse.julio')::uuid,current_setting('test.pulse.owner')::uuid,'17841400000000001','outra.conta','token-de-teste-com-mais-de-20','{instagram_business_basic,instagram_business_content_publish}',now()+interval '60 days');
  raise exception 'Different Instagram handle accepted';
 exception when raise_exception then if sqlerrm<>'handle_mismatch' then raise;end if;end;
 begin
  perform public.pulse_meta_save_connection(current_setting('test.pulse.julio')::uuid,current_setting('test.pulse.owner')::uuid,'17841400000000001','perfil.exemplo','token-de-teste-com-mais-de-20','{instagram_basic,instagram_manage_messages}',now()+interval '60 days');
  raise exception 'Connection without publish permission accepted';
 exception when raise_exception then if sqlerrm<>'missing_publish_scope' then raise;end if;end;
 begin
  perform public.pulse_meta_save_connection(current_setting('test.pulse.julio')::uuid,gen_random_uuid(),'17841400000000001','perfil.exemplo','token-de-teste-com-mais-de-20','{instagram_business_content_publish}',now()+interval '60 days');
  raise exception 'Non-owner connection accepted';
 exception when insufficient_privilege then null;end;
 perform public.pulse_meta_save_connection(current_setting('test.pulse.julio')::uuid,current_setting('test.pulse.owner')::uuid,'17841400000000001','Perfil.Exemplo','token-de-teste-com-mais-de-20','{instagram_basic,instagram_manage_messages,instagram_content_publish}',now()+interval '60 days');
 if (select connection_status from public.pulse_editorial_accounts where id=current_setting('test.pulse.julio')::uuid)<>'connected' then raise exception 'Account not connected';end if;
 if public.pulse_publisher_test_context(current_setting('test.pulse.post')::uuid,current_setting('test.pulse.owner')::uuid)->>'token'<>'token-de-teste-com-mais-de-20' then raise exception 'Vault token not returned';end if;
 -- Pending token: kept in Vault, read back once, dropped with its secret.
 perform public.pulse_meta_keep_pending(current_setting('test.pulse.julio')::uuid,current_setting('test.pulse.owner')::uuid,'token-pendente-com-mais-de-20','{instagram_basic}');
 if public.pulse_meta_take_pending(current_setting('test.pulse.julio')::uuid)->>'token'<>'token-pendente-com-mais-de-20' then raise exception 'Pending token not returned';end if;
 if public.pulse_meta_take_pending(current_setting('test.pulse.julio')::uuid)->>'expected_handle'<>'perfil.exemplo' then raise exception 'Pending handle missing';end if;
 begin
  perform public.pulse_meta_keep_pending(current_setting('test.pulse.julio')::uuid,gen_random_uuid(),'token-pendente-com-mais-de-20','{instagram_basic}');
  raise exception 'Non-owner pending accepted';
 exception when insufficient_privilege then null;end;
 perform public.pulse_meta_drop_pending(current_setting('test.pulse.julio')::uuid);
 if public.pulse_meta_take_pending(current_setting('test.pulse.julio')::uuid) is not null then raise exception 'Pending not dropped';end if;
end $$;
reset role;

set local role authenticated;
do $$ declare total integer; job record; begin
 begin
  perform public.pulse_schedule_publication(current_setting('test.pulse.post')::uuid,1,now()+interval '1 day',jsonb_build_array(jsonb_build_object('path',current_setting('test.pulse.path')||'01.jpg')));
  raise exception 'Missing slide accepted';
 exception when raise_exception then if sqlerrm not like 'Gere a imagem%' then raise;end if;end;
 begin
  perform public.pulse_schedule_publication(current_setting('test.pulse.post')::uuid,1,now()+interval '30 seconds',jsonb_build_array(jsonb_build_object('path',current_setting('test.pulse.path')||'01.jpg'),jsonb_build_object('path',current_setting('test.pulse.path')||'02.jpg')));
  raise exception 'Time too close accepted';
 exception when raise_exception then if sqlerrm not like 'Escolha um horário%' then raise;end if;end;
 select * into job from public.pulse_schedule_publication(current_setting('test.pulse.post')::uuid,1,now()+interval '1 day',
  jsonb_build_array(jsonb_build_object('path',current_setting('test.pulse.path')||'01.jpg'),jsonb_build_object('path',current_setting('test.pulse.path')||'02.jpg')));
 if job.job_state<>'scheduled' or job.post_revision<>2 then raise exception 'Schedule not recorded';end if;
 if (select status from public.pulse_editorial_posts where id=current_setting('test.pulse.post')::uuid)<>'scheduled' then raise exception 'Post not scheduled';end if;
 if not exists(select 1 from public.pulse_editorial_versions where post_id=current_setting('test.pulse.post')::uuid and revision=2 and status='scheduled') then raise exception 'Schedule version missing';end if;
 select count(*) into total from public.pulse_publication_jobs;
 if total<1 then raise exception 'Owner cannot read the queue';end if;
 begin
  perform container_id from public.pulse_publication_jobs;
  raise exception 'Owner read Meta container IDs';
 exception when insufficient_privilege then null;end;
 -- Second post: scheduling and then editing cancels the job.
 insert into storage.objects(bucket_id,name) values
  ('pulse-private',current_setting('test.pulse.workspace')||'/publication/'||current_setting('test.pulse.second')||'/test02/slide-01.jpg'),
  ('pulse-private',current_setting('test.pulse.workspace')||'/publication/'||current_setting('test.pulse.second')||'/test02/slide-02.jpg');
 perform public.pulse_schedule_publication(current_setting('test.pulse.second')::uuid,1,now()+interval '2 days',jsonb_build_array(
  jsonb_build_object('path',current_setting('test.pulse.workspace')||'/publication/'||current_setting('test.pulse.second')||'/test02/slide-01.jpg'),
  jsonb_build_object('path',current_setting('test.pulse.workspace')||'/publication/'||current_setting('test.pulse.second')||'/test02/slide-02.jpg')));
 update public.pulse_editorial_posts set status='draft',planned_at=null,revision=3 where id=current_setting('test.pulse.second')::uuid and revision=2;
 if (select state from public.pulse_publication_jobs where post_id=current_setting('test.pulse.second')::uuid)<>'cancelled' then raise exception 'Edit did not cancel the job';end if;
end $$;
reset role;

-- External post (finished images): the server creates and schedules it as the owner, then drops that identity.
set local role service_role;
do $$ declare external uuid:=gen_random_uuid(); julio uuid:=current_setting('test.pulse.julio')::uuid; owner uuid:=current_setting('test.pulse.owner')::uuid; prefix text; pair jsonb; created jsonb; scheduled jsonb; begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);perform set_config('request.jwt.claim.sub','',true);
 if auth.uid() is not null then raise exception 'Service role should have no user';end if;
 prefix:=current_setting('test.pulse.workspace')||'/publication/'||external||'/canva1/slide-';
 insert into storage.objects(bucket_id,name) values('pulse-private',prefix||'01.jpg'),('pulse-private',prefix||'02.jpg');
 pair:=jsonb_build_array(jsonb_build_object('path',prefix||'01.jpg'),jsonb_build_object('path',prefix||'02.jpg'));
 begin
  perform public.pulse_publish_external(external,gen_random_uuid(),'Canva','Legenda','{https://example.com/fonte}',null,pair,null);
  raise exception 'Unknown account accepted';
 exception when insufficient_privilege then null;end;
 begin
  perform public.pulse_publish_external(external,julio,'Canva','Legenda','{https://example.com/fonte}',null,jsonb_build_array(jsonb_build_object('path',prefix||'01.jpg')),null);
  raise exception 'Single image accepted';
 exception when raise_exception then if sqlerrm not like 'Use de 2 a 10%' then raise;end if;end;
 begin
  perform public.pulse_publish_external(external,julio,'Canva','Legenda','{https://example.com/fonte}',null,jsonb_build_array(jsonb_build_object('path',prefix||'01.jpg'),jsonb_build_object('path',prefix||'03.jpg')),null);
  raise exception 'Missing image accepted';
 exception when raise_exception then if sqlerrm not like 'A imagem 2%' then raise;end if;end;
 begin
  perform public.pulse_publish_external(external,julio,'Canva','Legenda','{}',null,pair,null);
  raise exception 'External post without a source accepted';
 exception when raise_exception then if sqlerrm not like 'Complete a legenda%' then raise;end if;end;
 if exists(select 1 from public.pulse_editorial_posts where id=external) then raise exception 'Refused post was kept';end if;
 created:=public.pulse_publish_external(external,julio,'Carrossel do Canva','Legenda do Canva','{https://example.com/fonte}','{Capa,Segunda imagem}',pair,jsonb_build_object('label','Canva','title','Design de teste','brief','2 imagens prontas'));
 if created->>'owner_id'<>owner::text or (created->>'revision')::integer<>1 or created->>'status'<>'review' or (created->>'slides')::integer<>2 then raise exception 'External post not created';end if;
 if (select content->'slides'->1->>'alt' from public.pulse_editorial_posts where id=external)<>'Segunda imagem' then raise exception 'Alt text not kept';end if;
 if (select content->>'kind' from public.pulse_editorial_posts where id=external)<>'external' then raise exception 'Kind not external';end if;
 if (select origin->'assets' from public.pulse_editorial_posts where id=external)<>pair then raise exception 'Assets not kept in origin';end if;
 if (select origin->>'label' from public.pulse_editorial_posts where id=external)<>'Canva' then raise exception 'Origin label lost';end if;
 if (select created_by from public.pulse_editorial_posts where id=external)<>owner then raise exception 'External post not owned by the owner';end if;
 if (select actor_id from public.pulse_editorial_versions where post_id=external and revision=1)<>owner then raise exception 'Version actor wrong';end if;
 if auth.uid() is not null then raise exception 'Owner identity leaked after the creation';end if;
 begin
  perform public.pulse_schedule_external(external,now()+interval '30 seconds');
  raise exception 'Time too close accepted for external';
 exception when raise_exception then if sqlerrm not like 'Escolha um horário%' then raise;end if;end;
 begin
  perform public.pulse_schedule_external(current_setting('test.pulse.post')::uuid,now()+interval '3 days');
  raise exception 'Editorial post scheduled as external';
 exception when raise_exception then if sqlerrm not like 'Este post não foi criado%' then raise;end if;end;
 scheduled:=public.pulse_schedule_external(external,now()+interval '3 days');
 if scheduled->>'job_state'<>'scheduled' or (scheduled->>'revision')::integer<>2 then raise exception 'External schedule not recorded';end if;
 if (select created_by from public.pulse_publication_jobs where post_id=external)<>owner then raise exception 'External job not owned by the owner';end if;
 if (select status from public.pulse_editorial_posts where id=external)<>'scheduled' then raise exception 'External post not scheduled';end if;
 if auth.uid() is not null then raise exception 'Owner identity leaked after scheduling';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner,'role','authenticated')::text,true);
end $$;
reset role;

set local role service_role;
do $$ declare claimed jsonb; again jsonb; begin
 if public.pulse_publisher_claim(300) is not null then raise exception 'Future job claimed';end if;
 update public.pulse_publication_jobs set scheduled_at=now()-interval '1 minute' where post_id=current_setting('test.pulse.post')::uuid;
 claimed:=public.pulse_publisher_claim(300);
 if claimed->>'token'<>'token-de-teste-com-mais-de-20' or claimed->>'caption' not like 'Comenta GUIA%' or (claimed->>'attempt')::integer<>1 then raise exception 'Claim payload wrong';end if;
 if public.pulse_publisher_claim(300) is not null then raise exception 'Leased job claimed twice';end if;
 if public.pulse_publisher_checkpoint((claimed->>'job_id')::uuid,gen_random_uuid(),'{"phase":"x"}') then raise exception 'Foreign lease accepted';end if;
 if not public.pulse_publisher_checkpoint((claimed->>'job_id')::uuid,(claimed->>'lease_id')::uuid,'{"phase":"container_created","children":["111","222"],"container_id":"333"}') then raise exception 'Checkpoint refused';end if;
 -- Expired lease: the job is resumed with the container already created.
 update public.pulse_publication_jobs set lease_until=now()-interval '1 second' where id=(claimed->>'job_id')::uuid;
 again:=public.pulse_publisher_claim(300);
 if again->>'job_id'<>claimed->>'job_id' or again->>'container_id'<>'333' or (again->>'attempt')::integer<>2 then raise exception 'Stale lease not resumed';end if;
 if public.pulse_publisher_finish((again->>'job_id')::uuid,(claimed->>'lease_id')::uuid,'published','{}') then raise exception 'Old lease finished the job';end if;
 if not public.pulse_publisher_finish((again->>'job_id')::uuid,(again->>'lease_id')::uuid,'published','{"media_id":"444","permalink":"https://www.instagram.com/p/teste/","published_at":"2026-10-28T12:00:00.000Z"}') then raise exception 'Finish refused';end if;
end $$;
reset role;

set local role authenticated;
do $$ begin
 if (select state from public.pulse_publication_jobs where post_id=current_setting('test.pulse.post')::uuid)<>'published' then raise exception 'Job not published';end if;
 begin
  update public.pulse_editorial_posts set status='draft',planned_at=null,revision=3 where id=current_setting('test.pulse.post')::uuid;
  raise exception 'Published post edited';
 exception when object_not_in_prerequisite_state then null;end;
 begin
  perform public.pulse_cancel_publication(current_setting('test.pulse.post')::uuid);
  raise exception 'Published post cancelled';
 exception when object_not_in_prerequisite_state then null;end;
 begin
  perform public.pulse_publish_external(gen_random_uuid(),current_setting('test.pulse.julio')::uuid,'x','x','{https://example.com}',null,'[]'::jsonb,null);
  raise exception 'Owner could create external posts directly';
 exception when insufficient_privilege then null;end;
 perform public.pulse_meta_disconnect(current_setting('test.pulse.julio')::uuid);
 if (select connection_status from public.pulse_editorial_accounts where id=current_setting('test.pulse.julio')::uuid)<>'not_connected' then raise exception 'Disconnect failed';end if;
end $$;
reset role;
do $$ begin
 if exists(select 1 from vault.secrets where name='pulse_meta_token_'||current_setting('test.pulse.julio')) then raise exception 'Token kept after disconnect';end if;
 if exists(select 1 from vault.secrets where name='pulse_meta_pending_'||current_setting('test.pulse.julio')) then raise exception 'Pending secret kept';end if;
end $$;
select 'meta-publishing: ok' as result;
rollback;
