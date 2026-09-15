import test from 'node:test';
import assert from 'node:assert/strict';
import {diversifyComments,rankParticipants} from './community.mjs';
const comment=(id,post,handle,extra={})=>({comment_id:id,content_id:post,author_handle:handle,like_count:1,...extra});
test('a viral cannot occupy the first round; all records remain available',()=>{
 const viral=Array.from({length:40},(_,i)=>comment('v'+i,'viral','person'+i,{like_count:1000-i}));
 const others=Array.from({length:30},(_,i)=>comment('p'+i,'post'+i,'reader'+i));
 const input=[...viral,...others],output=diversifyComments(input);
 assert.equal(new Set(output.slice(0,24).map(c=>c.content_id)).size,24);
 assert.equal(new Set(output.map(c=>c.comment_id)).size,input.length);
 assert.deepEqual(input[0],viral[0]);assert.equal(diversifyComments([]).length,0);
});
test('recurrence uses distinct posts, excludes creator and deduplicates handles and records',()=>{
 const rows=[comment('1','a','Alice',{is_substantive:true}),comment('2','b','alice',{is_cta_like:true}),comment('3','a','bob'),comment('4','a','bob'),comment('5','a','perfil.exemplo'),comment('6','a','othercreator',{is_creator_reply:true}),comment('1','a','Alice')];
 const people=rankParticipants(rows,{owner:'perfil.exemplo'});assert.equal(people.length,2);assert.equal(people[0].handle,'alice');assert.equal(people[0].post_count,2);assert.equal(people[0].total,2);assert.equal(people[0].substantive,1);assert.equal(people[0].cta,1);
 const one=rankParticipants(rows,{postId:'a',sort:'comments',owner:'perfil.exemplo'});assert.equal(one[0].handle,'bob');assert.equal(one[0].total,2);assert.equal(one[0].post_count,1);
 assert.equal(rankParticipants(rows,{signal:'cta'})[0].handle,'alice');assert.equal(rankParticipants(rows,{query:'@ALICE'})[0].handle,'alice');
});
test('varied synthetic sample reconciles participants without a private dataset',()=>{
 const rows=Array.from({length:90},(_,i)=>comment('c'+i,'post'+(i%30),'reader'+(i%12),{is_substantive:true}));
 const first=diversifyComments(rows).slice(0,24);
 assert.equal(new Set(first.map(c=>c.content_id)).size,24);
 const people=rankParticipants(rows);
 assert.equal(people.reduce((n,p)=>n+p.total,0),rows.length);
 for(const p of people)assert.equal(p.post_count,new Set(p.comments.map(c=>c.content_id)).size);
});
