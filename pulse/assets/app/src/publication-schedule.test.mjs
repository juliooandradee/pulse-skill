import test from 'node:test';import assert from 'node:assert/strict';
import {captionCheck,assetPath,assetBatch,isLocked,jobDetail,CONNECTION_RESULTS} from './publication-schedule.mjs';

test('legenda mostra o trecho antes do "mais" e avisa limites do Instagram',()=>{
 const ok=captionCheck('Comenta GUIA que eu te mando o material.\n\nResto da legenda.');
 assert.equal(ok.warnings.length,0);assert.ok(ok.preview.startsWith('Comenta GUIA'));
 const long=captionCheck('x'.repeat(130)+' '+Array.from({length:31},(_,i)=>'#tag'+i).join(' '));
 assert.equal(long.preview.length,126);assert.equal(long.hashtags,31);assert.equal(long.warnings.length,2);
});
test('caminho das imagens fica dentro do workspace, em publication/, com slide numerado',()=>{
 const batch=assetBatch();assert.match(batch,/^[a-z0-9]{6,32}$/);
 assert.equal(assetPath('ws','post','abc123',0),'ws/publication/post/abc123/slide-01.jpg');assert.equal(assetPath('ws','post','abc123',9),'ws/publication/post/abc123/slide-10.jpg');
});
test('post publicado ou publicando fica travado; detalhe mostra horário de Brasília',()=>{
 assert.ok(isLocked({state:'published'}));assert.ok(isLocked({state:'publishing'}));assert.ok(!isLocked({state:'scheduled'}));assert.ok(!isLocked(null));
 assert.match(jobDetail({state:'scheduled',scheduled_at:'2026-10-30T21:00:00Z'},()=>'30/10/2026 às 18:00'),/30\/10\/2026 às 18:00.*Brasília/);
 assert.equal(jobDetail({state:'failed',last_error:'Conecte de novo.'},String),'Conecte de novo.');
});
test('cada retorno da Meta tem uma mensagem',()=>{
 for(const code of ['conectado','cancelado','expirado','invalido','sem-conta','outra-conta','sem-permissao','conta-em-uso','erro-meta','erro'])assert.ok(CONNECTION_RESULTS[code]);
});
