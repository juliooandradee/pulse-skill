import {createClient} from '@supabase/supabase-js';
import {createIdeaProgress} from './idea-progress.mjs';
import {mountDashboard} from './dashboard.mjs';
import {createSignedFileCache} from './cover-loader.mjs';

import {config} from './config.mjs';
const client=createClient(config.supabaseUrl,config.publishableKey,{auth:{storageKey:'pulse-auth-v1',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const $=id=>document.getElementById(id);
let instance,workspace,loading=false,epoch=0,loadedRevision='',lastBackgroundCheck=0;
const fileCache=createSignedFileCache(async key=>{
 const {data,error}=await client.storage.from('pulse-private').createSignedUrl(key,300);
 if(error||!data)throw new Error('Arquivo indisponível');return data.signedUrl;
});
function clearWorkspace(){epoch++;loading=false;loadedRevision='';instance?.destroy();instance=undefined;workspace=undefined;fileCache.clear();$('owner-label').textContent='';$('admin-nav').hidden=true;$('workspace').hidden=true;$('login').hidden=false;}
function toast(message){$('app-toast').textContent=message;setTimeout(()=>{$('app-toast').textContent='';},6000);}
async function getFileUrl(path,options){
 if(!workspace)throw new Error('Entre novamente para abrir o arquivo.');
 return fileCache.get(workspace.id+'/'+path,options);
}
async function loadWorkspace(){
 if(loading)return;loading=true;const version=epoch;$('login-message').textContent='Conferindo seu acesso…';$('refresh-data').disabled=true;
 try{
  const {data:auth,error:authError}=await client.auth.getUser();if(version!==epoch)return;if(authError||!auth.user)throw new Error('Entre com sua conta para abrir o painel.');
  const {data:work,error:workError}=await client.from('pulse_workspaces').select('id,handle,title,owner_id').eq('id',config.workspaceId).single();if(version!==epoch)return;if(workError||!work)throw new Error('Seu e-mail ainda não tem acesso ao Pulse. Peça ao administrador para liberá-lo na aba Admin.');
  const {data:snapshot,error}=await client.from('pulse_datasets').select('payload').eq('workspace_id',work.id).eq('dataset_key','dashboard').single();if(version!==epoch)return;if(error||!snapshot)throw new Error('A base está sendo atualizada. Tente novamente em instantes.');
  instance?.destroy();workspace=work;loadedRevision=snapshot.payload.updated_at;instance=mountDashboard(snapshot.payload,work,{getFileUrl,admin:work.owner_id===auth.user.id,teamRequest:body=>teamRequest(work.id,body),ideaProgress:progressFor(work.id)});$('login-message').textContent='';$('login').hidden=true;$('workspace').hidden=false;
 }catch(error){if(version!==epoch)return;clearWorkspace();$('login-message').textContent=error.message||'Não foi possível abrir o painel. Tente novamente.';}
 finally{if(version===epoch)loading=false;$('refresh-data').disabled=false;}
}
$('login-form').addEventListener('submit',async e=>{
 e.preventDefault();const formElement=e.currentTarget,button=formElement.querySelector('button');button.disabled=true;$('login-message').textContent='Entrando…';const form=new FormData(formElement);
 try{const {error}=await client.auth.signInWithPassword({email:String(form.get('email')).trim(),password:String(form.get('password'))});if(error)throw error;formElement.elements.password.value='';await loadWorkspace();}
 catch{$('login-message').textContent='Não foi possível entrar. Confira o e-mail e a senha ou peça um link de acesso por e-mail.';}finally{button.disabled=false;}
});
async function logout(){const {error}=await client.auth.signOut({scope:'local'});if(error){toast('Não foi possível sair. Tente novamente.');return;}clearWorkspace();$('login-message').textContent='Você saiu da conta.';}
$('logout').onclick=logout;$('mobile-logout').onclick=logout;
$('refresh-data').onclick=async()=>{await loadWorkspace();if(instance)toast('Painel recarregado com a base disponível.');};
$('toggle-motion').onclick=e=>{const paused=document.body.classList.toggle('motion-paused'),label=paused?'Retomar animações':'Pausar animações';e.currentTarget.setAttribute('aria-pressed',String(paused));e.currentTarget.setAttribute('aria-label',label);e.currentTarget.title=label;e.currentTarget.textContent=paused?'▷':'Ⅱ';};
client.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT')clearWorkspace();else if(event==='SIGNED_IN'&&!workspace)queueMicrotask(loadWorkspace);});
client.auth.getSession().then(({data:s})=>{if(s.session)loadWorkspace();});
async function checkForUpdates(){
 if(!workspace||loading||document.hidden||$('post-dialog').open||Date.now()-lastBackgroundCheck<60000)return;
 lastBackgroundCheck=Date.now();const version=epoch;
 try{const {data,error}=await client.from('pulse_datasets').select('updated_at').eq('workspace_id',workspace.id).eq('dataset_key','dashboard').single();
  if(version===epoch&&!data&&(error?.code==='PGRST116'||!error)){clearWorkspace();$('login-message').textContent='Seu acesso mudou. Entre novamente ou fale com o administrador.';return;}
  if(!error&&version===epoch)instance?.refreshIdeaProgress();
  if(!error&&version===epoch&&data?.updated_at&&new Date(data.updated_at).getTime()!==new Date(loadedRevision).getTime()){const position=window.scrollY;await loadWorkspace();if(instance){window.scrollTo(0,position);toast('Novos dados e pautas disponíveis no Pulse.');}}
 }catch{/* Keep the current edition available when offline. */}
}
setInterval(checkForUpdates,60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkForUpdates();});

async function teamRequest(workspaceId,body){
 const {data,error}=await client.functions.invoke('pulse-team-admin',{body:{...body,workspace_id:workspaceId}});
 if(error){let message='Não foi possível concluir. Atualize a lista e tente novamente.';try{const detail=await error.context.json();message=detail.error||message;}catch{}throw new Error(message);}
 if(data?.error)throw new Error(data.error);return data;
}
$('login-link').onclick=async()=>{
 const input=$('login-form').elements.email;if(!input.reportValidity())return;
 const button=$('login-link');button.disabled=true;$('login-message').textContent='Solicitando link de acesso…';
 try{const {error}=await client.auth.signInWithOtp({email:input.value.trim(),options:{shouldCreateUser:false,emailRedirectTo:config.appUrl}});if(error)throw error;
 $('login-message').textContent='Se o e-mail tiver uma conta, você receberá um link para entrar. Confira também o spam.';}
 catch{$('login-message').textContent='Não foi possível solicitar o link. Confira se seu e-mail foi liberado e tente novamente em um minuto.';}
 finally{setTimeout(()=>{button.disabled=false;},60000);}
};

function progressFor(workspaceId){
 const table=()=>client.from('pulse_idea_progress');
 const columns='idea_id,completed_at,completed_by';
 return createIdeaProgress({
  async read(){const {data,error}=await table().select(columns).eq('workspace_id',workspaceId);if(error)throw error;return data;},
  async complete(id){
   const {error}=await table().upsert({workspace_id:workspaceId,idea_id:id},{onConflict:'workspace_id,idea_id',ignoreDuplicates:true});if(error)throw error;
   const {data,error:readError}=await table().select(columns).eq('workspace_id',workspaceId).eq('idea_id',id).single();if(readError)throw readError;return data;
  },
  async reopen(id){const {data,error}=await table().delete().eq('workspace_id',workspaceId).eq('idea_id',id).select('idea_id').single();if(error)throw error;return data;}
 });
}
