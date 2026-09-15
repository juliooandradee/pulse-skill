import test from 'node:test';import assert from 'node:assert/strict';import {makeHandler} from './handler.mjs';
const uid='11111111-1111-4111-8111-111111111111',wid='22222222-2222-4222-8222-222222222222',member='12345678-1234-4123-8123-123456789abc';
function rig({owner=uid,confirmed=true,existing=[],account=member}={}){
 const calls=[];
 const fn=makeHandler({url:'https://test.invalid',key:'secret',fetcher:async(url,o)=>{
  const path=new URL(url).pathname,q=new URL(url).search;calls.push({path,q,options:o});
  if(path==='/auth/v1/user')return Response.json({id:uid,email_confirmed_at:confirmed?'2026-09-13':null});
  if(path==='/rest/v1/pulse_workspaces')return Response.json([{id:wid,owner_id:owner}]);
  if(path==='/rest/v1/rpc/pulse_find_account')return Response.json({user_id:account,reserved:false});
  if(path==='/auth/v1/admin/users')return Response.json({id:member});
  if(path==='/rest/v1/pulse_memberships')return Response.json(q.includes('email=eq.')?existing:[]);
  throw new Error('unexpected path');
 }});
 const run=(body,headers={authorization:'Bearer user-jwt',origin:'https://pulse.example'})=>fn(new Request('https://test.invalid/',{method:'POST',headers,body:JSON.stringify({workspace_id:wid,...body})}));
 return {calls,run};
}
test('no token, wrong origin, unconfirmed and non-owner are denied before team mutations',async()=>{
 for(const [config,headers,status] of [[{}, {},401],[{}, {authorization:'Bearer jwt',origin:'https://evil.invalid'},403],[{confirmed:false},undefined,403],[{owner:member},undefined,403]]){
  const {calls,run}=rig(config),res=await run({action:'grant',email:'person@example.com'},headers);assert.equal(res.status,status);assert.ok(!calls.some(c=>c.path.includes('memberships')||c.path.includes('admin/users')));
 }
});
test('existing account grant is viewer-only and never alters auth or sends email',async()=>{
 const {calls,run}=rig();assert.equal((await run({action:'grant',email:' Person@Example.com ',role:'owner'})).status,200);
 const write=calls.find(c=>c.path.endsWith('pulse_memberships')&&c.options.method==='POST');const body=JSON.parse(write.options.body);
 assert.equal(body.role,'viewer');assert.equal(body.email,'person@example.com');assert.equal(body.granted_by,uid);assert.equal(body.workspace_id,wid);assert.ok(!calls.some(c=>c.path.includes('admin/users')||c.path.includes('invite')||c.path.includes('otp')));
});
test('new account stays unconfirmed and has no generated password',async()=>{
 const {calls,run}=rig({account:null});assert.equal((await run({action:'grant',email:'new@example.com'})).status,200);
 const body=JSON.parse(calls.find(c=>c.path==='/auth/v1/admin/users').options.body);assert.deepEqual(body,{email:'new@example.com',email_confirm:false});
});
test('repeated grant is idempotent; revocation targets only this workspace and never owner',async()=>{
 const {calls,run}=rig({existing:[{user_id:member,email:'person@example.com',revoked_at:null}]});assert.equal((await (await run({action:'grant',email:'person@example.com'})).json()).already_active,true);
 assert.ok(!calls.some(c=>c.options.method==='POST'));
 assert.equal((await run({action:'revoke',user_id:uid})).status,400);
 assert.equal((await run({action:'revoke',user_id:member})).status,200);
 const patch=calls.find(c=>c.options.method==='PATCH');assert.ok(patch.q.includes('workspace_id=eq.'+wid));assert.ok(patch.q.includes('user_id=eq.'+member));assert.ok(JSON.parse(patch.options.body).revoked_at);
});
