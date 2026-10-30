import {exchangeUnifiedCode,inspectToken,longLivedUserToken,probeInstagramAccounts,unifiedLoginUrl} from '../_shared/instagram-graph.mjs';
import {APP_ORIGINS,UUID,createRest,replies} from '../_shared/supabase-rest.mjs';

// Database refusals that the owner can act on; anything else is a generic failure.
const SAVE_ERRORS={handle_mismatch:'outra-conta',missing_publish_scope:'sem-permissao',ig_in_use:'conta-em-uso'};
// The business integration token does not expire; the database still needs a horizon for its checks.
const NO_EXPIRY_YEARS=10;

// The shared account must be the editorial account's @; with no @ on record, exactly one account is accepted.
export function pickAccount(accounts,expectedHandle){
 if(expectedHandle)return accounts.find(a=>a.username.toLowerCase()===expectedHandle.toLowerCase())||null;
 return accounts.length===1?accounts[0]:null;
}

export function makeHandler({url,key,appId,appSecret,configId,redirectUri,version,appUrl='https://your-app.example/',fetcher=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
 const rest=createRest({url,key,fetcher});
 // detail carries only counts (never tokens or IDs), to tell an empty share from a delayed one.
 const back=(status,detail)=>new Response(null,{status:302,headers:{Location:`${appUrl}?meta=${status}${detail?'&detalhe='+detail:''}#publication`,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});

 // The portfolio can take a moment to expose the shared account; the probe looks everywhere the Meta may list it.
 async function sharedAccounts(token,granted){
  let probe;
  for(let attempt=0;attempt<3;attempt++){
   probe=await probeInstagramAccounts({token,version,targets:granted.targets,fetchImpl:fetcher});
   if(probe.accounts.length)return probe;
   if(attempt<2)await sleep(2000);
  }
  return probe;
 }
 const reportText=(granted,report)=>[`tipo${granted.type||'0'}`,`escopos${granted.scopes.length}`,...Object.entries(report).map(([k,v])=>`${k}${v}`)].join('-').replace(/[^A-Za-z0-9._-]/g,'');
 // An account reached through a Facebook Page is saved with that Page's token: it never expires and publishes to its Instagram.
 async function saveConnection(pending,account,token,granted,shared){
  let saved=token,scopes=granted.scopes,expiresAt=granted.expiresAt;
  const pageToken=shared?.pageTokens?.[account.id];
  if(pageToken){saved=pageToken;try{({scopes,expiresAt}=await inspectToken({token:pageToken,appId,appSecret,version,fetchImpl:fetcher}));}catch{/* keep the user token's grants */}}
  await rest.rpc('pulse_meta_save_connection',{p_account:pending.account_id,p_user:pending.user_id,p_ig_user_id:account.id,p_username:account.username,p_token:saved,p_scopes:scopes,p_expires_at:expiresAt||new Date(Date.now()+NO_EXPIRY_YEARS*365*864e5).toISOString()});
  await rest.rpc('pulse_meta_drop_pending',{p_account:pending.account_id}).catch(()=>null);
 }
 async function tokenFromCode(code){
  const token=await exchangeUnifiedCode({appId,appSecret,redirectUri,code,version,fetchImpl:fetcher});
  try{return await longLivedUserToken({appId,appSecret,token,version,fetchImpl:fetcher});}catch{return token;}
 }
 const configured=Boolean(appId&&appSecret&&/^[0-9]+$/.test(configId||'')&&redirectUri&&/^v\d+\.\d+$/.test(version||''));

 // Step 1 (browser, signed in): one-time state bound to the owner and the editorial account.
 async function start(req){
  const {origin,headers,reply}=replies(req);
  if(origin&&!APP_ORIGINS.has(origin))return reply({error:'Origem não permitida.'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(!configured)return reply({error:'A conexão com a Meta ainda não foi configurada no Pulse.'},503);
  const authorization=req.headers.get('authorization')||'';
  const user=await rest.user(authorization);if(!user)return reply({error:'Entre novamente no Pulse.'},401);
  const raw=await req.text();if(raw.length>512)return reply({error:'Solicitação muito grande.'},413);
  let body;try{body=JSON.parse(raw);}catch{return reply({error:'Solicitação inválida.'},400);}
  if(!UUID.test(body.account_id||''))return reply({error:'Solicitação inválida.'},400);
  if(body.action==='resume')return resume(user,body.account_id,reply);
  if(body.action!=='start')return reply({error:'Ação desconhecida.'},400);
  try{
   const state=await rest.rpc('pulse_meta_oauth_begin',{p_account:body.account_id},{authorization});
   return reply({url:unifiedLoginUrl({appId,configId,redirectUri,state})});
  }catch{return reply({error:'Somente o proprietário desta conta pode conectar o Instagram.'},403);}
 }

 // "Retomar conexão": probes again with the pending token, without a new login.
 async function resume(user,accountId,reply){
  const pending=await rest.rpc('pulse_meta_take_pending',{p_account:accountId}).catch(()=>null);
  if(!pending||pending.user_id!==user.id)return reply({error:'Não há conexão pendente. Clique em Conectar Instagram.'},409);
  let granted,shared;
  try{granted=await inspectToken({token:pending.token,appId,appSecret,version,fetchImpl:fetcher});shared=await sharedAccounts(pending.token,granted);}
  catch{return reply({error:'A Meta não respondeu. Tente de novo em alguns minutos.'},502);}
  const report=reportText(granted,shared.report);
  if(!shared.accounts.length)return reply({error:'A Meta ainda não mostra o @ compartilhado. Confira em Configurações do negócio → Contas do Instagram e tente de novo.',report},409);
  const account=pickAccount(shared.accounts,pending.expected_handle);
  if(!account)return reply({error:'O @ compartilhado não é o desta conta.',report},409);
  try{await saveConnection(pending,account,pending.token,granted,shared);}
  catch(error){return reply({error:{handle_mismatch:'O @ compartilhado não é o desta conta.',missing_publish_scope:'A permissão de publicar não foi concedida.',ig_in_use:'Esse Instagram já está conectado a outra conta do Pulse.'}[error.message]||'Não foi possível salvar a conexão.'},409);}
  return reply({ok:true,username:account.username,report});
 }

 // Step 2 (redirect from the Meta): exchange the code, keep the portfolio token in Vault, return to the app.
 async function callback(req){
  const params=new URL(req.url).searchParams,state=params.get('state')||'',code=params.get('code');
  if(params.get('error'))return back('cancelado');
  if(!configured||!/^[0-9a-f]{64}$/.test(state)||!code||code.length>2048)return back('invalido');
  const [pending]=await rest.rpc('pulse_meta_oauth_consume',{p_state:state}).catch(()=>[]);
  if(!pending)return back('expirado');
  let token,granted,shared,stage='troca';
  try{
   token=await tokenFromCode(code);
   stage='token';granted=await inspectToken({token,appId,appSecret,version,fetchImpl:fetcher});
   stage='contas';shared=await sharedAccounts(token,granted);
  }catch{return back('erro-meta',stage);}
  if(!shared.accounts.length){
   // Keep the approved token so "Retomar conexão" can finish without another login and SMS.
   await rest.rpc('pulse_meta_keep_pending',{p_account:pending.account_id,p_user:pending.user_id,p_token:token,p_scopes:granted.scopes}).catch(()=>null);
   return back('sem-conta',reportText(granted,shared.report));
  }
  const account=pickAccount(shared.accounts,pending.expected_handle);
  if(!account)return back('outra-conta');
  try{await saveConnection(pending,account,token,granted,shared);}
  catch(error){return back(SAVE_ERRORS[error.message]||'erro');}
  return back('conectado');
 }

 return req=>req.method==='GET'?callback(req):start(req);
}
