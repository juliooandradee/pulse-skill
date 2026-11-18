# Publicação oficial no Instagram

O Pulse publica pela [Instagram Content Publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing) da Meta, com Facebook Login for Business. Não há agendador de terceiros. Nada neste guia autoriza aplicar a migração nem publicar um post real: Júlio aprova antes de qualquer mudança no projeto `comunidade-ia-medicos` (`azbzjlkuohhmvucreltf`).

## O que já existia

- Fila `pulse_publication_jobs` com estado, horário, tentativas e trava (`lease_id`), hoje só para carrossel de 2 a 10 JPEG.
- Conexão Meta em cofre (Vault), estado de OAuth apagado no primeiro uso e funções `pulse-meta-connect` e `pulse-publisher`.
- No projeto ao vivo a conta @julioandrade.ia está conectada com `instagram_content_publish`, `instagram_basic`, `pages_show_list`, `pages_read_engagement` e `business_management`. Falta `instagram_manage_insights`.
- O agendador `pulse-publisher` já roda a cada minuto. O schema privado nesse projeto chama-se `gravity_private` (no pacote da skill é `pulse_private`). As imagens do carrossel estão no bucket `gravity-private`; Reels avulsos usavam o bucket `pulse-reels` e a função `pulse-reels`, fora deste repositório.

## O que esta entrega acrescenta

- A mesma fila passa a aceitar `image`, `carousel` e `reel`, com legenda gravada no item.
- A migração `20261118120000_pulse_instagram_pipeline.sql` pode rodar duas vezes. Ela não escreve em `gravity_*`.
- O login pede também `instagram_manage_insights`. Sem essa permissão a publicação continua; o retorno avisa em português.
- Insights oficiais (alcance, salvamentos, compartilhamentos, comentários, curtidas e reproduções) vão para `pulse_media_insights`. Métrica ausente fica nula.
- CLI `assets/agent/instagram-cli.mjs` para o agente: `setup`, `connect`, `publish`, `schedule`, `list`, `cancel`, `insights`. O fuso padrão é `America/Maceio`.

## Instalar a Supabase CLI

Mac:

```bash
brew install supabase/tap/supabase
supabase --version
```

Windows (PowerShell), com [Scoop](https://scoop.sh/):

```powershell
scoop bucket add supabase https://github.com/supabase/scoop-bucket
scoop install supabase
supabase --version
```

Sem Scoop, baixe o instalador em [supabase.com/docs/guides/local-development/cli/getting-started](https://supabase.com/docs/guides/local-development/cli/getting-started).

Entre e aponte para o projeto **somente quando Júlio autorizar**:

```bash
supabase login
supabase link --project-ref azbzjlkuohhmvucreltf
```

Não rode `supabase db push`, `supabase functions deploy` nem publique na Meta a partir deste agente.

## Segredos

Copie `assets/.env.example` para `assets/.env` na sua máquina. Não commite o arquivo preenchido.

No servidor, os segredos das funções (nunca no git):

| Nome | Uso |
| --- | --- |
| `PULSE_META_APP_ID` | App Meta |
| `PULSE_META_APP_SECRET` | Segredo do app |
| `PULSE_META_CONFIG_ID` | ID da configuração de Facebook Login for Business |
| `PULSE_META_REDIRECT_URI` | `https://azbzjlkuohhmvucreltf.supabase.co/functions/v1/pulse-meta-connect` |
| `PULSE_META_GRAPH_VERSION` | `v26.0`, ou a versão validada no app |
| `PULSE_MEDIA_BUCKET` | No projeto ao vivo, `gravity-private` para imagens. Reels podem usar `--bucket pulse-reels` |

A migração, se o agendador antigo já tiver a URL do projeto, guarda essa URL no Vault com o nome `pulse_functions_base_url`. Em um projeto novo:

```sql
select vault.create_secret('https://SEU_PROJETO.supabase.co', 'pulse_functions_base_url', 'URL do projeto usada pelo agendador do Pulse');
```

O segredo `pulse_publisher_cron_secret` já existe no projeto ao vivo. Não o copie para o chat.

## O que Júlio faz na Meta

1. Abra [developers.facebook.com](https://developers.facebook.com/) no app que o Pulse já usa (o mesmo de `PULSE_META_APP_ID`).
2. Confirme o produto **Facebook Login for Business** e a **Instagram API with Facebook Login**. O Instagram de @julioandrade.ia precisa continuar profissional e ligado a uma Página do Facebook.
3. Na configuração de login cujo ID está em `PULSE_META_CONFIG_ID`, inclua estas permissões: `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement`, `business_management`.
4. Em Facebook Login, a URI de redirecionamento válida é a de `PULSE_META_REDIRECT_URI` acima. Não use o domínio do site do Pulse no lugar da função.
5. **Revisão do app.** Publicar e ler Insights são permissões de acesso avançado. Se Júlio é administrador, desenvolvedor ou testador do app, ele pode conceder `instagram_manage_insights` na própria conta sem esperar a revisão, com o app em modo de desenvolvimento ou com papel no app. Se o app está **no ar** e outra pessoa for conectar uma conta, a Meta exige App Review para `instagram_content_publish` e `instagram_manage_insights`: envie o uso (o Pulse mostra alcance, salvamentos e reproduções do próprio perfil) e espere a aprovação. Até lá, só contas com papel no app completam o login com Insights.
6. Reconecte. O token atual publica, mas não lê Insights. No computador, com `assets/.env` preenchido:

```bash
node assets/agent/instagram-cli.mjs connect --account principal
```

Abra o endereço uma vez. O estado expira em 30 minutos e não serve de novo. Se o retorno disser que Insights não veio, a permissão não estava na configuração da Meta.

7. Não informe senha do Instagram, token ou `service_role` no chat.

## Comandos do agente

Na pasta `pulse/`:

```bash
node assets/agent/instagram-cli.mjs help
node assets/agent/instagram-cli.mjs setup
node assets/agent/instagram-cli.mjs publish --type image --caption "Legenda" --file capa.jpg
node assets/agent/instagram-cli.mjs schedule --type reel --caption "Legenda" --file video.mp4 --at "2026-11-20 09:00"
node assets/agent/instagram-cli.mjs list
node assets/agent/instagram-cli.mjs cancel --job UUID
node assets/agent/instagram-cli.mjs insights
```

`schedule` sem `--tz` usa `America/Maceio`. `publish` enfileira para agora e acorda a função; o cron de cada minuto também acorda. Um item com trava não é publicado duas vezes. Cancelar só vale antes de a publicação começar.

## Testes locais

Não apontam para o projeto de produção.

```bash
node --test assets/agent/instagram-cli.test.mjs assets/backend/functions/pulse-publisher/handler.test.mjs assets/backend/functions/pulse-meta-connect/handler.test.mjs
deno check assets/backend/functions/pulse-publisher/index.ts assets/backend/functions/pulse-meta-connect/index.ts assets/backend/functions/local-run.ts
deno run assets/backend/functions/local-run.ts
bash assets/backend/local/run-tests.sh
```

O script SQL sobe um Postgres descartável, aplica a migração nova duas vezes e encerra o servidor.
