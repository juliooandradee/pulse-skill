import {InstagramClient,MetaError} from '../_shared/instagram-graph.mjs';
import {APP_ORIGINS,UUID,createRest,replies} from '../_shared/supabase-rest.mjs';

const ASSET=/^[0-9a-f-]{36}\/publication\/[0-9a-f-]{36}\/[a-z0-9]{6,32}\/slide-[0-9]{2}\.jpg$/;
const EXPIRED_TOKEN=190;
// Meta codes the owner can act on. Rate limits go back to the queue instead of failing.
const META_MESSAGES={
 9004:'O Instagram não conseguiu baixar as imagens. Gere as imagens de novo e agende outra vez.',
 36003:'O Instagram recusou o formato das imagens. Use JPEG 1080 × 1350.',
 2207026:'O Instagram recusou o formato das imagens. Use JPEG 1080 × 1350.',
 2207052:'O Instagram não conseguiu baixar as imagens. Gere as imagens de novo e agende outra vez.'
};
const RATE_LIMITS=new Set([4,17,32,613,2207042]);

export function friendlyError(error){
 if(error?.code===EXPIRED_TOKEN)return {state:'failed',expired:true,error:'A conexão com o Instagram expirou ou foi removida. Conecte de novo e agende outra vez.'};
 if(RATE_LIMITS.has(error?.code)||RATE_LIMITS.has(error?.subcode))return {state:'retry',retry:1800,error:'O Instagram pediu uma pausa nas publicações. Nova tentativa automática em 30 minutos.'};
 if(error?.uncertain||error?.status>=500||(error instanceof MetaError&&!error.status&&!error.code))return {state:'retry',backoff:true,error:'O Instagram não respondeu. Nova tentativa automática em instantes.'};
 const message=META_MESSAGES[error?.code]||META_MESSAGES[error?.subcode];
 if(message)return {state:'failed',error:message};
 return {state:'failed',error:error?.code?`O Instagram recusou a publicação (código ${error.code}). Revise o post e agende de novo.`:'Não foi possível publicar este post. Revise e agende de novo.'};
}

export function makeHandler({url,key,version,fetcher=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms)),budgetMs=100000,pollMs=3000,onPublished=async()=>{}}){
 const rest=createRest({url,key,fetcher}),mediaHost=new URL(url).hostname;
 // Unified Login tokens call graph.facebook.com with the Instagram professional account ID.
 const client=token=>new InstagramClient({token,version,login:'facebook',fetchImpl:fetcher,mediaHosts:[mediaHost]});

 async function waitFinished(ig,containerId,tries=8){
  for(let i=0;i<tries;i++){const {status_code}=await ig.status(containerId);if(status_code!=='IN_PROGRESS')return status_code;await sleep(pollMs);}
  return 'IN_PROGRESS';
 }
 async function createCarousel(ig,igUserId,paths,caption,checkpoint=async()=>true){
  const urls=[];for(const path of paths)urls.push(await rest.sign(path,3600));
  const children=[];for(const imageUrl of urls)children.push((await ig.image(igUserId,{url:imageUrl})).id);
  if(!await checkpoint({phase:'children_created',children}))return null;
  const container=(await ig.carousel(igUserId,children,caption)).id;
  if(!await checkpoint({phase:'container_created',container_id:container}))return null;
  return container;
 }
 // After an uncertain publish the container says PUBLISHED; the caption identifies the media.
 async function findPublished(ig,job){
  const recent=(await ig.recentMedia(job.ig_user_id)).data||[];
  const matches=recent.filter(m=>(m.caption||'').trim()===(job.caption||'').trim()&&m.permalink&&m.timestamp&&Date.parse(m.timestamp)>=Date.parse(job.scheduled_at||new Date(Date.now()-3600000).toISOString())-300000);
  return matches.length===1?matches[0]:null;
 }

 async function publishJob(job){
  const ig=client(job.token);
  const checkpoint=async patch=>await rest.rpc('pulse_publisher_checkpoint',{p_job:job.job_id,p_lease:job.lease_id,p_patch:patch})===true;
  const finish=(state,patch={})=>rest.rpc('pulse_publisher_finish',{p_job:job.job_id,p_lease:job.lease_id,p_state:state,p_patch:patch});
  const done=async media=>{if(!media.id||!media.permalink){await finish('retry',{phase:'verification_pending',retry_in_seconds:60});return 'retry';}const saved=await finish('published',{phase:'published',media_id:media.id,permalink:media.permalink,...(media.timestamp?{published_at:new Date(media.timestamp).toISOString()}:{})});if(saved)await onPublished(job).catch(()=>null);return 'published';};
  try{
   if(job.media_id)return await done(await ig.media(job.media_id));
   let container=job.container_id;
   if(container){
    const status=(await ig.status(container)).status_code;
    if(status==='PUBLISHED'){const media=await findPublished(ig,job);if(media)return await done(media);await finish('retry',{phase:'verification_pending',retry_in_seconds:120,error:'O Instagram processou a publicação. Aguardando confirmação do link, sem publicar novamente.'});return 'retry';}
    if(status==='IN_PROGRESS'){await finish('retry',{phase:'container_processing',retry_in_seconds:60});return 'retry';}
    if(status!=='FINISHED')container=null;
   }
   if(!container){
    container=await createCarousel(ig,job.ig_user_id,job.assets.map(a=>a.path),job.caption,checkpoint);
    if(!container)return 'cancelled';
    const status=await waitFinished(ig,container);
    if(status==='IN_PROGRESS'){await finish('retry',{phase:'container_processing',retry_in_seconds:60});return 'retry';}
    if(status!=='FINISHED'){await finish('failed',{phase:'container_error',container_id:null,children:null,error:'O Instagram não aceitou as imagens deste carrossel. Gere as imagens de novo e agende outra vez.'});return 'failed';}
   }
   if(!await checkpoint({phase:'publishing'}))return 'cancelled';
   const media=await ig.publish(job.ig_user_id,container);
   await checkpoint({phase:'media_accepted',media_id:media.id});
   return await done(await ig.media(media.id));
  }catch(error){return recordFailure(job,finish,error);}
 }
 async function recordFailure(job,finish,error){
  const outcome=friendlyError(error);
  const seconds=outcome.backoff?60*2**Math.min(job.attempt||1,5):outcome.retry;
  await finish(outcome.state,{error:outcome.error,...(outcome.state==='retry'?{retry_in_seconds:seconds}:{})}).catch(()=>null);
  if(outcome.expired)await rest.rpc('pulse_meta_refresh_result',{p_account:job.account_id,p_token:null,p_expires_at:null,p_expired:true}).catch(()=>null);
  return outcome.state;
 }

 async function tick(){
  const started=Date.now(),results=[];
  while(Date.now()-started<budgetMs&&results.length<10){
   const job=await rest.rpc('pulse_publisher_claim',{p_lease_seconds:300});
   if(!job)break;
   results.push(await publishJob(job));
  }
  return {processed:results};
 }

 // "Testar sem publicar": builds the carousel on Instagram and stops before media_publish.
 async function dryRun(user,body){
  if(!UUID.test(body.post_id||'')||!Number.isInteger(body.revision)||!Array.isArray(body.assets))return [{error:'Solicitação inválida.'},400];
  let context;
  try{context=await rest.rpc('pulse_publisher_test_context',{p_post:body.post_id,p_user:user.id});}
  catch(error){return error.message==='not_connected'?[{error:'Conecte o Instagram desta conta na aba Conexão antes de testar.'},409]:[{error:'Somente o proprietário pode testar esta publicação.'},403];}
  if(context.revision!==body.revision)return [{error:'Salve o rascunho antes de testar.'},409];
  const prefix=`${context.workspace_id}/publication/${body.post_id}/`;
  if(body.assets.length!==context.slides||!body.assets.every((p,i)=>typeof p==='string'&&ASSET.test(p)&&p.startsWith(prefix)&&p.endsWith(`slide-${String(i+1).padStart(2,'0')}.jpg`)))return [{error:'Gere as imagens de todos os slides antes de testar.'},400];
  try{
   const ig=client(context.token),container=await createCarousel(ig,context.ig_user_id,body.assets,context.caption);
   const status=await waitFinished(ig,container);
   if(status==='FINISHED'||status==='IN_PROGRESS')return [{ok:true,username:context.username,message:`O Instagram de @${context.username} aceitou as ${context.slides} imagens e a legenda${status==='IN_PROGRESS'?' (ainda processando)':''}. Nada foi publicado.`},200];
   return [{error:'O Instagram não aceitou as imagens deste carrossel. Gere as imagens de novo.'},422];
  }catch(error){return [{error:friendlyError(error).error.replace(/ e agende( de novo| outra vez)?\./,'.')},422];}
 }

 // The owner's own session, or the server (service key) naming the owner it acts for; the database still checks ownership.
 async function caller(authorization,body){
  if(authorization==='Bearer '+key)return UUID.test(body.user_id||'')?{id:body.user_id}:null;
  return rest.user(authorization);
 }

 return async function handle(req){
  const {origin,headers,reply}=replies(req);
  if(origin&&!APP_ORIGINS.has(origin))return reply({error:'Origem não permitida.'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply({error:'Método não permitido.'},405);
  const cron=req.headers.get('x-pulse-cron');
  if(cron){
   if(!await rest.rpc('pulse_publisher_cron_ok',{p_secret:cron}).catch(()=>false))return reply({error:'Não autorizado.'},401);
   return reply(await tick());
  }
  const raw=await req.text();if(raw.length>4096)return reply({error:'Solicitação muito grande.'},413);
  let body;try{body=JSON.parse(raw);}catch{return reply({error:'Solicitação inválida.'},400);}
  const user=await caller(req.headers.get('authorization')||'',body);
  if(!user)return reply({error:'Entre novamente no Pulse.'},401);
  if(body.action!=='test')return reply({error:'Ação desconhecida.'},400);
  const [data,status]=await dryRun(user,body);return reply(data,status);
 };
}
