// Local smoke run: loads the edge handlers without deploying or calling the Meta.
import {makeHandler as connect} from './pulse-meta-connect/handler.mjs';
import {makeHandler as publish} from './pulse-publisher/handler.mjs';

const base='https://project.supabase.test';
const fetcher=async(input:RequestInfo|URL)=>{
 const url=new URL(String(input));
 if(url.pathname.endsWith('/pulse_publisher_cron_ok'))return Response.json(false);
 return Response.json({message:'não configurado'},{status:503});
};
const publisher=publish({url:base,key:'service-key',version:'v26.0',fetcher});
const cron=await publisher(new Request(base,{method:'POST',headers:{'x-pulse-cron':'segredo-invalido'}}));
if(cron.status!==401)throw new Error('O agendador sem segredo deveria ser recusado.');
const connector=connect({url:base,key:'service-key',appId:'',appSecret:'',configId:'',redirectUri:'',version:'v26.0',fetcher});
const start=await connector(new Request(base,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'start',account_id:'55555555-5555-4555-8555-555555555555'})}));
const body=await start.json();
if(start.status!==503||!String(body.error).includes('Meta'))throw new Error('A conexão sem configuração deveria explicar o problema em português.');
console.log('edge functions locais: ok');
