export const THEME_KEY='pulse-theme';
export function readTheme(storage){
 try{return storage.getItem(THEME_KEY)==='light'?'light':'dark';}catch{return 'dark';}
}
export function initTheme({doc=globalThis.document,events=globalThis.window,storage}={}){
 if(!storage)try{storage=events.localStorage;}catch{/* The theme still works when storage is blocked. */}
 let theme=readTheme(storage);
 function apply(next){
  theme=next==='light'?'light':'dark';doc.documentElement.dataset.theme=theme;
  const meta=doc.querySelector('meta[name="theme-color"]');if(meta)meta.content=theme==='dark'?'#0c252d':'#f5f9fa';
  for(const button of doc.querySelectorAll('[data-theme-toggle]')){
   button.setAttribute('aria-pressed',String(theme==='dark'));
   button.setAttribute('aria-label',theme==='dark'?'Ativar modo claro':'Ativar modo escuro');
   button.title=theme==='dark'?'Ativar modo claro':'Ativar modo escuro';
   button.querySelector('[data-theme-label]').textContent=theme==='dark'?'Modo escuro':'Modo claro';
  }
 }
 function bind(){
  apply(theme);
  for(const button of doc.querySelectorAll('[data-theme-toggle]'))button.onclick=()=>{
   apply(theme==='dark'?'light':'dark');
   try{storage.setItem(THEME_KEY,theme);}catch{/* Keep the current choice in this tab. */}
  };
 }
 apply(theme);
 if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
 events.addEventListener('storage',event=>{if(event.key===THEME_KEY||event.key===null)apply(readTheme(storage));});
}
