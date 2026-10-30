import {createRest,replies,APP_ORIGINS,UUID} from '../_shared/supabase-rest.mjs';
import {InstagramClient} from '../_shared/instagram-graph.mjs';
export function metricValues(payload){return Object.fromEntries((payload?.data||[]).map(m=>[m.name,m.values?.[0]?.value??m.total_value?.value]).filter(([,n])=>typeof n==='number'&&Number.isFinite(n)));}
export function makeEditorialHandler({url,key,version,crmUrl,crmKey,fetcher=fetch}){
 const rest=createRest({url,key,fetcher});
 async function query(path,{method='GET',body}={}){
  const response=await fetcher(url+'/rest/v1/'+path,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=representation'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('Não foi possível consultar os dados do Pulse.');return response.json();
 }
 async function crm(body){
  if(!crmUrl||!crmKey){const configured=await rest.rpc('pulse_crm_connection',{});crmUrl=configured?.url;crmKey=configured?.key;}
  if(!crmUrl||!crmKey)throw Error('Conecte o CRM ao Pulse para usar automações.');
  const endpoint=new URL(crmUrl);if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password)throw Error('Destino do CRM inválido.');
  const r=await fetcher(endpoint,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+crmKey,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(typeof data.message==='string'?data.message:'O CRM não confirmou a operação.');return data.data??data;
 }
 async function sync(job,account){
  if(!job.media_id||!job.permalink)return {post_id:job.post_id,pending:true};
  const [post]=await query('pulse_editorial_posts?id=eq.'+job.post_id+'&select=id,content,origin');if(!post)return {pending:true};
  const [old]=await query('pulse_post_outcomes?post_id=eq.'+post.id);const next={post_id:post.id,account_id:job.account_id,metrics:old?.metrics||{},updated_at:new Date().toISOString()};
  const template=post.origin?.planning?.automationId;
  if(template){
   try{const result=await crm({action:'bind',username:account.username,post_id:post.id,template_id:template,media_id:job.media_id,permalink:job.permalink,title:post.content.title});next.automation_state=result.state;next.automation_flow_id=result.flow_id;next.automation_error=null;
    const resultMetrics=await crm({action:'metrics',username:account.username,post_id:post.id});next.metrics={...next.metrics,...resultMetrics.metrics};
   }catch{next.automation_state=old?.automation_state==='linked'?'linked':'failed';next.automation_error='Não foi possível confirmar a automação no CRM. Atualize os resultados para tentar novamente.';}
  }
  try{
   const context=await rest.rpc('pulse_publisher_test_context',{p_post:post.id,p_user:account.owner_id});
   const ig=new InstagramClient({token:context.token,version,login:'facebook',fetchImpl:fetcher});
   const errors=[];
   for(const field of ['reach','saved','shares','comments','likes']){try{Object.assign(next.metrics,metricValues(await ig.insights(job.media_id,[field])));}catch{errors.push(field);}}
   next.collected_at=new Date().toISOString();next.last_error=errors.length?'Algumas métricas não estão disponíveis na autorização atual da Meta.':null;
  }catch{next.last_error='Não foi possível atualizar os dados da Meta. Os últimos valores foram preservados.';}
  await query('pulse_post_outcomes',{method:'POST',body:next});return {post_id:post.id,automation_state:next.automation_state||'none'};
 }
 return async req=>{
  const {origin,headers,reply}=replies(req);if(origin&&!APP_ORIGINS.has(origin))return reply({error:'Origem não permitida.'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});if(req.method!=='POST')return reply({error:'Método não permitido.'},405);
  try{
   const raw=await req.text();if(raw.length>5000)return reply({error:'Solicitação muito grande.'},413);const body=JSON.parse(raw);
   const cron=req.headers.get('x-pulse-cron'),server=req.headers.get('authorization')==='Bearer '+key;
   const cronOk=cron&&await rest.rpc('pulse_publisher_cron_ok',{p_secret:cron});
   const user=server&&UUID.test(body.user_id||'')?{id:body.user_id}:await rest.user(req.headers.get('authorization'));
   if(!cronOk&&!user&&!server)return reply({error:'Entre novamente no Pulse.'},401);
   if(body.action==='tick'&&(cronOk||server)){
    const jobs=await query('pulse_publication_jobs?state=eq.published&media_id=not.is.null&order=updated_at.desc&limit=20');
    const results=[];for(const job of jobs){const [outcome]=await query('pulse_post_outcomes?post_id=eq.'+job.post_id);if(outcome?.collected_at&&Date.now()-Date.parse(outcome.collected_at)<3600000&&outcome.automation_state!=='failed')continue;const account=await rest.rpc('pulse_editorial_account_context',{p_account:job.account_id});results.push(await sync(job,account));if(results.length>=3)break;}
    return reply({ok:true,processed:results});
   }
   if(!UUID.test(body.account_id||''))return reply({error:'Conta inválida.'},400);
   if(!user)return reply({error:'Identifique o proprietário.'},401);
   const account=await rest.rpc('pulse_editorial_account_context',{p_account:body.account_id,p_user:user.id});
   if(body.action==='templates')return reply(await crm({action:'templates',username:account.username}));
   if(body.action==='results'){
    const jobs=await query('pulse_publication_jobs?account_id=eq.'+account.id+'&state=eq.published&media_id=not.is.null&order=updated_at.desc&limit=10');
    for(const job of jobs)await sync(job,account);return reply({ok:true,message:jobs.length?'Resultados conferidos. Veja a data e a cobertura de cada post.':'Ainda não há posts confirmados nesta conta.'});
   }
   return reply({error:'Ação desconhecida.'},400);
  }catch(error){return reply({error:error?.code==='42501'?'Você não tem acesso a esta conta.':error?.message==='not_owner'?'Você não tem acesso a esta conta.':'Não foi possível concluir esta operação.'},error?.code==='42501'?403:400);}
 };
}
