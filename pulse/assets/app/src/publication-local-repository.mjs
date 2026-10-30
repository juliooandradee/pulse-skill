import {assetBatch,assetPath} from './publication-schedule.mjs';
export function createLocalPublicationRepository(profile){
 const scope='pulse-local:'+profile+':editorial',accountId='local-account';
 const read=()=>JSON.parse(localStorage.getItem(scope)||'[]');
 const db=new Promise((resolve,reject)=>{const request=indexedDB.open('pulse-editorial-assets',1);request.onupgradeneeded=()=>request.result.createObjectStore('assets');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(Error('Armazenamento de imagens indisponível.'));});
 async function asset(method,key,value){const database=await db;return new Promise((resolve,reject)=>{const tx=database.transaction('assets',method==='get'?'readonly':'readwrite'),store=tx.objectStore('assets');const q=method==='get'?store.get(key):store.put(value,key);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(Error('Não foi possível guardar a imagem neste navegador.'));});}
 const unavailable=()=>{throw Error('Configure seu próprio acesso online e conecte a Meta para publicar automaticamente.');};
 return {
  local:true,
  accounts:async()=>[{id:accountId,account_key:'local',name:profile||'Meu Pulse',instagram_handle:profile||null,connection_status:'not_connected'}],
  list:async()=>read(),jobs:async()=>[],outcomes:async()=>[],templates:async()=>[],
  async save(post){const rows=read(),old=rows.find(p=>p.id===post.id);if(old&&old.revision!==post.revision)throw Error('A versão mudou. Reabra o post.');const saved={...structuredClone(post),revision:(post.revision||0)+1,updated_at:new Date().toISOString()};localStorage.setItem(scope,JSON.stringify([saved,...rows.filter(p=>p.id!==post.id)]));return saved;},
  async uploadSlides(post,blobs){const batch=assetBatch(),paths=blobs.map((_,i)=>assetPath(profile,post.id,batch,i));for(const [i,blob] of blobs.entries())await asset('put',paths[i],blob);return paths;},
  downloadSlide:path=>asset('get',path),
  async previewUrl(path){const blob=await asset('get',path);if(!blob)throw Error('Imagem indisponível.');return URL.createObjectURL(blob);},
  refreshResults:async()=>({message:'Métricas reais exigem seu acesso online e uma conexão autorizada com a Meta.'}),schedule:unavailable,testPublish:unavailable,connect:unavailable,resumeConnect:unavailable,disconnect:unavailable,cancel:unavailable
 };
}
