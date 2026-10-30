-- Posts made from finished images (Canva, Google Drive, local files). The server creates them on behalf of the
-- account owner and reuses the publishing queue, so every editorial rule and the scheduling checks still apply.
-- Only the service role can call these functions; the browser keeps using the owner's own functions.

-- Runs the rest of the transaction as the account owner, so auth.uid() points to them inside the editorial triggers.
create function pulse_private.act_as_account_owner(p_account uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare owner uuid;
begin
 select w.owner_id into owner from public.pulse_editorial_accounts a join public.pulse_workspaces w on w.id=a.workspace_id where a.id=p_account;
 if owner is null or not pulse_private.account_owner_user(p_account,owner) then raise exception 'not_owner' using errcode='42501';end if;
 perform set_config('request.jwt.claim.sub',owner::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner,'role','authenticated')::text,true);
 return owner;
end;
$$;
revoke all on function pulse_private.act_as_account_owner(uuid) from public,anon,authenticated,service_role;

create function pulse_private.restore_caller(p_sub text,p_claims text) returns void
language sql security definer set search_path='' as $$
 select set_config('request.jwt.claim.sub',coalesce(p_sub,''),true),set_config('request.jwt.claims',coalesce(p_claims,''),true);
$$;
revoke all on function pulse_private.restore_caller(text,text) from public,anon,authenticated,service_role;

-- Creates a post whose slides are finished JPEGs already stored under <workspace>/publication/<post>/<batch>/.
-- The post id comes from the caller because the storage paths carry it. Status starts in review.
create function public.pulse_publish_external(p_post uuid,p_account uuid,p_title text,p_caption text,p_sources text[],p_alts text[],p_assets jsonb,p_origin jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prev_sub text:=current_setting('request.jwt.claim.sub',true); prev_claims text:=current_setting('request.jwt.claims',true);
 owner uuid; workspace uuid; asset jsonb; slide_number integer:=0; total integer; slides jsonb:='[]'::jsonb; sources jsonb; origin jsonb; created public.pulse_editorial_posts;
begin
 if p_post is null or p_account is null then raise exception 'Informe o post e a conta.';end if;
 if jsonb_typeof(p_assets) is distinct from 'array' or jsonb_array_length(p_assets) not between 2 and 10 then raise exception 'Use de 2 a 10 imagens.';end if;
 total:=jsonb_array_length(p_assets);
 if p_alts is not null and coalesce(array_length(p_alts,1),0)<>total then raise exception 'Informe um texto alternativo por imagem.';end if;
 if p_origin is not null and jsonb_typeof(p_origin)<>'object' then raise exception 'Origem inválida.';end if;
 if exists(select 1 from public.pulse_editorial_posts p where p.id=p_post) then raise exception 'Este post já existe.' using errcode='23505';end if;
 select a.workspace_id into workspace from public.pulse_editorial_accounts a where a.id=p_account;
 if workspace is null then raise exception 'not_owner' using errcode='42501';end if;
 for asset in select value from jsonb_array_elements(p_assets) loop
  slide_number:=slide_number+1;
  if jsonb_typeof(asset->'path') is distinct from 'string'
     or (asset->>'path') !~ ('^'||workspace::text||'/publication/'||p_post::text||'/[a-z0-9]{6,32}/slide-'||lpad(slide_number::text,2,'0')||'\.jpg$')
     or not exists(select 1 from storage.objects o where o.bucket_id='pulse-private' and o.name=asset->>'path')
  then raise exception 'A imagem % não foi encontrada no Pulse.',slide_number;end if;
  slides:=slides||jsonb_build_object('headline','Imagem '||slide_number,'body','','alt',coalesce(nullif(trim(p_alts[slide_number]),''),'Imagem '||slide_number||' de '||total||' do carrossel.'));
 end loop;
 sources:=coalesce((select jsonb_agg(jsonb_build_object('url',u,'label',u)) from unnest(p_sources) u where u is not null),'[]'::jsonb);
 origin:=coalesce(p_origin,'{}'::jsonb)||jsonb_build_object('kind','external','imported_at',now(),'assets',(select jsonb_agg(jsonb_build_object('path',value->>'path')) from jsonb_array_elements(p_assets)));
 owner:=pulse_private.act_as_account_owner(p_account);
 insert into public.pulse_editorial_posts(id,account_id,content,origin,status)
 values(p_post,p_account,jsonb_build_object('kind','external','visualVersion','external-images-v1','title',coalesce(p_title,''),'caption',coalesce(p_caption,''),'sources',sources,'slides',slides),origin,'review')
 returning * into created;
 perform pulse_private.restore_caller(prev_sub,prev_claims);
 return jsonb_build_object('post_id',created.id,'revision',created.revision,'status',created.status,'owner_id',owner,'workspace_id',workspace,'slides',total);
end;
$$;

-- Hands an external post to the queue with the same checks the owner's "Agendar" goes through.
create function public.pulse_schedule_external(p_post uuid,p_scheduled_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prev_sub text:=current_setting('request.jwt.claim.sub',true); prev_claims text:=current_setting('request.jwt.claims',true);
 post public.pulse_editorial_posts; job record;
begin
 select * into post from public.pulse_editorial_posts p where p.id=p_post;
 if not found then raise exception 'Post não encontrado.';end if;
 if post.content->>'kind' is distinct from 'external' or jsonb_typeof(post.origin->'assets') is distinct from 'array' then raise exception 'Este post não foi criado a partir de imagens prontas.';end if;
 perform pulse_private.act_as_account_owner(post.account_id);
 select * into job from public.pulse_schedule_publication(p_post,post.revision,p_scheduled_at,post.origin->'assets');
 perform pulse_private.restore_caller(prev_sub,prev_claims);
 return jsonb_build_object('job_id',job.job_id,'job_state',job.job_state,'scheduled_at',job.job_scheduled_at,'revision',job.post_revision);
end;
$$;

do $$ declare fn text; begin
 foreach fn in array array['public.pulse_publish_external(uuid,uuid,text,text,text[],text[],jsonb,jsonb)','public.pulse_schedule_external(uuid,timestamptz)'] loop
  execute format('revoke all on function %s from public,anon,authenticated',fn);
  execute format('grant execute on function %s to service_role',fn);
 end loop;
end $$;
