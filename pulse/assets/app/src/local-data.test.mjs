import test from 'node:test';
import assert from 'node:assert/strict';
import initial from './data.mjs';
import {mergeDatasets,validateDataset} from './local-data.mjs';
const dataset=()=>({...structuredClone(initial),observations:[{content_id:'p1',title:'Exemplo'}],metrics:[{content_id:'p1',views:null,likes:0}],ideas:[{id:'idea1',title:'Preservar'}],curation:{editions:[{edition_date:'2026-01-01',items:[{id:'n1'}]}]}});
test('incremental updates retain old ideas, editions, known metrics and input evidence',()=>{
 const old=dataset(),incoming=dataset();incoming.ideas=[{id:'idea2'}];incoming.curation.editions=[{edition_date:'2026-01-08',items:[{id:'n2'}]}];incoming.metrics[0].likes=null;
 const original=JSON.stringify(old);const merged=mergeDatasets(old,incoming);
 assert.deepEqual(merged.ideas.map(x=>x.id),['idea1','idea2']);assert.equal(merged.curation.editions.length,2);assert.equal(merged.metrics[0].likes,0);assert.equal(merged.metrics[0].views,null);assert.equal(JSON.stringify(old),original);
 assert.equal(Object.hasOwn(merged,'checks'),false);
});
test('reject duplicate IDs, invalid metrics, missing post links and profile mismatch',()=>{
 const duplicate=dataset();duplicate.ideas.push({...duplicate.ideas[0]});assert.throws(()=>validateDataset(duplicate));
 const metric=dataset();metric.metrics[0].views=-1;assert.throws(()=>validateDataset(metric));
 const orphan=dataset();orphan.metrics[0].content_id='unknown';assert.throws(()=>validateDataset(orphan));
 const other=dataset();other.profile='outro';assert.throws(()=>mergeDatasets(dataset(),other));
});
test('re-import is idempotent and a new post increases measured coverage only when known',()=>{
 const old=dataset();const added=dataset();added.observations.push({content_id:'p2'});added.metrics.push({content_id:'p2',views:120});
 const once=mergeDatasets(old,added),twice=mergeDatasets(once,added);
 assert.deepEqual(once,twice);assert.equal(twice.coverage.inventoried_posts,2);assert.equal(twice.coverage.posts_with_views,1);
});
test('reject malformed nested collections before persisting an import',()=>{
 for(const mutate of [d=>d.curation.editions={},d=>d.curation.editions[0].items=null,d=>d.editorial_analysis.recurring_patterns=[{id:'p',posts:{}}],d=>d.ideas[0].post_ids='p1',d=>d.observations[0].published_at='<img>',d=>d.taxonomy={}]){const d=dataset();mutate(d);assert.throws(()=>validateDataset(d));}
});
