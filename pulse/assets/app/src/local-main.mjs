import initialData from './data.mjs';
import {mountDashboard} from './dashboard.mjs';
import {createIdeaProgress} from './idea-progress.mjs';
import {validateDataset,mergeDatasets} from './local-data.mjs';

const key='pulse-local:'+initialData.profile;
let data=initialData,instance;
try{const saved=localStorage.getItem(key+':data');if(saved)data=validateDataset(JSON.parse(saved));}catch{}
const progressRows=()=>JSON.parse(localStorage.getItem(key+':checks')||'[]');
function progress(){return createIdeaProgress({
 read:async()=>progressRows(),
 complete:async id=>{const row={idea_id:id,completed_at:new Date().toISOString(),completed_by:'local'};localStorage.setItem(key+':checks',JSON.stringify([...progressRows().filter(x=>x.idea_id!==id),row]));return row;},
 reopen:async id=>{localStorage.setItem(key+':checks',JSON.stringify(progressRows().filter(x=>x.idea_id!==id)));}
});}
function open(){
 instance?.destroy();instance=mountDashboard(data,{handle:data.profile},{admin:true,local:true,ideaProgress:progress(),
  getFileUrl:async path=>{if(!/^brand\/[A-Za-z0-9_./-]+$/.test(path)||path.split('/').includes('..'))throw new Error('Arquivo inválido');return new URL(path,location.href.split('#')[0]).href;}});
 document.getElementById('login').hidden=true;document.getElementById('workspace').hidden=false;
 document.getElementById('updated-label').textContent=data.updated_at?'Última coleta: '+new Date(data.updated_at).toLocaleString('pt-BR'):'Base vazia · importe dados conferidos para começar';
 document.getElementById('status-label').textContent='Local · sem conexão com Instagram';
}
open();
const bar=document.createElement('div');bar.className='panel';bar.style.cssText='margin:12px;padding:12px;display:flex;gap:12px;flex-wrap:wrap;align-items:center';
bar.innerHTML='<span>Versão local · dados e checks neste navegador. Faça backup antes de limpar o histórico.</span><label class="toolbar-button">Importar dados <input id="local-import" type="file" accept="application/json,.json" style="max-width:220px"></label><button class="toolbar-button" id="local-backup">Baixar backup</button><span id="local-message" role="status"></span>';
document.getElementById('workspace').prepend(bar);
document.getElementById('local-import').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>10*1024*1024)throw new Error('Divida o arquivo em lotes de até 10 MB.');const next=mergeDatasets(data,JSON.parse(await file.text()));localStorage.setItem(key+':data',JSON.stringify(next));data=next;open();document.getElementById('local-message').textContent='Dados atualizados. Checks preservados.';}catch(error){document.getElementById('local-message').textContent=error.message;}};
document.getElementById('local-backup').onclick=()=>{try{const blob=new Blob([JSON.stringify({dataset:data,checks:progressRows()},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='pulse-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch{document.getElementById('local-message').textContent='Não foi possível ler o armazenamento local para exportar o backup.';}};
document.getElementById('refresh-data').onclick=()=>open();
for(const id of ['logout','mobile-logout'])document.getElementById(id).hidden=true;
document.getElementById('toggle-motion').onclick=e=>{const paused=document.body.classList.toggle('motion-paused');e.currentTarget.setAttribute('aria-pressed',String(paused));e.currentTarget.setAttribute('aria-label',paused?'Retomar animações':'Pausar animações');e.currentTarget.textContent=paused?'▷':'Ⅱ';};
