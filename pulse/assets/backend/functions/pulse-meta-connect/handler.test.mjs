import test from 'node:test';import assert from 'node:assert/strict';import {makeHandler,pickAccount} from './handler.mjs';
const base='https://project.supabase.test',state='a'.repeat(64),account='55555555-5555-4555-8555-555555555555',owner='11111111-1111-4111-8111-111111111111';
const config={url:base,key:'service-key',appId:'123456',appSecret:'app-secret',configId:'1507197881297382',redirectUri:base+'/functions/v1/pulse-meta-connect',version:'v26.0'};
const julio={id:'17841400000000001',username:'perfil.exemplo'};

function rig({consume=[{account_id:account,user_id:owner,expected_handle:'perfil.exemplo'}],accounts=[julio],listings,byId={},business={},pages=[],pending=null,longLived=false,debug={is_valid:true,app_id:'123456',scopes:['instagram_basic','instagram_manage_messages','instagram_content_publish'],expires_at:0},saveError,overrides={}}={}){
 const queue=listings?[...listings]:null;
 const calls=[];
 const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
 const fetcher=async(input,options={})=>{
  const url=new URL(String(input));calls.push({url,options,body:options.body?JSON.parse(options.body):null});
  if(url.pathname==='/auth/v1/user')return options.headers.Authorization==='Bearer user-jwt'?json({id:owner,email_confirmed_at:'2026-10-01'}):json({},401);
  if(url.pathname==='/rest/v1/rpc/pulse_meta_oauth_begin')return json(state);
  if(url.pathname==='/rest/v1/rpc/pulse_meta_oauth_consume')return json(consume);
  if(url.pathname==='/rest/v1/rpc/pulse_meta_save_connection')return saveError?json({message:saveError,code:'P0001'},400):json(null);
  if(url.pathname==='/rest/v1/rpc/pulse_meta_keep_pending'||url.pathname==='/rest/v1/rpc/pulse_meta_drop_pending')return json(null);
  if(url.pathname==='/rest/v1/rpc/pulse_meta_take_pending')return json(pending);
  if(url.pathname==='/v26.0/oauth/access_token')return url.searchParams.get('grant_type')==='fb_exchange_token'?(longLived?json({access_token:'token-usuario-longo'}):json({error:{code:100}},400)):json({access_token:'token-portfolio-secreto',token_type:'bearer'});
  if(url.pathname==='/v26.0/debug_token')return json({data:debug});
  if(url.pathname==='/v26.0/me/assigned_instagram_accounts')return json({data:queue?queue.shift()||[]:accounts});
  if(url.pathname==='/v26.0/me')return json({id:'1',...business});
  if(/^\/v26\.0\/[0-9]+\/(owned_)?instagram_accounts$/.test(url.pathname))return json({data:business.accounts||[]});
  if(url.pathname==='/v26.0/me/accounts')return json({data:pages});
  if(byId[url.pathname.split('/').pop()])return json(byId[url.pathname.split('/').pop()]);
  if(/^\/v26\.0\/[0-9]+$/.test(url.pathname))return json({error:{code:100}},400);
  throw new Error('rota inesperada '+url.href);
 };
 const handler=makeHandler({...config,fetcher,sleep:async()=>{},...overrides});
 return {calls,
  meta:()=>calls.filter(c=>c.url.hostname==='graph.facebook.com'),
  start:(headers={authorization:'Bearer user-jwt',origin:'https://your-app.example'},action='start')=>handler(new Request(base,{method:'POST',headers,body:JSON.stringify({action,account_id:account})})),
  back:query=>handler(new Request(base+'/functions/v1/pulse-meta-connect?'+query))};
}
const target=res=>new URL(res.headers.get('location')).searchParams.get('meta');

test('início exige configuração e sessão; devolve o login unificado oficial com config_id',async()=>{
 assert.equal((await rig({overrides:{configId:''}}).start()).status,503);
 assert.equal((await rig().start({origin:'https://your-app.example'})).status,401);
 const r=rig(),res=await r.start(),{url}=await res.json(),link=new URL(url);
 assert.equal(link.origin+link.pathname,'https://www.facebook.com/dialog/oauth');
 for(const [k,v] of Object.entries({client_id:'123456',config_id:'1507197881297382',redirect_uri:config.redirectUri,response_type:'code',prompt:'login',state}))assert.equal(link.searchParams.get(k),v);
 assert.ok(!url.includes('app-secret'));assert.equal(r.calls.find(c=>c.url.pathname.endsWith('oauth_begin')).options.headers.Authorization,'Bearer user-jwt');
});
test('retorno cancelado, inválido ou expirado não troca código nenhum',async()=>{
 for(const [query,status] of [['error=access_denied&state='+state,'cancelado'],['code=x&state=curto','invalido']]){const r=rig(),res=await r.back(query);assert.equal(target(res),status);assert.equal(r.meta().length,0);}
 const r=rig({consume:[]});assert.equal(target(await r.back('code=abc&state='+state)),'expirado');assert.equal(r.meta().length,0);
});
test('conexão guarda o token do portfólio no servidor e volta sem expor nada na URL',async()=>{
 const r=rig(),res=await r.back('code=codigo-meta&state='+state);
 assert.equal(res.status,302);assert.equal(target(res),'conectado');assert.ok(!res.headers.get('location').match(/token|codigo/));
 const exchange=r.meta().find(c=>c.url.pathname.endsWith('/oauth/access_token')).url.searchParams;
 assert.equal(exchange.get('client_secret'),'app-secret');assert.equal(exchange.get('code'),'codigo-meta');assert.equal(exchange.get('redirect_uri'),config.redirectUri);
 const accounts=r.meta().find(c=>c.url.pathname.endsWith('assigned_instagram_accounts'));assert.equal(accounts.options.headers.Authorization,'Bearer token-portfolio-secreto');assert.ok(!accounts.url.href.includes('token-portfolio'));
 const save=r.calls.find(c=>c.url.pathname.endsWith('save_connection')).body;
 assert.equal(save.p_token,'token-portfolio-secreto');assert.equal(save.p_user,owner);assert.equal(save.p_ig_user_id,julio.id);assert.equal(save.p_username,'perfil.exemplo');
 assert.ok(save.p_scopes.includes('instagram_content_publish'));assert.ok(Date.parse(save.p_expires_at)>Date.now()+9*365*864e5);
});
test('sem conta compartilhada, outro @ ou token de outro app são recusados com motivo claro',async()=>{
 const none=rig({accounts:[]}),noneRes=await none.back('code=c&state='+state);assert.equal(target(noneRes),'sem-conta');assert.equal(new URL(noneRes.headers.get('location')).searchParams.get('detalhe'),'tipo0-escopos3-atribuidas0-empresanao-paginas0');assert.equal(none.calls.find(c=>c.url.pathname.endsWith('keep_pending')).body.p_token,'token-portfolio-secreto');assert.ok(!none.calls.some(c=>c.url.pathname.endsWith('save_connection')));
 assert.equal(target(await rig({accounts:[{id:'17841400000000009',username:'outra.conta'}]}).back('code=c&state='+state)),'outra-conta');
 assert.equal(target(await rig({debug:{is_valid:true,app_id:'999',scopes:[]}}).back('code=c&state='+state)),'erro-meta');
 assert.equal(target(await rig({saveError:'missing_publish_scope'}).back('code=c&state='+state)),'sem-permissao');
 assert.equal(target(await rig({saveError:'algo inesperado'}).back('code=c&state='+state)),'erro');
});
test('escolhe o @ da conta editorial entre várias contas compartilhadas',()=>{
 const other={id:'17841400000000009',username:'med.magno'};
 assert.deepEqual(pickAccount([other,julio],'Perfil.Exemplo'),julio);assert.equal(pickAccount([other],'perfil.exemplo'),null);
 assert.deepEqual(pickAccount([other],null),other);assert.equal(pickAccount([other,julio],null),null);
});
test('lista atrasada: tenta de novo e conecta quando a conta aparece',async()=>{
 const r=rig({listings:[[],[],[julio]]}),res=await r.back('code=c&state='+state);
 assert.equal(target(res),'conectado');assert.equal(r.meta().filter(c=>c.url.pathname.endsWith('assigned_instagram_accounts')).length,3);assert.ok(r.calls.some(c=>c.url.pathname.endsWith('drop_pending')));
});
test('lista vazia: usa as contas liberadas na própria autorização',async()=>{
 const debug={is_valid:true,app_id:'123456',expires_at:0,granular_scopes:[{scope:'instagram_basic',target_ids:[julio.id]},{scope:'instagram_content_publish',target_ids:[julio.id]},{scope:'business_management'}]};
 const r=rig({accounts:[],debug,byId:{[julio.id]:julio}}),res=await r.back('code=c&state='+state);
 assert.equal(target(res),'conectado');const save=r.calls.find(c=>c.url.pathname.endsWith('save_connection')).body;
 assert.equal(save.p_ig_user_id,julio.id);assert.deepEqual(save.p_scopes,['instagram_basic','instagram_content_publish','business_management']);
});
test('erro da Meta informa só a etapa',async()=>{
 const res=await rig({debug:{is_valid:false}}).back('code=c&state='+state);
 assert.equal(target(res),'erro-meta');assert.equal(new URL(res.headers.get('location')).searchParams.get('detalhe'),'token');
});
test('diagnóstico descreve a resposta da Meta sem expor IDs nem chave',async()=>{
 const debug={is_valid:true,app_id:'123456',type:'SYSTEM_USER',expires_at:0,scopes:['instagram_basic','instagram_content_publish'],granular_scopes:[{scope:'instagram_basic',target_ids:[julio.id]}]};
 const r=rig({accounts:[{id:julio.id}],debug}),res=await r.back('code=c&state='+state);
 const detail=new URL(res.headers.get('location')).searchParams.get('detalhe');
 assert.equal(target(res),'sem-conta');assert.equal(detail,'tipoSYSTEM_USER-escopos2-atribuidas0-empresanao-paginas0-alvo1erro100');
 assert.ok(!detail.includes(julio.id)&&!detail.includes('token'));
});
test('conta encontrada pelo portfólio ou pela Página quando a lista atribuída vem vazia',async()=>{
 const viaBusiness=rig({accounts:[],business:{client_business_id:'686265564266051',accounts:[julio]}});
 assert.equal(target(await viaBusiness.back('code=c&state='+state)),'conectado');
 const viaPage=rig({accounts:[],pages:[{id:'9',instagram_business_account:julio}]});
 assert.equal(target(await viaPage.back('code=c&state='+state)),'conectado');
});
test('retomar conexão usa a chave pendente, sem novo login',async()=>{
 const pending={account_id:account,user_id:owner,scopes:['instagram_basic','instagram_content_publish'],expected_handle:'perfil.exemplo',token:'token-pendente-secreto'};
 const r=rig({pending}),res=await r.start(undefined,'resume'),out=await res.json();
 assert.equal(res.status,200);assert.equal(out.username,'perfil.exemplo');assert.ok(!JSON.stringify(out).includes('token-pendente'));
 assert.equal(r.calls.find(c=>c.url.pathname.endsWith('save_connection')).body.p_token,'token-pendente-secreto');assert.ok(!r.meta().some(c=>c.url.pathname.endsWith('/oauth/access_token')));
 const empty=rig({pending,accounts:[]}),emptyRes=await empty.start(undefined,'resume');assert.equal(emptyRes.status,409);assert.match((await emptyRes.json()).report,/atribuidas0/);
 assert.equal((await rig({pending:null}).start(undefined,'resume')).status,409);
 assert.equal((await rig({pending:{...pending,user_id:'outro'}}).start(undefined,'resume')).status,409);
});
test('conta achada pela Página do Facebook é salva com a chave da Página, que não vence',async()=>{
 const pages=[{id:'9',name:'Júlio Andrade IA para médicos',access_token:'token-da-pagina-secreto',instagram_business_account:julio}];
 const r=rig({accounts:[],pages,longLived:true,debug:{is_valid:true,app_id:'123456',scopes:['pages_show_list','instagram_basic','instagram_content_publish'],expires_at:0}});
 const res=await r.back('code=c&state='+state);assert.equal(target(res),'conectado');
 const save=r.calls.find(c=>c.url.pathname.endsWith('save_connection')).body;
 assert.equal(save.p_token,'token-da-pagina-secreto');assert.equal(save.p_ig_user_id,julio.id);assert.ok(Date.parse(save.p_expires_at)>Date.now()+9*365*864e5);
 const exchange=r.meta().find(c=>c.url.searchParams.get('grant_type')==='fb_exchange_token');assert.equal(exchange.url.searchParams.get('fb_exchange_token'),'token-portfolio-secreto');
 const accountsCall=r.meta().find(c=>c.url.pathname.endsWith('/me/accounts'));assert.equal(accountsCall.options.headers.Authorization,'Bearer token-usuario-longo');assert.match(accountsCall.url.searchParams.get('fields'),/access_token/);
 assert.ok(!res.headers.get('location').includes('token'));
});
