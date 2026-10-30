import {localDateTime} from './publication-repository.mjs';
export const STAGES={idea:'Ideia',copy:'Copy',art:'Arte',review:'Em revisão',approved:'Aprovado',scheduled:'Agendado',publishing:'Publicando',published:'Publicado',failed:'Falhou'};
export function planning(post){return post?.origin?.planning||{};}
export function postStage(post,job){
 if(job&&['scheduled','publishing','published','failed'].includes(job.state))return job.state;
 return planning(post).stage||(post.status==='review'?'review':'idea');
}
export function postDate(post,job){return job?.published_at||(['scheduled','publishing','failed'].includes(job?.state)?job.scheduled_at:null)||post.planned_at||planning(post).date||null;}
export function calendarDays(anchor,mode='month'){
 const date=new Date(anchor.slice(0,10)+'T12:00:00Z');
 if(mode==='month')date.setUTCDate(1);
 date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);
 return Array.from({length:mode==='week'?7:42},(_,i)=>{const d=new Date(date);d.setUTCDate(d.getUTCDate()+i);return d.toISOString().slice(0,10);});
}
export function filterPosts(rows,jobs,{query='',stage='',campaign=''}={}){
 const q=query.trim().toLocaleLowerCase('pt-BR');
 return rows.filter(p=>(!stage||postStage(p,jobs.get(p.id))===stage)&&(!campaign||planning(p).campaign===campaign)&&(!q||[p.content.title,p.content.caption,planning(p).owner,planning(p).campaign].join(' ').toLocaleLowerCase('pt-BR').includes(q)));
}
export function overview(rows,jobs,now=Date.now()){
 const count=stage=>rows.filter(p=>postStage(p,jobs.get(p.id))===stage).length;
 return {total:rows.length,review:count('review'),scheduled:count('scheduled'),published:count('published'),failed:count('failed'),overdue:rows.filter(p=>{const date=postDate(p,jobs.get(p.id));return date&&Date.parse(date)<now&&!['published','publishing'].includes(postStage(p,jobs.get(p.id)));})};
}
export function dayKey(date){return date?localDateTime(date).slice(0,10):'';}
export function safeLink(value,hosts){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(!hosts||hosts.some(h=>u.hostname===h||u.hostname.endsWith('.'+h)))?u.href:'';}catch{return '';}}
export async function imageFilesToJpegs(files){
 if(files.length<2||files.length>10)throw Error('Escolha de 2 a 10 imagens, numeradas na ordem dos slides.');
 const ordered=[...files].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR',{numeric:true})),blobs=[];
 for(const file of ordered){
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>20*1024*1024)throw Error('Use imagens JPEG, PNG ou WebP de até 20 MB.');
  const image=await createImageBitmap(file),ratio=image.width/image.height;
  try{
   if(image.width<320||ratio<.8||ratio>1.91)throw Error(`${file.name}: use proporção entre 4:5 e 1,91:1, com largura mínima de 320 px.`);
   if(blobs.length&&Math.abs(ratio-blobs[0].ratio)>.01)throw Error('Todos os slides precisam ter a mesma proporção.');
   const canvas=document.createElement('canvas');canvas.width=Math.min(image.width,1440);canvas.height=Math.round(canvas.width/ratio);
   const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.94));
   if(!blob||blob.size>8*1024*1024)throw Error('Uma imagem ultrapassou o limite de 8 MB após a conversão.');
   blobs.push({blob,ratio,name:file.name});
  }finally{image.close();}
 }
 return blobs;
}
