-- Completion is independent from curated datasets so sync never resets it.
create table public.pulse_idea_progress (
 workspace_id uuid not null references public.pulse_workspaces(id) on delete cascade,
 idea_id text not null check (idea_id ~ '^[A-Za-z0-9_-]{1,160}$'),
 completed_at timestamptz not null default now(),
 completed_by uuid not null default auth.uid() references auth.users(id),
 primary key (workspace_id, idea_id)
);
create index pulse_idea_progress_author_idx on public.pulse_idea_progress(completed_by);
alter table public.pulse_idea_progress enable row level security;
revoke all on public.pulse_idea_progress from public, anon, authenticated;
grant select, delete on public.pulse_idea_progress to authenticated;
grant insert (workspace_id, idea_id) on public.pulse_idea_progress to authenticated;
grant all on public.pulse_idea_progress to service_role;
create policy pulse_idea_progress_read on public.pulse_idea_progress
 for select to authenticated using (pulse_private.can_read(workspace_id));
create policy pulse_idea_progress_complete on public.pulse_idea_progress
 for insert to authenticated with check (
  pulse_private.is_owner(workspace_id) and completed_by=(select auth.uid())
 );
create policy pulse_idea_progress_reopen on public.pulse_idea_progress
 for delete to authenticated using (pulse_private.is_owner(workspace_id));
