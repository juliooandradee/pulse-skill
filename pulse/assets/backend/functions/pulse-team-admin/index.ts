import {makeHandler} from './handler.mjs';
Deno.serve(makeHandler({url:Deno.env.get('SUPABASE_URL')!,key:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,origin:Deno.env.get('PULSE_APP_ORIGIN')!}));
