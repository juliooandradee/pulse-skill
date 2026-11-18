import test from 'node:test';import assert from 'node:assert/strict';
import {helpText,mediaName,parseCommand,publicJob,queuePlan,run,toUtcInZone} from './instagram-cli.mjs';

test('a ajuda está em português e cita o fuso de Maceió',()=>{
 const help=helpText();
 for(const word of ['setup','connect','publish','schedule','list','cancel','America/Maceio','não commite'])assert.match(help,new RegExp(word));
});
test('o horário de Maceió vira UTC e rejeita data impossível',()=>{
 assert.equal(toUtcInZone('2026-11-20 09:00'),'2026-11-20T12:00:00.000Z');
 assert.equal(toUtcInZone('2026-11-20T09:00','America/Maceio'),'2026-11-20T12:00:00.000Z');
 assert.throws(()=>toUtcInZone('2026-02-31 09:00'),/não existe/);
 assert.equal(parseCommand(['schedule','--tz','America/Sao_Paulo']).tz,'America/Sao_Paulo');
});
test('imagem, carrossel e Reels montam caminhos privados',()=>{
 const job='55555555-5555-4555-8555-555555555555',workspace='33333333-3333-4333-8333-333333333333';
 assert.equal(mediaName('capa.JPEG',0,'carousel'),'slide-01.jpg');
 assert.deepEqual(queuePlan({workspaceId:workspace,jobId:job,type:'image',files:['foto.png'],bucket:'pulse-private'}).map(item=>item.path),[`${workspace}/instagram/${job}/slide-01.png`]);
 assert.equal(queuePlan({workspaceId:workspace,jobId:job,type:'reel',files:['video.mp4'],bucket:'pulse-reels'})[0].bucket,'pulse-reels');
 assert.throws(()=>queuePlan({workspaceId:workspace,jobId:job,type:'carousel',files:['a.jpg'],bucket:'pulse-private'}),/2 a 10/);
 assert.throws(()=>queuePlan({workspaceId:workspace,jobId:job,type:'reel',files:['a.jpg'],bucket:'pulse-private'}),/MP4/);
});
test('a resposta da fila não devolve token nem container',()=>{
 assert.deepEqual(publicJob({job_id:'1',state:'scheduled',token:'segredo',container_id:'9',caption:'Oi'}),{job_id:'1',state:'scheduled',caption:'Oi'});
});
test('publicar agora sobe o arquivo e acorda a fila sem imprimir a chave',async()=>{
 const calls=[];
 const fetchImpl=async(url,options={})=>{
  calls.push({url:String(url),body:options.body,type:options.headers?.['Content-Type']});
  const path=new URL(url).pathname;
  if(path.startsWith('/rest/v1/pulse_editorial_accounts'))return Response.json([{id:'55555555-5555-4555-8555-555555555555',workspace_id:'33333333-3333-4333-8333-333333333333',instagram_handle:'julioandrade.ia',connection_status:'connected'}]);
  if(path.startsWith('/storage/'))return Response.json({Key:'ok'});
  if(path.endsWith('/pulse_queue_media'))return Response.json({job_id:'55555555-5555-4555-8555-555555555555',state:'scheduled',media_type:'image'});
  if(path.endsWith('/pulse-publisher'))return Response.json({processed:['published'],insights:0});
  return Response.json({error:'rota'},{status:404});
 };
 const result=await run(['publish','--type','image','--caption','Legenda do post','--file','foto.jpg'],{env:{NEXT_PUBLIC_SUPABASE_URL:'https://project.supabase.test',SUPABASE_SERVICE_ROLE_KEY:'service-secret'},fetchImpl,readFile:()=>Buffer.from('jpeg'),now:()=>new Date('2026-11-18T15:00:00Z')});
 assert.equal(result.code,0);assert.match(result.text,/Legenda|scheduled|Enviado/);assert.ok(!result.text.includes('service-secret'));
 assert.ok(calls.some(call=>call.url.includes('/storage/v1/object/pulse-private/')&&call.url.includes('/instagram/')));
 assert.ok(calls.some(call=>call.url.endsWith('/pulse-publisher')));
 const queued=calls.find(call=>call.url.endsWith('/pulse_queue_media'));
 assert.equal(JSON.parse(queued.body).p_scheduled_at,'2026-11-18T15:00:00.000Z');
});
test('agendar não publica na hora e usa o fuso informado',async()=>{
 const calls=[];
 const fetchImpl=async(url)=>{
  calls.push(String(url));
  if(String(url).includes('pulse_editorial_accounts'))return Response.json([{id:'55555555-5555-4555-8555-555555555555',workspace_id:'33333333-3333-4333-8333-333333333333',connection_status:'connected'}]);
  if(String(url).includes('/storage/'))return Response.json({Key:'ok'});
  if(String(url).includes('pulse_queue_media'))return Response.json({job_id:'job',state:'scheduled'});
  return Response.json({error:'nao'},{status:500});
 };
 const result=await run(['schedule','--type','reel','--caption','Reels','--file','video.mp4','--at','2026-11-20 09:00'],{env:{NEXT_PUBLIC_SUPABASE_URL:'https://project.supabase.test',SUPABASE_SERVICE_ROLE_KEY:'service-secret',PULSE_MEDIA_BUCKET:'pulse-reels'},fetchImpl,readFile:()=>Buffer.from('mp4')});
 assert.equal(result.code,0);assert.match(result.text,/2026-11-20T12:00:00.000Z/);assert.ok(!calls.some(url=>url.includes('pulse-publisher')));
});
test('setup e connect explicam o próximo passo sem vazar segredo',async()=>{
 const fetchImpl=async(url,options={})=>{
  if(String(url).includes('pulse_editorial_accounts')&&!options.body)return Response.json([{account_key:'principal',instagram_handle:'julioandrade.ia',connection_status:'connected',name:'Principal',id:'55555555-5555-4555-8555-555555555555',workspace_id:'33333333-3333-4333-8333-333333333333'}]);
  if(String(url).includes('pulse-meta-connect'))return Response.json({url:'https://www.facebook.com/dialog/oauth?state=abc',aviso:'Abra uma única vez.'});
  return Response.json([{id:'55555555-5555-4555-8555-555555555555',workspace_id:'33333333-3333-4333-8333-333333333333',instagram_handle:'julioandrade.ia',connection_status:'connected'}]);
 };
 const env={NEXT_PUBLIC_SUPABASE_URL:'https://project.supabase.test',SUPABASE_SERVICE_ROLE_KEY:'service-secret'};
 const setup=await run(['setup'],{env,fetchImpl});
 assert.equal(setup.code,0);assert.match(setup.text,/julioandrade.ia/);assert.ok(!setup.text.includes('service-secret'));
 const connect=await run(['connect'],{env,fetchImpl});
 assert.match(connect.text,/facebook.com\/dialog\/oauth/);assert.match(connect.text,/única vez/);
 assert.equal((await run(['publish'],{env:{}})).code,1);
});
