// Keep private links short-lived, but request them only when a photo is needed.
export function createSignedFileCache(sign,{now=Date.now,lifetime=240000}={}){
 const entries=new Map();
 return {
  get(key,{forceRefresh=false}={}){
   const previous=entries.get(key);
   if(!forceRefresh&&previous&&previous.until>now())return previous.promise;
   const entry={until:now()+lifetime};
   entry.promise=Promise.resolve().then(()=>sign(key));entries.set(key,entry);
   entry.promise.catch(()=>{if(entries.get(key)===entry)entries.delete(key);});
   return entry.promise;
  },
  clear(){entries.clear();}
 };
}

export function createCoverLoader(getFileUrl,{
 Observer=globalThis.IntersectionObserver,
 doc=globalThis.document,
 events=globalThis.window
}={}){
 const states=new Map();let disposed=false;
 const observer=new Observer(entries=>{
  for(const entry of entries){
   const state=states.get(entry.target);if(!state)continue;
   state.visible=entry.isIntersecting;
   if(state.visible&&(state.status==='waiting'||state.status==='failed')){
    state.attempts=0;start(state,state.status==='failed');
   }
  }
 },{rootMargin:'300px 0px'});
 const alive=state=>!disposed&&state.img.isConnected&&states.get(state.img)===state;
 function discard(state){
  observer.unobserve(state.img);state.img.onload=state.img.onerror=null;
  state.feedback?.remove();states.delete(state.img);
 }
 function recover(){
  if(doc.hidden)return;
  for(const state of states.values()){
   if(!alive(state)){discard(state);continue;}
   if(state.visible&&state.status==='failed'){state.attempts=0;start(state,true);}
  }
 }
 function feedback(state){
  // News cards keep their photograph area and credit even during a network failure.
  const figure=state.img.closest('.news-photo');if(!figure)return;
  const panel=doc.createElement('div');panel.className='cover-feedback';
  const message=doc.createElement('span');message.textContent='Não foi possível carregar a foto.';
  const button=doc.createElement('button');button.type='button';button.className='toolbar-button';button.textContent='Tentar novamente';
  button.onclick=()=>{state.attempts=0;start(state,true);};
  panel.append(message,button);figure.append(panel);state.feedback=panel;
 }
 function fail(state){
  if(!alive(state))return;
  state.status='waiting';
  if(state.attempts<2){start(state,true);return;}
  state.status='failed';state.img.dataset.coverState='failed';feedback(state);
 }
 async function start(state,forceRefresh=false){
  if(!alive(state)||state.status==='signing'||state.status==='loading'||state.status==='loaded')return;
  state.feedback?.remove();state.feedback=undefined;
  state.img.onload=state.img.onerror=null;
  state.status='signing';state.attempts++;state.img.dataset.coverState='loading';
  try{
   const url=await getFileUrl(state.img.dataset.cover,{forceRefresh});
   if(!alive(state))return;
   state.status='loading';
   state.img.onload=()=>{
    if(!alive(state))return;
    state.status='loaded';state.img.dataset.coverState='loaded';
    discard(state);
   };
   state.img.onerror=()=>fail(state);
   // IntersectionObserver already did the lazy loading. Do not postpone a signed URL again.
   state.img.loading='eager';state.img.src=url;
  }catch{fail(state);}
 }
 doc.addEventListener('visibilitychange',recover);events.addEventListener('online',recover);
 return {
  observe(root){
   if(disposed)return;
   for(const state of states.values())if(!state.img.isConnected)discard(state);
   for(const img of root.querySelectorAll('img[data-cover]')){
    if(states.has(img)||img.dataset.coverState==='loaded')continue;
    const state={img,status:'waiting',attempts:0,visible:false};
    states.set(img,state);observer.observe(img);
   }
  },
  destroy(){
   disposed=true;observer.disconnect();
   doc.removeEventListener('visibilitychange',recover);events.removeEventListener('online',recover);
   for(const state of states.values())discard(state);
  }
 };
}
