import {STAGES,planning,postStage,postDate,calendarDays,filterPosts,overview,dayKey,safeLink} from './publication-planning.mjs';
import {localDateTime} from './publication-repository.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=n=>typeof n==='number'?n.toLocaleString('pt-BR'):'—';
export function mountPlanning(root,{getState,openPost,previewUrl}){
 const $=id=>root.querySelector('#'+id);let mode='month',anchor=dayKey(new Date().toISOString());
 const filters=()=>({query:$('planning-query').value,stage:$('planning-stage').value,campaign:$('planning-campaign').value});
 $('planning-stage').innerHTML+=[...Object.entries(STAGES)].map(([key,label])=>`<option value="${key}">${label}</option>`).join('');
 function card(p,job,compact=false){
  const date=postDate(p,job),meta=planning(p),stage=postStage(p,job),path=p.origin?.assets?.[0]?.path;
  return `<button class="planning-card ${compact?'compact':''}" data-post="${p.id}">${path?`<img data-cover="${esc(path)}" alt="Capa do post" loading="lazy">`:'<span class="planning-cover" aria-hidden="true">Aa</span>'}<span class="planning-card-copy"><small class="planning-status" data-state="${stage}">${STAGES[stage]||stage}</small><strong>${esc(p.content.title)}</strong><span>${date?esc(localDateTime(date).replace('T',' · ')):'Sem data'}${meta.campaign?' · '+esc(meta.campaign):''}</span>${!compact&&meta.owner?`<span>${esc(meta.owner)}</span>`:''}</span></button>`;
 }
 function wire(){
  root.querySelectorAll('[data-post]').forEach(b=>b.onclick=()=>openPost(b.dataset.post));
  root.querySelectorAll('img[data-cover]').forEach(async img=>{const path=img.dataset.cover;delete img.dataset.cover;try{const url=await previewUrl(path);if(img.isConnected)img.src=url;}catch{img.hidden=true;}});
 }
 function render(){
  const {rows,jobs}=getState(),campaign=$('planning-campaign').value;
  $('planning-campaign').innerHTML='<option value="">Todas</option>'+[...new Set(rows.map(p=>planning(p).campaign).filter(Boolean))].sort().map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');$('planning-campaign').value=campaign;
  const visible=filterPosts(rows,jobs,filters()),counts=overview(visible,jobs);
  $('planning-summary').innerHTML=[['Em revisão',counts.review],['Agendados',counts.scheduled],['Publicados',counts.published],['Falhas',counts.failed]].map(([l,n])=>`<article><span>${l}</span><strong>${n}</strong></article>`).join('');
  const next=visible.filter(p=>postDate(p,jobs.get(p.id))&&!['published','failed'].includes(postStage(p,jobs.get(p.id)))).sort((a,b)=>Date.parse(postDate(a,jobs.get(a.id)))-Date.parse(postDate(b,jobs.get(b.id))));
  $('planning-next').innerHTML=next.slice(0,6).map(p=>card(p,jobs.get(p.id))).join('')||'<p class="planning-empty">Nenhuma publicação com data. Comece por uma pauta ou importe um carrossel.</p>';
  const needs=visible.filter(p=>['review','failed'].includes(postStage(p,jobs.get(p.id)))||counts.overdue.includes(p));
  $('planning-attention').innerHTML=needs.slice(0,6).map(p=>card(p,jobs.get(p.id),true)).join('')||'<p class="planning-empty">Nenhuma revisão, atraso ou falha neste filtro.</p>';
  $('planning-board').innerHTML=Object.entries(STAGES).filter(([s])=>s!=='publishing').map(([key,label])=>{const items=visible.filter(p=>postStage(p,jobs.get(p.id))===key);return `<section><h3>${label}<span>${items.length}</span></h3>${items.map(p=>card(p,jobs.get(p.id),true)).join('')||'<p class="planning-empty">Sem conteúdos</p>'}</section>`;}).join('');
  const days=calendarDays(anchor,mode);$('calendar-grid').dataset.mode=mode;
  $('month-label').textContent=mode==='month'?new Date(anchor+'T12:00:00Z').toLocaleDateString('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'}):`${days[0].split('-').reverse().join('/')} — ${days[6].split('-').reverse().join('/')}`;
  $('calendar-grid').innerHTML=['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'].map(d=>`<div class="day-name">${d}</div>`).join('')+days.map(day=>`<div class="day ${day.slice(0,7)!==anchor.slice(0,7)?'out':''} ${day===dayKey(new Date().toISOString())?'today':''}"><b>${Number(day.slice(-2))}</b>${visible.filter(p=>dayKey(postDate(p,jobs.get(p.id)))===day).map(p=>card(p,jobs.get(p.id),true)).join('')}</div>`).join('');
  const undated=visible.filter(p=>!postDate(p,jobs.get(p.id)));$('calendar-grid').insertAdjacentHTML('beforeend',`<div class="calendar-undated"><strong>Sem data · ${undated.length}</strong>${undated.slice(0,6).map(p=>card(p,jobs.get(p.id),true)).join('')}</div>`);
  wire();
 }
 function results(outcomes=[]){
  const {rows,jobs}=getState(),visible=filterPosts(rows,jobs,filters()),published=visible.filter(p=>jobs.get(p.id)?.state==='published');
  const fields=[['reach','Alcance'],['saved','Salvamentos'],['comments','Comentários'],['dm_sent','DMs enviadas'],['clicks','Cliques'],['leads','Leads identificados']];
  $('results-summary').innerHTML=fields.map(([k,l])=>{const values=outcomes.filter(o=>visible.some(p=>p.id===o.post_id)).map(o=>o.metrics?.[k]).filter(n=>typeof n==='number');return `<article><span>${l}</span><strong>${values.length?number(values.reduce((a,b)=>a+b,0)):'—'}</strong><small>${values.length} posts com dados</small></article>`;}).join('');
  $('results-list').innerHTML=published.map(p=>{const j=jobs.get(p.id),o=outcomes.find(x=>x.post_id===p.id),link=safeLink(j.permalink,['instagram.com']);return `<article class="panel result-row"><h3>${esc(p.content.title)}</h3><p>${o?.collected_at?'Coletado em '+esc(localDateTime(o.collected_at).replace('T',' · ')):'Métricas ainda não coletadas'}${o?.last_error?' · '+esc(o.last_error):''}</p><div class="result-numbers">${fields.map(([k,l])=>`<span>${l}<strong>${number(o?.metrics?.[k])}</strong></span>`).join('')}</div><p>${o?.automation_state==='linked'?'Automação vinculada ao post':o?.automation_error?esc(o.automation_error):'Sem automação vinculada'}</p>${link?`<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Ver publicação ↗</a>`:''}</article>`;}).join('')||'<p class="planning-empty">Os resultados aparecem após uma publicação confirmada pelo Instagram.</p>';
 }
 for(const id of ['planning-query','planning-stage','planning-campaign'])$(id).oninput=render;
 $('calendar-mode').onchange=()=>{mode=$('calendar-mode').value;render();};
 $('calendar-today').onclick=()=>{anchor=dayKey(new Date().toISOString());render();};
 function shift(delta){const date=new Date(anchor+'T12:00:00Z');if(mode==='week')date.setUTCDate(date.getUTCDate()+delta*7);else{date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+delta);}anchor=date.toISOString().slice(0,10);render();}
 return {render,results,shift,card,wire};
}
