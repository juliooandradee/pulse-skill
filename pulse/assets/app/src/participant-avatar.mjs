export function renderParticipantAvatar(handle,profiles={},esc){
 const name=String(handle||'').replace(/^@/,'').toLowerCase();
 const valid=/^[a-z0-9._]{1,30}$/.test(name);
 const file=valid&&profiles&&Object.hasOwn(profiles,name)?profiles[name]?.photo_file:null;
 const safe=typeof file==='string'&&['jpg','jpeg','png','webp'].some(ext=>file===`brand/participants/${name}.${ext}`);
 return `<span class="participant-avatar" aria-hidden="true"><span class="avatar-initial">${esc(valid?name[0].toUpperCase():'?')}</span>${safe?`<img data-cover="${esc(file)}" data-avatar alt="" loading="lazy">`:''}</span>`;
}
