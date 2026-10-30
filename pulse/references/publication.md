# Planejamento e publicação · Pulse 2.0

O Pulse reúne calendário semanal e mensal, campanhas, responsáveis, etapas de produção, prévia do carrossel e resultados. A abertura é Visão geral; cada cartão abre a ficha do mesmo post.

## Comece localmente

Abra `assets/app/` em um servidor limitado a 127.0.0.1. Na aba Publicação, crie um post ou importe de 2 a 10 imagens JPEG, PNG ou WebP exportadas do Canva. Os nomes numerados determinam a ordem inicial; os botões de reordenar permitem ajustá-la. Os arquivos são convertidos em JPEG e a proporção precisa ser a mesma em todos os slides. Revise texto alternativo, fontes e legenda.

O modo local salva textos no navegador e imagens no IndexedDB. Ele não publica sozinho. Faça cópias dos pacotes editoriais e preserve os arquivos originais das imagens.

## Publicação online

1. Configure o backend privado da própria pessoa conforme `private-access.md`.
2. Revise e aplique as migrações em `assets/backend/migrations/` em ordem. Substitua `YOUR_PROJECT` nos agendadores e `your-app.example` nas funções pelo projeto e domínio autorizados. Crie as contas editoriais no próprio workspace; nenhum cadastro do criador acompanha o pacote.
3. Publique `pulse-meta-connect`, `pulse-publisher` e `pulse-editorial` com os arquivos `_shared`. Os handlers validam sua própria autenticação; não retire essa validação. Configure app, segredo, configuração do login e retorno da Meta no servidor.
4. Conecte a conta profissional pela tela oficial da Meta. Nunca solicite senha social ao agente. A autorização de publicação e as permissões para Insights podem ser diferentes; confira as permissões disponíveis e indique dados ausentes.
5. Revise a prévia e use Testar sem publicar. Só agende após autorização do dono para o conteúdo, conta e horário. Alterar a copy cancela o agendamento; uma publicação confirmada permanece travada.
6. Confira o ID e o permalink. Falha de resposta não autoriza repetir a publicação; use a reconciliação existente.

## CRM opcional

O adaptador NestJS em `assets/integrations/crm/` foi desenvolvido para o CRM IA para médicos. Registre o controller no módulo Instagram e configure `PULSE_BRIDGE_KEY` (segredo aleatório de 64 caracteres) e `PULSE_BRIDGE_ACCOUNT_ID` no servidor do CRM. Configure a URL HTTPS e a mesma chave no Vault do Pulse através de `pulse_crm_configure`, somente pelo servidor. O adaptador permite apenas uma conta; não devolve contatos ou conversas.

O usuário escolhe um modelo antes de agendar. Depois que a Meta confirma o post, o CRM cria uma cópia específica; tentativas repetidas devolvem o mesmo vínculo. Uma automação pausada não é reativada por uma repetição. O fluxo anterior é preservado. Confira envio real de DM separadamente da simulação e da ativação.

## Trabalhar com o agente

`assets/agent/pulse-editorial.mjs` oferece os comandos `list`, `save`, `templates`, `results` e `schedule`. `publish-external.mjs` importa imagens e testa ou agenda. Esses comandos exigem configuração local do servidor, fora do repositório. A chave privilegiada não deve ser enviada ao chat nem ao navegador. A instalação da skill não executa esses comandos nem autoriza publicar.

Ao preparar um post, mantenha seu ID e sua revisão. Grave campanha, responsável, data e modelo em `origin.planning`. Confira a prévia e obtenha a autorização aplicável antes de usar o comando de agendamento. O pacote de agendamento deve conter `id`, `revision`, `scheduled_at` com fuso e `approved: true`.

Para os comandos locais, crie `assets/.env` fora do controle de versão com `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `PULSE_APP_URL`. Use a chave da conta editorial configurada (exemplo: `node assets/agent/pulse-editorial.mjs list principal`). O importador `publish-external.mjs` usa o conversor `sips` do macOS; em outros sistemas, prefira a importação pelo navegador ou implemente um conversor equivalente.
