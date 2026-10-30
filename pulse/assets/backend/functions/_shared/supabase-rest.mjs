// Supabase REST from Edge Functions with the service role. A user's JWT only identifies the caller.
export const APP_ORIGINS=new Set(['https://your-app.example']);
export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function replies(req){
 const origin=req.headers.get('origin');
 const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',...(APP_ORIGINS.has(origin)?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'}:{})};
 return {origin,headers,reply:(data,status=200)=>new Response(JSON.stringify(data),{status,headers})};
}

export class RestError extends Error{constructor(message,{status=0,code=null}={}){super(message);this.status=status;this.code=code;}}

export function createRest({url,key,fetcher=fetch}){
 async function request(path,{body,authorization}={}){
  const res=await fetcher(url+path,{method:body===undefined?'GET':'POST',headers:{apikey:key,Authorization:authorization||'Bearer '+key,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await res.json().catch(()=>null);
  if(!res.ok)throw new RestError(data?.message||'Falha ao consultar o Pulse.',{status:res.status,code:data?.code||null});
  return data;
 }
 return {
  rpc:(name,args,{authorization}={})=>request('/rest/v1/rpc/'+name,{body:args,authorization}),
  async user(authorization){
   if(!authorization?.startsWith('Bearer ')||authorization==='Bearer '+key)return null;
   try{const user=await request('/auth/v1/user',{authorization});return user?.id&&user.email_confirmed_at&&!user.is_anonymous?user:null;}catch{return null;}
  },
  async sign(path,seconds){
   const data=await request('/storage/v1/object/sign/pulse-private/'+path.split('/').map(encodeURIComponent).join('/'),{body:{expiresIn:seconds}});
   if(!data?.signedURL)throw new RestError('Imagem indisponível.');
   return url+'/storage/v1'+data.signedURL;
  }
 };
}
