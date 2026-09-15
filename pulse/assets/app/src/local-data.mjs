const listKeys={observations:'content_id',metrics:'content_id',community_comments:'comment_id',ideas:'id',sources:'id',source_catalog:'id'};
export function validateDataset(data){
 if(!data||typeof data!=='object'||Array.isArray(data)||!/^[@\w.-]{1,80}$/.test(data.profile||''))throw new Error('Informe um perfil válido no arquivo.');
 for(const [key,id] of Object.entries(listKeys)){
  if(!Array.isArray(data[key]))throw new Error('Lista ausente: '+key);
  const seen=new Set();for(const row of data[key]){if(!row||typeof row[id]!=='string'||!row[id]||seen.has(row[id]))throw new Error('Identificador ausente ou repetido em '+key);seen.add(row[id]);}
 }
 const posts=new Set(data.observations.map(x=>x.content_id));
 for(const row of [...data.metrics,...data.community_comments])if(!posts.has(row.content_id))throw new Error('Registro sem publicação de origem.');
 for(const row of data.metrics)for(const key of ['views','likes','comments','shares','saves'])if(row[key]!=null&&(!Number.isFinite(row[key])||row[key]<0))throw new Error('Métrica inválida: '+key);
 if(!data.coverage||typeof data.coverage!=='object')throw new Error('Informe a cobertura da coleta.');
 const record=x=>x&&typeof x==='object'&&!Array.isArray(x);
 const unique=(rows,key,label)=>{if(!Array.isArray(rows))throw new Error('Lista inválida: '+label);const seen=new Set();for(const row of rows){if(!record(row)||typeof row[key]!=='string'||!row[key]||seen.has(row[key]))throw new Error('Identificador inválido em '+label);seen.add(row[key]);}};
 for(const key of ['coverage','account','profile_snapshot','participant_profiles','curation','editorial_analysis'])if(data[key]!=null&&!record(data[key]))throw new Error('Objeto inválido: '+key);
 if(data.taxonomy!=null&&(!Array.isArray(data.taxonomy)||data.taxonomy.some(x=>typeof x!=='string')))throw new Error('Linhas editoriais inválidas.');
 for(const key of ['observations','metrics','community_comments','ideas','sources','source_catalog'])for(const row of data[key]){
  for(const field of ['published_at','observed_at','edition_date'])if(row[field]!=null&&(typeof row[field]!=='string'||!/^\d{4}-\d{2}-\d{2}(T[\d:.+Z-]+)?$/.test(row[field])))throw new Error('Data inválida: '+field);
  for(const field of ['post_ids','source_ids','comment_ids'])if(row[field]!=null&&(!Array.isArray(row[field])||row[field].some(x=>typeof x!=='string')))throw new Error('Referências inválidas: '+field);
 }
 if(data.curation?.editions!=null){unique(data.curation.editions,'edition_date','edições');for(const edition of data.curation.editions){if(!/^\d{4}-\d{2}-\d{2}$/.test(edition.edition_date))throw new Error('Data de edição inválida.');unique(edition.items,'id','notícias');}}
 if(data.editorial_analysis?.recurring_patterns!=null){unique(data.editorial_analysis.recurring_patterns,'id','padrões');for(const pattern of data.editorial_analysis.recurring_patterns)if(pattern.posts!=null&&!Array.isArray(pattern.posts))throw new Error('Publicações do padrão inválidas.');}
 return data;
}
export function mergeDatasets(previous,incoming){
 validateDataset(incoming);
 if(previous.profile!==incoming.profile)throw new Error('Este arquivo pertence a outro perfil. Use outro projeto.');
 const merged={...previous,...incoming};
 for(const [key,id] of Object.entries(listKeys)){
  const rows=new Map((previous[key]||[]).map(row=>[row[id],row]));
  for(const row of incoming[key]){const old=rows.get(row[id]);const values=old?Object.fromEntries(Object.entries(row).filter(([k,v])=>v!=null||old[k]==null)):row;rows.set(row[id],{...old,...values});}
  merged[key]=[...rows.values()];
 }
 merged.participant_profiles={...previous.participant_profiles,...incoming.participant_profiles};
 const editions=new Map((previous.curation?.editions||[]).map(e=>[e.edition_date,e]));
 for(const e of incoming.curation?.editions||[]){const old=editions.get(e.edition_date);if(old){const items=new Map(old.items.map(i=>[i.id,i]));for(const item of e.items)items.set(item.id,item);editions.set(e.edition_date,{...old,...e,items:[...items.values()]});}else editions.set(e.edition_date,e);}
 merged.curation={...previous.curation,...incoming.curation,editions:[...editions.values()]};
 const patterns=new Map((previous.editorial_analysis?.recurring_patterns||[]).map(x=>[x.id,x]));
 for(const x of incoming.editorial_analysis?.recurring_patterns||[])patterns.set(x.id,x);
 merged.editorial_analysis={...previous.editorial_analysis,...incoming.editorial_analysis,recurring_patterns:[...patterns.values()]};
 merged.coverage={...previous.coverage,...incoming.coverage,inventoried_posts:merged.observations.length,
  dates_known:merged.observations.filter(x=>x.published_at).length,posts_with_covers:merged.observations.filter(x=>x.cover_file).length,
  posts_with_views:merged.metrics.filter(x=>Number.isFinite(x.views)).length,comments_catalogued:merged.community_comments.length,
  posts_with_catalogued_comments:new Set(merged.community_comments.map(x=>x.content_id)).size};
 return merged;
}
