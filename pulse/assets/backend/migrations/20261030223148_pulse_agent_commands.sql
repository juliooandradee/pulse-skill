-- Owner-scoped server commands for the local agent. They reuse versioning, validation and locks.
create function public.pulse_agent_save(p_account uuid,p_post uuid,p_revision integer,p_content jsonb,p_origin jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prev_sub text:=current_setting('request.jwt.claim.sub',true);prev_claims text:=current_setting('request.jwt.claims',true);saved public.pulse_editorial_posts;
begin
 perform pulse_private.act_as_account_owner(p_account);
 if p_revision=0 then
  insert into public.pulse_editorial_posts(id,account_id,content,origin) values(p_post,p_account,p_content,p_origin) returning * into saved;
 else
  update public.pulse_editorial_posts set content=p_content,origin=p_origin,revision=p_revision+1,status='draft',planned_at=null where id=p_post and account_id=p_account and revision=p_revision returning * into saved;
  if not found then raise exception 'A versão mudou. Reabra o post.' using errcode='40001';end if;
 end if;
 perform pulse_private.restore_caller(prev_sub,prev_claims);
 return to_jsonb(saved);
end;
$$;
revoke all on function public.pulse_agent_save(uuid,uuid,integer,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.pulse_agent_save(uuid,uuid,integer,jsonb,jsonb) to service_role;
