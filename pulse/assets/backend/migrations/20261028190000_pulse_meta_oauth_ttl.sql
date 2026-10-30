-- The Meta flow can ask for an SMS confirmation; ten minutes expired before the owner finished it.
create or replace function public.pulse_meta_oauth_begin(p_account uuid) returns text
language plpgsql security definer set search_path='' as $$
declare v_state text;
begin
 if not pulse_private.editorial_owner(p_account) then raise exception 'Acesso editorial não autorizado.' using errcode='42501';end if;
 delete from pulse_private.pulse_meta_oauth_states s where s.expires_at<now() or (s.user_id=auth.uid() and s.account_id=p_account);
 v_state:=encode(extensions.gen_random_bytes(32),'hex');
 insert into pulse_private.pulse_meta_oauth_states(state,account_id,user_id,expires_at) values(v_state,p_account,auth.uid(),now()+interval '30 minutes');
 return v_state;
end;
$$;
