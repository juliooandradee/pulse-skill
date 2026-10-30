// Automatic publishing helpers shared by the Publication tab. No network, no DOM.
export const JOB_LABELS={scheduled:'Agendado · publica sozinho',publishing:'Publicando agora',published:'Publicado no Instagram',failed:'Falhou · agende de novo',cancelled:'Agendamento cancelado'};
export const isLocked=job=>['publishing','published'].includes(job?.state);
const MORE_CUT=125;

// Result of the Meta authorization, sent back as ?meta=<code>.
export const CONNECTION_RESULTS={
 conectado:'Instagram conectado. Faça um teste sem publicar antes do primeiro agendamento.',
 cancelado:'A autorização foi cancelada na Meta. Nada mudou.',
 expirado:'O pedido de conexão expirou. Clique em Conectar Instagram de novo.',
 invalido:'O retorno da Meta veio incompleto. Clique em Conectar Instagram de novo.',
 'sem-conta':'A Meta aprovou, mas ainda não mostrou o @ compartilhado. Aguarde um minuto e clique em Retomar conexão; não precisa de novo SMS.',
 'outra-conta':'O @ compartilhado não é o desta conta. Conecte de novo e escolha o @ certo na tela da Meta.',
 'sem-permissao':'A permissão de publicar não foi concedida. Conecte de novo e aprove todas as permissões.',
 'conta-em-uso':'Esse Instagram já está conectado a outra conta do Pulse.',
 'erro-meta':'A Meta não confirmou a conexão. Tente de novo em alguns minutos.',
 erro:'Não foi possível salvar a conexão. Tente de novo.'
};

// Instagram shows about 125 characters before "mais": the call to action belongs there.
export function captionCheck(caption=''){
 const text=caption.trim(),firstLine=text.split('\n')[0]||'',hashtags=(text.match(/#[\p{L}\p{N}_]+/gu)||[]).length,mentions=(text.match(/@[A-Za-z0-9_.]+/g)||[]).length;
 const warnings=[];
 if(hashtags>30)warnings.push('Use no máximo 30 hashtags.');
 if(mentions>20)warnings.push('Use no máximo 20 menções.');
 if(firstLine.length>MORE_CUT)warnings.push('A primeira linha passa do "mais": deixe a chamada nos primeiros 125 caracteres.');
 return {preview:text.slice(0,MORE_CUT)+(text.length>MORE_CUT?'…':''),hashtags,warnings};
}

export const assetBatch=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
export const assetPath=(workspaceId,postId,batch,index)=>`${workspaceId}/publication/${postId}/${batch}/slide-${String(index+1).padStart(2,'0')}.jpg`;

export function jobDetail(job,format){
 if(!job)return '';
 if(job.state==='scheduled')return `Sai sozinho em ${format(job.scheduled_at)} (horário de Brasília). Editar o texto cancela o agendamento.`;
 if(job.state==='publishing')return 'O Instagram está recebendo as imagens. O link aparece aqui quando terminar.';
 if(job.state==='published')return job.published_at?`Publicado em ${format(job.published_at)}.`:'Publicado. O Instagram não devolveu o horário exato.';
 return job.last_error||'';
}
