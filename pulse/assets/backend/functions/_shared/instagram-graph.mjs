// Instagram Graph API client and the Unified Login helpers. Server only: tokens never reach the browser or the logs.
const assert=(value,message)=>{if(!value)throw new Error(message);};

// code: Meta error code; uncertain: the write may have happened (never retried blindly).
export class MetaError extends Error{
 constructor(message,{code=null,subcode=null,status=0,uncertain=false}={}){super(message);this.code=code;this.subcode=subcode;this.status=status;this.uncertain=uncertain;}
}

async function readJson(response,method){
 let data;try{data=await response.json();}catch{throw new MetaError('Resposta da Meta não confirmada.',{status:response.status,uncertain:method==='POST'});}
 if(!response.ok||data?.error){
  const code=Number(data?.error?.code)||null;
  throw new MetaError(`Meta recusou a operação (código ${code||response.status}).`,{code,subcode:Number(data?.error?.error_subcode)||null,status:response.status,uncertain:method==='POST'&&response.status>=500});
 }
 return data;
}
async function call(fetchImpl,url,options){
 try{return await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(30000),...options});}
 catch{throw new MetaError('Resposta da Meta não confirmada.',{uncertain:options.method==='POST'});}
}

export class InstagramClient{
 constructor({token,version,login='instagram',fetchImpl=fetch,mediaHosts=[]}){
  assert(token&&/^v\d+\.\d+$/.test(version),'Configure o token e a versão da API validada no app Meta.');
  assert(['instagram','facebook'].includes(login),'Tipo de login inválido.');
  this.token=token;this.base=`https://graph.${login==='instagram'?'instagram':'facebook'}.com/${version}`;this.fetch=fetchImpl;this.mediaHosts=new Set(mediaHosts);
 }
 async request(path,{method='GET',values={}}={}){
  assert(/^[0-9]+(?:\/(?:media|media_publish|insights|content_publishing_limit))?$/.test(path),'Destino Meta inválido.');
  const url=new URL(this.base+'/'+path);const headers={Authorization:`Bearer ${this.token}`};const options={method,headers};
  if(method==='GET')for(const[k,v]of Object.entries(values))url.searchParams.set(k,v);
  else {headers['Content-Type']='application/x-www-form-urlencoded';options.body=new URLSearchParams(values);}
  return readJson(await call(this.fetch,url,options),method);
 }
 image(igUserId,asset){const u=new URL(asset.url);assert(u.protocol==='https:'&&!u.username&&!u.password&&this.mediaHosts.has(u.hostname),'Arquivo fora do armazenamento autorizado.');return this.request(`${igUserId}/media`,{method:'POST',values:{image_url:u.href,is_carousel_item:'true'}});}
 carousel(igUserId,children,caption){assert(children.length>=2&&children.length<=10,'Quantidade de slides inválida.');return this.request(`${igUserId}/media`,{method:'POST',values:{media_type:'CAROUSEL',children:children.join(','),caption}});}
 status(id){return this.request(id,{values:{fields:'id,status_code'}});}
 publish(igUserId,containerId){return this.request(`${igUserId}/media_publish`,{method:'POST',values:{creation_id:containerId}});}
 media(id){return this.request(id,{values:{fields:'id,permalink,timestamp,media_type'}});}
 recentMedia(igUserId){return this.request(`${igUserId}/media`,{values:{fields:'id,caption,permalink,timestamp',limit:'10'}});}
 insights(id,metrics){assert(metrics?.length&&metrics.every(x=>/^[a-z_]+$/.test(x)),'Selecione as métricas compatíveis com esta versão.');return this.request(`${id}/insights`,{values:{metric:metrics.join(',')}});}
}

// Instagram API with Unified Login: Facebook Login for Business with a config_id. The token belongs to the
// customer's business portfolio (business integration system user) and does not expire.
export function unifiedLoginUrl({appId,configId,redirectUri,state}){
 const url=new URL('https://www.facebook.com/dialog/oauth');
 for(const [k,v] of Object.entries({client_id:appId,config_id:configId,redirect_uri:redirectUri,response_type:'code',override_default_response_type:'true',prompt:'login',state}))url.searchParams.set(k,v);
 return url.href;
}
async function graphGet(fetchImpl,version,path,values){
 const url=new URL(`https://graph.facebook.com/${version}/${path}`);for(const[k,v]of Object.entries(values))url.searchParams.set(k,v);
 return readJson(await call(fetchImpl,url,{method:'GET'}),'GET');
}
export async function exchangeUnifiedCode({appId,appSecret,redirectUri,code,version,fetchImpl=fetch}){
 const data=await graphGet(fetchImpl,version,'oauth/access_token',{client_id:appId,client_secret:appSecret,redirect_uri:redirectUri,code});
 assert(data.access_token,'A Meta não devolveu a autorização.');
 return data.access_token;
}
// User tokens become long-lived (60 days); a Page token derived from one never expires. BISU tokens refuse this.
export async function longLivedUserToken({appId,appSecret,token,version,fetchImpl=fetch}){
 const data=await graphGet(fetchImpl,version,'oauth/access_token',{grant_type:'fb_exchange_token',client_id:appId,client_secret:appSecret,fb_exchange_token:token});
 assert(data.access_token,'A Meta não devolveu a chave de longa duração.');
 return data.access_token;
}
// Scopes and expiry as the Meta sees them; expires_at 0 means the token never expires.
export async function inspectToken({token,appId,appSecret,version,fetchImpl=fetch}){
 const {data}=await graphGet(fetchImpl,version,'debug_token',{input_token:token,access_token:`${appId}|${appSecret}`});
 assert(data?.is_valid&&String(data.app_id)===String(appId),'A Meta não confirmou o token deste app.');
 const scopes=data.scopes?.length?data.scopes:(data.granular_scopes||[]).map(s=>s.scope);
 // Instagram accounts granted to this token, as listed per permission.
 const targets=[...new Set((data.granular_scopes||[]).filter(s=>/^instagram_/.test(s.scope)).flatMap(s=>s.target_ids||[]).map(String))].filter(id=>/^[0-9]{5,40}$/.test(id));
 return {scopes,targets,type:String(data.type||''),expiresAt:Number(data.expires_at)>0?new Date(Number(data.expires_at)*1000).toISOString():null};
}
const validAccount=a=>/^[0-9]{5,40}$/.test(String(a?.id))&&/^[A-Za-z0-9_.]{1,30}$/.test(a?.username||'');
const asAccount=a=>({id:String(a.id),username:a.username});
async function graphTry(fetchImpl,token,version,path,fields){
 const url=new URL(`https://graph.facebook.com/${version}/${path}`);if(fields)url.searchParams.set('fields',fields);
 try{return {ok:true,data:await readJson(await call(fetchImpl,url,{method:'GET',headers:{Authorization:`Bearer ${token}`}}),'GET')};}
 catch(error){return {ok:false,code:error.code||error.status||'x'};}
}
// Every place the Meta may expose the shared Instagram account. The report holds counts and error codes only;
// Instagram IDs and usernames are public identifiers, the token never leaves this function.
export async function probeInstagramAccounts({token,version,targets=[],fetchImpl=fetch}){
 const report={},found=[];
 const record=(name,result,pick)=>{
  if(!result.ok){report[name]=`erro${result.code}`;return;}
  const accounts=pick(result.data).filter(validAccount).map(asAccount);report[name]=accounts.length;found.push(...accounts);
 };
 const list=data=>Array.isArray(data?.data)?data.data:[];
 record('atribuidas',await graphTry(fetchImpl,token,version,'me/assigned_instagram_accounts','id,username'),list);
 const me=await graphTry(fetchImpl,token,version,'me','id,client_business_id');
 const business=me.ok&&/^[0-9]{5,40}$/.test(String(me.data.client_business_id||''))?String(me.data.client_business_id):null;
 report.empresa=me.ok?(business?'sim':'nao'):`erro${me.code}`;
 if(business){
  record('empresa_contas',await graphTry(fetchImpl,token,version,`${business}/instagram_accounts`,'id,username'),list);
  record('empresa_proprias',await graphTry(fetchImpl,token,version,`${business}/owned_instagram_accounts`,'id,username'),list);
 }
 const pageTokens={};
 record('paginas',await graphTry(fetchImpl,token,version,'me/accounts','id,access_token,instagram_business_account{id,username}'),data=>list(data).map(page=>{
  const ig=page.instagram_business_account;if(validAccount(ig)&&typeof page.access_token==='string')pageTokens[String(ig.id)]=page.access_token;return ig;
 }));
 for(const id of targets)record(`alvo${targets.indexOf(id)+1}`,await graphTry(fetchImpl,token,version,id,'id,username'),data=>[data]);
 const accounts=[...new Map(found.map(a=>[a.id,a])).values()];
 return {accounts,report,pageTokens};
}
