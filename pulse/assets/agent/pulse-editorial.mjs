#!/usr/bin/env node
// Local authenticated agent interface. Secrets stay in .env; commands stay within one editorial account.
import fs from 'node:fs';import {readEnv} from './publish-external.mjs';
const env=readEnv(),url=env.NEXT_PUBLIC_SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY;
const [command='list',accountKey='principal',argument]=process.argv.slice(2);
const headers={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
async function request(path,body){const r=await fetch(url+path,{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw Error(data.message||data.error||'Operação não concluída.');return data;}
const accounts=await request('/rest/v1/pulse_editorial_accounts?account_key=eq.'+encodeURIComponent(accountKey)+'&select=id,workspace_id,name,instagram_handle');
if(accounts.length!==1)throw Error('Informe uma conta editorial única e existente.');const account=accounts[0];
const rpc=(name,body)=>request('/rest/v1/rpc/'+name,body);
if(command==='list')console.log(JSON.stringify(await request('/rest/v1/pulse_editorial_posts?account_id=eq.'+account.id+'&select=id,revision,status,planned_at,content,origin&order=updated_at.desc'),null,2));
else if(command==='save'){
 const post=JSON.parse(fs.readFileSync(argument,'utf8'));
 const result=await rpc('pulse_agent_save',{p_account:account.id,p_post:post.id||crypto.randomUUID(),p_revision:post.revision||0,p_content:post.content,p_origin:post.origin||null});console.log(JSON.stringify({id:result.id,revision:result.revision,status:result.status,url:(env.PULSE_APP_URL||'https://your-app.example')+'/#publication'}));
}else if(command==='results'||command==='templates'){
 const context=await rpc('pulse_editorial_account_context',{p_account:account.id});console.log(JSON.stringify(await request('/functions/v1/pulse-editorial',{action:command,account_id:account.id,user_id:context.owner_id}),null,2));
}else if(command==='schedule'){
 const input=JSON.parse(fs.readFileSync(argument,'utf8'));if(input.approved!==true)throw Error('O pacote precisa registrar approved=true após a aprovação da prévia.');
 const rows=await request('/rest/v1/pulse_editorial_posts?id=eq.'+encodeURIComponent(input.id)+'&account_id=eq.'+account.id+'&select=id,revision');if(rows.length!==1||rows[0].revision!==input.revision)throw Error('A prévia aprovada não corresponde à versão salva.');console.log(JSON.stringify(await rpc('pulse_schedule_external',{p_post:input.id,p_scheduled_at:input.scheduled_at})));
}else throw Error('Use list, save, templates, results ou schedule. Para imagens prontas use publish-external.mjs.');
