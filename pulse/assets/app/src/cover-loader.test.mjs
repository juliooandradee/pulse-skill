import test from 'node:test';
import assert from 'node:assert/strict';
import {createCoverLoader,createSignedFileCache} from './cover-loader.mjs';

const settle=()=>new Promise(resolve=>setImmediate(resolve));
function harness(sign){
 let observer;
 class Observer{
  targets=new Set();
  constructor(callback){this.callback=callback;observer=this;}
  observe(img){this.targets.add(img);}
  unobserve(img){this.targets.delete(img);}
  disconnect(){this.targets.clear();}
  intersect(img,visible=true){this.callback([{target:img,isIntersecting:visible}]);}
 }
 function element(tag){return {tag,children:[],append(...nodes){for(const node of nodes){this.children.push(node);node.parent=this;}},remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);}};}
 const doc=new EventTarget();doc.hidden=false;doc.createElement=element;
 const events=new EventTarget();
 const loader=createCoverLoader(sign,{Observer,doc,events});
 const image=(path='brand/news/physician-ai.jpg')=>{
  const figure=element('figure');
  const img={dataset:{cover:path},isConnected:true,closest:()=>figure};
  figure.append(img);return {img,figure};
 };
 const observe=(...imgs)=>loader.observe({querySelectorAll:()=>imgs});
 return {loader,observer,doc,events,image,observe};
}

test('a hidden News tab opened after six minutes receives a newly signed URL',async()=>{
 let time=0;const signed=[];
 const cache=createSignedFileCache(key=>{signed.push([key,time]);return `private-link-expires-${time+300000}`;},{now:()=>time});
 const h=harness((path,options)=>cache.get(path,options));const {img}=h.image();
 h.observe(img);h.observer.intersect(img,false);await settle();
 assert.equal(signed.length,0);assert.equal(img.src,undefined);
 time=360000;h.observer.intersect(img);await settle();
 assert.equal(img.src,'private-link-expires-660000');assert.equal(img.loading,'eager');
 img.onload();assert.equal(img.dataset.coverState,'loaded');h.loader.destroy();
});

test('concurrent readers share a link, expired links renew and retries bypass cache',async()=>{
 let time=0,count=0;const cache=createSignedFileCache(()=>`url-${++count}`,{now:()=>time});
 assert.deepEqual(await Promise.all([cache.get('photo'),cache.get('photo')]),['url-1','url-1']);
 time=240000;assert.equal(await cache.get('photo'),'url-2');
 assert.equal(await cache.get('photo',{forceRefresh:true}),'url-3');
 cache.clear();assert.equal(await cache.get('photo'),'url-4');
});

test('a late rejected signing request cannot remove a newer valid cache entry',async()=>{
 let reject,first=true;
 const cache=createSignedFileCache(()=>{if(first){first=false;return new Promise((_,r)=>reject=r);}return 'fresh';});
 const old=cache.get('photo');await settle();
 assert.equal(await cache.get('photo',{forceRefresh:true}),'fresh');
 reject(new Error('old request failed'));await assert.rejects(old);
 assert.equal(await cache.get('photo'),'fresh');
});

test('an expired image response renews automatically without removing the photo',async()=>{
 const calls=[];const h=harness((path,options)=>{calls.push(options);return `signed-${calls.length}`;});const {img,figure}=h.image();
 h.observe(img);h.observer.intersect(img);await settle();img.onerror();await settle();
 assert.equal(calls.length,2);assert.equal(calls[1].forceRefresh,true);assert.equal(img.src,'signed-2');
 img.onload();assert.equal(img.dataset.coverState,'loaded');assert.deepEqual(figure.children,[img]);h.loader.destroy();
});

test('a failed signing request also renews automatically',async()=>{
 let calls=0;const h=harness(()=>{if(++calls===1)throw new Error('temporary');return 'recovered';});const {img}=h.image();
 h.observe(img);h.observer.intersect(img);await settle();
 assert.equal(img.src,'recovered');assert.equal(calls,2);img.onload();h.loader.destroy();
});

test('persistent failure stops after two attempts and News offers a working retry',async()=>{
 let calls=0;const h=harness(()=>`signed-${++calls}`);const {img,figure}=h.image();
 h.observe(img);h.observer.intersect(img);await settle();img.onerror();await settle();img.onerror();await settle();
 assert.equal(calls,2);assert.equal(img.dataset.coverState,'failed');assert.equal(figure.children[0],img);
 const panel=figure.children[1];assert.equal(panel.children[1].textContent,'Tentar novamente');
 panel.children[1].onclick();await settle();assert.equal(calls,3);assert.equal(figure.children.length,1);
 img.onload();assert.equal(img.dataset.coverState,'loaded');h.loader.destroy();
});

for(const event of ['online','visibilitychange'])test(`failed visible photos recover on ${event}`,async()=>{
 let online=false,calls=0;const h=harness(()=>{calls++;if(!online)throw new Error('offline');return 'reconnected';});const {img}=h.image();
 h.observe(img);h.observer.intersect(img);await settle();assert.equal(calls,2);assert.equal(img.dataset.coverState,'failed');
 online=true;(event==='online'?h.events:h.doc).dispatchEvent(new Event(event));await settle();
 assert.equal(img.src,'reconnected');img.onload();h.loader.destroy();
});

test('leaving and reopening News retries failed photos without reloading the dashboard',async()=>{
 let available=false;const h=harness(()=>{if(!available)throw new Error('offline');return 'now-available';});const {img}=h.image();
 h.observe(img);h.observer.intersect(img);await settle();
 h.observer.intersect(img,false);available=true;h.observer.intersect(img);await settle();
 assert.equal(img.src,'now-available');img.onload();h.loader.destroy();
});

test('sign out cancels pending image updates and removes recovery listeners',async()=>{
 let resolve,calls=0;const h=harness(()=>{calls++;return new Promise(r=>resolve=r);});const {img}=h.image();
 h.observe(img);h.observer.intersect(img);await settle();h.loader.destroy();resolve('private-link');await settle();
 h.events.dispatchEvent(new Event('online'));h.doc.dispatchEvent(new Event('visibilitychange'));await settle();
 assert.equal(img.src,undefined);assert.equal(calls,1);assert.equal(h.observer.targets.size,0);
});

test('filter changes discard detached photos and cannot update them after signing',async()=>{
 let resolve;const h=harness(()=>new Promise(r=>resolve=r));const old=h.image().img,next=h.image('brand/news/diabetes.jpg').img;
 h.observe(old);h.observer.intersect(old);await settle();old.isConnected=false;h.observe(next);
 resolve('outdated-filter-link');await settle();
 assert.equal(old.src,undefined);assert.equal(h.observer.targets.has(old),false);assert.equal(h.observer.targets.has(next),true);h.loader.destroy();
});
