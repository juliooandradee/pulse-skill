import {makeHandler} from './handler.mjs';
Deno.serve(makeHandler({
 url:Deno.env.get('SUPABASE_URL')!,key:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
 appId:Deno.env.get('PULSE_META_APP_ID')??'',appSecret:Deno.env.get('PULSE_META_APP_SECRET')??'',configId:Deno.env.get('PULSE_META_CONFIG_ID')??'',
 redirectUri:Deno.env.get('PULSE_META_REDIRECT_URI')??'',version:Deno.env.get('PULSE_META_GRAPH_VERSION')??'v26.0'
}));
