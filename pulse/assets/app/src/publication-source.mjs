const sourceLinks = rows => [...new Map(rows.filter(x => {
 try { return new URL(x.url).protocol === 'https:'; } catch { return false; }
}).map(x => [x.url, {url:x.url,label:x.label||'Fonte'}])).values()];

export function ideaPublicationSource(idea,{posts=[],sources=[]}={}) {
 return {
  id:idea.id,label:'Pautas do Pulse',title:idea.title,
  brief:[idea.angle,idea.evidence,idea.limitation].filter(Boolean).join('\n\n'),
  sources:sourceLinks([
   ...sources.filter(s=>(idea.source_ids||[]).includes(s.id)).map(s=>({url:s.url,label:s.publisher||s.title})),
   ...posts.filter(p=>(idea.post_ids||[]).includes(p.content_id)).map(p=>({url:p.url,label:'Post de origem: '+p.title}))
  ])
 };
}

export function newsPublicationSource(item) {
 return {
  id:item.id||item.url,label:'Pulse News',title:item.suggested_angle||item.title,
  brief:[item.summary,item.why_relevant,item.limitation].filter(Boolean).join('\n\n'),
  sources:sourceLinks([{url:item.url,label:item.publisher||item.title}])
 };
}
