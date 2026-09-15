const completedDate=value=>new Date(value).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'});
const priority=x=>x.kind==='Conversa da audiência'?0:x.kind==='Curadoria diária'?1:2;
export function ideaCatalog(data){
 const ideas=[...(data.ideas||[])].sort((a,b)=>priority(a)-priority(b)).map(x=>({...x,section:x.kind==='Recriação de post'?'remakes':'ideas'}));
 return [...ideas,...(data.editorial_analysis?.recurring_patterns||[]).map(p=>({...p,section:'patterns',kind:'Padrão do histórico',format:'Nova versão',angle:p.opportunity,post_ids:p.posts.map(x=>x.content_id),source_ids:[]}))];
}
export function mountIdeas(root,{data,posts,esc,link,n,date,heading,coverPath,loadCovers,progress,canEdit=false}){
 let alive=true,filter='all',kind='all',query='',lastCheckFocus='',state=progress.snapshot();
 const catalog=ideaCatalog(data),sourceMap=new Map(data.sources.map(s=>[s.id,s])),postMap=new Map(posts.map(p=>[p.content_id,p]));
 root.innerHTML=heading('Próximas pautas','Ideias novas e boas histórias para contar de outro jeito.')+`
 <div class="ideas-toolbar panel"><div class="ideas-status-filters" role="group" aria-label="Status das pautas"><button data-idea-filter="all" aria-pressed="true">Todas <span></span></button><button data-idea-filter="pending" aria-pressed="false">Pendentes <span></span></button><button data-idea-filter="done" aria-pressed="false">Feitas <span></span></button></div><label>Tipo de pauta<select id="idea-kind"><option value="all">Todos os tipos</option><option value="ideas">Novas pautas</option><option value="remakes">Recriações de posts</option><option value="patterns">Padrões do histórico</option></select></label><label>Buscar pauta<input id="idea-search" type="search" placeholder="Tema ou título"></label></div>
 <div class="ideas-progress-line"><p id="ideas-progress-message" role="status" aria-live="polite"></p><button class="text-button" id="ideas-refresh">Atualizar checks ↻</button></div>
 ${canEdit?'':'<p class="fineprint">Você pode acompanhar as propostas feitas. A marcação fica com o administrador.</p>'}<div id="ideas-results"></div><p class="fineprint">As pautas feitas continuam salvas. Nenhuma ideia é publicada automaticamente. Confira as fontes antes de produzir.</p>`;
 const $=id=>root.querySelector('#'+id);
 function action(x){
  const done=state.rows.get(x.id),disabled=!state.ready||state.loading||!!state.error||state.busy.has(x.id);
  return `<div class="idea-completion">${canEdit?`<button class="idea-check ${done?'is-done':''}" data-idea-check="${esc(x.id)}" aria-pressed="${!!done}" aria-label="${done?'Reabrir proposta':'Marcar como feita'}: ${esc(x.title)}" ${disabled?'disabled':''}><span class="idea-checkbox" aria-hidden="true">${done?'✓':''}</span>${state.busy.has(x.id)?'Salvando…':done?'Proposta feita <small>Desfazer</small>':'Marcar como feita'}</button>`:`<span class="status-pill">${!state.ready?'Conferindo…':done?'✓ Proposta feita':'Pendente'}</span>`}${done?`<span class="idea-done-date">Feita em ${completedDate(done.completed_at)}</span>`:''}</div>`;
 }
 function card(x,i){
  const done=state.rows.has(x.id),p=x.section==='remakes'?postMap.get(x.post_ids?.[0]):null,cover=p&&coverPath(p);
  const sourceLinks=x.section==='patterns'?(x.posts||[]).map(p=>link(p.url,'Conferir post · '+(p.views_approximate?'≈ ':'')+n(p.views)+' visualizações')).join(''):(x.post_ids||[]).map(id=>postMap.has(id)?link(postMap.get(id).url,'Post de origem'):'').join('');
  const media=p?`<div class="idea-original">${cover?`<img data-cover="${esc(cover)}" alt="Capa do post original: ${esc(p.title)}" loading="lazy">`:''}<div><span class="idea-format-switch">${p.format==='reel'?'Reel → Carrossel':'Carrossel → Reel'}</span><strong>${esc(p.title)}</strong><span>${date(p.published_at)}</span><div class="idea-original-metrics">${[['views','visualizações'],['saves','salvamentos'],['shares','compartilhamentos']].filter(([key])=>Number.isFinite(p[key])).map(([key,label])=>`<span><b>${key==='views'&&p.views_approximate?'≈ ':''}${n(p[key])}</b> ${label}</span>`).join('')}</div></div></div>`:'';
  return `<article class="panel idea ${done?'idea-is-done':''}" data-idea-id="${esc(x.id)}"><div class="idea-top"><span class="idea-number">${String(i+1).padStart(2,'0')}</span><span class="status-pill">${!state.ready?'Proposta':done?'Feita':'Proposta'}</span></div>${media}<p class="eyebrow">${esc(x.kind)} · ${esc(x.format)}</p><h2>${esc(x.title)}</h2><p>${esc(x.angle)}</p><div class="source-links">${sourceLinks}${(x.source_ids||[]).map(id=>sourceMap.has(id)?link(sourceMap.get(id).url,sourceMap.get(id).publisher+' · '+date(sourceMap.get(id).published_at)):'').join('')}${(x.comment_ids||[]).map(id=>{const c=(data.community_comments||[]).find(c=>c.comment_id===id);return c?link(c.url,'Comentário que motivou a pauta'):'';}).join('')}</div><details><summary>Evidência, teste e limites</summary><p><b>Por que esta pauta:</b> ${esc(x.evidence)}</p><p><b>Como testar:</b> ${esc(x.test)}</p>${x.basis?`<p class="fineprint">${esc(x.basis)}. ${esc(x.limitation)}</p>`:''}${(x.source_ids||[]).map(id=>`<p class="fineprint">${esc(sourceMap.get(id)?.limitation)}</p>`).join('')}</details>${action(x)}</article>`;
 }
 function draw(){
  if(!alive)return;
  const active=document.activeElement;
  if(root.contains(active)&&active.dataset.ideaCheck)lastCheckFocus=active.dataset.ideaCheck;
  else if(active!==document.body)lastCheckFocus='';
  const focus=lastCheckFocus;
  const expanded=new Set([...root.querySelectorAll('[data-idea-id] details[open]')].map(el=>el.closest('[data-idea-id]').dataset.ideaId));
  const scoped=catalog.filter(x=>(kind==='all'||x.section===kind)&&(!query||[x.title,x.angle,x.format].join(' ').toLocaleLowerCase('pt-BR').includes(query)));
  const done=scoped.filter(x=>state.rows.has(x.id)).length;
  for(const b of root.querySelectorAll('[data-idea-filter]')){const v=b.dataset.ideaFilter;b.setAttribute('aria-pressed',String(filter===v));b.querySelector('span').textContent=v==='all'?scoped.length:state.ready?(v==='done'?done:scoped.length-done):'—';}
  $('ideas-progress-message').textContent=state.error||(state.loading?'Conferindo propostas feitas…':state.busy.size?'Salvando check…':state.ready?`${scoped.length-done} pendentes · ${done} feitas`:'Conferindo propostas feitas…');
  $('ideas-refresh').disabled=state.loading||!!state.busy.size;
  const rows=scoped.filter(x=>filter==='all'||state.ready&&(filter==='done')===state.rows.has(x.id));
  $('ideas-results').innerHTML=['ideas','remakes','patterns'].map(section=>{const list=rows.filter(x=>x.section===section);if(!list.length)return '';return `${section==='ideas'?'':`<div class="section-heading section-space"><div><h2>${section==='remakes'?'Recriar posts que deram certo':'O que pode ganhar uma nova versão'}</h2><p>${section==='remakes'?'O post original, seu resultado e uma proposta em outro formato.':'Temas que reaparecem no seu histórico.'}</p></div></div>`}<div class="ideas-grid">${list.map(card).join('')}</div>`;}).join('')||`<div class="panel empty-state"><h2>${!state.ready?'Conferindo os checks':filter==='done'?'Nenhuma proposta feita neste filtro':'Nenhuma pauta neste filtro'}</h2><p>${!state.ready?'Atualize os checks para confirmar o status.':'As propostas continuam disponíveis em Todas.'}</p></div>`;
  for(const article of root.querySelectorAll('[data-idea-id]')){if(expanded.has(article.dataset.ideaId))article.querySelector('details').open=true;}
  for(const b of root.querySelectorAll('[data-idea-check]'))b.onclick=async()=>{const id=b.dataset.ideaCheck;await progress.setDone(id,!state.rows.has(id));};
  if(focus){const button=root.querySelector(`[data-idea-check="${CSS.escape(focus)}"]`);if(button&&!button.disabled)button.focus({preventScroll:true});else if(!button&&!state.busy.has(focus)){root.querySelector(`[data-idea-filter="${filter}"]`)?.focus({preventScroll:true});lastCheckFocus='';}}
  loadCovers($('ideas-results'));
 }
 root.querySelectorAll('[data-idea-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.ideaFilter;draw();});
 $('idea-kind').onchange=e=>{kind=e.target.value;draw();};$('idea-search').oninput=e=>{query=e.target.value.toLocaleLowerCase('pt-BR');draw();};
 $('ideas-refresh').onclick=()=>progress.refresh();
 const unsubscribe=progress.subscribe(s=>{state=s;draw();});
 return {refresh:()=>progress.refresh(),destroy(){alive=false;unsubscribe();root.replaceChildren();}};
}
