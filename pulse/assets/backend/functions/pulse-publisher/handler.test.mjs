import test from 'node:test';import assert from 'node:assert/strict';import {makeHandler,friendlyError} from './handler.mjs';
const base='https://project.supabase.test',ws='33333333-3333-4333-8333-333333333333',post='55555555-5555-4555-8555-555555555555',uid='11111111-1111-4111-8111-111111111111';
const paths=[1,2].map(i=>`${ws}/publication/${post}/abc123/slide-0${i}.jpg`);
const job=(extra={})=>({job_id:'j1',lease_id:'l1',post_id:post,account_id:'a1',attempt:1,scheduled_at:'2026-10-28T20:55:00Z',assets:paths.map(path=>({path})),children:null,container_id:null,media_id:null,caption:'Comenta GUIA que eu te mando',ig_user_id:'17841400000000001',username:'perfil.exemplo',token:'ig-token-secreto',...extra});

// Fake Supabase + Instagram. meta.status / meta.fail let each test shape the Graph API answers.
function rig({jobs=[],checkpoint=true,meta={},context}={}){
 const calls=[],rpc=[];const queue=[...jobs];
 const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
 const fetcher=async(input,options={})=>{
  const url=new URL(String(input)),body=options.body;calls.push({url:url.href,method:options.method||'GET',headers:options.headers||{},body:body instanceof URLSearchParams?Object.fromEntries(body):body?JSON.parse(body):null});
  if(url.origin===base){
   if(url.pathname==='/auth/v1/user')return options.headers.Authorization==='Bearer user-jwt'?json({id:uid,email_confirmed_at:'2026-10-01'}):json({},401);
   if(url.pathname.startsWith('/storage/v1/object/sign/'))return json({signedURL:url.pathname.replace('/storage/v1','')+'?token=signed'});
   const name=url.pathname.replace('/rest/v1/rpc/','');const args=JSON.parse(body);rpc.push({name,args});
   if(name==='pulse_publisher_cron_ok')return json(args.p_secret==='c'.repeat(64));
   if(name==='pulse_publisher_claim')return json(queue.shift()||null);
   if(name==='pulse_publisher_checkpoint')return json(typeof checkpoint==='function'?checkpoint(args):checkpoint);
   if(name==='pulse_publisher_test_context')return context instanceof Error?json({message:context.message},400):json(context);
   return json(true);
  }
  if(meta.fail?.[url.pathname])return meta.fail[url.pathname]();
  if(url.pathname.endsWith('/media_publish'))return json({id:'900'});
  if(url.pathname.endsWith('/media')&&options.method==='POST')return json({id:calls.filter(c=>c.url.endsWith('/media')&&c.method==='POST').length+'0'});
  if(url.pathname.endsWith('/media'))return json({data:meta.recent||[]});
  if(url.pathname.endsWith('/900'))return json({id:'900',permalink:'https://www.instagram.com/p/abc/',timestamp:'2026-10-28T21:00:00+0000'});
  return json({id:url.pathname.split('/').pop(),status_code:meta.status||'FINISHED'});
 };
 const handler=makeHandler({url:base,key:'service-key',version:'v26.0',fetcher,sleep:async()=>{},pollMs:0});
 const cron=(secret='c'.repeat(64))=>handler(new Request(base,{method:'POST',headers:{'x-pulse-cron':secret},body:'{"action":"tick"}'}));
 const user=(body,headers={authorization:'Bearer user-jwt',origin:'https://your-app.example'})=>handler(new Request(base,{method:'POST',headers,body:JSON.stringify(body)}));
 const meta_=()=>calls.filter(c=>c.url.startsWith('https://graph.facebook.com/v26.0/'));
 return {calls,rpc,cron,user,meta:meta_,finish:()=>rpc.filter(r=>r.name==='pulse_publisher_finish')};
}

test('agendador sem segredo válido não processa nada',async()=>{
 const r=rig({jobs:[job()]});assert.equal((await r.cron('errado')).status,401);assert.ok(!r.rpc.some(x=>x.name==='pulse_publisher_claim'));
});
test('publica o carrossel na ordem certa e grava o link do post',async()=>{
 const r=rig({jobs:[job()]}),res=await r.cron(),out=await res.json();
 assert.deepEqual(out.processed,['published']);
 const children=r.meta().filter(c=>c.method==='POST'&&c.body.is_carousel_item);
 assert.equal(children.length,2);assert.ok(children.every(c=>new URL(c.body.image_url).origin===base&&c.body.image_url.includes('token=signed')));
 assert.ok(r.meta().every(c=>!c.url.includes('ig-token-secreto')&&c.headers.Authorization==='Bearer ig-token-secreto'));
 const carousel=r.meta().find(c=>c.body?.media_type==='CAROUSEL');assert.equal(carousel.body.caption,'Comenta GUIA que eu te mando');assert.equal(carousel.body.children,'10,20');
 assert.deepEqual(r.rpc.filter(x=>x.name==='pulse_publisher_checkpoint').map(x=>x.args.p_patch.phase),['children_created','container_created','publishing','media_accepted']);
 const [done]=r.finish();assert.equal(done.args.p_state,'published');assert.equal(done.args.p_patch.permalink,'https://www.instagram.com/p/abc/');assert.equal(done.args.p_patch.published_at,'2026-10-28T21:00:00.000Z');
});
test('container ainda processando volta para a fila sem publicar',async()=>{
 const r=rig({jobs:[job()],meta:{status:'IN_PROGRESS'}});await r.cron();
 assert.ok(!r.meta().some(c=>c.url.endsWith('/media_publish')));const [retry]=r.finish();assert.equal(retry.args.p_state,'retry');assert.equal(retry.args.p_patch.retry_in_seconds,60);
});
test('retomada: container já publicado é confirmado pela legenda, sem publicar de novo',async()=>{
 const r=rig({jobs:[job({container_id:'333'})],meta:{status:'PUBLISHED',recent:[{id:'800',caption:' Comenta GUIA que eu te mando ',permalink:'https://www.instagram.com/p/xyz/',timestamp:'2026-10-28T21:00:00Z'}]}});await r.cron();
 assert.ok(!r.meta().some(c=>c.method==='POST'));const [done]=r.finish();assert.equal(done.args.p_patch.media_id,'800');
});
test('retomada: container pronto é publicado uma vez, sem recriar imagens',async()=>{
 const r=rig({jobs:[job({container_id:'333'})]});await r.cron();
 assert.equal(r.meta().filter(c=>c.method==='POST').length,1);assert.equal(r.meta().find(c=>c.url.endsWith('/media_publish')).body.creation_id,'333');
});
test('post editado durante o processo não é publicado',async()=>{
 const r=rig({jobs:[job()],checkpoint:a=>a.p_patch.phase!=='publishing'});const out=await (await r.cron()).json();
 assert.deepEqual(out.processed,['cancelled']);assert.ok(!r.meta().some(c=>c.url.endsWith('/media_publish')));
});
test('token vencido falha o job e marca a conexão como expirada',async()=>{
 const r=rig({jobs:[job()],meta:{fail:{'/v26.0/17841400000000001/media':()=>Response.json({error:{code:190}},{status:400})}}});await r.cron();
 assert.equal(r.finish()[0].args.p_state,'failed');assert.ok(r.rpc.some(x=>x.name==='pulse_meta_refresh_result'&&x.args.p_expired===true));
});
test('resposta incerta na publicação volta para a fila com espera crescente',async()=>{
 const r=rig({jobs:[job({container_id:'333',attempt:3})],meta:{fail:{'/v26.0/17841400000000001/media_publish':()=>{throw new Error('socket');}}}});await r.cron();
 const [retry]=r.finish();assert.equal(retry.args.p_state,'retry');assert.equal(retry.args.p_patch.retry_in_seconds,480);
});
test('limite de publicações da Meta espera 30 minutos',()=>{
 assert.deepEqual(friendlyError({code:4,status:400}).state,'retry');assert.equal(friendlyError({code:4,status:400}).retry,1800);
 assert.equal(friendlyError({code:36003,status:400}).state,'failed');
});
test('publica pelo graph.facebook.com do login unificado e nunca chama outro host da Meta',async()=>{
 const r=rig({jobs:[job()]});await r.cron();
 assert.ok(r.meta().length>0);assert.ok(r.calls.every(c=>new URL(c.url).origin===base||c.url.startsWith('https://graph.facebook.com/v26.0/')));
});
test('testar sem publicar monta o carrossel e nunca chama media_publish',async()=>{
 const context={workspace_id:ws,revision:3,slides:2,caption:'Legenda',ig_user_id:'17841400000000001',username:'perfil.exemplo',token:'ig-token-secreto'};
 const r=rig({context}),res=await r.user({action:'test',post_id:post,revision:3,assets:paths});const out=await res.json();
 assert.equal(res.status,200);assert.match(out.message,/Nada foi publicado/);assert.ok(!r.meta().some(c=>c.url.endsWith('/media_publish')));
 assert.equal(r.rpc.find(x=>x.name==='pulse_publisher_test_context').args.p_user,uid);
});
test('o servidor testa em nome do dono com a chave de serviço, e só com o dono informado',async()=>{
 const context={workspace_id:ws,revision:1,slides:2,caption:'Legenda',ig_user_id:'17841400000000001',username:'perfil.exemplo',token:'ig-token-secreto'};
 const server=(body,r=rig({context}))=>r.user(body,{authorization:'Bearer service-key'}).then(res=>({res,r}));
 const {res,r}=await server({action:'test',post_id:post,revision:1,assets:paths,user_id:uid});
 assert.equal(res.status,200);assert.equal(r.rpc.find(x=>x.name==='pulse_publisher_test_context').args.p_user,uid);assert.ok(!r.meta().some(c=>c.url.endsWith('/media_publish')));
 assert.equal((await server({action:'test',post_id:post,revision:1,assets:paths})).res.status,401);
 assert.equal((await server({action:'test',post_id:post,revision:1,assets:paths,user_id:'nao-e-uuid'})).res.status,401);
});
test('testar sem publicar recusa sessão, origem, versão e arquivos fora do lugar',async()=>{
 const context={workspace_id:ws,revision:3,slides:2,caption:'Legenda',ig_user_id:'1784140000',username:'x',token:'t'};
 assert.equal((await rig({context}).user({action:'test'},{})).status,401);
 assert.equal((await rig({context}).user({action:'test'},{authorization:'Bearer user-jwt',origin:'https://evil.test'})).status,403);
 assert.equal((await rig({context}).user({action:'test',post_id:post,revision:2,assets:paths})).status,409);
 const other=paths.map(p=>p.replace(ws,'00000000-0000-4000-8000-000000000000'));const r=rig({context});
 assert.equal((await r.user({action:'test',post_id:post,revision:3,assets:other})).status,400);assert.equal(r.meta().length,0);
 assert.equal((await rig({context:new Error('not_connected')}).user({action:'test',post_id:post,revision:3,assets:paths})).status,409);
});

test('reconciliation does not guess a permalink or republish when evidence is missing',async()=>{const r=rig({jobs:[job({container_id:'333'})],meta:{status:'PUBLISHED',recent:[]}});await r.cron();assert.ok(!r.meta().some(c=>c.method==='POST'));assert.equal(r.finish()[0].args.p_state,'retry');});
