#!/usr/bin/env node
// Publishes a carousel of finished images (Canva export, Google Drive download or local files) through the Pulse:
// converts them to JPEG with the Mac's sips, uploads them to the private bucket, creates the post for the account
// owner and, on request, runs "Testar sem publicar" and schedules it. Reads assets/.env (service role, server only).
//
//   node assets/agent/publish-external.mjs --title "…" --caption-file legenda.txt --source https://… \
//     --provider canva --name "Design X" --at 2026-10-30T09:00 --test slide-1.png slide-2.png
import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {toUtc} from '../app/src/publication-workflow.mjs';
import {assetBatch,assetPath} from '../app/src/publication-schedule.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const APP_URL='https://your-app.example/#publication';
export const PROVIDERS={canva:'Canva',drive:'Google Drive',local:'Imagens prontas'};
// Instagram carousel limits: 4:5 to 1.91:1, up to 8 MB; wider images are scaled down by Instagram anyway.
export const RATIO={min:0.8,max:1.91};
export const MAX_BYTES=8*1024*1024;
export const MAX_WIDTH=1440;
const SIPS='/usr/bin/sips';

export function readEnv(file=path.join(root,'.env')){
 if(!fs.existsSync(file))throw Error(`Arquivo ${file} não encontrado.`);
 const env={};
 for(const line of fs.readFileSync(file,'utf8').split('\n')){
  if(line.trim().startsWith('#'))continue;
  const match=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);if(!match)continue;
  env[match[1]]=match[2].replace(/^(['"])(.*)\1$/,'$2');
 }
 for(const name of ['NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'])if(!env[name])throw Error(`Falta ${name} em ${file}.`);
 return env;
}

export function parseCli(argv){
 const {values,positionals}=parseArgs({args:argv,allowPositionals:true,options:{
  account:{type:'string',default:'principal'},title:{type:'string'},caption:{type:'string'},'caption-file':{type:'string'},
  source:{type:'string',multiple:true,default:[]},alt:{type:'string',multiple:true},at:{type:'string'},test:{type:'boolean',default:false},
  provider:{type:'string',default:'local'},name:{type:'string'},id:{type:'string'},url:{type:'string'},json:{type:'boolean',default:false}}});
 if(positionals.length<2||positionals.length>10)throw Error('Informe de 2 a 10 imagens, na ordem do carrossel.');
 if(!values.title?.trim())throw Error('Informe --title.');
 const caption=values['caption-file']?fs.readFileSync(values['caption-file'],'utf8'):values.caption;
 if(!caption?.trim())throw Error('Informe --caption ou --caption-file.');
 if(!values.source.length)throw Error('Informe ao menos uma fonte HTTPS com --source.');
 if(values.alt&&values.alt.length!==positionals.length)throw Error('Use um --alt por imagem, na mesma ordem das imagens.');
 if(!PROVIDERS[values.provider])throw Error('Use --provider canva, drive ou local.');
 const at=values.at?values.at.trim().replace(' ','T'):null;if(at)toUtc(at);
 return {...values,at,title:values.title.trim(),caption:caption.trim(),images:positionals,alts:values.alt||null};
}

export function imageInfo(file){
 const out=execFileSync(SIPS,['-g','pixelWidth','-g','pixelHeight','-g','format',file],{encoding:'utf8'});
 const get=key=>out.match(new RegExp(key+': (\\S+)'))?.[1];
 return {width:Number(get('pixelWidth')),height:Number(get('pixelHeight')),format:get('format'),bytes:fs.statSync(file).size};
}
export function checkImage(info,index){
 const label=`Imagem ${index+1}`;
 if(!(info.width>0&&info.height>0))throw Error(`${label}: não foi possível ler as dimensões.`);
 const ratio=info.width/info.height;
 if(ratio<RATIO.min-0.005||ratio>RATIO.max+0.005)throw Error(`${label}: proporção ${info.width} × ${info.height} fora do que o Instagram aceita (de 4:5 a 1.91:1).`);
 if(info.width<320)throw Error(`${label}: largura mínima de 320 px.`);
}
// JPEG as it is when it already fits; otherwise converted (and scaled down to 1440 px wide) by sips.
export function prepareImage(file,index,workDir){
 if(!fs.existsSync(file))throw Error(`Imagem ${index+1}: arquivo ${file} não encontrado.`);
 const info=imageInfo(file);checkImage(info,index);
 const target=path.join(workDir,`slide-${String(index+1).padStart(2,'0')}.jpg`);
 if(info.format==='jpeg'&&info.width<=MAX_WIDTH&&info.bytes<=MAX_BYTES)fs.copyFileSync(file,target);
 else{
  const args=['-s','format','jpeg','-s','formatOptions','90',...(info.width>MAX_WIDTH?['--resampleWidth',String(MAX_WIDTH)]:[])];
  execFileSync(SIPS,[...args,file,'--out',target],{stdio:'ignore'});
 }
 const final=imageInfo(target);
 if(final.bytes>MAX_BYTES)throw Error(`Imagem ${index+1}: ${(final.bytes/1048576).toFixed(1)} MB depois da conversão; o Instagram aceita até 8 MB.`);
 return {source:file,file:target,...final};
}

export function buildOrigin(options,count,now=new Date()){
 const stamp=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(now);
 const files=options.images.map(file=>path.basename(file));
 return {label:PROVIDERS[options.provider],title:(options.name||files.join(', ')).slice(0,160),brief:`${count} imagens prontas importadas em ${stamp}.${options.url?' '+options.url:''}`,
  provider:options.provider,source:{id:options.id||null,url:options.url||null,name:options.name||null,files}};
}
const when=value=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value)).replace(', ',' às ');

export function createApi({url,key,fetcher=fetch}){
 const headers={apikey:key,Authorization:'Bearer '+key};
 const json=async(res,fallback)=>{const data=await res.json().catch(()=>null);if(!res.ok)throw Error(data?.message||data?.error||fallback);return data;};
 const post=(route,body,extra={})=>fetcher(url+route,{method:'POST',headers:{...headers,'Content-Type':'application/json',...extra},body:JSON.stringify(body)});
 return {
  async account(accountKey){
   const res=await fetcher(`${url}/rest/v1/pulse_editorial_accounts?account_key=eq.${encodeURIComponent(accountKey)}&select=id,workspace_id,account_key,name,instagram_handle,connection_status`,{headers});
   const rows=await json(res,'Não foi possível consultar as contas do Pulse.');
   if(rows.length!==1)throw Error(`Conta "${accountKey}" não encontrada no Pulse.`);return rows[0];
  },
  async upload(objectPath,buffer){
   const res=await fetcher(`${url}/storage/v1/object/pulse-private/${objectPath.split('/').map(encodeURIComponent).join('/')}`,{method:'POST',headers:{...headers,'Content-Type':'image/jpeg','x-upsert':'false'},body:buffer});
   await json(res,'Não foi possível enviar a imagem ao Pulse.');
  },
  rpc:async(name,args)=>json(await post('/rest/v1/rpc/'+name,args),'O Pulse recusou a operação.'),
  async test(body){
   const data=await json(await post('/functions/v1/pulse-publisher',{action:'test',...body}),'Não foi possível testar com o Instagram.');
   if(data.error)throw Error(data.error);return data;
  }
 };
}

export async function run(options,api,{workDir,log=()=>{}}){
 const account=await api.account(options.account);
 if((options.test||options.at)&&account.connection_status!=='connected')throw Error(`Conecte o Instagram da conta ${account.name} no Pulse antes de testar ou agendar.`);
 const images=options.images.map((file,index)=>prepareImage(file,index,workDir));
 const postId=crypto.randomUUID(),batch=assetBatch(),paths=images.map((_,index)=>assetPath(account.workspace_id,postId,batch,index));
 for(const [index,image] of images.entries()){await api.upload(paths[index],fs.readFileSync(image.file));log(`Imagem ${index+1}: ${image.width} × ${image.height}, ${Math.round(image.bytes/1024)} KB enviada.`);}
 const created=await api.rpc('pulse_publish_external',{p_post:postId,p_account:account.id,p_title:options.title,p_caption:options.caption,p_sources:options.source,p_alts:options.alts,p_assets:paths.map(path=>({path})),p_origin:buildOrigin(options,images.length)});
 log(`Pauta criada no Pulse: "${options.title}" · ${images.length} imagens · versão ${created.revision} · em revisão.`);
 const summary={post_id:postId,revision:created.revision,status:created.status,account:account.account_key,handle:account.instagram_handle,images:images.length,test:null,job:null,app:APP_URL};
 if(options.test){const result=await api.test({post_id:postId,revision:created.revision,assets:paths,user_id:created.owner_id});summary.test=result.message;log('Teste: '+result.message);}
 if(options.at){
  const job=await api.rpc('pulse_schedule_external',{p_post:postId,p_scheduled_at:toUtc(options.at)});
  Object.assign(summary,{job,revision:job.revision,status:'scheduled'});log(`Agendado: sai sozinho em ${when(job.scheduled_at)} (Brasília) no @${account.instagram_handle}.`);
 }
 log('Abra no Pulse: '+APP_URL);
 return summary;
}

async function main(){
 const workDir=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-external-'));
 try{
  const options=parseCli(process.argv.slice(2)),env=readEnv();
  const summary=await run(options,createApi({url:env.NEXT_PUBLIC_SUPABASE_URL,key:env.SUPABASE_SERVICE_ROLE_KEY}),{workDir,log:line=>process.stdout.write(line+'\n')});
  if(options.json)process.stdout.write(JSON.stringify(summary)+'\n');
 }catch(error){process.stderr.write((error.message||'Falhou.')+'\n');process.exitCode=1;}
 finally{fs.rmSync(workDir,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
