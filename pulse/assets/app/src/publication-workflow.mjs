// Shared editorial contract. Persistence and actor identity belong to the server.
export const TIME_ZONE = 'America/Sao_Paulo';
export const LABELS = {draft:'Rascunho',review:'Em revisão',approved:'Aprovado',scheduled:'Agendado',publishing:'Publicando',published:'Publicado',reconcile:'Conferir publicação',failed:'Falhou',cancelled:'Cancelado'};
export function assert(value,message){if(!value)throw new Error(message);}
export function scope(account,actor,capability){
 assert(account && actor?.id,'Conta e usuário são obrigatórios.');
 const role=account.ownerId===actor.id?'owner':account.members?.find(m=>m.userId===actor.id&&!m.revoked)?.role;
 const allowed={read:['owner','publisher','editor','viewer'],edit:['owner','publisher','editor'],publish:['owner','publisher']};
 assert(allowed[capability]?.includes(role),'Você não tem permissão nesta conta.');
}
export function normalizeContent(input){
 assert(typeof input?.title==='string'&&input.title.trim().length>0&&input.title.length<=160,'Informe um título de até 160 caracteres.');
 assert(typeof input.caption==='string'&&input.caption.trim().length>0&&input.caption.length<=2200,'A legenda deve ter de 1 a 2.200 caracteres.');
 assert(Array.isArray(input.slides)&&input.slides.length>=2&&input.slides.length<=10,'O piloto aceita de 2 a 10 slides.');
 const slides=input.slides.map((s,i)=>{
  assert(typeof s.headline==='string'&&s.headline.length>0&&s.headline.length<=120,`Revise o título do slide ${i+1}.`);
  assert(typeof s.body==='string'&&s.body.length<=600,`Revise o texto do slide ${i+1}.`);
  assert(typeof s.alt==='string'&&s.alt.trim(),`Falta texto alternativo no slide ${i+1}.`);
  return {headline:s.headline.trim(),body:s.body.trim(),alt:s.alt.trim(),image:s.image||null,credit:s.credit||null};
 });
 const sources=(input.sources||[]).map(s=>{assert(typeof s.url==='string'&&/^https:\/\//.test(s.url),'Use a URL HTTPS da fonte.');return {url:s.url,label:String(s.label||''),checkedAt:s.checkedAt||null};});
 assert(sources.length>0,'Inclua ao menos uma fonte.');
 return {title:input.title.trim(),caption:input.caption.trim(),slides,sources,kind:input.kind||'news',visualVersion:input.visualVersion||'pulse-editorial-v2'};
}
export function createDraft({id,accountId,content,actor,account,now=new Date().toISOString()}){
 scope(account,actor,'edit');assert(account.id===accountId,'Conta divergente.');
 return {id,accountId,content:normalizeContent(content),revision:1,status:'draft',approval:null,schedule:null,media:null,assets:[],createdBy:actor.id,createdAt:now,updatedAt:now,history:[{action:'created',actorId:actor.id,at:now,revision:1}]};
}
export function transition(post,{action,expectedRevision,content,assets,scheduledAt,actor,account,now=new Date().toISOString()}){
 scope(account,actor,['approve','schedule','cancel'].includes(action)?'publish':'edit');
 assert(post.accountId===account.id,'Publicação de outra conta.');
 assert(post.revision===expectedRevision,'A versão mudou. Reabra a prévia antes de continuar.');
 const p=structuredClone(post);
 assert(!['publishing','published','reconcile'].includes(p.status),'Publicação em andamento ou concluída: consulte o resultado antes de alterar.');
 if(action==='edit'){
  assert(p.status!=='scheduled','Cancele o agendamento antes de editar.');
  p.content=normalizeContent(content);p.revision++;p.approval=null;p.schedule=null;p.assets=[];p.status='draft';
 }else if(action==='assets'){
  assert(['draft','review'].includes(p.status),'Altere a versão antes de trocar os arquivos aprovados.');
  assert(Array.isArray(assets)&&assets.length===p.content.slides.length,'Falta exportar algum slide.');
  for(const a of assets)assert(/^https:\/\//.test(a.url)&&/^[a-f0-9]{64}$/.test(a.sha256)&&a.mime==='image/jpeg'&&a.width===1080&&a.height===1350,'Use JPEG 1080 × 1350 com URL HTTPS e hash SHA-256.');
  p.assets=structuredClone(assets);p.revision++;p.approval=null;p.status='review';
 }else if(action==='review'){
  assert(p.status==='draft','Envie um rascunho para revisão.');p.status='review';
 }else if(action==='approve'){
  assert(p.status==='review','Abra a versão em revisão antes de aprovar.');
  assert(p.assets.length===p.content.slides.length,'Exporte e confira os slides finais antes de aprovar.');
  p.status='approved';p.approval={revision:p.revision,actorId:actor.id,at:now};
 }else if(action==='schedule'){
  assert(p.status==='approved'&&p.approval?.revision===p.revision,'Aprovação da versão atual é obrigatória.');
  assert(account.connection?.status==='connected'&&account.connection?.igUserId,'Conecte a conta oficial do Instagram antes de agendar.');
  assert(account.connection.canPublish===true,'A conexão não tem permissão para publicar.');
  assert(/(?:Z|[+-]\d{2}:\d{2})$/.test(scheduledAt||'')&&Number.isFinite(Date.parse(scheduledAt))&&Date.parse(scheduledAt)>Date.parse(now),'Informe uma data futura com fuso horário.');
  p.schedule={at:new Date(scheduledAt).toISOString(),timeZone:TIME_ZONE,revision:p.revision,actorId:actor.id};p.status='scheduled';
 }else if(action==='cancel'){
  assert(['scheduled','approved','failed'].includes(p.status),'Não há agendamento para cancelar.');p.status='cancelled';p.schedule=null;p.approval=null;
 }else throw new Error('Ação desconhecida.');
 p.updatedAt=now;p.history.push({action,actorId:actor.id,at:now,revision:p.revision});return p;
}
export function toUtc(localDateTime){
 assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localDateTime),'Data inválida.');
 const stamp=new Date(localDateTime+'-03:00');assert(Number.isFinite(stamp.getTime()),'Data inválida.');
 const parts=new Intl.DateTimeFormat('sv-SE',{timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(stamp).replace(' ','T');
 assert(parts===localDateTime,'Data inexistente ou horário incompatível com São Paulo.');return stamp.toISOString();
}
export function metricValue(value){return Number.isFinite(value)?value:null;}
