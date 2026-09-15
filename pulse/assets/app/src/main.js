import {config} from './config.mjs';
if(config.mode==='cloud'){
 if(!config.supabaseUrl||!config.publishableKey||!config.workspaceId){document.getElementById('login-message').textContent='Configure seu próprio projeto antes de ativar o acesso online.';document.getElementById('login-form').hidden=true;}
 else import('./cloud-main.js');
}else{import('./local-main.mjs');}
