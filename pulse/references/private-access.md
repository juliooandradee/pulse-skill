# Acesso privado opcional

O app local não solicita Instagram nem possui autenticação. Sirva somente em loopback (`127.0.0.1`) e use um navegador pessoal. Dados no armazenamento local não são um controle de acesso entre usuários da mesma máquina. Nunca publique o modo local com dados de participantes.

Para acesso online e equipe, o pacote inclui o código do login, Admin, permissões de leitura e checks separados. Ele exige configuração **no projeto da própria pessoa**. Instalar a skill não provisiona infraestrutura.

## Configuração pelo agente

1. Escolher o destino com a pessoa; verificar domínio, custos e recursos já existentes. Nunca reutilizar credenciais, IDs ou base do criador da skill.
2. Em um Supabase novo, revisar e aplicar `assets/backend/schema.sql`, `team-access.sql` e `idea-progress.sql`, nesta ordem. Os arquivos são modelos sem histórico de migração. Gerar migrações conforme o fluxo do projeto. Todos os dados ficam sob políticas de acesso; bucket `pulse-private` privado.
3. Criar o proprietário com e-mail confirmado usando o fluxo oficial. Criar `pulse_workspaces` com seu `owner_id`, handle e título; guardar o ID resultante. Não criar senha padrão ou acesso público.
4. `src/config.mjs`: definir `mode: 'cloud'`, URL Supabase, chave **publicável**, workspace e URL final do app. Chave privilegiada nunca aparece no frontend. O login é do Pulse, separado de redes sociais.
5. Configurar `pulse-team-admin` a partir de `assets/backend/functions/`, com `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `PULSE_APP_ORIGIN` apenas no servidor. O handler confere usuário, e-mail confirmado, origem e propriedade antes de conceder acesso. Não executar o deploy durante a instalação da skill. Validar a estratégia JWT com a versão atual do Supabase.
6. Configurar URLs de retorno e entrega de e-mail do próprio projeto; cadastro público desativado. O Admin permite conceder/revogar visualização. Não envia convite automaticamente; a pessoa pede seu próprio link de acesso. Envio de teste exige autorização.
7. Enviar dataset e imagens conferidos ao bucket privado sob `<workspace-id>/brand/...` e atualizar `pulse_datasets` com `dataset_key: 'dashboard'`. Importação editorial não escreve em `pulse_idea_progress`. Preservar brutos e histórico, comparar payload remoto e IDs anteriores.
8. Para recompilar, usar os pacotes já disponíveis ou preparar instalação separada das versões declaradas em `assets/app/package.json`. Nenhuma dependência é necessária para apenas copiar a skill. Se instalar pacotes posteriormente, revisar a origem, gerar lockfile e executar `npm run build` e os testes.
9. Publicar somente arquivos estáticos do modo cloud; nunca dados privados, `.env`, fontes brutas, backups ou chaves privilegiadas. Configurar CSP para o domínio Supabase efetivo, cabeçalhos de segurança, links HTTPS e cache apropriado.

## Verificação que permite declarar pronto

Testar usuário anônimo bloqueado, proprietário, viewer, workspace diferente, permissão de escrita negada ao viewer, Admin e revogação. Asserções de handler estão no pacote; políticas devem ser testadas no banco de destino com rollback. Nenhuma nova base remota foi provisionada para a release do template.

Conferir login/logout, retorno do link, capas assinadas após expiração, recuperação de rede, foto ausente e preservação dos checks após sincronizar. A revogação bloqueia novas consultas; conteúdo já lido não pode ser recolhido e links assinados ainda duram até sua expiração.

Guias oficiais: [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Storage privado](https://supabase.com/docs/guides/storage/security/access-control). Validar documentação atual antes de aplicar o modelo.
