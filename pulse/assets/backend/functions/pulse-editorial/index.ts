import {makeEditorialHandler} from './handler.mjs';
Deno.serve(makeEditorialHandler({url:Deno.env.get('SUPABASE_URL')!,key:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,version:Deno.env.get('PULSE_META_GRAPH_VERSION')??'v26.0',crmUrl:Deno.env.get('PULSE_CRM_URL'),crmKey:Deno.env.get('PULSE_CRM_KEY')}));
