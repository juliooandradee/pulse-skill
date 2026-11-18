-- Extends the existing Instagram queue (image, carousel, reel), records Insights
-- and wakes the publisher every minute. Safe to run twice. Does not write gravity_*.
-- On the live project the private schema is gravity_private; skill installs use pulse_private.

do $$
declare sch text;
begin
 if exists (
  select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='gravity_private' and c.relname='pulse_meta_connections' and c.relkind='r') then
  sch:='gravity_private';
 elsif to_regclass('pulse_private.pulse_meta_connections') is not null then
  sch:='pulse_private';
 else
  raise exception 'Conexão Meta do Pulse não encontrada. Aplique as migrações anteriores.';
 end if;
 perform set_config('pulse.private_schema',sch,false);
end $$;

alter table public.pulse_publication_jobs add column if not exists media_type text not null default 'carousel';
alter table public.pulse_publication_jobs add column if not exists caption text;
alter table public.pulse_publication_jobs alter column post_id drop not null;
alter table public.pulse_publication_jobs drop constraint if exists pulse_publication_jobs_media_type_check;
alter table public.pulse_publication_jobs add constraint pulse_publication_jobs_media_type_check check (media_type in ('image','carousel','reel'));
alter table public.pulse_publication_jobs drop constraint if exists pulse_publication_jobs_caption_check;
alter table public.pulse_publication_jobs add constraint pulse_publication_jobs_caption_check check (caption is null or length(caption)<=2200);

do $$
declare name text;
begin
 for name in
  select conname from pg_constraint
  where conrelid='public.pulse_publication_jobs'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%assets%'
 loop
  execute format('alter table public.pulse_publication_jobs drop constraint %I',name);
 end loop;
end $$;
alter table public.pulse_publication_jobs add constraint pulse_publication_jobs_assets_check check (
 (media_type='carousel' and jsonb_typeof(assets)='array' and jsonb_array_length(assets) between 2 and 10)
 or (media_type='image' and jsonb_typeof(assets)='array' and jsonb_array_length(assets)=1)
 or (media_type='reel' and jsonb_typeof(assets)='array' and jsonb_array_length(assets)=1));

do $$
declare sch text:=current_setting('pulse.private_schema');
begin
 execute format('alter table %I.pulse_meta_connections add column if not exists insights_granted boolean not null default false',sch);
 execute format('update %I.pulse_meta_connections set insights_granted = scopes && array[''instagram_manage_insights'',''instagram_business_manage_insights'']::text[]',sch);
end $$;

insert into storage.buckets(id,name,public,file_size_limit)
values ('pulse-private','pulse-private',false,104857600)
on conflict (id) do update set public=false, file_size_limit=greatest(coalesce(storage.buckets.file_size_limit,0), excluded.file_size_limit);

drop policy if exists pulse_instagram_assets_upload on storage.objects;
create policy pulse_instagram_assets_upload on storage.objects for insert to authenticated with check (
 bucket_id='pulse-private' and (storage.foldername(name))[2]='instagram'
 and lower(storage.extension(name)) in ('jpg','jpeg','png','webp','mp4')
 and (storage.foldername(name))[1] in (select id::text from public.pulse_workspaces where owner_id=(select auth.uid()))
);

create table if not exists public.pulse_media_insights (
 media_id text primary key check (media_id ~ '^[0-9]{5,40}$'),
 account_id uuid not null references public.pulse_editorial_accounts(id),
 job_id uuid references public.pulse_publication_jobs(id) on delete set null,
 media_type text not null check (media_type in ('image','carousel','reel')),
 permalink text check (permalink is null or permalink ~ '^https://(www\.)?instagram\.com/'),
 reach bigint check (reach is null or reach>=0),
 saves bigint check (saves is null or saves>=0),
 shares bigint check (shares is null or shares>=0),
 comments bigint check (comments is null or comments>=0),
 likes bigint check (likes is null or likes>=0),
 plays bigint check (plays is null or plays>=0),
 raw jsonb not null default '{}'::jsonb,
 collected_at timestamptz not null default now(),
 last_error text check (last_error is null or length(last_error)<=500)
);
create index if not exists pulse_media_insights_account_idx on public.pulse_media_insights(account_id,collected_at desc);
alter table public.pulse_media_insights enable row level security;
revoke all on public.pulse_media_insights from public,anon,authenticated;
grant select on public.pulse_media_insights to authenticated;
grant all on public.pulse_media_insights to service_role;

do $$
declare sch text:=current_setting('pulse.private_schema');
begin
 execute format('drop policy if exists pulse_media_insights_read on public.pulse_media_insights');
 execute format('create policy pulse_media_insights_read on public.pulse_media_insights for select to authenticated using (%I.editorial_owner(account_id))',sch);
end $$;

grant select (media_type,caption) on public.pulse_publication_jobs to authenticated;

-- Keep a project URL that was already compiled into the scheduler, without writing it into git.
do $$
declare sch text:=current_setting('pulse.private_schema'); src text; base text;
begin
 select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname=sch and p.proname='pulse_publisher_tick';
 if src is not null then
  base:=(regexp_match(src,'https://[a-z0-9]+\.supabase\.co'))[1];
  if base is not null and not exists(select 1 from vault.secrets where name='pulse_functions_base_url') then
   perform vault.create_secret(base,'pulse_functions_base_url','URL HTTPS do projeto usada pelo agendador do Pulse');
  end if;
 end if;
end $$;

create or replace function public.pulse_publisher_checkpoint(p_job uuid,p_lease uuid,p_patch jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 update public.pulse_publication_jobs j set
  phase=coalesce(p_patch->>'phase',j.phase),
  children=case when p_patch ? 'children' then nullif(p_patch->'children','null'::jsonb) else j.children end,
  container_id=case when p_patch ? 'container_id' then p_patch->>'container_id' else j.container_id end,
  media_id=case when p_patch ? 'media_id' then p_patch->>'media_id' else j.media_id end,
  lease_until=greatest(j.lease_until,now()+interval '2 minutes'),updated_at=now()
 where j.id=p_job and j.lease_id=p_lease and j.state='publishing'
   and (j.post_id is null or exists (
    select 1 from public.pulse_editorial_posts p where p.id=j.post_id and p.status='scheduled' and p.revision=j.revision));
 return found;
end;
$$;

create or replace function public.pulse_insights_save(p_media_id text,p_account uuid,p_job uuid,p_type text,p_permalink text,p_reach bigint,p_saves bigint,p_shares bigint,p_comments bigint,p_likes bigint,p_plays bigint,p_raw jsonb,p_error text) returns void
language plpgsql security definer set search_path='' as $$
declare post uuid;
begin
 if p_media_id is null or p_media_id !~ '^[0-9]{5,40}$' then raise exception 'Mídia inválida.';end if;
 if p_type not in ('image','carousel','reel') then raise exception 'Tipo inválido.';end if;
 insert into public.pulse_media_insights as i(media_id,account_id,job_id,media_type,permalink,reach,saves,shares,comments,likes,plays,raw,collected_at,last_error)
 values(p_media_id,p_account,p_job,p_type,p_permalink,p_reach,p_saves,p_shares,p_comments,p_likes,p_plays,coalesce(p_raw,'{}'::jsonb),now(),left(p_error,500))
 on conflict (media_id) do update set account_id=excluded.account_id,job_id=coalesce(excluded.job_id,i.job_id),media_type=excluded.media_type,
  permalink=coalesce(excluded.permalink,i.permalink),reach=coalesce(excluded.reach,i.reach),saves=coalesce(excluded.saves,i.saves),
  shares=coalesce(excluded.shares,i.shares),comments=coalesce(excluded.comments,i.comments),likes=coalesce(excluded.likes,i.likes),
  plays=coalesce(excluded.plays,i.plays),raw=i.raw||excluded.raw,collected_at=now(),last_error=excluded.last_error;
 select j.post_id into post from public.pulse_publication_jobs j where j.id=p_job and j.post_id is not null;
 if post is not null then
  insert into public.pulse_post_outcomes(post_id,account_id,metrics,collected_at)
  values(post,p_account,jsonb_build_object('instagram',jsonb_strip_nulls(jsonb_build_object('reach',p_reach,'saves',p_saves,'shares',p_shares,'comments',p_comments,'likes',p_likes,'plays',p_plays))),now())
  on conflict (post_id) do update set
   metrics=jsonb_set(public.pulse_post_outcomes.metrics,'{instagram}',coalesce(public.pulse_post_outcomes.metrics->'instagram','{}'::jsonb)||excluded.metrics->'instagram',true),
   collected_at=now(),updated_at=now();
 end if;
end;
$$;

create or replace function public.pulse_list_publication_queue(p_account uuid)
returns table(job_id uuid,media_type text,state text,scheduled_at timestamptz,caption text,attempts integer,permalink text,media_id text,last_error text,published_at timestamptz,created_at timestamptz)
language sql stable security definer set search_path='' as $$
 select j.id,j.media_type,j.state,j.scheduled_at,j.caption,j.attempts,j.permalink,j.media_id,j.last_error,j.published_at,j.created_at
 from public.pulse_publication_jobs j where j.account_id=p_account order by j.scheduled_at desc limit 100;
$$;

do $mig$
declare sch text:=current_setting('pulse.private_schema');
begin
 execute replace($pulsefn$
create or replace function public.pulse_meta_save_connection(p_account uuid,p_user uuid,p_ig_user_id text,p_username text,p_token text,p_scopes text[],p_expires_at timestamptz) returns void
language plpgsql security definer set search_path='' as $fn$
declare account public.pulse_editorial_accounts; secret_ref uuid; secret_name text:='pulse_meta_token_'||p_account::text; insights boolean;
begin
 select * into account from public.pulse_editorial_accounts a where a.id=p_account for update;
 if not found or not __SCHEMA__.account_owner_user(p_account,p_user) then raise exception 'not_owner' using errcode='42501';end if;
 if account.instagram_handle is not null and lower(account.instagram_handle)<>lower(p_username) then raise exception 'handle_mismatch';end if;
 if exists(select 1 from __SCHEMA__.pulse_meta_connections c where c.ig_user_id=p_ig_user_id and c.account_id<>p_account) then raise exception 'ig_in_use';end if;
 if not (p_scopes && array['instagram_content_publish','instagram_business_content_publish']) then raise exception 'missing_publish_scope';end if;
 if p_token is null or length(p_token)<20 or p_expires_at is null or p_expires_at<=now() then raise exception 'invalid_token';end if;
 insights:=p_scopes && array['instagram_manage_insights','instagram_business_manage_insights'];
 select c.token_secret_id into secret_ref from __SCHEMA__.pulse_meta_connections c where c.account_id=p_account;
 if secret_ref is null then
  delete from vault.secrets s where s.name=secret_name;
  secret_ref:=vault.create_secret(p_token,secret_name,'Token do Instagram usado pelo Pulse');
 else
  perform vault.update_secret(secret_ref,p_token);
 end if;
 insert into __SCHEMA__.pulse_meta_connections(account_id,ig_user_id,username,token_secret_id,scopes,expires_at,refreshed_at,connected_by,connected_at,insights_granted)
 values(p_account,p_ig_user_id,p_username,secret_ref,p_scopes,p_expires_at,now(),p_user,now(),insights)
 on conflict (account_id) do update set ig_user_id=excluded.ig_user_id,username=excluded.username,token_secret_id=excluded.token_secret_id,
  scopes=excluded.scopes,expires_at=excluded.expires_at,refreshed_at=now(),connected_by=excluded.connected_by,connected_at=now(),insights_granted=excluded.insights_granted;
 update public.pulse_editorial_accounts set connection_status='connected',instagram_handle=coalesce(instagram_handle,lower(p_username)),connection_expires_at=p_expires_at where id=p_account;
end;
$fn$;
$pulsefn$, '__SCHEMA__', quote_ident(sch));

 execute replace($pulsefn$
create or replace function public.pulse_schedule_publication(p_post uuid,p_revision integer,p_scheduled_at timestamptz,p_assets jsonb)
returns table(job_id uuid,job_state text,job_scheduled_at timestamptz,post_revision integer)
language plpgsql security definer set search_path='' as $fn$
declare post public.pulse_editorial_posts; workspace uuid; asset jsonb; slide_number integer:=0; next_revision integer;
begin
 select * into post from public.pulse_editorial_posts p where p.id=p_post for update;
 if not found or not __SCHEMA__.editorial_owner(post.account_id) then raise exception 'Acesso editorial não autorizado.' using errcode='42501';end if;
 if post.revision<>p_revision then raise exception 'A versão mudou. Reabra o rascunho antes de agendar.' using errcode='40001';end if;
 if __SCHEMA__.publication_locked(p_post) then raise exception 'Este post já está sendo publicado ou já foi publicado.' using errcode='55000';end if;
 if not exists(select 1 from __SCHEMA__.pulse_meta_connections c where c.account_id=post.account_id and c.expires_at>now()) then
  raise exception 'Conecte o Instagram desta conta na aba Conexão antes de agendar.' using errcode='55000';end if;
 if p_scheduled_at is null or p_scheduled_at<now()+interval '2 minutes' or p_scheduled_at>now()+interval '120 days' then
  raise exception 'Escolha um horário entre 2 minutos e 120 dias a partir de agora.';end if;
 if jsonb_typeof(p_assets) is distinct from 'array' or jsonb_array_length(p_assets)<>jsonb_array_length(post.content->'slides') then
  raise exception 'Gere a imagem final de todos os slides antes de agendar.';end if;
 select a.workspace_id into workspace from public.pulse_editorial_accounts a where a.id=post.account_id;
 for asset in select value from jsonb_array_elements(p_assets) loop
  slide_number:=slide_number+1;
  if jsonb_typeof(asset->'path') is distinct from 'string'
     or (asset->>'path') !~ ('^'||workspace::text||'/publication/'||p_post::text||'/[a-z0-9]{6,32}/slide-'||lpad(slide_number::text,2,'0')||'\.jpg$')
     or not exists(select 1 from storage.objects o where o.bucket_id='pulse-private' and o.name=asset->>'path')
  then raise exception 'A imagem do slide % não foi encontrada no Pulse. Gere as imagens de novo.',slide_number;end if;
 end loop;
 perform set_config('pulse.scheduling','on',true);
 update public.pulse_editorial_posts p set status='scheduled',planned_at=p_scheduled_at,revision=post.revision+1 where p.id=p_post returning p.revision into next_revision;
 perform set_config('pulse.scheduling','off',true);
 insert into public.pulse_publication_jobs as j(post_id,account_id,revision,scheduled_at,assets,media_type,caption,created_by)
 values(p_post,post.account_id,next_revision,p_scheduled_at,(select jsonb_agg(jsonb_build_object('path',value->>'path')) from jsonb_array_elements(p_assets)),'carousel',post.content->>'caption',auth.uid())
 on conflict (post_id) do update set revision=excluded.revision,scheduled_at=excluded.scheduled_at,assets=excluded.assets,media_type='carousel',caption=excluded.caption,state='scheduled',
  phase=null,attempts=0,lease_id=null,lease_until=null,next_attempt_at=null,children=null,container_id=null,media_id=null,
  permalink=null,published_at=null,last_error=null,created_by=excluded.created_by,updated_at=now()
 where j.state in ('scheduled','failed','cancelled');
 return query select j.id,j.state,j.scheduled_at,j.revision from public.pulse_publication_jobs j where j.post_id=p_post and j.revision=next_revision and j.state='scheduled';
 if not found then raise exception 'Não foi possível agendar. Recarregue a lista e tente de novo.';end if;
end;
$fn$;
$pulsefn$, '__SCHEMA__', quote_ident(sch));

 execute replace($pulsefn$
create or replace function public.pulse_publisher_claim(p_lease_seconds integer default 300) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare job public.pulse_publication_jobs; post public.pulse_editorial_posts; conn __SCHEMA__.pulse_meta_connections; token text; lease uuid:=gen_random_uuid(); caption text;
begin
 loop
  select * into job from public.pulse_publication_jobs j
  where (j.state='scheduled' and j.scheduled_at<=now() and coalesce(j.next_attempt_at,'-infinity')<=now())
     or (j.state='publishing' and j.lease_until<now())
  order by j.scheduled_at for update skip locked limit 1;
  if not found then return null;end if;
  caption:=nullif(job.caption,'');
  if job.post_id is not null then
   select * into post from public.pulse_editorial_posts p where p.id=job.post_id;
   if not found or post.status<>'scheduled' or post.revision<>job.revision then
    update public.pulse_publication_jobs set state='cancelled',lease_id=null,lease_until=null,updated_at=now(),last_error='O rascunho mudou depois do agendamento. Agende de novo.' where id=job.id;
    continue;
   end if;
   caption:=coalesce(caption,post.content->>'caption');
  end if;
  select * into conn from __SCHEMA__.pulse_meta_connections c where c.account_id=job.account_id;
  if not found or conn.expires_at<=now() then
   update public.pulse_publication_jobs set state='failed',lease_id=null,lease_until=null,updated_at=now(),last_error='A conexão com o Instagram não está ativa. Conecte de novo e agende outra vez.' where id=job.id;
   update public.pulse_editorial_accounts set connection_status=case when connection_status='connected' then 'expired' else connection_status end where id=job.account_id;
   continue;
  end if;
  if job.attempts>=6 then
   update public.pulse_publication_jobs set state='failed',lease_id=null,lease_until=null,updated_at=now(),last_error='O Instagram não confirmou a publicação depois de várias tentativas. Confira o perfil antes de agendar de novo.' where id=job.id;
   continue;
  end if;
  select s.decrypted_secret into token from vault.decrypted_secrets s where s.id=conn.token_secret_id;
  update public.pulse_publication_jobs set state='publishing',lease_id=lease,lease_until=now()+make_interval(secs=>greatest(p_lease_seconds,60)),attempts=attempts+1,next_attempt_at=null,updated_at=now() where id=job.id;
  return jsonb_build_object('job_id',job.id,'lease_id',lease,'post_id',job.post_id,'account_id',job.account_id,'attempt',job.attempts+1,
   'media_type',coalesce(job.media_type,'carousel'),'assets',job.assets,'children',job.children,'container_id',job.container_id,'media_id',job.media_id,
   'caption',caption,'ig_user_id',conn.ig_user_id,'username',conn.username,'token',token);
 end loop;
end;
$fn$;
$pulsefn$, '__SCHEMA__', quote_ident(sch));

 execute replace($pulsefn$
create or replace function __SCHEMA__.pulse_publisher_tick() returns void
language plpgsql security definer set search_path='' as $fn$
declare base text; secret text;
begin
 if not (
   exists(select 1 from public.pulse_publication_jobs j
          where (j.state='scheduled' and j.scheduled_at<=now() and coalesce(j.next_attempt_at,'-infinity')<=now())
             or (j.state='publishing' and j.lease_until<now()))
   or exists(select 1 from __SCHEMA__.pulse_meta_connections c
             where c.expires_at>now() and c.expires_at<now()+interval '15 days' and c.refreshed_at<now()-interval '1 day')
   or exists(select 1 from public.pulse_publication_jobs j
             join __SCHEMA__.pulse_meta_connections c on c.account_id=j.account_id
             where j.state='published' and j.media_id is not null and c.expires_at>now()
               and (c.insights_granted or c.scopes && array['instagram_manage_insights','instagram_business_manage_insights'])
               and not exists(select 1 from public.pulse_media_insights i where i.media_id=j.media_id and i.collected_at>now()-interval '6 hours'))
 ) then return; end if;
 select s.decrypted_secret into base from vault.decrypted_secrets s where s.name='pulse_functions_base_url';
 select s.decrypted_secret into secret from vault.decrypted_secrets s where s.name='pulse_publisher_cron_secret';
 if base is null or secret is null or base !~ '^https://[a-z0-9]+\.supabase\.co$' then return; end if;
 perform net.http_post(
  url:=base||'/functions/v1/pulse-publisher',
  headers:=jsonb_build_object('Content-Type','application/json','x-pulse-cron',secret),
  body:='{"action":"tick"}'::jsonb,
  timeout_milliseconds:=150000);
end;
$fn$;
$pulsefn$, '__SCHEMA__', quote_ident(sch));
 execute format('revoke all on function %I.pulse_publisher_tick() from public,anon,authenticated',sch);

 execute replace($pulsefn$
create or replace function public.pulse_queue_media(p_account uuid,p_type text,p_caption text,p_scheduled_at timestamptz,p_assets jsonb,p_job uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare account public.pulse_editorial_accounts; owner uuid; workspace uuid; job_id uuid:=coalesce(p_job,gen_random_uuid());
 when_at timestamptz; asset jsonb; n integer:=0; bucket text; path text; ext text; clean jsonb:='[]'::jsonb;
begin
 if p_type not in ('image','carousel','reel') then raise exception 'Tipo inválido. Use image, carousel ou reel.';end if;
 if p_caption is null or length(trim(p_caption)) not between 1 and 2200 then raise exception 'Informe uma legenda de 1 a 2.200 caracteres.';end if;
 if p_scheduled_at is not null and (p_scheduled_at<now()-interval '2 minutes' or p_scheduled_at>now()+interval '120 days') then
  raise exception 'Escolha um horário entre agora e 120 dias.';end if;
 when_at:=greatest(coalesce(p_scheduled_at,now()),now());
 select * into account from public.pulse_editorial_accounts where id=p_account;
 if not found then raise exception 'Conta editorial não encontrada.' using errcode='42501';end if;
 select w.owner_id,a.workspace_id into owner,workspace from public.pulse_editorial_accounts a join public.pulse_workspaces w on w.id=a.workspace_id where a.id=p_account;
 if owner is null or not __SCHEMA__.account_owner_user(p_account,owner) then raise exception 'not_owner' using errcode='42501';end if;
 if not exists(select 1 from __SCHEMA__.pulse_meta_connections c where c.account_id=p_account and c.expires_at>now()
    and c.scopes && array['instagram_content_publish','instagram_business_content_publish']) then
  raise exception 'Conecte o Instagram desta conta antes de publicar.' using errcode='55000';end if;
 if jsonb_typeof(p_assets) is distinct from 'array' then raise exception 'Informe os arquivos.';end if;
 if p_type='carousel' and jsonb_array_length(p_assets) not between 2 and 10 then raise exception 'O carrossel precisa de 2 a 10 imagens.';end if;
 if p_type in ('image','reel') and jsonb_array_length(p_assets)<>1 then raise exception 'Este tipo usa um único arquivo.';end if;
 for asset in select value from jsonb_array_elements(p_assets) loop
  n:=n+1; path:=asset->>'path'; bucket:=coalesce(nullif(asset->>'bucket',''),'pulse-private'); ext:=lower(regexp_replace(path,'^.*\.',''));
  if bucket !~ '^[a-z0-9-]{1,50}$' or path is null or length(path) not between 1 and 500 or path !~ '^[A-Za-z0-9_./-]+$' or position('..' in path)>0 then raise exception 'Arquivo % inválido.',n;end if;
  if path !~ ('^'||workspace::text||'/instagram/'||job_id::text||'/') then raise exception 'O arquivo % não está na pasta desta conta.',n;end if;
  if p_type='reel' and ext<>'mp4' then raise exception 'O Reels precisa ser um MP4.';end if;
  if p_type='carousel' and ext not in ('jpg','jpeg') then raise exception 'O carrossel usa JPEG.';end if;
  if p_type='image' and ext not in ('jpg','jpeg','png','webp') then raise exception 'Use JPEG, PNG ou WebP.';end if;
  if not exists(select 1 from storage.buckets b where b.id=bucket and b.public=false) then raise exception 'O arquivo % não está num bucket privado.',n;end if;
  if not exists(select 1 from storage.objects o where o.bucket_id=bucket and o.name=path) then raise exception 'O arquivo % não foi encontrado no Pulse.',n;end if;
  clean:=clean||jsonb_build_array(jsonb_build_object('path',path,'bucket',bucket));
 end loop;
 insert into public.pulse_publication_jobs as j(id,post_id,account_id,revision,scheduled_at,assets,state,media_type,caption,created_by)
 values(job_id,null,p_account,1,when_at,clean,'scheduled',p_type,trim(p_caption),owner)
 on conflict (id) do update set scheduled_at=excluded.scheduled_at,assets=excluded.assets,media_type=excluded.media_type,caption=excluded.caption,state='scheduled',
  phase=null,attempts=0,lease_id=null,lease_until=null,next_attempt_at=null,children=null,container_id=null,media_id=null,permalink=null,published_at=null,last_error=null,updated_at=now()
 where j.state in ('scheduled','failed','cancelled') and j.account_id=excluded.account_id and j.post_id is null;
 if not found then raise exception 'Não foi possível agendar. Este item já está sendo publicado ou já foi publicado.';end if;
 return jsonb_build_object('job_id',job_id,'state','scheduled','scheduled_at',when_at,'media_type',p_type);
end;
$fn$;
$pulsefn$, '__SCHEMA__', quote_ident(sch));

 execute replace($pulsefn$
create or replace function public.pulse_cancel_media(p_job uuid) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare job public.pulse_publication_jobs; prev_sub text:=current_setting('request.jwt.claim.sub',true); prev_claims text:=current_setting('request.jwt.claims',true);
begin
 select * into job from public.pulse_publication_jobs where id=p_job for update;
 if not found then raise exception 'Item não encontrado na fila.';end if;
 if job.state in ('publishing','published') then raise exception 'A publicação já começou ou terminou; não dá mais para cancelar.' using errcode='55000';end if;
 if job.post_id is not null then
  perform __SCHEMA__.act_as_account_owner(job.account_id);
  perform public.pulse_cancel_publication(job.post_id);
  perform __SCHEMA__.restore_caller(prev_sub,prev_claims);
 else
  update public.pulse_publication_jobs set state='cancelled',last_error=null,lease_id=null,lease_until=null,updated_at=now()
   where id=p_job and state in ('scheduled','failed','cancelled');
 end if;
 return jsonb_build_object('job_id',p_job,'state','cancelled');
end;
$fn$;
$pulsefn$, '__SCHEMA__', quote_ident(sch));

 execute replace($pulsefn$
create or replace function public.pulse_meta_oauth_begin_service(p_account uuid) returns text
language plpgsql security definer set search_path='' as $fn$
declare v_state text; owner uuid;
begin
 select w.owner_id into owner from public.pulse_editorial_accounts a join public.pulse_workspaces w on w.id=a.workspace_id where a.id=p_account;
 if owner is null or not __SCHEMA__.account_owner_user(p_account,owner) then raise exception 'not_owner' using errcode='42501';end if;
 delete from __SCHEMA__.pulse_meta_oauth_states s where s.expires_at<now() or (s.user_id=owner and s.account_id=p_account);
 v_state:=encode(extensions.gen_random_bytes(32),'hex');
 insert into __SCHEMA__.pulse_meta_oauth_states(state,account_id,user_id,expires_at) values(v_state,p_account,owner,now()+interval '30 minutes');
 return v_state;
end;
$fn$;
$pulsefn$, '__SCHEMA__', quote_ident(sch));

 execute replace($pulsefn$
create or replace function public.pulse_meta_tokens_due(p_within interval default interval '15 days')
returns table(account_id uuid,token text,expires_at timestamptz)
language sql security definer set search_path='' as $fn$
 select c.account_id,s.decrypted_secret,c.expires_at from __SCHEMA__.pulse_meta_connections c
 join vault.decrypted_secrets s on s.id=c.token_secret_id
 where c.expires_at>now() and c.expires_at<now()+p_within and c.refreshed_at<now()-interval '1 day';
$fn$;
$pulsefn$, '__SCHEMA__', quote_ident(sch));

 execute replace($pulsefn$
create or replace function public.pulse_insights_due(p_limit integer default 5)
returns table(job_id uuid,account_id uuid,media_id text,media_type text,permalink text,ig_user_id text,token text)
language sql security definer set search_path='' as $fn$
 select j.id,j.account_id,j.media_id,j.media_type,j.permalink,c.ig_user_id,s.decrypted_secret
 from public.pulse_publication_jobs j
 join __SCHEMA__.pulse_meta_connections c on c.account_id=j.account_id
 join vault.decrypted_secrets s on s.id=c.token_secret_id
 where j.state='published' and j.media_id is not null and c.expires_at>now()
   and (c.insights_granted or c.scopes && array['instagram_manage_insights','instagram_business_manage_insights'])
   and not exists(select 1 from public.pulse_media_insights i where i.media_id=j.media_id and i.collected_at>now()-interval '6 hours')
 order by j.published_at desc nulls last
 limit least(greatest(coalesce(p_limit,5),1),20);
$fn$;
$pulsefn$, '__SCHEMA__', quote_ident(sch));
end
$mig$;

do $$ declare fn text; begin
 foreach fn in array array[
  'public.pulse_queue_media(uuid,text,text,timestamptz,jsonb,uuid)',
  'public.pulse_cancel_media(uuid)',
  'public.pulse_list_publication_queue(uuid)',
  'public.pulse_meta_oauth_begin_service(uuid)',
  'public.pulse_meta_tokens_due(interval)',
  'public.pulse_insights_due(integer)',
  'public.pulse_insights_save(text,uuid,uuid,text,text,bigint,bigint,bigint,bigint,bigint,bigint,jsonb,text)'] loop
  execute format('revoke all on function %s from public,anon,authenticated',fn);
  execute format('grant execute on function %s to service_role',fn);
 end loop;
end $$;

do $$
declare sch text:=current_setting('pulse.private_schema');
begin
 if exists(select 1 from pg_extension where extname='pg_cron') and exists(select 1 from pg_extension where extname='pg_net') then
  perform cron.schedule('pulse-publisher','* * * * *',format('select %I.pulse_publisher_tick()',sch));
 end if;
end $$;
