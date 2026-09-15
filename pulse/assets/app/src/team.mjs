const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=s=>new Date(s).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'});
import {config} from './config.mjs';
const APP_URL=config.appUrl;
export function mountTeam(root,{request}){
 let alive=true,members=[],busy=false;
 root.innerHTML=`<div class="heading-row"><div><h1>Admin</h1><p>Você decide quem entra no Pulse.</p></div><span class="team-owner-badge">Proprietário</span></div><div class="team-layout"><article class="panel team-add"><span class="eyebrow">ACESSO INDIVIDUAL</span><h2>Liberar acesso ao time</h2><p>Conteúdos, comentários, pessoas, notícias e pautas. Todos os dados do painel, com permissão de visualização.</p><form id="team-form"><label>E-mail da pessoa<input id="team-email" name="email" type="email" autocomplete="off" maxlength="254" required placeholder="pessoa@exemplo.com"></label><div class="team-permission"><svg class="icon" aria-hidden="true"><use href="#i-eye"/></svg><div><b>Somente visualização</b><span>O controle de acessos fica com você.</span></div></div><button class="primary" type="submit">Liberar acesso</button></form><p id="team-message" role="status" aria-live="polite"></p></article><article class="panel team-how"><span class="eyebrow">COMO A PESSOA ENTRA</span><h2>Uma conta para cada pessoa</h2><ol><li>Você libera o e-mail nesta aba.</li><li>Compartilha o endereço do Pulse.</li><li>A pessoa entra com sua senha ou pede um link por e-mail na tela de login.</li></ol><button id="team-copy" class="secondary" type="button">Copiar endereço do Pulse</button><p>A liberação não envia uma mensagem. O link de login é solicitado pela própria pessoa.</p></article></div><div class="section-heading section-space"><div><h2>Pessoas com acesso</h2><p id="team-count">Carregando…</p></div><button id="team-refresh" class="text-button" type="button">Atualizar lista ↻</button></div><label class="team-search">Buscar por e-mail<input id="team-search" type="search" placeholder="Buscar pessoa…"></label><div id="team-list" class="team-list"></div><p class="fineprint team-footnote">Remover um acesso bloqueia novas consultas. Arquivos já abertos podem continuar disponíveis por até 5 minutos.</p>`;
 const $=id=>root.querySelector('#'+id),message=s=>{if(alive)$('team-message').textContent=s;};
 function draw(){
  if(!alive)return;
  const active=members.filter(m=>!m.revoked_at).length;
  $('team-count').textContent=`${active} ${active===1?'acesso liberado':'acessos liberados'} · ${members.length-active} removidos`;
  const rows=members.filter(m=>m.email.toLowerCase().includes($('team-search').value.trim().toLowerCase()));
  $('team-list').innerHTML=rows.length?rows.map(m=>`<article class="panel team-member"><span class="participant-avatar" aria-hidden="true">${esc(m.email[0].toUpperCase())}</span><div class="team-member-info"><h3>${esc(m.email)}</h3><p>Visualização · ${m.revoked_at?'Removido em '+when(m.revoked_at):'Liberado em '+when(m.granted_at)}</p></div><span class="team-status ${m.revoked_at?'revoked':''}">${m.revoked_at?'Removido':'Liberado'}</span><button class="text-button" type="button" data-member="${esc(m.user_id)}" ${busy?'disabled':''}>${m.revoked_at?'Liberar novamente':'Remover acesso'}</button></article>`).join(''):`<div class="panel team-empty"><svg class="icon" aria-hidden="true"><use href="#i-user"/></svg><h3>${members.length?'Nenhum e-mail encontrado':'Só você tem acesso por enquanto'}</h3><p>${members.length?'Tente outra busca.':'Adicione o primeiro integrante do time pelo formulário acima.'}</p></div>`;
  root.querySelectorAll('[data-member]').forEach(button=>button.onclick=async()=>{
   const m=members.find(x=>x.user_id===button.dataset.member);if(!m||busy)return;
   if(!m.revoked_at&&!window.confirm(`Remover o acesso de ${m.email} ao Pulse?`))return;
   await mutate(m.revoked_at?{action:'grant',email:m.email}:{action:'revoke',user_id:m.user_id},m.revoked_at?'Acesso liberado novamente.':'Acesso removido.');
  });
 }
 async function refresh(){const result=await request({action:'list'});if(alive){members=result.members;draw();}}
 async function mutate(body,success){
  busy=true;$('team-form').querySelector('button').disabled=true;$('team-refresh').disabled=true;draw();message('Salvando…');
  try{const r=await request(body);if(!alive)return;await refresh();message(r.already_active?'Essa pessoa já tem acesso.':success);if(body.action==='grant')$('team-form').reset();}
  catch(error){message(error.message);try{await refresh();}catch{/* Preserve the error and previous list. */}}
  finally{busy=false;if(alive){$('team-form').querySelector('button').disabled=false;$('team-refresh').disabled=false;draw();}}
 }
 $('team-form').onsubmit=e=>{e.preventDefault();if(!busy)mutate({action:'grant',email:$('team-email').value.trim()},'Acesso liberado. Compartilhe o endereço do Pulse com a pessoa.');};
 $('team-search').oninput=draw;
 $('team-refresh').onclick=async()=>{if(busy)return;try{await refresh();message('Lista atualizada.');}catch(error){message(error.message);}};
 $('team-copy').onclick=async()=>{try{await navigator.clipboard.writeText(APP_URL);message('Endereço copiado.');}catch{message('Endereço do Pulse: '+APP_URL);}};
 refresh().catch(error=>{message(error.message);if(alive)$('team-count').textContent='Não foi possível carregar a lista.';});
 return {destroy(){alive=false;root.replaceChildren();}};
}
