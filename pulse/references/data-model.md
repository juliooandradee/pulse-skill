# Dados do aplicativo

O modelo vazio executável está em `assets/app/src/data.mjs`. O agente o preenche com evidências do usuário e preserva uma cópia bruta separada. O arquivo importável no app é JSON com os mesmos campos; não contém código. O perfil identifica o espaço local. Não reutilize o mesmo identificador para duas pessoas.

## Listas e identificadores

- `observations`: `content_id`, `url`, `title`, `caption`, `published_at`, `format` (`reel`, `carrossel`, `imagem`), `candidate_line`, `cover_file`, `source_file`, `review_status`, `is_paid`, `has_comment_automation`. Use desconhecido quando não revisado.
- `metrics`: `content_id`, `observed_at`, `views`, `views_approximate`, `likes`, `comments`, `shares`, `saves`, `source_file`, `method`. Métricas indisponíveis são `null` ou ausentes. Campos privados opcionais exigem fonte fornecida pelo usuário; nunca estimar.
- `community_comments`: `comment_id`, `content_id`, `author_handle`, `comment_text`, `like_count`, `reply_count_reported`, `signal_type`, `theme`, `is_substantive`, `is_cta_like`, `is_creator_reply`, `source_file`, `observed_at`. IDs vindos da interface ou hash estável de post/autor/texto; não usar posição da lista como identidade.
- `participant_profiles`: mapa por handle; cada entrada contém `photo_file` em `brand/participants/`, origem e data. Conferir a propriedade esperada pelo renderizador `participant-avatar.mjs` ao adaptar os dados. Não atribuir fotos ilustrativas a participantes reais.
- `ideas`: `id`, `kind`, `format`, `title`, `angle`, `evidence`, `post_ids`, `source_ids`, opcionalmente `comment_ids`. `kind: "Recriação de post"` habilita a apresentação do formato de origem/destino. Não incluir `completed` nos dados editoriais.
- `sources`: `id`, `title`, `url`, `publisher`, `published_at`, `summary`, `status`, `limitation`.
- `source_catalog`: `id`, `name`, `url`, `kind`, `focus`, `role`.
- `curation.editions`: `edition_date`, `window`, `items`. Cada notícia tem `id`, `title`, `url`, `publisher`, `published_at`, `topic`, `summary`, `evidence_type`, `limitation`, `read_scope`, `why_relevant`, `suggested_angle`, `format`, `post_ids` e `image`. Confira os nomes de apresentação em `curation.mjs` antes de importar.
- `editorial_analysis.recurring_patterns`: padrões com `id`, `title`, `opportunity`, `evidence` e `posts` com `content_id`, `url`, métricas observadas. Não substituir padrões anteriores em uma simples atualização.

## Arquivos visuais e cobertura

`brand_file` é opcional e aponta para o manual fornecido pela pessoa em `brand/`. Sem esse arquivo, não há botão de abertura.

`cover_file`: `brand/capas/<id>.jpg`. Fotos: `brand/participants/<arquivo>.jpg`. Notícias: `brand/news/<arquivo>.jpg`, com `image.file`, `alt`, `credit`, `source_url`, `license` e `license_url`. O código contém carregamento sob demanda e recuperação de falhas. Use somente nomes seguros, sem caminhos para fora do projeto.

`coverage`: contagens realmente verificadas (posts, capas, datas, visualizações, comentários, mídia revisada), campos faltantes, universo conhecido e estado da classificação. Uma contagem calculável de uma base vazia é zero; o total desconhecido de um perfil é `null`.

`updated_at` deve ser a data/hora da última alteração real. `curation.last_run` descreve fontes consultadas, falhas e leitura parcial; `schedule_label` corresponde à agenda efetivamente configurada, ou manual.

## Persistência

Modo local: dataset e checks usam chaves distintas por perfil no armazenamento do navegador. Exportar backup antes de limpar dados do navegador ou mover de dispositivo. O backup contém `{dataset, checks}`. Para restaurar, peça à IA para extrair `dataset` em um JSON para a importação e restaurar `checks` somente mediante pedido explícito, nunca durante coleta automática. O seletor de importação recebe apenas o dataset, não o envelope completo do backup.

Modo privado com equipe: tabelas `pulse_workspaces`, `pulse_datasets`, `pulse_contents`, `pulse_comments`, `pulse_updates`, `pulse_memberships` e `pulse_idea_progress`. Os três SQLs em `assets/backend/` são modelos para **um projeto novo**, não scripts de instalação nem migrações para executar sobre o projeto de outra pessoa.
