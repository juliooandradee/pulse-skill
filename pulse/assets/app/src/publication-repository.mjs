import {assetBatch,assetPath} from './publication-schedule.mjs';
const columns='id,account_id,content,origin,status,planned_at,revision,created_at,updated_at';
const jobColumns='id,post_id,revision,scheduled_at,state,phase,attempts,permalink,published_at,last_error,updated_at';
async function invoke(client,name,body,fallback){
 const {data,error}=await client.functions.invoke(name,{body});
 if(error){let message=fallback;try{message=(await error.context.json()).error||message;}catch{}throw Error(message);}
 if(data?.error)throw Error(data.error);return data;
}
export function createPublicationRepository(client,workspaceId){
 return {
  async accounts(){const {data,error}=await client.from('pulse_editorial_accounts').select('id,account_key,name,instagram_handle,connection_status,connection_expires_at').eq('workspace_id',workspaceId).order('name');if(error)throw Error('Não foi possível carregar as contas de publicação.');return data;},
  async jobs(accountId){const {data,error}=await client.from('pulse_publication_jobs').select(jobColumns).eq('account_id',accountId).limit(500);if(error)throw Error('Não foi possível carregar os agendamentos desta conta.');return data;},
  async outcomes(accountId){const {data,error}=await client.from('pulse_post_outcomes').select('post_id,metrics,collected_at,last_error,automation_state,automation_error').eq('account_id',accountId);if(error)return [];return data;},
  async templates(accountId){return (await invoke(client,'pulse-editorial',{action:'templates',account_id:accountId},'Não foi possível consultar o CRM.')).templates||[];},
  refreshResults:accountId=>invoke(client,'pulse-editorial',{action:'results',account_id:accountId},'Não foi possível atualizar os resultados.'),
  async downloadSlide(path){const {data,error}=await client.storage.from('pulse-private').download(path);if(error)throw Error('Não foi possível reordenar a imagem.');return data;},
  async uploadSlides(post,blobs){
   const batch=assetBatch(),paths=blobs.map((_,i)=>assetPath(workspaceId,post.id,batch,i));
   for(const [i,blob] of blobs.entries()){const {error}=await client.storage.from('pulse-private').upload(paths[i],blob,{contentType:'image/jpeg',upsert:false});if(error)throw Error(`Não foi possível enviar a imagem do slide ${i+1}.`);}
   return paths;
  },
  async previewUrl(path){const {data,error}=await client.storage.from('pulse-private').createSignedUrl(path,3600);if(error||!data?.signedUrl)throw Error('Não foi possível carregar a imagem importada.');return data.signedUrl;},
  async schedule(post,scheduledAt,paths){
   const {error}=await client.rpc('pulse_schedule_publication',{p_post:post.id,p_revision:post.revision,p_scheduled_at:scheduledAt,p_assets:paths.map(path=>({path}))});
   if(error)throw Error(error.message||'Não foi possível agendar.');
  },
  async cancel(postId){const {error}=await client.rpc('pulse_cancel_publication',{p_post:postId});if(error)throw Error(error.message||'Não foi possível cancelar o agendamento.');},
  testPublish:(post,paths)=>invoke(client,'pulse-publisher',{action:'test',post_id:post.id,revision:post.revision,assets:paths},'Não foi possível testar com o Instagram.'),
  async connect(accountId){return (await invoke(client,'pulse-meta-connect',{action:'start',account_id:accountId},'Não foi possível iniciar a conexão com o Instagram.')).url;},
  resumeConnect:accountId=>invoke(client,'pulse-meta-connect',{action:'resume',account_id:accountId},'Não foi possível retomar a conexão.'),
  async disconnect(accountId){const {error}=await client.rpc('pulse_meta_disconnect',{p_account:accountId});if(error)throw Error('Não foi possível desconectar o Instagram.');},
  async list(accountId){const {data,error}=await client.from('pulse_editorial_posts').select(columns).eq('account_id',accountId).order('updated_at',{ascending:false}).limit(500);if(error)throw Error('Não foi possível carregar os rascunhos desta conta.');return data;},
  async save(post){
   const payload={content:post.content,origin:post.origin||null,status:post.status,planned_at:post.planned_at||null};
   const query=post.revision?client.from('pulse_editorial_posts').update({...payload,revision:post.revision+1}).eq('id',post.id).eq('account_id',post.account_id).eq('revision',post.revision):client.from('pulse_editorial_posts').insert({...payload,id:post.id,account_id:post.account_id});
   const {data,error}=await query.select(columns).maybeSingle();
   if(error){if(error.code==='40001'||error.code==='23505')throw Error('A versão mudou ou a gravação anterior foi concluída. Reabra o rascunho na lista antes de salvar novamente.');throw Error(error.message||'Não foi possível salvar o rascunho.');}
   if(!data)throw Error('A versão ou seu acesso mudou. Seu texto continua no editor; copie-o antes de recarregar a lista.');
   if(data.account_id!==post.account_id||data.id!==post.id)throw Error('A conta do rascunho retornado não corresponde ao destino.');return data;
  }
 };
}
export const localDateTime=value=>value?new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value)).replace(' ','T'):'';
export function emptyEditorialPost(accountId){return {id:crypto.randomUUID(),account_id:accountId,revision:0,status:'draft',planned_at:null,origin:null,content:{title:'Nova pauta',caption:'',sources:[],slides:[{headline:'',body:'',alt:''},{headline:'',body:'',alt:''}]}};}
