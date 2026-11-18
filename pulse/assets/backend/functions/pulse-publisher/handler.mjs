import {InstagramClient,MetaError,inspectToken,longLivedUserToken} from '../_shared/instagram-graph.mjs';
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

const numberOrNull=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
// Official Insights values only. A missing metric stays null; a zero returned by the Meta is kept.
export function mapInsights(raw={},mediaType,counts={}){
 const plays=mediaType==='reel'?numberOrNull(raw.plays)??numberOrNull(raw.views):null;
 return {
  reach:numberOrNull(raw.reach),
  saves:numberOrNull(raw.saved),
  shares:numberOrNull(raw.shares),
  comments:numberOrNull(raw.comments)??numberOrNull(counts.comments_count),
  likes:numberOrNull(raw.likes)??numberOrNull(counts.like_count),
  plays
 };
}
function containerError(row,fallback){
 const detail=String(row?.status||'').replace(/https?:\/\/\S+/g,'').replace(/\s+/g,' ').trim().slice(0,180);
 return detail?`${fallback} (${row.status_code}: ${detail})`:fallback;
}

export function makeHandler({url,key,version,fetcher=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms)),budgetMs=100000,pollMs=3000,onPublished=async()=>{},bucket='pulse-private',appId='',appSecret=''}){
 const rest=createRest({url,key,fetcher,bucket}),mediaHost=new URL(url).hostname;
 // Unified Login tokens call graph.facebook.com with the Instagram professional account ID.
 const client=token=>new InstagramClient({token,version,login:'facebook',fetchImpl:fetcher,mediaHosts:[mediaHost]});

 async function waitFinished(ig,containerId,tries=8){
  let row={status_code:'IN_PROGRESS'};
  for(let i=0;i<tries;i++){row=await ig.containerStatus(containerId);if(row.status_code!=='IN_PROGRESS')return row;await sleep(pollMs);}
  return row;
 }
 async function createCarousel(ig,igUserId,assets,caption,checkpoint=async()=>true){
  const urls=[];
  for(const asset of assets)urls.push(await rest.sign(typeof asset==='string'?asset:asset.path,3600,typeof asset==='string'?undefined:asset.bucket));
  const children=[];for(const imageUrl of urls)children.push((await ig.image(igUserId,{url:imageUrl})).id);
  if(!await checkpoint({phase:'children_created',children}))return null;
  const container=(await ig.carousel(igUserId,children,caption)).id;
  if(!await checkpoint({phase:'container_created',container_id:container}))return null;
  return container;
 }
 async function createSingle(ig,job,checkpoint){
  const asset=job.assets[0],url=await rest.sign(asset.path,3600,asset.bucket);
  const created=job.media_type==='reel'?await ig.reel(job.ig_user_id,{url},job.caption):await ig.feedImage(job.ig_user_id,{url},job.caption);
  if(!await checkpoint({phase:'container_created',container_id:created.id}))return null;
  return created.id;
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
   const type=job.media_type||'carousel';
   if(job.media_id)return await done(await ig.media(job.media_id));
   let container=job.container_id;
   if(container){
    const status=(await ig.containerStatus(container)).status_code;
    if(status==='PUBLISHED'){const media=await findPublished(ig,job);if(media)return await done(media);await finish('retry',{phase:'verification_pending',retry_in_seconds:120,error:'O Instagram processou a publicação. Aguardando confirmação do link, sem publicar novamente.'});return 'retry';}
    if(status==='IN_PROGRESS'){await finish('retry',{phase:'container_processing',retry_in_seconds:type==='reel'?90:60});return 'retry';}
    if(status!=='FINISHED')container=null;
   }
   if(!container){
    container=type==='carousel'?await createCarousel(ig,job.ig_user_id,job.assets,job.caption,checkpoint):await createSingle(ig,job,checkpoint);
    if(!container)return 'cancelled';
    const row=await waitFinished(ig,container,type==='reel'?4:8);
    if(row.status_code==='IN_PROGRESS'){await finish('retry',{phase:'container_processing',retry_in_seconds:type==='reel'?90:60});return 'retry';}
    if(row.status_code!=='FINISHED'){await finish('failed',{phase:'container_error',container_id:null,children:null,error:containerError(row,type==='reel'?'O Instagram não aceitou o vídeo deste Reels. Envie um MP4 vertical e agende de novo.':'O Instagram não aceitou o arquivo. Revise o formato e agende de novo.')});return 'failed';}
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

 async function pullInsights(){
  const due=await rest.rpc('pulse_insights_due',{p_limit:3}).catch(()=>[]);
  if(!Array.isArray(due)||!due.length)return [];
  const saved=[];
  for(const item of due){
   if(!item?.media_id||!item.token)continue;
   const ig=client(item.token);
   const names=item.media_type==='reel'?['reach','saved','shares','comments','likes','views','plays']:['reach','saved','shares','comments','likes'];
   const raw={};let error=null;
   for(const metric of names){
    try{
     const data=await ig.insights(item.media_id,[metric]);
     const value=data?.data?.[0]?.values?.[0]?.value??data?.data?.[0]?.total_value?.value;
     if(typeof value==='number')raw[metric]=value;
    }catch(err){if(err?.code===190)error='A conexão com o Instagram expirou. Conecte de novo para atualizar os Insights.';}
   }
   let counts={};try{counts=await ig.counts(item.media_id);}catch{/* likes and comments may still come from Insights */}
   const metrics=mapInsights(raw,item.media_type,counts);
   if(!error&&metrics.reach==null&&metrics.likes==null&&metrics.plays==null)error='A Meta não devolveu Insights deste post. Inclua instagram_manage_insights na conexão e tente de novo.';
   await rest.rpc('pulse_insights_save',{p_media_id:item.media_id,p_account:item.account_id,p_job:item.job_id,p_type:item.media_type||'carousel',p_permalink:item.permalink||null,p_reach:metrics.reach,p_saves:metrics.saves,p_shares:metrics.shares,p_comments:metrics.comments,p_likes:metrics.likes,p_plays:metrics.plays,p_raw:raw,p_error:error}).catch(()=>null);
   saved.push(item.media_id);
  }
  return saved;
 }
 async function refreshDue(){
  if(!appId||!appSecret)return 0;
  const due=await rest.rpc('pulse_meta_tokens_due',{p_within:'15 days'}).catch(()=>[]);
  if(!Array.isArray(due)||!due.length)return 0;
  let refreshed=0;
  for(const row of due){
   try{
    const token=await longLivedUserToken({appId,appSecret,token:row.token,version,fetchImpl:fetcher});
    const inspected=await inspectToken({token,appId,appSecret,version,fetchImpl:fetcher});
    await rest.rpc('pulse_meta_refresh_result',{p_account:row.account_id,p_token:token,p_expires_at:inspected.expiresAt||new Date(Date.now()+60*864e5).toISOString(),p_expired:false});
    refreshed++;
   }catch{await rest.rpc('pulse_meta_refresh_result',{p_account:row.account_id,p_token:null,p_expires_at:null,p_expired:false}).catch(()=>null);}
  }
  return refreshed;
 }
 async function tick(){
  const started=Date.now(),results=[];
  while(Date.now()-started<budgetMs&&results.length<10){
   const job=await rest.rpc('pulse_publisher_claim',{p_lease_seconds:300});
   if(!job)break;
   results.push(await publishJob(job));
  }
  const insights=await pullInsights().catch(()=>[]);
  const refreshed=await refreshDue().catch(()=>0);
  return {processed:results,insights:insights.length,refreshed};
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
   const status=(await waitFinished(ig,container)).status_code;
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
  const authorization=req.headers.get('authorization')||'';
  if(body.action==='tick'||body.action==='insights'){
   if(authorization!=='Bearer '+key)return reply({error:'Não autorizado.'},401);
   if(body.action==='insights')return reply({insights:await pullInsights()});
   return reply(await tick());
  }
  const user=await caller(authorization,body);
  if(!user)return reply({error:'Entre novamente no Pulse.'},401);
  if(body.action!=='test')return reply({error:'Ação desconhecida.'},400);
  const [data,status]=await dryRun(user,body);return reply(data,status);
 };
}
