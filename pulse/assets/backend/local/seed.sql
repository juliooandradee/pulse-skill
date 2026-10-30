-- Owner, viewer and the existing Pulse workspace, as in production.
insert into auth.users(id,email,email_confirmed_at) values
 ('11111111-1111-4111-8111-111111111111','owner@example.com',now()),
 ('22222222-2222-4222-8222-222222222222','viewer@example.com',now());
insert into public.pulse_workspaces(id,owner_id,handle,title) values
 ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','perfil.exemplo','Pulse');
