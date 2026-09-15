import test from 'node:test';
import assert from 'node:assert/strict';
import {createIdeaProgress} from './idea-progress.mjs';
import {ideaCatalog} from './ideas-view.mjs';
const row=id=>({idea_id:id,completed_at:'2026-09-13T18:00:00Z'});
test('saved completion survives a new dashboard edition and can be reopened',async()=>{
 const saved=new Map();const transport={read:async()=>[...saved.values()],complete:async id=>{saved.set(id,row(id));return saved.get(id);},reopen:async id=>saved.delete(id)};
 const first=createIdeaProgress(transport);await first.refresh();assert.equal(await first.setDone('pauta-001',true),true);first.destroy();
 const next=createIdeaProgress(transport);await next.refresh();assert.ok(next.snapshot().rows.has('pauta-001'));await next.setDone('pauta-001',false);assert.equal(saved.size,0);
});
test('an uncertain save never displays a false completion and refresh reconciles it',async()=>{
 let remote=[];const state=createIdeaProgress({read:async()=>remote,complete:async id=>{remote=[row(id)];throw Error('network lost');},reopen:async()=>{}});await state.refresh();
 assert.equal(await state.setDone('one',true),false);assert.equal(state.snapshot().rows.size,0);assert.ok(state.snapshot().error);
 await state.refresh();assert.ok(state.snapshot().rows.has('one'));assert.equal(state.snapshot().error,'');
});
test('double clicks are ignored; refresh cannot overwrite in-flight changes',async()=>{
 let resolve,calls=0,reads=0;const state=createIdeaProgress({read:async()=>{reads++;return [];},complete:id=>{calls++;return new Promise(r=>resolve=()=>r(row(id)));},reopen:async()=>{}});await state.refresh();
 const pending=state.setDone('one',true);assert.equal(await state.setDone('one',true),false);await state.refresh();assert.equal(reads,1);resolve();await pending;assert.equal(calls,1);assert.ok(state.snapshot().rows.has('one'));
});
test('a failed initial read leaves checks unavailable; sign out ignores late saves',async()=>{
 const bad=createIdeaProgress({read:async()=>{throw Error('denied')},complete:async()=>assert.fail(),reopen:async()=>assert.fail()});await bad.refresh();assert.equal(bad.snapshot().ready,false);assert.equal(await bad.setDone('one',true),false);
 let resolve;const state=createIdeaProgress({read:async()=>[],complete:id=>new Promise(r=>resolve=()=>r(row(id))),reopen:async()=>{}});await state.refresh();const pending=state.setDone('one',true);state.destroy();resolve();assert.equal(await pending,false);assert.equal(state.snapshot().rows.size,0);
});
test('existing ideas and historical patterns keep stable IDs when reordered',()=>{
 const data={ideas:[{id:'pauta-001',kind:'Conversa da audiência'},{id:'remake-ABC-reel',kind:'Recriação de post'}],editorial_analysis:{recurring_patterns:[{id:'historico-fotos',posts:[{content_id:'ABC'}]}]}};
 assert.deepEqual(ideaCatalog(data).map(x=>x.id),['pauta-001','remake-ABC-reel','historico-fotos']);data.ideas.reverse();assert.deepEqual(new Set(ideaCatalog(data).map(x=>x.id)),new Set(['pauta-001','remake-ABC-reel','historico-fotos']));
});
