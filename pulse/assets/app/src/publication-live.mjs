import {mountPlanning} from './publication-planning-view.mjs';
import {STAGES,planning,safeLink,imageFilesToJpegs} from './publication-planning.mjs';
import {publicationMarkup} from './publication-template.mjs';
import {emptyEditorialPost,localDateTime} from './publication-repository.mjs';
import {CONNECTION_RESULTS,JOB_LABELS,captionCheck,isLocked,jobDetail} from './publication-schedule.mjs';
import {normalizeContent,toUtc} from './publication-workflow.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const validSource=s=>{try{const u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}};
const labels={draft:'Rascunho',review:'Em revisão',planned:'Planejado · só no calendário',scheduled:JOB_LABELS.scheduled};
const when=value=>{const [day,hour]=localDateTime(value).split('T');return day.split('-').reverse().join('/')+' às '+hour;};
// Portfolio tokens do not expire; the database keeps a ten-year horizon for them.
const LONG_LIVED=5*365*864e5;
const editable=['post-stage','post-campaign','post-owner','post-date','post-source','post-automation','import-images','title','headline','body','alt','caption','source-urls','save','review','plan','add-slide','remove-slide','import'];

export function mountCloudPublication(root,{repository}){
 root.classList.add('publication-area');root.innerHTML=publicationMarkup;
 if(repository.local)root.querySelector('.coverage-notice span').textContent='Salvo neste navegador · faça backup dos textos e guarde as imagens';
 const $=id=>root.querySelector('#'+id);
 let alive=true,accounts=[],accountId='',rows=[],jobs=new Map(),current=null,slideIndex=0,view='overview',dirty=false,busy=false,epoch=0,uploaded=null;
 let outcomes=[],templates=[];
 const planner=mountPlanning(root,{getState:()=>({rows,jobs}),previewUrl:path=>repository.previewUrl(path),openPost:id=>guarded(async()=>{await flush();current=structuredClone(rows.find(p=>p.id===id));slideIndex=0;dirty=false;fill();changeView('studio');})()});
 let month=localDateTime(new Date().toISOString()).slice(0,7);
 const account=()=>accounts.find(a=>a.id===accountId);
 const connected=()=>account()?.connection_status==='connected';
 // A job only describes the post while it refers to the same saved revision (or already left the queue).
 const jobFor=post=>{const job=post&&jobs.get(post.id);return job&&(job.revision===post.revision||isLocked(job))?job:null;};
 // Posts imported from finished images (Canva, Drive): the slides are already in storage; nothing is drawn here.
 const external=()=>current?.content?.kind==='external'&&Array.isArray(current.origin?.assets);
 const previews=new Map();
 const statusLabel=post=>{const job=jobFor(post);return job&&job.state!=='scheduled'?JOB_LABELS[job.state]:STAGES[planning(post).stage]||labels[post.status];};
 const metaResult=new URLSearchParams(location.search).get('meta'),metaDetail=new URLSearchParams(location.search).get('detalhe');
 if(metaResult)history.replaceState(null,'',location.pathname+location.hash);
 let resumable=metaResult==='sem-conta';
 $('slide-number').insertAdjacentHTML('afterend','<div class="slide-tools"><button id="add-slide" type="button" class="text-button">＋ Slide</button><button id="remove-slide" type="button" class="text-button">Remover slide</button></div>');
 const report=message=>{if(alive)$('notice').textContent=message;};
 function lock(value){busy=value;root.querySelectorAll('button,input,select,textarea').forEach(x=>x.disabled=value);if(!value)render();}
 async function busyStep(message,fn){lock(true);report(message);try{return await fn();}finally{if(alive)lock(false);}}
 function read(){
  if(!current)return;const c=current.content;c.title=$('title').value;c.caption=$('caption').value;
  Object.assign(c.slides[slideIndex],{headline:$('headline').value,body:$('body').value,alt:$('alt').value});
  const oldPlanning=planning(current);current.origin={...(current.origin||{}),planning:{...oldPlanning,stage:$('post-stage').value,campaign:$('post-campaign').value.trim(),owner:$('post-owner').value.trim(),date:$('post-date').value?toUtc($('post-date').value):null,sourceUrl:$('post-source').value.trim(),automationId:$('post-automation').value}};
  const previous=new Map(c.sources.map(s=>[s.url,s]));c.sources=$('source-urls').value.split('\n').map(s=>s.trim()).filter(Boolean).map(url=>previous.get(url)||{url,label:url});
 }
 function dirtyEdit(event){if(!current)return;if(planning(current).stage==='approved'&&['title','headline','body','alt','caption','source-urls'].includes(event?.target?.id))$('post-stage').value='review';read();dirty=true;current.status='draft';current.planned_at=null;render();}
 function fill(){
  const c=current?.content,s=c?.slides[slideIndex];
  for(const [id,value] of Object.entries({title:c?.title,caption:c?.caption,headline:s?.headline,body:s?.body,alt:s?.alt,'source-urls':c?.sources.map(s=>s.url).join('\n')}))$(id).value=value||'';
  const meta=planning(current);for(const [id,value] of Object.entries({'post-stage':meta.stage||(current?.status==='review'?'review':'idea'),'post-campaign':meta.campaign,'post-owner':meta.owner,'post-date':localDateTime(meta.date),'post-source':meta.sourceUrl,'post-automation':meta.automationId}))$(id).value=value||'';
  $('plan-time').value=localDateTime(current?.planned_at);const job=jobFor(current);$('publish-time').value=job?.state==='scheduled'?localDateTime(job.scheduled_at):'';render();
 }
 function renderConnection(a){
  const status=a?.connection_status||'not_connected',handle=a?.instagram_handle?'@'+a.instagram_handle:'';
  $('connection-pill').textContent={connected:'Conectado',expired:'Conexão expirada'}[status]||'Conexão pendente';$('connection-pill').dataset.state=status;
  $('connection-name').textContent=a?.name||'';
  $('connection-handle').textContent=status==='connected'?`${handle} pronto para publicação automática.`:handle?`${handle} ainda não autorizou o Pulse a publicar.`:'Entre com o @ oficial desta conta para conectar.';
  $('connection-expiry').textContent=status!=='connected'||!a.connection_expires_at?'':Date.parse(a.connection_expires_at)>Date.now()+LONG_LIVED?'Acesso sem vencimento, ligado ao portfólio da empresa.':`Acesso válido até ${when(a.connection_expires_at)}.`;
  $('connect-instagram').textContent=status==='not_connected'?'Conectar Instagram':'Conectar de novo';$('disconnect-instagram').hidden=status==='not_connected';$('resume-instagram').hidden=!(resumable&&status!=='connected');
  $('instagram-notice').textContent=status==='connected'?`Instagram: ${handle} conectado`:status==='expired'?'Instagram: conexão expirada':'Instagram: conexão pendente';
 }
 function renderAutopublish(){
  const job=jobs.get(current.id),live=jobFor(current),locked=isLocked(live);
  const shown=live&&live.state!=='cancelled'?live:null;
  $('job-status').textContent=shown?JOB_LABELS[shown.state]:'Não agendado';$('job-status').dataset.state=shown?.state||'none';
  $('job-detail').textContent=!connected()&&!locked?'Conecte o Instagram desta conta na aba Conexão e equipe para agendar.':dirty&&job?.state==='scheduled'?'Ao salvar, o agendamento é cancelado. Agende de novo depois.':shown?jobDetail(shown,when):job?.state==='scheduled'?'O texto mudou depois do agendamento, que foi cancelado. Agende de novo.':job?.state==='cancelled'?job.last_error||'':'';
  $('job-link').hidden=!shown?.permalink;if(shown?.permalink)$('job-link').href=shown.permalink;
  $('cancel-schedule').hidden=!(live&&['scheduled','failed'].includes(live.state));
  $('schedule').textContent=live?.state==='scheduled'?'Reagendar':'Agendar publicação automática';
  $('schedule').disabled=$('test-publish').disabled=$('publish-time').disabled=!connected()||locked;
  for(const id of editable)if(locked)$(id).disabled=true;
 }
 function render(){
  if(!alive||busy)return;const a=account();$('account').value=accountId;
  $('account-note').textContent=a?`${a.name}${a.instagram_handle?' · @'+a.instagram_handle:''} · rascunhos e calendário desta conta`:'Carregando contas…';
  renderConnection(a);planner.render();planner.results(outcomes);
  $('empty-editor').hidden=!!current;$('editing-content').hidden=!current;
  for(const id of ['plan','review','save','export','jpeg','add-slide','remove-slide','schedule','test-publish'])$(id).disabled=!current;
  if(!current)return;
  const c=current.content,s=c.slides[slideIndex];$('draft-status').textContent=dirty?'Alterações por salvar':statusLabel(current);$('revision').textContent=current.revision?'Versão '+current.revision:'Ainda não salvo';
  $('slide-preview').className='slide '+(slideIndex?'inner':'');
  const photo='';
  $('slide-preview').innerHTML=photo+`<div class="slide-main"><span class="kicker">${esc(a?.name.toUpperCase())} · PULSE</span><h2>${esc(s.headline||'Sua próxima manchete')}</h2><p>${esc(s.body)}</p>${slideIndex?`<span class="story-no">${slideIndex+1} / ${c.slides.length}</span>`:''}</div><div class="signature"><span class="personal-signature">${esc(a?.name)}</span></div>`;
  $('photo-note').textContent=photo?s.credit||'Confira o crédito antes de exportar.':s.image?'A imagem deste pacote ainda precisa ser incorporada aos arquivos finais.':'';
  if(external()){$('slide-preview').innerHTML=`<img class="external-image" alt="${esc(s.alt)}">`;previewExternal(slideIndex);$('photo-note').textContent=`Imagem ${slideIndex+1} de ${c.slides.length} importada de ${current.origin.label}. O Pulse publica as imagens prontas; o texto do slide não entra na arte.`;}
  $('slide-number').textContent=`SLIDE ${slideIndex+1} DE ${c.slides.length}`;$('word-count').textContent=(s.headline+' '+s.body).trim().split(/\s+/).filter(Boolean).length+' palavras';$('caption-count').textContent=c.caption.length+'/2.200';
  const check=captionCheck(c.caption);$('caption-check').textContent=c.caption.trim()?`Antes do "mais": ${check.preview}${check.warnings.length?' · '+check.warnings.join(' '):''}`:'';
  $('slide-dots').innerHTML=c.slides.map((_,i)=>`<button data-slide="${i}" aria-label="Ir ao slide ${i+1}" ${i===slideIndex?'class="active" aria-current="true"':''}></button>`).join('');
  $('slide-dots').querySelectorAll('button').forEach(b=>b.onclick=()=>move(Number(b.dataset.slide)));
  $('previous').disabled=slideIndex===0;$('next').disabled=slideIndex===c.slides.length-1;$('add-slide').disabled=c.slides.length>=10;$('remove-slide').disabled=c.slides.length<=2;
  if(external())for(const id of ['jpeg','add-slide','remove-slide'])$(id).disabled=true;
  $('sources').innerHTML=c.sources.map(s=>validSource(s.url)?`<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.label||s.url)} ↗</a>`:`<p>Revise a fonte: ${esc(s.url)}</p>`).join('')+(current.origin?`<p>Origem: ${esc(current.origin.label)} · ${esc(current.origin.title)}</p><p>${esc(current.origin.brief)}</p>`:'');
  renderAutopublish();renderAssetOrder();
 }

 function renderAssetOrder(){
  $('asset-order').innerHTML=external()?current.origin.assets.map((a,i)=>`<div><span>${i+1}. ${esc(a.name||'Slide '+(i+1))}</span><button type="button" data-order="${i}" data-delta="-1" aria-label="Mover slide ${i+1} para antes" ${i===0||isLocked(jobFor(current))?'disabled':''}>↑</button><button type="button" data-order="${i}" data-delta="1" aria-label="Mover slide ${i+1} para depois" ${i===current.origin.assets.length-1||isLocked(jobFor(current))?'disabled':''}>↓</button></div>`).join(''):'';
  $('asset-order').querySelectorAll('[data-order]').forEach(b=>b.onclick=guarded(async()=>{read();const i=Number(b.dataset.order),j=i+Number(b.dataset.delta);const assets=[...current.origin.assets],slides=[...current.content.slides];[assets[i],assets[j]]=[assets[j],assets[i]];[slides[i],slides[j]]=[slides[j],slides[i]];
   const blobs=await busyStep('Reordenando imagens…',async()=>{const result=[];for(const a of assets)result.push(await repository.downloadSlide(a.path));return result;});const paths=await repository.uploadSlides(current,blobs);current.origin.assets=assets.map((a,k)=>({...a,path:paths[k]}));current.content.slides=slides;slideIndex=j;dirty=true;current.status='draft';current.planned_at=null;fill();await save();}));
 }
 async function save(status='draft',plannedAt=null){
  if(!current)throw Error('Abra um rascunho primeiro.');read();
  if(planning(current).sourceUrl&&!safeLink(planning(current).sourceUrl))throw Error('Use um link HTTPS válido para a arte.');
  if(planning(current).stage==='approved')normalizeContent(current.content);
  if(current.content.sources.some(s=>!validSource(s.url)))throw Error('Revise as fontes: use URLs HTTPS sem credenciais.');
  if(status!=='draft')normalizeContent(current.content);
  const candidate=structuredClone({...current,status,planned_at:plannedAt}),version=epoch;lock(true);report('Salvando no Pulse…');
  try{const saved=await repository.save(candidate);if(!alive||version!==epoch)return;current=saved;rows=[saved,...rows.filter(x=>x.id!==saved.id)];dirty=false;report('Salvo no Pulse · '+labels[saved.status]+'.');}
  finally{if(alive&&version===epoch){lock(false);fill();}}
 }
 async function flush(){if(dirty&&current)await save('draft');}
 function guarded(fn){return async(...args)=>{if(busy||!alive)return;try{await fn(...args);}catch(error){report(error.message||'Não foi possível concluir.');}};}
 async function load(id){
  const [next,nextJobs]=await Promise.all([repository.list(id),repository.jobs(id)]);
  return {next,jobs:new Map(nextJobs.map(j=>[j.post_id,j]))};
 }
 async function chooseAccount(id){
  await flush();const version=++epoch;lock(true);report('Carregando rascunhos…');
  try{const loaded=await load(id);outcomes=await repository.outcomes?.(id)||[];templates=await repository.templates?.(id).catch(()=>[])||[];$('post-automation').innerHTML='<option value="">Sem automação</option>'+templates.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');$('automation-note').textContent=templates.length?'Escolha o modelo. O CRM criará uma cópia exclusiva para o post confirmado.':'Nenhum modelo disponível. Conecte o CRM para associar automações.';if(!alive||version!==epoch)return;accountId=id;rows=loaded.next;jobs=loaded.jobs;current=null;slideIndex=0;dirty=false;uploaded=null;report('');}
  finally{if(alive&&version===epoch){lock(false);fill();changeView(view);}}
 }
 // Reloads the account after a server-side change and reopens the same post with its new revision.
 async function refresh(postId){
  const loaded=await load(accountId);if(!alive)return;rows=loaded.next;jobs=loaded.jobs;
  const found=rows.find(x=>x.id===postId);if(found){current=structuredClone(found);dirty=false;}fill();
 }
 function move(i){read();slideIndex=Math.max(0,Math.min(current.content.slides.length-1,i));fill();}
 function changeView(name){view=['overview','studio','calendar','board','library','metrics','connection'].includes(name)?name:'studio';root.querySelectorAll('.publication-view').forEach(x=>x.hidden=x.id!==view);root.querySelectorAll('[data-view]').forEach(b=>{if(b.dataset.view===view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});if(view==='library')library();if(view==='calendar')calendar();planner.render();planner.results(outcomes);}
 function library(){
  $('library-list').innerHTML=rows.map(p=>{const job=jobFor(p);return `<article class="library-card"><div><span class="eyebrow">${esc(statusLabel(p))} · V${p.revision}</span><h3>${esc(p.content.title)}</h3><p>${p.content.slides.length} slides${p.planned_at?' · '+esc(when(p.planned_at))+' · Brasília':''}${job?.permalink?` · <a href="${esc(job.permalink)}" target="_blank" rel="noopener noreferrer">Ver no Instagram ↗</a>`:''}</p></div><button class="toolbar-button" data-open="${p.id}">${isLocked(job)?'Abrir':'Editar'}</button></article>`;}).join('')||'<div class="panel empty"><h2>Nenhum rascunho nesta conta</h2><p>Comece pelo Carrossel ou prepare uma pauta no Pulse News.</p></div>';
  $('library-list').querySelectorAll('[data-open]').forEach(b=>b.onclick=guarded(async()=>{await flush();current=structuredClone(rows.find(x=>x.id===b.dataset.open));slideIndex=0;dirty=false;fill();changeView('studio');}));
 }
 function calendar(){planner.render();}
 function shiftMonth(delta){planner.shift(delta);}
 function download(name,blob){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);}
 async function slideJpeg(index){
  const s=current.content.slides[index],a=account();if(!s.headline.trim())throw Error(`Preencha a headline do slide ${index+1}.`);
  await document.fonts.ready;await document.fonts.load('700 68px Inter');await document.fonts.load('400 45px Inter');
  const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1350;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,1080,1350);let y=100;
  const load=src=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('Não foi possível carregar a imagem.'));img.src=src;});
  const wrap=(text,y,font,lineHeight)=>{ctx.font=font;for(const paragraph of text.split('\n')){let line='';for(const word of paragraph.split(/\s+/)){if(ctx.measureText(word).width>928)throw Error(`Há uma palavra ou URL longa demais no slide ${index+1}.`);const candidate=line?line+' '+word:word;if(ctx.measureText(candidate).width>928&&line){ctx.fillText(line,76,y);y+=lineHeight;line=word;}else line=candidate;}ctx.fillText(line,76,y);y+=lineHeight;}return y;};
  if(s.image)throw Error(`A imagem do slide ${index+1} ainda não está disponível. Importe as imagens finais pelo botão do Canva.`);
  ctx.fillStyle='#89764b';ctx.font='700 23px Inter';ctx.fillText(a.name.toUpperCase()+' · PULSE',76,y);ctx.fillStyle='#101c16';y=wrap(s.headline,y+76,index?'72px Georgia':'700 68px Inter',77)+26;y=wrap(s.body,y,index?'400 45px Inter':'400 36px Inter',index?65:51);if(y>1170)throw Error(`Reduza o texto do slide ${index+1}: ele excede o espaço.`);
  ctx.font='400 30px Inter';ctx.textAlign='center';ctx.fillText(a.name,540,1255);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.94));if(!blob)throw Error('Falha ao gerar o JPEG.');return blob;
 }
 async function jpeg(){if(external())throw Error('Este post usa imagens prontas; não há arte para exportar.');read();const blob=await slideJpeg(slideIndex);download(`${account().account_key}-slide-${String(slideIndex+1).padStart(2,'0')}.jpg`,blob);report('JPEG exportado. Confira o arquivo final antes de publicar.');}
 // Signed link of an imported image, cached while the tab is open; the alt text stays if it cannot be loaded.
 async function previewExternal(index){
  const path=current.origin.assets[index]?.path,postId=current.id;if(!path)return;
  try{
   if(!previews.has(path))previews.set(path,repository.previewUrl(path));
   const src=await previews.get(path),img=root.querySelector('#slide-preview .external-image');
   if(alive&&current?.id===postId&&slideIndex===index&&img)img.src=src;
  }catch{previews.delete(path);}
 }
 // Final JPEGs of the saved revision, uploaded once and reused by the test and the schedule.
 async function finalAssets(){
  read();normalizeContent(current.content);
  if(dirty||!current.revision||current.status==='draft')await save('review');
  if(external())return current.origin.assets.map(a=>a.path);
  const key=current.id+':'+current.revision;if(uploaded?.key===key)return uploaded.paths;
  return busyStep('Gerando e enviando as imagens finais…',async()=>{
   const blobs=[];for(let i=0;i<current.content.slides.length;i++)blobs.push(await slideJpeg(i));
   const paths=await repository.uploadSlides(current,blobs);uploaded={key,paths};return paths;
  });
 }
 async function testPublish(){
  const paths=await finalAssets();
  const result=await busyStep('Enviando ao Instagram sem publicar…',()=>repository.testPublish(current,paths));
  report(result.message);
 }
 async function schedulePublish(){
  const local=$('publish-time').value;if(!local)throw Error('Escolha a data e a hora da publicação.');
  const at=toUtc(local);if(Date.parse(at)<Date.now()+120000)throw Error('Escolha um horário pelo menos 2 minutos à frente.');
  if(!window.confirm(`Publicar sozinho no Instagram @${account().instagram_handle} em ${when(at)} (Brasília)?\n\nO post sai sem nova confirmação. Editar o texto antes disso cancela o agendamento.`))return;
  const paths=await finalAssets(),postId=current.id;
  await busyStep('Agendando no Pulse…',()=>repository.schedule(current,at,paths));
  await refresh(postId);report(`Agendado: sai sozinho em ${when(at)}.`);
 }
 async function cancelSchedule(){
  if(!window.confirm('Cancelar a publicação automática deste post?'))return;
  const postId=current.id;await busyStep('Cancelando o agendamento…',()=>repository.cancel(postId));
  await refresh(postId);report('Agendamento cancelado. O post voltou para revisão.');
 }
 async function connect(){
  await flush();const url=await busyStep('Abrindo a tela oficial do Instagram…',()=>repository.connect(accountId));
  if(!/^https:\/\/www\.facebook\.com\/dialog\/oauth\?/.test(url))throw Error('Endereço de autorização inesperado.');
  window.location.assign(url);
 }
 async function resumeConnect(){
  const result=await busyStep('Procurando o @ compartilhado na Meta…',()=>repository.resumeConnect(accountId));
  resumable=false;accounts=await repository.accounts();render();report(`Instagram @${result.username} conectado. Faça um teste sem publicar antes do primeiro agendamento.`);
 }
 async function disconnect(){
  if(!window.confirm(`Desconectar ${account().instagram_handle?'@'+account().instagram_handle:'esta conta'}? Agendamentos pendentes vão falhar até você conectar de novo.`))return;
  await busyStep('Desconectando…',()=>repository.disconnect(accountId));
  accounts=await repository.accounts();render();report('Instagram desconectado. A chave de acesso foi apagada do Pulse.');
 }
 root.querySelectorAll('[data-view]').forEach(b=>b.onclick=guarded(()=>{read();changeView(b.dataset.view);}));
 for(const id of ['post-stage','post-campaign','post-owner','post-date','post-source','post-automation','title','headline','body','alt','caption','source-urls'])$(id).oninput=dirtyEdit;
 $('save').onclick=guarded(()=>save('draft'));$('review').onclick=guarded(()=>{$('post-stage').value='review';return save('review');});
 $('account').onchange=guarded(async e=>{const id=e.target.value;$('account').value=accountId;await chooseAccount(id);});
 $('new').onclick=$('overview-new').onclick=guarded(async()=>{await flush();current=emptyEditorialPost(accountId);slideIndex=0;dirty=false;fill();changeView('studio');});
 $('previous').onclick=()=>move(slideIndex-1);$('next').onclick=()=>move(slideIndex+1);
 $('add-slide').onclick=()=>{read();current.content.slides.push({headline:'',body:'',alt:''});slideIndex=current.content.slides.length-1;dirty=true;current.status='draft';current.planned_at=null;fill();};
 $('remove-slide').onclick=()=>{read();current.content.slides.splice(slideIndex,1);slideIndex=Math.min(slideIndex,current.content.slides.length-1);dirty=true;current.status='draft';current.planned_at=null;fill();};
 $('plan').onclick=guarded(async()=>{const local=$('plan-time').value;await save('planned',toUtc(local));month=local.slice(0,7);calendar();});
 $('schedule').onclick=guarded(schedulePublish);$('test-publish').onclick=guarded(testPublish);$('cancel-schedule').onclick=guarded(cancelSchedule);
 $('connect-instagram').onclick=guarded(connect);$('resume-instagram').onclick=guarded(resumeConnect);$('disconnect-instagram').onclick=guarded(disconnect);
 $('prev-month').onclick=()=>shiftMonth(-1);$('next-month').onclick=()=>shiftMonth(1);
 $('planning-refresh').onclick=$('reload-drafts').onclick=guarded(async()=>{await flush();const loaded=await load(accountId);if(!alive)return;rows=loaded.next;jobs=loaded.jobs;outcomes=await repository.outcomes?.(accountId)||[];library();planner.render();planner.results(outcomes);report('Lista atualizada.');});
 $('refresh-results').onclick=guarded(async()=>{const result=await busyStep('Conferindo resultados no Instagram e no CRM…',()=>repository.refreshResults(accountId));outcomes=await repository.outcomes(accountId);planner.results(outcomes);report(result.message||'Resultados atualizados.');});
 $('import-images').onchange=guarded(async e=>{const files=[...e.target.files];e.target.value='';if(!files.length)return;await flush();const images=await busyStep('Preparando imagens na ordem dos arquivos…',()=>imageFilesToJpegs(files));current=emptyEditorialPost(accountId);current.content={...current.content,kind:'external',title:files[0].name.replace(/\.[^.]+$/,''),sources:[],slides:images.map((x,i)=>({headline:'Imagem '+(i+1),body:'',alt:x.name}))};const paths=await busyStep('Guardando imagens no Pulse…',()=>repository.uploadSlides(current,images.map(x=>x.blob)));current.origin={label:'Imagens importadas',provider:'upload',assets:paths.map((path,i)=>({path,name:images[i].name})),planning:{stage:'art'}};slideIndex=0;dirty=true;fill();changeView('studio');await save();report('Imagens importadas em ordem. Revise a legenda, as fontes e cada slide.');});
 $('export').onclick=guarded(()=>{read();download(`pulse-${account().account_key}-${current.id}.json`,new Blob([JSON.stringify({schemaVersion:1,mode:'draft',accountId:account().account_key,content:current.content,origin:current.origin,publicationAuthorized:false},null,2)],{type:'application/json'}));});
 $('jpeg').onclick=guarded(jpeg);
 $('import').onchange=guarded(async e=>{const file=e.target.files[0];if(!file)return;if(file.size>150000)throw Error('Use um pacote de até 150 KB, com os textos e referências das imagens.');const payload=JSON.parse(await file.text());if(payload.accountId&&! [accountId,account().account_key].includes(payload.accountId))throw Error('Selecione a conta correspondente ao pacote.');const content=normalizeContent(payload.content);await flush();current={...emptyEditorialPost(accountId),content};slideIndex=0;dirty=true;fill();await save();e.target.value='';});
 const beforeUnload=e=>{if(dirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',beforeUnload);
 // While something is queued, the status follows the publisher without touching the editor.
 const follow=setInterval(async()=>{
  if(busy||!alive||document.hidden||![...jobs.values()].some(j=>['scheduled','publishing'].includes(j.state)))return;
  try{const next=await repository.jobs(accountId);if(alive&&!busy){jobs=new Map(next.map(j=>[j.post_id,j]));render();}}catch{/* Keep the last known status offline. */}
 },60000);
 lock(true);report('Carregando contas de publicação…');
 const ready=repository.accounts().then(async data=>{if(!alive)return;accounts=data;$('account').innerHTML=accounts.map(a=>`<option value="${a.id}">${esc(a.name)}${a.instagram_handle?' · @'+esc(a.instagram_handle):''}</option>`).join('');if(!accounts.length){busy=false;root.innerHTML='<div class="heading-row"><div><h1>Publicação</h1><p>Seu acesso atual permite consultar o histórico. As contas editoriais precisam de uma liberação específica.</p></div></div>';return;}await chooseAccount(accounts[0].id);if(metaResult){changeView('connection');report((CONNECTION_RESULTS[metaResult]||CONNECTION_RESULTS.erro)+(metaDetail?' (diagnóstico: '+metaDetail.replace(/[^A-Za-z0-9._-]/g,'')+')':''));}}).catch(e=>{busy=false;if(alive){root.innerHTML='<div class="heading-row"><div><h1>Publicação</h1><p></p></div></div>';root.querySelector('p').textContent=e.message;}});
 return {
  hasUnsavedChanges:()=>dirty||busy,
  async createFromSource(source){await ready;if(!alive||!accountId)return;await flush();current={...emptyEditorialPost(accountId),origin:source,content:{title:source.title.slice(0,160),caption:'',sources:source.sources,slides:[{headline:source.title.slice(0,120),body:'',alt:'Capa em preparação.'},{headline:'O que essa história precisa explicar?',body:source.brief.slice(0,600),alt:'Contexto para revisão.'}]}};slideIndex=0;dirty=true;fill();changeView('studio');await save();},
  destroy(){alive=false;epoch++;clearInterval(follow);window.removeEventListener('beforeunload',beforeUnload);root.replaceChildren();}
 };
}
