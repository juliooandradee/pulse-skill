create table public.pulse_workspaces (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id),
 handle text not null unique, title text not null,
 taxonomy jsonb not null default '[]', settings jsonb not null default '{}',
 updated_at timestamptz not null default now()
);
create table public.pulse_contents (
 workspace_id uuid not null references public.pulse_workspaces(id) on delete cascade,
 content_id text not null, published_at date, title text, editorial_line text,
 payload jsonb not null, updated_at timestamptz not null default now(),
 primary key(workspace_id,content_id)
);
create table public.pulse_comments (
 workspace_id uuid not null references public.pulse_workspaces(id) on delete cascade,
 comment_id text not null, content_id text not null, payload jsonb not null,
 updated_at timestamptz not null default now(),
 primary key(workspace_id,comment_id),
 foreign key(workspace_id,content_id) references public.pulse_contents(workspace_id,content_id)
);
create table public.pulse_datasets (
 workspace_id uuid not null references public.pulse_workspaces(id) on delete cascade,
 dataset_key text not null, payload jsonb not null, updated_at timestamptz not null default now(),
 primary key(workspace_id,dataset_key)
);
create table public.pulse_updates (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.pulse_workspaces(id) on delete cascade,
 observed_at timestamptz not null default now(), summary jsonb not null
);
create index pulse_contents_period_idx on public.pulse_contents(workspace_id,published_at);
create index pulse_comments_content_idx on public.pulse_comments(workspace_id,content_id);
create index pulse_updates_workspace_idx on public.pulse_updates(workspace_id,observed_at);
alter table public.pulse_workspaces enable row level security;
alter table public.pulse_contents enable row level security;
alter table public.pulse_comments enable row level security;
alter table public.pulse_datasets enable row level security;
alter table public.pulse_updates enable row level security;
revoke all on public.pulse_workspaces,public.pulse_contents,public.pulse_comments,public.pulse_datasets,public.pulse_updates from anon,authenticated;
grant select on public.pulse_workspaces,public.pulse_contents,public.pulse_comments,public.pulse_datasets,public.pulse_updates to authenticated;
grant all on public.pulse_workspaces,public.pulse_contents,public.pulse_comments,public.pulse_datasets,public.pulse_updates to service_role;
create policy pulse_owner_read on public.pulse_workspaces for select to authenticated using ((select auth.uid())=owner_id);
create policy pulse_owner_read on public.pulse_contents for select to authenticated using (workspace_id in (select id from public.pulse_workspaces where owner_id=(select auth.uid())));
create policy pulse_owner_read on public.pulse_comments for select to authenticated using (workspace_id in (select id from public.pulse_workspaces where owner_id=(select auth.uid())));
create policy pulse_owner_read on public.pulse_datasets for select to authenticated using (workspace_id in (select id from public.pulse_workspaces where owner_id=(select auth.uid())));
create policy pulse_owner_read on public.pulse_updates for select to authenticated using (workspace_id in (select id from public.pulse_workspaces where owner_id=(select auth.uid())));
insert into storage.buckets(id,name,public,file_size_limit) values ('pulse-private','pulse-private',false,52428800);
create policy pulse_owner_files_read on storage.objects for select to authenticated using (
 bucket_id='pulse-private' and (storage.foldername(name))[1] in
 (select id::text from public.pulse_workspaces where owner_id=(select auth.uid()))
);
