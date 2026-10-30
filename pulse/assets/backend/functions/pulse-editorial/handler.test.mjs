import test from 'node:test';import assert from 'node:assert/strict';
import {makeEditorialHandler,metricValues} from './handler.mjs';
const handler=makeEditorialHandler({url:'https://test.supabase.co',key:'test-secret',version:'v26.0',fetcher:async()=>new Response('{}',{status:401})});
test('metrics preserve missing values and genuine zero',()=>{assert.deepEqual(metricValues({data:[{name:'reach',values:[{value:0}]},{name:'saved',values:[]},{name:'shares',total_value:{value:3}}]}),{reach:0,shares:3});});
test('anonymous callers cannot list templates or fetch results',async()=>{const r=await handler(new Request('https://test',{method:'POST',body:JSON.stringify({action:'results',account_id:'44444444-4444-4444-8444-444444444444'})}));assert.equal(r.status,401);});
test('rejects cross-origin request before authenticating',async()=>{const r=await handler(new Request('https://test',{method:'POST',headers:{origin:'https://evil.test'},body:'{}'}));assert.equal(r.status,403);});
test('service caller must identify owner for account actions',async()=>{const r=await handler(new Request('https://test',{method:'POST',headers:{authorization:'Bearer test-secret'},body:JSON.stringify({action:'templates',account_id:'44444444-4444-4444-8444-444444444444'})}));assert.equal(r.status,401);});
