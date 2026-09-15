const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function makeHandler({url,key,origin:ORIGIN='https://pulse.example',fetcher=fetch}){
 return async function handle(req){
  const origin=req.headers.get('origin');
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',...(origin===ORIGIN?{'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'}:{})};
  const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
  if(origin&&origin!==ORIGIN)return reply({error:'Origem não permitida.'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply({error:'Método não permitido.'},405);
  const authorization=req.headers.get('authorization')||'';
  if(!authorization.startsWith('Bearer ')||authorization==='Bearer '+key)return reply({error:'Entre novamente no Pulse.'},401);
  async function api(path,{body,method,asUser=false}={}){
   const res=await fetcher(url+path,{method:method||(body?'POST':'GET'),headers:{apikey:key,Authorization:asUser?authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=representation'},...(body?{body:JSON.stringify(body)}:{})});
   const data=await res.json().catch(()=>null);
   if(!res.ok)throw Object.assign(new Error('Falha ao salvar. Recarregue a lista antes de tentar novamente.'),{status:res.status});
   return data;
  }
  try{
   let user;try{user=await api('/auth/v1/user',{asUser:true});}catch{return reply({error:'Entre novamente no Pulse.'},401);}
   if(!user?.id||!user.email_confirmed_at||user.is_anonymous)return reply({error:'Confirme seu e-mail para continuar.'},403);
   const raw=await req.text();if(raw.length>2048)return reply({error:'Solicitação muito grande.'},413);
   let body;try{body=JSON.parse(raw);}catch{return reply({error:'Solicitação inválida.'},400);}
   if(!UUID.test(body.workspace_id||''))return reply({error:'Espaço inválido.'},400);
   const work=(await api('/rest/v1/pulse_workspaces?select=id,owner_id&id=eq.'+body.workspace_id))[0];
   if(!work||work.owner_id!==user.id)return reply({error:'Somente o proprietário pode gerenciar acessos.'},403);
   const base='/rest/v1/pulse_memberships?workspace_id=eq.'+work.id;
   if(body.action==='list')return reply({members:await api(base+'&select=user_id,email,role,granted_at,revoked_at&order=granted_at.desc')});
   if(body.action==='grant'){
    const email=String(body.email||'').trim().toLowerCase();
    if(email.length>254||!EMAIL.test(email))return reply({error:'Informe um e-mail válido.'},400);
    const existing=await api(base+'&select=user_id,email,role,granted_at,revoked_at&email=eq.'+encodeURIComponent(email));
    if(existing[0]&&!existing[0].revoked_at)return reply({member:existing[0],already_active:true});
    const active=await api(base+'&select=user_id&revoked_at=is.null');
    if(active.length>=100)return reply({error:'O limite de 100 acessos foi atingido.'},409);
    let account=await api('/rest/v1/rpc/pulse_find_account',{body:{target_email:email}});
    if(account.user_id===user.id)return reply({error:'Sua conta já é a proprietária deste Pulse.'},409);
    if(!account.user_id){
     if(account.reserved)return reply({error:'Esta conta reservada precisa ser revisada pelo administrador.'},409);
     // No temporary password and no outgoing email. The member requests their own sign-in link.
     try{const created=await api('/auth/v1/admin/users',{body:{email,email_confirm:false}});account.user_id=created.id;}catch(error){
      account=await api('/rest/v1/rpc/pulse_find_account',{body:{target_email:email}});if(!account.user_id)throw error;
     }
    }
    if(!UUID.test(account.user_id||''))throw new Error('Não foi possível preparar a conta.');
    // Merge only the membership in this workspace; never change unrelated account permissions.
    const row={workspace_id:work.id,user_id:account.user_id,email,role:'viewer',granted_by:user.id,granted_at:new Date().toISOString(),revoked_at:null,revoked_by:null};
    if(existing[0]){
     if(existing[0].user_id!==account.user_id)return reply({error:'O e-mail mudou de conta. Revise este acesso antes de liberar.'},409);
     await api(base+'&user_id=eq.'+account.user_id,{method:'PATCH',body:row});
    }else{
     try{await api('/rest/v1/pulse_memberships',{body:row});}catch(error){
      const current=await api(base+'&select=user_id,revoked_at&email=eq.'+encodeURIComponent(email));
      if(!current[0]||current[0].revoked_at||current[0].user_id!==account.user_id)throw error;
     }
    }
    return reply({ok:true,message:'Acesso de visualização liberado. Compartilhe o endereço do Pulse com a pessoa.'});
   }
   if(body.action==='revoke'){
    if(!UUID.test(body.user_id||'')||body.user_id===work.owner_id)return reply({error:'Este acesso não pode ser removido.'},400);
    const changed=await api(base+'&user_id=eq.'+body.user_id+'&revoked_at=is.null',{method:'PATCH',body:{revoked_at:new Date().toISOString(),revoked_by:user.id}});
    return reply({ok:true,changed:changed.length>0});
   }
   return reply({error:'Ação inválida.'},400);
  }catch{return reply({error:'Não foi possível concluir. Atualize a lista para conferir o estado do acesso.'},500);}
 };
}
