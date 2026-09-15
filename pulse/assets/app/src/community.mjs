const number = value => Number.isFinite(value) ? value : -1;
export const byReaction = (a,b) => number(b.like_count)-number(a.like_count) || number(b.reply_count_reported)-number(a.reply_count_reported) || a.comment_id.localeCompare(b.comment_id);

// Each round contributes at most one comment per publication, without dropping records.
export function diversifyComments(comments) {
  const groups = new Map();
  for (const comment of [...comments].sort(byReaction)) {
    if (!groups.has(comment.content_id)) groups.set(comment.content_id, []);
    groups.get(comment.content_id).push(comment);
  }
  const buckets = [...groups.values()].sort((a,b)=>byReaction(a[0],b[0]));
  const result = [];
  for (let round=0; result.length<comments.length; round++) {
    for (const bucket of buckets) if (bucket[round]) result.push(bucket[round]);
  }
  return result;
}

export function rankParticipants(comments, {postId='', signal='all', sort='posts', query='', owner=''}={}) {
  const people = new Map(), seen = new Set();
  for (const comment of comments) {
    const handle = (comment.author_handle||'').replace(/^@/,'').toLowerCase();
    if (!/^[a-z0-9._]{1,30}$/.test(handle) || handle===owner.toLowerCase() || comment.is_creator_reply || seen.has(comment.comment_id)) continue;
    seen.add(comment.comment_id);
    if (postId && comment.content_id!==postId || signal==='substantive' && !comment.is_substantive || signal==='cta' && !comment.is_cta_like) continue;
    if (query && !handle.includes(query.replace(/^@/,'').toLowerCase().trim())) continue;
    if (!people.has(handle)) people.set(handle,{handle,total:0,substantive:0,cta:0,posts:new Set(),comments:[],last_date:null});
    const person=people.get(handle);
    person.total++;person.substantive+=Number(Boolean(comment.is_substantive));person.cta+=Number(Boolean(comment.is_cta_like));
    person.posts.add(comment.content_id);person.comments.push(comment);
    if (comment.published_at && (!person.last_date || comment.published_at>person.last_date)) person.last_date=comment.published_at;
  }
  const rows=[...people.values()].map(p=>({...p,post_count:p.posts.size,posts:[...p.posts],comments:p.comments.sort(byReaction)}));
  const score=p=>sort==='comments'?p.total:sort==='substantive'?p.substantive:p.post_count;
  return rows.sort((a,b)=>score(b)-score(a)||b.post_count-a.post_count||b.substantive-a.substantive||b.total-a.total||a.handle.localeCompare(b.handle));
}
