import {diversifyComments, rankParticipants, byReaction} from './community.mjs';
import {renderParticipantAvatar} from './participant-avatar.mjs';
const number=x=>Number.isFinite(x)?x:-1;
const commentDate=(c,date,esc)=>c.published_at?date(c.published_at):c.displayed_date?esc(c.displayed_date.replace(/(\d+)w/,'$1 sem').replace(/(\d+)d/,'$1 d'))+' na coleta':'Data não informada';
const postName=p=>p?.title==='Publicação com título a conferir'?'Publicação'+(p.published_at?' de '+p.published_at.slice(0,10).split('-').reverse().join('/'):'')+' · '+p.content_id:p?.title||'Publicação';

export function renderConversations({root,data,posts,esc,link,n,icon,heading,date,coverPath,loadCovers}) {
  const avatar=handle=>renderParticipantAvatar(handle,data.participant_profiles,esc);
  const comments=data.community_comments||[], postMap=new Map(posts.map(p=>[p.content_id,p]));
  const allPeople=rankParticipants(comments), recurring=allPeople.filter(p=>p.post_count>1).length;const lines=[...new Set(posts.map(p=>p.candidate_line||'A conferir'))].sort();
  const postOptions=posts.filter(p=>comments.some(c=>c.content_id===p.content_id)).sort((a,b)=>number(b.comments)-number(a.comments)).map(p=>`<option value="${esc(p.content_id)}">${esc(postName(p).slice(0,95))}</option>`).join('');
  root.innerHTML=heading('Comunidade','Conversas, pessoas e novas pautas.')+`
    <div class="community-metrics">
      <article class="metric-tile"><span>Comentários catalogados ${icon('chat')}</span><strong>${n(comments.length)}</strong><small>Em ${n(new Set(comments.map(c=>c.content_id)).size)} publicações</small></article>
      <article class="metric-tile"><span>Pessoas na amostra ${icon('user')}</span><strong>${n(allPeople.length)}</strong><small>Exclui suas próprias respostas</small></article>
      <article class="metric-tile"><span>Voltaram a comentar ${icon('spark')}</span><strong>${n(recurring)}</strong><small>Em pelo menos dois posts distintos</small></article>
    </div>
    <div class="community-tabs" role="group" aria-label="Visualização da comunidade"><button id="community-conversations" aria-pressed="true">${icon('chat')} Conversas</button><button id="community-people" aria-pressed="false">${icon('user')} Pessoas</button></div>
    <div id="conversation-view">
      <div class="section-heading section-space"><div><h2>Um olhar para cada conversa</h2><p>Comece por posts diferentes. Aprofunde o que chamar sua atenção.</p></div></div>
      <div class="filterbar panel conversation-filters">
        <label class="search-field">Buscar comentário<input id="comment-search" type="search" placeholder="Dúvida, ferramenta ou pessoa"></label>
        <label>Mostrar<select id="comment-kind"><option value="substantive">Perguntas e discussões</option><option value="all">Todos os catalogados</option><option value="cta">Pedidos por palavra-chave</option><option value="creator">Respostas do criador</option><option value="brief">Reações breves</option></select></label>
        <label>Ordenar por<select id="comment-sort"><option value="diverse">Posts variados</option><option value="likes">Curtidas no comentário</option><option value="replies">Respostas ao comentário</option><option value="post-comments">Comentários no post</option><option value="post-likes">Curtidas no post</option></select></label>
        <label>Publicação<select id="comment-post"><option value="">Todas as publicações</option>${postOptions}</select></label>
      </div>
      <div class="result-line"><span id="comment-count" role="status"></span></div><p id="comment-mix" class="fineprint"></p>
      <div id="comment-results" class="conversation-grid"></div>
      <div class="pagination"><button class="toolbar-button" id="comments-prev">← Anterior</button><span id="comments-page" role="status"></span><button class="toolbar-button" id="comments-next">Próxima →</button></div>
    </div>
    <div id="participant-view" hidden>
      <div class="section-heading section-space"><div><h2>Pessoas mais presentes</h2><p>Quem participa em vários posts e quem aprofunda uma conversa.</p></div><span class="status-pill">Sinais de interesse</span></div>
      <div class="filterbar panel participant-filters">
        <label class="search-field">Buscar pessoa<input id="participant-search" type="search" placeholder="@perfil"></label>
        <label>Publicação<select id="participant-post"><option value="">Todas as publicações</option>${postOptions}</select></label>
        <label>Linha editorial<select id="participant-topic"><option value="">Todas as linhas</option>${lines.map(t=>`<option>${esc(t)}</option>`).join('')}</select></label>
        <label>Participações<select id="participant-signal"><option value="all">Todas as participações</option><option value="substantive">Perguntas e discussões</option><option value="cta">Pedidos de material</option></select></label>
        <label>Ordenar pessoas<select id="participant-sort"><option value="posts">Posts distintos</option><option value="comments">Mais comentários</option><option value="substantive">Mais perguntas e discussões</option></select></label>
      </div>
      <div class="result-line"><span id="participant-count" role="status"></span><span class="fineprint">Ranking da amostra coletada</span></div>
      <div id="participant-results" class="participant-list"></div>
      <div class="pagination"><button class="toolbar-button" id="participants-prev">← Anterior</button><span id="participants-page" role="status"></span><button class="toolbar-button" id="participants-next">Próxima →</button></div>
      <details class="context-details"><summary>Como interpretar estas pessoas</summary><p>O ranking usa comentários únicos e posts distintos da amostra. Por padrão, prioriza quem apareceu em mais publicações; depois, perguntas e discussões, volume total e nome do perfil. Suas respostas ficam fora do ranking.</p><p>“Pedidos de material” são respostas por palavra-chave. A triagem e as linhas editoriais são provisórias. Participação é um sinal de interesse para revisão comercial, não comprovação de intenção de compra. As contagens mudam conforme os filtros e não representam toda a audiência.</p></details>
    </div>
    <details class="context-details"><summary>Como esta amostra foi selecionada</summary><p>Comentários coletados em ${n(new Set(comments.map(c=>c.content_id)).size)} publicações, com aprofundamento de conversas prioritárias. A amostra é dirigida e não representa toda a audiência nem um ranking anual. A ordenação “Posts variados” intercala um comentário de cada publicação antes de repetir o mesmo post, priorizando os mais curtidos dentro de cada conversa.</p><p>Pedidos por palavra-chave, reações breves e respostas do criador têm filtros próprios. “—” significa que a contagem não apareceu na interface, não zero.</p></details>`;
  const get=id=>root.querySelector('#'+id);let page=0,peoplePage=0,focusedAuthor='';
  function chooseView(people){get('conversation-view').hidden=people;get('participant-view').hidden=!people;get('community-conversations').setAttribute('aria-pressed',String(!people));get('community-people').setAttribute('aria-pressed',String(people));}
  function drawComments(){
    const kind=get('comment-kind').value,q=get('comment-search').value.toLocaleLowerCase('pt-BR'),pid=get('comment-post').value,key=get('comment-sort').value;
    let rows=comments.filter(c=>(!focusedAuthor||c.author_handle?.toLowerCase()===focusedAuthor)&&(!pid||c.content_id===pid)&&(!q||[c.comment_text,c.theme,c.author_handle,postName(postMap.get(c.content_id))].join(' ').toLocaleLowerCase('pt-BR').includes(q))&&(kind==='all'||kind==='substantive'&&c.is_substantive||kind==='cta'&&c.is_cta_like||kind==='creator'&&c.is_creator_reply||kind==='brief'&&!c.is_substantive&&!c.is_cta_like&&!c.is_creator_reply));
    const score=c=>key==='likes'?number(c.like_count):key==='replies'?number(c.reply_count_reported):number(postMap.get(c.content_id)?.[key==='post-comments'?'comments':'likes']);
    rows=key==='diverse'?diversifyComments(rows):rows.sort((a,b)=>score(b)-score(a)||byReaction(a,b));
    const pages=Math.max(1,Math.ceil(rows.length/24));page=Math.min(page,pages-1);const shown=rows.slice(page*24,(page+1)*24),distinct=new Set(shown.map(c=>c.content_id)).size;
    get('comment-count').textContent=`${n(rows.length)} comentários neste filtro`;
    get('comment-mix').textContent=`Nesta página: ${n(distinct)} publicações · ${n(shown.length)} comentários${key==='diverse'?' · seleção intercalada':''}`;
    get('comment-results').innerHTML=shown.map(c=>{const p=postMap.get(c.content_id),cover=p&&coverPath(p);return `<article class="panel conversation-card" data-content-id="${esc(c.content_id)}"><div class="conversation-meta"><span>${esc(c.signal_type)}</span><span>${n(c.like_count)} curtidas · ${n(c.reply_count_reported)} respostas</span></div><blockquote>${esc(c.comment_text)}</blockquote><div class="conversation-author"><div class="conversation-identity">${avatar(c.author_handle)}${link('https://www.instagram.com/'+encodeURIComponent(c.author_handle)+'/','@'+c.author_handle)}</div><span>${commentDate(c,date,esc)}</span></div><p class="topic-tag">${esc(c.theme)} · triagem</p><div class="conversation-source"><div class="conversation-post">${cover?`<img data-cover="${esc(cover)}" alt="Capa da publicação de origem" loading="lazy">`:''}<div><strong>${esc(postName(p))}</strong><span>${n(p?.likes)} curtidas · ${n(p?.comments)} comentários no post</span></div></div><div>${link(c.url,'Comentário original')}<button class="text-button" data-conversation-post="${esc(c.content_id)}">Ver esta conversa</button></div></div></article>`;}).join('')||'<div class="empty-state"><h2>Nenhum comentário neste filtro</h2><p>Experimente outro tema ou escolha todos os catalogados.</p></div>';
    get('comments-page').textContent=`Página ${page+1} de ${pages}`;get('comments-prev').disabled=page===0;get('comments-next').disabled=page===pages-1;
    get('comment-results').querySelectorAll('[data-conversation-post]').forEach(b=>b.onclick=()=>{get('comment-post').value=b.dataset.conversationPost;get('comment-sort').value='likes';page=0;drawComments();get('comment-count').scrollIntoView({block:'center'});});loadCovers(get('comment-results'));
  }
  function drawPeople(){
    const topic=get('participant-topic').value,scoped=topic?comments.filter(c=>(postMap.get(c.content_id)?.candidate_line||'A conferir')===topic):comments;const rows=rankParticipants(scoped,{postId:get('participant-post').value,signal:get('participant-signal').value,sort:get('participant-sort').value,query:get('participant-search').value}),ranked=rows.slice(0,50),pages=Math.max(1,Math.ceil(ranked.length/10));peoplePage=Math.min(peoplePage,pages-1);
    get('participant-count').textContent=`${n(rows.length)} pessoas neste filtro${rows.length>50?' · 50 em destaque':''}`;
    get('participant-results').innerHTML=ranked.slice(peoplePage*10,(peoplePage+1)*10).map((p,i)=>`<article class="panel participant-card"><div class="participant-row"><span class="participant-rank">${String(peoplePage*10+i+1).padStart(2,'0')}</span>${avatar(p.handle)}<div class="participant-name">${link('https://www.instagram.com/'+p.handle+'/','@'+p.handle)}<small>${p.post_count>1?'Voltou em '+n(p.post_count)+' publicações':'Participou de uma publicação'}${p.last_date?' · '+date(p.last_date):''}</small></div><div class="participant-numbers"><div><b>${n(p.post_count)}</b><span>posts</span></div><div><b>${n(p.total)}</b><span>comentários</span></div><div><b>${n(p.substantive)}</b><span>perguntas / discussões</span></div><div><b>${n(p.cta)}</b><span>pedidos de material</span></div></div></div><details><summary>Ver participações</summary><div class="participant-evidence">${p.comments.slice(0,5).map(c=>`<div><p>${esc(c.comment_text)}</p><span>${esc(postName(postMap.get(c.content_id)))} · ${commentDate(c,date,esc)}</span>${link(c.url,'Comentário original')}</div>`).join('')}</div><button class="text-button" data-person-comments="${esc(p.handle)}">Ver todos os comentários desta pessoa</button></details></article>`).join('')||'<div class="empty-state"><h2>Nenhuma pessoa neste filtro</h2><p>Experimente outro perfil ou publicação.</p></div>';
    get('participants-page').textContent=`Página ${peoplePage+1} de ${pages}`;get('participants-prev').disabled=peoplePage===0;get('participants-next').disabled=peoplePage===pages-1;
    get('participant-results').querySelectorAll('[data-person-comments]').forEach(b=>b.onclick=()=>{focusedAuthor=b.dataset.personComments;get('comment-search').value=b.dataset.personComments;get('comment-post').value=get('participant-post').value;get('comment-kind').value='all';get('comment-sort').value='diverse';page=0;drawComments();chooseView(false);get('comment-count').scrollIntoView({block:'center'});});
    loadCovers(get('participant-results'));
  }
  ['comment-kind','comment-sort','comment-post','comment-search'].forEach(id=>get(id).addEventListener(id==='comment-search'?'input':'change',()=>{if(id==='comment-search')focusedAuthor='';page=0;drawComments();}));
  ['participant-search','participant-post','participant-topic','participant-signal','participant-sort'].forEach(id=>get(id).addEventListener(id==='participant-search'?'input':'change',()=>{peoplePage=0;if(id==='participant-post')get('participant-sort').value=get(id).value?'comments':'posts';drawPeople();}));
  get('comments-prev').onclick=()=>{page--;drawComments();};get('comments-next').onclick=()=>{page++;drawComments();get('comment-count').scrollIntoView({block:'center'});};
  get('participants-prev').onclick=()=>{peoplePage--;drawPeople();};get('participants-next').onclick=()=>{peoplePage++;drawPeople();get('participant-count').scrollIntoView({block:'center'});};
  get('community-conversations').onclick=()=>chooseView(false);get('community-people').onclick=()=>chooseView(true);
  drawComments();drawPeople();
  return {showParticipants(id=''){get('participant-post').value=id;get('participant-topic').value='';get('participant-search').value='';get('participant-signal').value='all';get('participant-sort').value=id?'comments':'posts';peoplePage=0;drawPeople();chooseView(true);}};
}

export function renderPostParticipants(comments,postId,{esc,link,n,profiles={}}) {
  const avatar=handle=>renderParticipantAvatar(handle,profiles,esc);
  const people=rankParticipants(comments,{postId,sort:'comments'});
  return `<section class="post-participants"><div class="section-heading"><div><h3>Quem mais participou deste post</h3><p>${n(people.length)} pessoas na amostra coletada · suas respostas ficam fora</p></div></div>${people.length?`<div class="post-participant-list">${people.slice(0,5).map(p=>`<div>${avatar(p.handle)}<div>${link('https://www.instagram.com/'+p.handle+'/','@'+p.handle)}<small>${n(p.total)} comentários · ${n(p.cta)} pedidos de material</small></div></div>`).join('')}</div><button class="toolbar-button" id="show-post-participants" data-post="${esc(postId)}">Ver participantes desta publicação ${'→'}</button>`:'<p>Os comentários desta publicação ainda não foram coletados.</p>'}</section>`;
}
