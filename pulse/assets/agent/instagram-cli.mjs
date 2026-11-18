#!/usr/bin/env node
// Agente local do Pulse: configura, conecta, publica e agenda pela API oficial da Meta.
// Segredos ficam em assets/.env. Este comando não publica sozinho ao ser importado.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {readEnv} from './publish-external.mjs';

export const DEFAULT_TIME_ZONE='America/Maceio';
const TYPES=new Set(['image','carousel','reel']);
const EXT={image:['.jpg','.jpeg','.png','.webp'],carousel:['.jpg','.jpeg'],reel:['.mp4']};

export function helpText(){
 return `Pulse Instagram — publicação oficial pela Meta

Uso:
  node assets/agent/instagram-cli.mjs help
  node assets/agent/instagram-cli.mjs setup
  node assets/agent/instagram-cli.mjs connect [--account principal]
  node assets/agent/instagram-cli.mjs publish --type image|carousel|reel --caption "..." --file foto.jpg [--account principal]
  node assets/agent/instagram-cli.mjs schedule --type image|carousel|reel --caption "..." --file foto.jpg --at "2026-11-20 09:00" [--tz America/Maceio]
  node assets/agent/instagram-cli.mjs list [--account principal]
  node assets/agent/instagram-cli.mjs cancel --job <uuid>
  node assets/agent/instagram-cli.mjs insights [--account principal]

O fuso padrão do agendamento é America/Maceio. O carrossel usa de 2 a 10 JPEG.
A imagem usa 1 arquivo (JPEG, PNG ou WebP). O Reels usa 1 MP4.
Nada é publicado na Meta durante setup, list ou cancel.

Variáveis em assets/.env (não commite este arquivo):
  NEXT_PUBLIC_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  PULSE_MEDIA_BUCKET   opcional, padrão pulse-private
`;
}

export function toUtcInZone(value,timeZone=DEFAULT_TIME_ZONE){
 const local=String(value||'').trim().replace(' ','T');
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local))throw Error('Use --at no formato AAAA-MM-DD HH:MM.');
 if(!timeZone||timeZone.length>64)throw Error('Fuso horário inválido.');
 const [date,time]=local.split('T');
 const [year,month,day]=date.split('-').map(Number);
 const [hour,minute]=time.split(':').map(Number);
 const guess=Date.UTC(year,month-1,day,hour,minute);
 const offset=zoneOffset(timeZone,guess);
 const utc=guess-offset;
 const check=wallTime(timeZone,utc);
 if(check!==local)throw Error('Essa data não existe nesse fuso.');
 return new Date(utc).toISOString();
}
function zoneOffset(timeZone,utcMs){
 const parts=wallParts(timeZone,utcMs);
 const asUtc=Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute,parts.second);
 return asUtc-utcMs;
}
function wallParts(timeZone,utcMs){
  const formatted=new Intl.DateTimeFormat('en-US',{timeZone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(new Date(utcMs));
  const pick=type=>Number(formatted.find(part=>part.type===type).value);
  return {year:pick('year'),month:pick('month'),day:pick('day'),hour:pick('hour'),minute:pick('minute'),second:pick('second')};
}
function wallTime(timeZone,utcMs){
 const parts=wallParts(timeZone,utcMs);
 const pad=value=>String(value).padStart(2,'0');
 return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function parseCommand(argv){
 const command=argv[0]||'help';
 if(command==='help'||command==='--help'||command==='-h')return {command:'help'};
 const {values}=parseArgs({args:argv.slice(1),options:{
  account:{type:'string',default:'principal'},type:{type:'string'},caption:{type:'string'},'caption-file':{type:'string'},
  file:{type:'string',multiple:true},at:{type:'string'},tz:{type:'string',default:DEFAULT_TIME_ZONE},
  job:{type:'string'},bucket:{type:'string'},json:{type:'boolean',default:false}
 }});
 return {command,account:values.account,type:values.type,caption:values.caption,captionFile:values['caption-file'],files:values.file||[],at:values.at,tz:values.tz,job:values.job,bucket:values.bucket,json:values.json};
}

export function mediaName(file,index,type){
 const ext=path.extname(file).toLowerCase();
 if(!EXT[type]?.includes(ext))throw Error(type==='reel'?'O Reels precisa ser um MP4.':type==='carousel'?'O carrossel usa arquivos JPEG.':'Use JPEG, PNG ou WebP.');
 const safe=ext==='.jpeg'?'.jpg':ext;
 return type==='reel'?'reel.mp4':`slide-${String(index+1).padStart(2,'0')}${safe}`;
}
export function queuePlan({workspaceId,jobId,type,files,bucket}){
 if(!TYPES.has(type))throw Error('Use --type image, carousel ou reel.');
 if(type==='carousel'&&(files.length<2||files.length>10))throw Error('O carrossel precisa de 2 a 10 imagens.');
 if(type!=='carousel'&&files.length!==1)throw Error('Este tipo usa um único arquivo.');
 return files.map((file,index)=>{
  const name=mediaName(file,index,type);
  return {file,path:`${workspaceId}/instagram/${jobId}/${name}`,bucket,contentType:name.endsWith('.mp4')?'video/mp4':name.endsWith('.png')?'image/png':name.endsWith('.webp')?'image/webp':'image/jpeg'};
 });
}
export function publicJob(job){
 if(!job||typeof job!=='object')return job;
 const {token,container_id,lease_id,lease_until,children,assets,...safe}=job;
 return safe;
}

const mimeOf=name=>name.endsWith('.mp4')?'video/mp4':name.endsWith('.png')?'image/png':name.endsWith('.webp')?'image/webp':'image/jpeg';

export async function run(argv,{env,fetchImpl=fetch,readFile=file=>fs.readFileSync(file),now=()=>new Date()}={}){
 const parsed=parseCommand(argv);
 if(parsed.command==='help')return {code:0,text:helpText()};
 if(!env?.NEXT_PUBLIC_SUPABASE_URL||!env?.SUPABASE_SERVICE_ROLE_KEY)return {code:1,text:'Faltam NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em assets/.env.\n'+helpText()};
 const base=env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/,'');
 const key=env.SUPABASE_SERVICE_ROLE_KEY;
 const bucket=parsed.bucket||env.PULSE_MEDIA_BUCKET||'pulse-private';
 const headers={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
 async function request(pathname,body,extra={}){
  const response=await fetchImpl(base+pathname,{method:body===undefined&&!extra.raw?'GET':'POST',headers:{...headers,...extra.headers},...(body===undefined?extra.raw?{body:extra.raw}:{}:{body:JSON.stringify(body)})});
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw Error(data?.message||data?.error||data?.msg||'A operação não foi concluída.');
  return data;
 }
 async function account(){
  const rows=await request('/rest/v1/pulse_editorial_accounts?account_key=eq.'+encodeURIComponent(parsed.account)+'&select=id,workspace_id,name,instagram_handle,connection_status');
  if(!Array.isArray(rows)||rows.length!==1)throw Error('Informe uma conta editorial única e existente com --account.');
  return rows[0];
 }
 try{
  if(parsed.command==='setup'){
   const rows=await request('/rest/v1/pulse_editorial_accounts?select=account_key,name,instagram_handle,connection_status&order=account_key');
   const lines=['Pulse pronto para configurar a publicação oficial.','Bucket de mídia: '+bucket,'Contas:'];
   for(const row of rows||[])lines.push(`- ${row.account_key} (@${row.instagram_handle||'sem @'}) conexão ${row.connection_status}`);
   if(!rows?.length)lines.push('- Nenhuma conta editorial. Crie uma em pulse_editorial_accounts antes de conectar.');
   lines.push('Próximo passo: node assets/agent/instagram-cli.mjs connect --account principal');
   return {code:0,text:lines.join('\n')};
  }
  if(parsed.command==='connect'){
   const row=await account();
   const data=await request('/functions/v1/pulse-meta-connect',{action:'agent-start',account_id:row.id});
   return {code:0,text:`Abra este endereço no navegador, uma única vez, com a conta @${row.instagram_handle||row.account_key}:\n${data.url}\n${data.aviso||''}`.trim()};
  }
  if(parsed.command==='list'){
   const row=await account();
   const jobs=await request('/rest/v1/rpc/pulse_list_publication_queue',{p_account:row.id});
   const safe=(Array.isArray(jobs)?jobs:[]).map(publicJob);
   return {code:0,text:parsed.json?JSON.stringify(safe,null,2):safe.length?safe.map(item=>`${item.job_id}  ${item.media_type}  ${item.state}  ${item.scheduled_at}  ${(item.caption||'').slice(0,60)}`).join('\n'):'A fila desta conta está vazia.'};
  }
  if(parsed.command==='cancel'){
   if(!/^[0-9a-f-]{36}$/i.test(parsed.job||''))throw Error('Informe --job com o identificador da fila.');
   const data=await request('/rest/v1/rpc/pulse_cancel_media',{p_job:parsed.job});
   return {code:0,text:JSON.stringify(publicJob(data))};
  }
  if(parsed.command==='insights'){
   const data=await request('/functions/v1/pulse-publisher',{action:'insights'});
   return {code:0,text:JSON.stringify({insights:Array.isArray(data.insights)?data.insights.length:0})};
  }
  if(parsed.command==='publish'||parsed.command==='schedule'){
   const row=await account();
   const caption=parsed.captionFile?readFile(parsed.captionFile,'utf8'):parsed.caption;
   if(!caption?.trim())throw Error('Informe --caption ou --caption-file.');
   const scheduledAt=parsed.command==='schedule'?toUtcInZone(parsed.at,parsed.tz):now().toISOString();
   const jobId=crypto.randomUUID();
   const plan=queuePlan({workspaceId:row.workspace_id,jobId,type:parsed.type,files:parsed.files,bucket});
   for(const item of plan){
    const bytes=readFile(item.file);
    await request('/storage/v1/object/'+bucket+'/'+item.path.split('/').map(encodeURIComponent).join('/'),undefined,{raw:bytes,headers:{'Content-Type':mimeOf(item.path),'x-upsert':'false'}});
   }
   const queued=await request('/rest/v1/rpc/pulse_queue_media',{p_account:row.id,p_type:parsed.type,p_caption:caption.trim(),p_scheduled_at:scheduledAt,p_assets:plan.map(item=>({path:item.path,bucket:item.bucket})),p_job:jobId});
   if(parsed.command==='publish')await request('/functions/v1/pulse-publisher',{action:'tick'});
   const when=parsed.command==='schedule'?`Agendado para ${scheduledAt} (${parsed.tz}).`:'Enviado para publicação agora. O Instagram confirma o link na fila.';
   return {code:0,text:`${when}\n${JSON.stringify(publicJob(queued))}`};
  }
  return {code:1,text:'Comando desconhecido.\n'+helpText()};
 }catch(error){return {code:1,text:error.message||'Não foi possível concluir.'};}
}

const isMain=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(isMain){
 const envFile=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','.env');
 let env={};
 try{env=readEnv(envFile);}catch(error){if((process.argv[2]||'help')!=='help'){console.error(error.message);process.exit(1);}}
 const result=await run(process.argv.slice(2),{env});
 process.stdout.write(result.text.endsWith('\n')?result.text:result.text+'\n');
 process.exit(result.code);
}
