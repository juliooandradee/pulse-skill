begin;
select set_config('test.pulse.owner',(select owner_id::text from public.pulse_workspaces where handle='perfil.exemplo'),true);
select set_config('test.pulse.julio',(select id::text from public.pulse_editorial_accounts where account_key='principal'),true);
select set_config('test.pulse.med',(select id::text from public.pulse_editorial_accounts where account_key='secundaria'),true);
select set_config('test.pulse.post',gen_random_uuid()::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.pulse.owner'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare total integer; begin
 select count(*) into total from public.pulse_editorial_accounts;
 if total<>2 then raise exception 'Owner did not see both accounts';end if;
 insert into public.pulse_editorial_posts(id,account_id,content) values(current_setting('test.pulse.post')::uuid,current_setting('test.pulse.julio')::uuid,'{"title":"Teste transacional","caption":"Legenda de teste","sources":[{"url":"https://example.com/source"}],"slides":[{"headline":"Capa","body":"Texto","alt":"Capa"},{"headline":"Contexto","body":"Texto","alt":"Contexto"}]}');
 if not exists(select 1 from public.pulse_editorial_versions where post_id=current_setting('test.pulse.post')::uuid and revision=1) then raise exception 'Missing immutable version';end if;
 update public.pulse_editorial_posts set status='review',revision=2 where id=current_setting('test.pulse.post')::uuid and account_id=current_setting('test.pulse.julio')::uuid and revision=1;
 get diagnostics total=row_count;if total<>1 then raise exception 'Expected revision update failed';end if;
 update public.pulse_editorial_posts set status='draft',revision=2 where id=current_setting('test.pulse.post')::uuid and revision=1;
 get diagnostics total=row_count;if total<>0 then raise exception 'Stale edit was allowed';end if;
 begin
  update public.pulse_editorial_posts set revision=99 where id=current_setting('test.pulse.post')::uuid;
  raise exception 'Forged revision allowed';
 exception when serialization_failure then null;end;
 begin
  update public.pulse_editorial_posts set account_id=current_setting('test.pulse.med')::uuid where id=current_setting('test.pulse.post')::uuid;
  raise exception 'Cross-account reassignment allowed';
 exception when insufficient_privilege then null;end;
 begin
  delete from public.pulse_editorial_posts where id=current_setting('test.pulse.post')::uuid;
  raise exception 'Destructive delete allowed';
 exception when insufficient_privilege then null;end;
 begin
  update public.pulse_editorial_versions set status='planned' where post_id=current_setting('test.pulse.post')::uuid;
  raise exception 'History mutation allowed';
 exception when insufficient_privilege then null;end;
 update public.pulse_editorial_posts set status='planned',planned_at=now()+interval '2 days',revision=3 where id=current_setting('test.pulse.post')::uuid and revision=2;
 if not exists(select 1 from public.pulse_editorial_posts where id=current_setting('test.pulse.post')::uuid and status='planned' and planned_at is not null) then raise exception 'Planning not saved';end if;
 if exists(select 1 from public.pulse_editorial_posts where account_id=current_setting('test.pulse.med')::uuid) then raise exception 'Draft leaked to other account';end if;
 if (select count(*) from public.pulse_editorial_versions where post_id=current_setting('test.pulse.post')::uuid)<>3 then raise exception 'Missing versions';end if;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.pulse_editorial_accounts) or exists(select 1 from public.pulse_editorial_posts) or exists(select 1 from public.pulse_editorial_versions) then raise exception 'Unauthorized read allowed';end if;
 begin
  insert into public.pulse_editorial_posts(account_id,content) values(current_setting('test.pulse.med')::uuid,'{}');
  raise exception 'Unauthorized write allowed';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claims','{}',true);
set local role anon;
do $$ begin
 begin
  perform 1 from public.pulse_editorial_accounts;
  raise exception 'Anonymous read allowed';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'passed: owner access, version audit, stale edit, reassignment denial, delete denial, history immutability, planned time, per-account filter, outsider and anonymous denial; all test rows rolled back' as result;
