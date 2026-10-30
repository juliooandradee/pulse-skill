-- Automatic Instagram publishing through the official Meta API (Instagram Login).
-- The access token lives only in Vault: the browser never reads tokens or Meta container IDs.
-- The scheduler (pg_cron/pg_net) is a separate activation file: 20261028150100_pulse_publisher_cron.sql.

-- 1. A post can be handed to the automatic publisher ("scheduled").
alter table public.pulse_editorial_posts drop constraint pulse_editorial_posts_status_check;
alter table public.pulse_editorial_posts add constraint pulse_editorial_posts_status_check check (status in ('draft','review','planned','scheduled'));
alter table public.pulse_editorial_posts drop constraint pulse_editorial_posts_check;
alter table public.pulse_editorial_posts add constraint pulse_editorial_posts_check check ((status in ('planned','scheduled'))=(planned_at is not null));
alter table public.pulse_editorial_accounts add column connection_expires_at timestamptz;

-- 2. Publication queue. One job per post; the owner reads only the user-facing columns.
create table public.pulse_publication_jobs (
 id uuid primary key default gen_random_uuid(),
 post_id uuid not null unique,
 account_id uuid not null,
 revision integer not null check (revision>0),
 scheduled_at timestamptz not null,
 assets jsonb not null check (jsonb_typeof(assets)='array' and jsonb_array_length(assets) between 2 and 10),
 state text not null default 'scheduled' check (state in ('scheduled','publishing','published','failed','cancelled')),
 phase text check (phase ~ '^[a-z_]{1,40}$'),
 attempts integer not null default 0 check (attempts>=0),
 lease_id uuid,
 lease_until timestamptz,
 next_attempt_at timestamptz,
 children jsonb,
 container_id text check (container_id ~ '^[0-9]{1,40}$'),
 media_id text check (media_id ~ '^[0-9]{1,40}$'),
 permalink text check (permalink ~ '^https://(www\.)?instagram\.com/'),
 published_at timestamptz,
 last_error text check (length(last_error)<=500),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key (post_id,account_id) references public.pulse_editorial_posts(id,account_id)
);
create index pulse_publication_jobs_due_idx on public.pulse_publication_jobs(scheduled_at) where state in ('scheduled','publishing');
create index pulse_publication_jobs_account_idx on public.pulse_publication_jobs(account_id);
create index pulse_publication_jobs_creator_idx on public.pulse_publication_jobs(created_by);
alter table public.pulse_publication_jobs enable row level security;
revoke all on public.pulse_publication_jobs from public,anon,authenticated;
grant select(id,post_id,account_id,revision,scheduled_at,state,phase,attempts,permalink,published_at,last_error,created_at,updated_at) on public.pulse_publication_jobs to authenticated;
grant all on public.pulse_publication_jobs to service_role;
create policy pulse_publication_jobs_read on public.pulse_publication_jobs for select to authenticated using (pulse_private.editorial_owner(account_id));

-- 3. Private connection data and short-lived OAuth states. Reached only through the functions below.
create table pulse_private.pulse_meta_connections (
 account_id uuid primary key references public.pulse_editorial_accounts(id),
 ig_user_id text not null unique check (ig_user_id ~ '^[0-9]{5,40}$'),
 username text not null check (username ~ '^[A-Za-z0-9_.]{1,30}$'),
 token_secret_id uuid not null,
 scopes text[] not null,
 expires_at timestamptz not null,
 refreshed_at timestamptz not null default now(),
 connected_by uuid not null references auth.users(id),
 connected_at timestamptz not null default now()
);
create table pulse_private.pulse_meta_oauth_states (
 state text primary key check (state ~ '^[0-9a-f]{64}$'),
 account_id uuid not null references public.pulse_editorial_accounts(id),
 user_id uuid not null references auth.users(id),
 expires_at timestamptz not null
);
create index pulse_meta_connections_user_idx on pulse_private.pulse_meta_connections(connected_by);
create index pulse_meta_oauth_states_account_idx on pulse_private.pulse_meta_oauth_states(account_id);
create index pulse_meta_oauth_states_user_idx on pulse_private.pulse_meta_oauth_states(user_id);
revoke all on pulse_private.pulse_meta_connections,pulse_private.pulse_meta_oauth_states from public,anon,authenticated;

create function pulse_private.publication_locked(target uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.pulse_publication_jobs where post_id=target and state in ('publishing','published'));
$$;
revoke all on function pulse_private.publication_locked(uuid) from public,anon;
grant execute on function pulse_private.publication_locked(uuid) to authenticated,service_role;

-- Same owner rule as editorial_owner, for server calls that carry the user id explicitly.
create function pulse_private.account_owner_user(target uuid,actor uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select actor is not null and exists (
  select 1 from public.pulse_editorial_accounts a
  join public.pulse_workspaces w on w.id=a.workspace_id
  join auth.users u on u.id=w.owner_id
  where a.id=target and w.owner_id=actor and u.email_confirmed_at is not null
    and not u.is_anonymous and (u.banned_until is null or u.banned_until<now())
 );
$$;
revoke all on function pulse_private.account_owner_user(uuid,uuid) from public,anon,authenticated;
grant execute on function pulse_private.account_owner_user(uuid,uuid) to service_role;

-- 4. Post validation: published posts are frozen; "scheduled" is set only by pulse_schedule_publication.
create or replace function pulse_private.validate_editorial_post() returns trigger
language plpgsql security invoker set search_path='' as $$
declare slide jsonb; source jsonb;
begin
 if auth.uid() is null or not pulse_private.editorial_owner(new.account_id) then raise exception 'Acesso editorial não autorizado.' using errcode='42501'; end if;
 if tg_op='INSERT' then
  new.revision:=1;new.created_by:=auth.uid();new.created_at:=now();
 else
  if pulse_private.publication_locked(old.id) then raise exception 'Este post já está sendo publicado ou já foi publicado no Instagram. Crie um novo rascunho para mudar o conteúdo.' using errcode='55000';end if;
  if new.account_id<>old.account_id or new.id<>old.id or new.created_by<>old.created_by or new.created_at<>old.created_at then raise exception 'A origem do rascunho é imutável.';end if;
  if new.revision<>old.revision+1 then raise exception 'A versão mudou. Reabra o rascunho antes de salvar.' using errcode='40001';end if;
 end if;
 if new.status='scheduled' and coalesce(current_setting('pulse.scheduling',true),'')<>'on' then raise exception 'Use "Agendar publicação automática" para entregar o post ao Instagram.' using errcode='42501';end if;
 if jsonb_typeof(new.content) is distinct from 'object' or octet_length(new.content::text)>150000 then raise exception 'Conteúdo inválido ou muito grande.';end if;
 if jsonb_typeof(new.content->'title') is distinct from 'string' or length(trim(new.content->>'title')) not between 1 and 160 then raise exception 'Informe um título de até 160 caracteres.';end if;
 if jsonb_typeof(new.content->'caption') is distinct from 'string' or length(new.content->>'caption')>2200 then raise exception 'Legenda inválida.';end if;
 if jsonb_typeof(new.content->'slides') is distinct from 'array' then raise exception 'Slides inválidos.';end if;
 if jsonb_array_length(new.content->'slides') not between 2 and 10 then raise exception 'Use de 2 a 10 slides.';end if;
 for slide in select value from jsonb_array_elements(new.content->'slides') loop
  if jsonb_typeof(slide->'headline') is distinct from 'string' or length(slide->>'headline')>120
     or jsonb_typeof(slide->'body') is distinct from 'string' or length(slide->>'body')>600
     or jsonb_typeof(slide->'alt') is distinct from 'string' or length(slide->>'alt')>500
     then raise exception 'Revise os campos do slide.';end if;
  if new.status<>'draft' and (length(trim(slide->>'headline'))=0 or length(trim(slide->>'alt'))=0) then raise exception 'Complete os títulos e textos alternativos.';end if;
 end loop;
 if jsonb_typeof(new.content->'sources') is distinct from 'array' then raise exception 'Fontes inválidas.';end if;
 if jsonb_array_length(new.content->'sources')>30 then raise exception 'Use até 30 fontes.';end if;
 for source in select value from jsonb_array_elements(new.content->'sources') loop
  if jsonb_typeof(source->'url') is distinct from 'string' or (source->>'url') !~ '^https://[^/[:space:]]+' or length(source->>'url')>2048 then raise exception 'Use uma fonte HTTPS válida.';end if;
 end loop;
 if new.status<>'draft' and (length(trim(new.content->>'caption'))=0 or jsonb_array_length(new.content->'sources')=0) then raise exception 'Complete a legenda e inclua uma fonte antes de revisar ou planejar.';end if;
 if new.origin is not null and (jsonb_typeof(new.origin)<>'object' or octet_length(new.origin::text)>20000) then raise exception 'Origem inválida.';end if;
 if new.status in ('planned','scheduled') and (new.planned_at is null or new.planned_at<=now()) then raise exception 'Escolha um horário futuro para o planejamento.';end if;
 new.updated_by:=auth.uid();new.updated_at:=now();return new;
end;
$$;

-- Any later save of the post invalidates a pending schedule; the schedule function re-creates it.
create function pulse_private.sync_publication_job() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.pulse_publication_jobs set state='cancelled',lease_id=null,lease_until=null,updated_at=now(),
  last_error='O rascunho mudou depois do agendamento. Agende de novo.'
 where post_id=new.id and state='scheduled';
 return null;
end;
$$;
revoke all on function pulse_private.sync_publication_job() from public,anon,authenticated;
create trigger pulse_publication_job_sync after update on public.pulse_editorial_posts for each row execute function pulse_private.sync_publication_job();

-- 5. Owner actions (browser, authenticated).
create function public.pulse_schedule_publication(p_post uuid,p_revision integer,p_scheduled_at timestamptz,p_assets jsonb)
returns table(job_id uuid,job_state text,job_scheduled_at timestamptz,post_revision integer)
language plpgsql security definer set search_path='' as $$
declare post public.pulse_editorial_posts; workspace uuid; asset jsonb; slide_number integer:=0; next_revision integer;
begin
 select * into post from public.pulse_editorial_posts p where p.id=p_post for update;
 if not found or not pulse_private.editorial_owner(post.account_id) then raise exception 'Acesso editorial não autorizado.' using errcode='42501';end if;
 if post.revision<>p_revision then raise exception 'A versão mudou. Reabra o rascunho antes de agendar.' using errcode='40001';end if;
 if pulse_private.publication_locked(p_post) then raise exception 'Este post já está sendo publicado ou já foi publicado.' using errcode='55000';end if;
 if not exists(select 1 from pulse_private.pulse_meta_connections c where c.account_id=post.account_id and c.expires_at>now()) then
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
 insert into public.pulse_publication_jobs as j(post_id,account_id,revision,scheduled_at,assets,created_by)
 values(p_post,post.account_id,next_revision,p_scheduled_at,(select jsonb_agg(jsonb_build_object('path',value->>'path')) from jsonb_array_elements(p_assets)),auth.uid())
 on conflict (post_id) do update set revision=excluded.revision,scheduled_at=excluded.scheduled_at,assets=excluded.assets,state='scheduled',
  phase=null,attempts=0,lease_id=null,lease_until=null,next_attempt_at=null,children=null,container_id=null,media_id=null,
  permalink=null,published_at=null,last_error=null,created_by=excluded.created_by,updated_at=now()
 where j.state in ('scheduled','failed','cancelled');
 return query select j.id,j.state,j.scheduled_at,j.revision from public.pulse_publication_jobs j where j.post_id=p_post and j.revision=next_revision and j.state='scheduled';
 if not found then raise exception 'Não foi possível agendar. Recarregue a lista e tente de novo.';end if;
end;
$$;

create function public.pulse_cancel_publication(p_post uuid) returns void
language plpgsql security definer set search_path='' as $$
declare post public.pulse_editorial_posts;
begin
 select * into post from public.pulse_editorial_posts p where p.id=p_post for update;
 if not found or not pulse_private.editorial_owner(post.account_id) then raise exception 'Acesso editorial não autorizado.' using errcode='42501';end if;
 if pulse_private.publication_locked(p_post) then raise exception 'A publicação já começou ou terminou; não dá mais para cancelar.' using errcode='55000';end if;
 if post.status='scheduled' then
  update public.pulse_editorial_posts p set status='review',planned_at=null,revision=post.revision+1 where p.id=p_post;
 end if;
 update public.pulse_publication_jobs set state='cancelled',last_error=null,lease_id=null,lease_until=null,updated_at=now()
 where post_id=p_post and state in ('scheduled','failed','cancelled');
end;
$$;

create function public.pulse_meta_oauth_begin(p_account uuid) returns text
language plpgsql security definer set search_path='' as $$
declare v_state text;
begin
 if not pulse_private.editorial_owner(p_account) then raise exception 'Acesso editorial não autorizado.' using errcode='42501';end if;
 delete from pulse_private.pulse_meta_oauth_states s where s.expires_at<now() or (s.user_id=auth.uid() and s.account_id=p_account);
 v_state:=encode(extensions.gen_random_bytes(32),'hex');
 insert into pulse_private.pulse_meta_oauth_states(state,account_id,user_id,expires_at) values(v_state,p_account,auth.uid(),now()+interval '10 minutes');
 return v_state;
end;
$$;

create function public.pulse_meta_disconnect(p_account uuid) returns void
language plpgsql security definer set search_path='' as $$
declare secret_ref uuid;
begin
 if not pulse_private.editorial_owner(p_account) then raise exception 'Acesso editorial não autorizado.' using errcode='42501';end if;
 delete from pulse_private.pulse_meta_connections c where c.account_id=p_account returning c.token_secret_id into secret_ref;
 if secret_ref is not null then delete from vault.secrets s where s.id=secret_ref;end if;
 update public.pulse_editorial_accounts set connection_status='not_connected',connection_expires_at=null where id=p_account;
end;
$$;

-- 6. Server actions (Edge Functions with the service role).
create function public.pulse_meta_oauth_consume(p_state text) returns table(account_id uuid,user_id uuid,expected_handle text)
language sql security definer set search_path='' as $$
 with s as (delete from pulse_private.pulse_meta_oauth_states x where x.state=p_state and x.expires_at>now() returning x.account_id,x.user_id)
 select s.account_id,s.user_id,a.instagram_handle from s join public.pulse_editorial_accounts a on a.id=s.account_id;
$$;

create function public.pulse_meta_save_connection(p_account uuid,p_user uuid,p_ig_user_id text,p_username text,p_token text,p_scopes text[],p_expires_at timestamptz) returns void
language plpgsql security definer set search_path='' as $$
declare account public.pulse_editorial_accounts; secret_ref uuid; secret_name text:='pulse_meta_token_'||p_account::text;
begin
 select * into account from public.pulse_editorial_accounts a where a.id=p_account for update;
 if not found or not pulse_private.account_owner_user(p_account,p_user) then raise exception 'not_owner' using errcode='42501';end if;
 if account.instagram_handle is not null and lower(account.instagram_handle)<>lower(p_username) then raise exception 'handle_mismatch';end if;
 if exists(select 1 from pulse_private.pulse_meta_connections c where c.ig_user_id=p_ig_user_id and c.account_id<>p_account) then raise exception 'ig_in_use';end if;
 if not ('instagram_business_content_publish'=any(p_scopes)) then raise exception 'missing_publish_scope';end if;
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

create function public.pulse_meta_tokens_due(p_within interval default interval '15 days') returns table(account_id uuid,token text,expires_at timestamptz)
language sql security definer set search_path='' as $$
 select c.account_id,s.decrypted_secret,c.expires_at from pulse_private.pulse_meta_connections c
 join vault.decrypted_secrets s on s.id=c.token_secret_id
 where c.expires_at>now() and c.expires_at<now()+p_within and c.refreshed_at<now()-interval '1 day';
$$;

-- p_token null records a failed attempt (retried the next day); p_expired marks the connection as expired.
create function public.pulse_meta_refresh_result(p_account uuid,p_token text,p_expires_at timestamptz,p_expired boolean default false) returns void
language plpgsql security definer set search_path='' as $$
declare secret_ref uuid;
begin
 select c.token_secret_id into secret_ref from pulse_private.pulse_meta_connections c where c.account_id=p_account for update;
 if not found then return;end if;
 if p_token is not null and length(p_token)>=20 and p_expires_at>now() then
  perform vault.update_secret(secret_ref,p_token);
  update pulse_private.pulse_meta_connections set expires_at=p_expires_at,refreshed_at=now() where account_id=p_account;
  update public.pulse_editorial_accounts set connection_status='connected',connection_expires_at=p_expires_at where id=p_account;
 else
  update pulse_private.pulse_meta_connections set refreshed_at=now() where account_id=p_account;
  if p_expired then update public.pulse_editorial_accounts set connection_status='expired' where id=p_account;end if;
 end if;
end;
$$;

-- Claims one due job with a lease. Stale schedules are cancelled; jobs without a live connection fail.
create function public.pulse_publisher_claim(p_lease_seconds integer default 300) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.pulse_publication_jobs; post public.pulse_editorial_posts; conn pulse_private.pulse_meta_connections; token text; lease uuid:=gen_random_uuid();
begin
 loop
  select * into job from public.pulse_publication_jobs j
  where (j.state='scheduled' and j.scheduled_at<=now() and coalesce(j.next_attempt_at,'-infinity')<=now())
     or (j.state='publishing' and j.lease_until<now())
  order by j.scheduled_at for update skip locked limit 1;
  if not found then return null;end if;
  select * into post from public.pulse_editorial_posts p where p.id=job.post_id;
  if post.status<>'scheduled' or post.revision<>job.revision then
   update public.pulse_publication_jobs set state='cancelled',lease_id=null,lease_until=null,updated_at=now(),last_error='O rascunho mudou depois do agendamento. Agende de novo.' where id=job.id;
   continue;
  end if;
  select * into conn from pulse_private.pulse_meta_connections c where c.account_id=job.account_id;
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
   'assets',job.assets,'children',job.children,'container_id',job.container_id,'media_id',job.media_id,
   'caption',post.content->>'caption','ig_user_id',conn.ig_user_id,'username',conn.username,'token',token);
 end loop;
end;
$$;

-- Keys present in p_patch are written (a JSON null clears the field). False means the lease or the post changed.
create function public.pulse_publisher_checkpoint(p_job uuid,p_lease uuid,p_patch jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 update public.pulse_publication_jobs j set
  phase=coalesce(p_patch->>'phase',j.phase),
  children=case when p_patch ? 'children' then nullif(p_patch->'children','null'::jsonb) else j.children end,
  container_id=case when p_patch ? 'container_id' then p_patch->>'container_id' else j.container_id end,
  media_id=case when p_patch ? 'media_id' then p_patch->>'media_id' else j.media_id end,
  lease_until=greatest(j.lease_until,now()+interval '2 minutes'),updated_at=now()
 from public.pulse_editorial_posts p
 where j.id=p_job and j.lease_id=p_lease and j.state='publishing' and p.id=j.post_id and p.status='scheduled' and p.revision=j.revision;
 return found;
end;
$$;

-- p_state: published | failed | retry (back to the queue after retry_in_seconds, keeping the container).
create function public.pulse_publisher_finish(p_job uuid,p_lease uuid,p_state text,p_patch jsonb default '{}'::jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if p_state not in ('published','failed','retry') then raise exception 'Estado inválido.';end if;
 update public.pulse_publication_jobs j set
  state=case p_state when 'retry' then 'scheduled' else p_state end,
  next_attempt_at=case when p_state='retry' then now()+make_interval(secs=>least(greatest(coalesce((p_patch->>'retry_in_seconds')::integer,60),30),3600)) end,
  phase=coalesce(p_patch->>'phase',j.phase),
  children=case when p_patch ? 'children' then nullif(p_patch->'children','null'::jsonb) else j.children end,
  container_id=case when p_patch ? 'container_id' then p_patch->>'container_id' else j.container_id end,
  media_id=case when p_patch ? 'media_id' then p_patch->>'media_id' else j.media_id end,
  permalink=case when p_state='published' then p_patch->>'permalink' else j.permalink end,
  published_at=case when p_state='published' then coalesce((p_patch->>'published_at')::timestamptz,now()) else j.published_at end,
  last_error=case when p_state='published' then null else left(p_patch->>'error',500) end,
  lease_id=null,lease_until=null,updated_at=now()
 where j.id=p_job and j.lease_id=p_lease and j.state='publishing';
 return found;
end;
$$;

-- Dry run ("Testar sem publicar"): same token and caption the publisher will use, for the owner's saved revision.
create function public.pulse_publisher_test_context(p_post uuid,p_user uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare post public.pulse_editorial_posts; conn pulse_private.pulse_meta_connections; workspace uuid; token text;
begin
 select * into post from public.pulse_editorial_posts p where p.id=p_post;
 if not found or not pulse_private.account_owner_user(post.account_id,p_user) then raise exception 'not_owner' using errcode='42501';end if;
 select * into conn from pulse_private.pulse_meta_connections c where c.account_id=post.account_id and c.expires_at>now();
 if not found then raise exception 'not_connected';end if;
 select a.workspace_id into workspace from public.pulse_editorial_accounts a where a.id=post.account_id;
 select s.decrypted_secret into token from vault.decrypted_secrets s where s.id=conn.token_secret_id;
 return jsonb_build_object('workspace_id',workspace,'revision',post.revision,'slides',jsonb_array_length(post.content->'slides'),
  'caption',post.content->>'caption','ig_user_id',conn.ig_user_id,'username',conn.username,'token',token);
end;
$$;

do $$ declare fn text; begin
 foreach fn in array array[
  'public.pulse_schedule_publication(uuid,integer,timestamptz,jsonb)','public.pulse_cancel_publication(uuid)',
  'public.pulse_meta_oauth_begin(uuid)','public.pulse_meta_disconnect(uuid)',
  'public.pulse_meta_oauth_consume(text)','public.pulse_meta_save_connection(uuid,uuid,text,text,text,text[],timestamptz)',
  'public.pulse_meta_tokens_due(interval)','public.pulse_meta_refresh_result(uuid,text,timestamptz,boolean)',
  'public.pulse_publisher_claim(integer)','public.pulse_publisher_checkpoint(uuid,uuid,jsonb)',
  'public.pulse_publisher_finish(uuid,uuid,text,jsonb)','public.pulse_publisher_test_context(uuid,uuid)'] loop
  execute format('revoke all on function %s from public,anon,authenticated',fn);
  execute format('grant execute on function %s to service_role',fn);
 end loop;
end $$;
grant execute on function public.pulse_schedule_publication(uuid,integer,timestamptz,jsonb) to authenticated;
grant execute on function public.pulse_cancel_publication(uuid) to authenticated;
grant execute on function public.pulse_meta_oauth_begin(uuid) to authenticated;
grant execute on function public.pulse_meta_disconnect(uuid) to authenticated;

-- 7. The owner uploads the final JPEGs of each slide under <workspace>/publication/. Insert only: nothing is overwritten.
create policy pulse_publication_assets_upload on storage.objects for insert to authenticated with check (
 bucket_id='pulse-private' and (storage.foldername(name))[2]='publication' and lower(storage.extension(name))='jpg'
 and (storage.foldername(name))[1] in (select id::text from public.pulse_workspaces where owner_id=(select auth.uid()))
);
