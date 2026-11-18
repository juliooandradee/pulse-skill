import {makeHandler} from './handler.mjs';
const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
Deno.serve(makeHandler({
 url,key,version:Deno.env.get('PULSE_META_GRAPH_VERSION')??'v26.0',
 bucket:Deno.env.get('PULSE_MEDIA_BUCKET')??'pulse-private',
 appId:Deno.env.get('PULSE_META_APP_ID')??'',appSecret:Deno.env.get('PULSE_META_APP_SECRET')??'',
 onPublished:async()=>{await fetch(url+'/functions/v1/pulse-editorial',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({action:'tick'}),signal:AbortSignal.timeout(20000)});}
}));
