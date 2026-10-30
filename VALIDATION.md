# Validação · Pulse 2.0.0

Conferência em 30/10/2026. O pacote contém código e instruções, com a base local vazia. Instalar a skill não conecta contas nem publica conteúdo.

## Conferido nesta versão

- 66 testes Node passaram no pacote: planejamento, datas no fuso de São Paulo, filtros, métricas ausentes, autenticação, Meta, publicação e reconciliação sem duplicação, além dos testes existentes de dados e equipe. Execução limitada a três processos.
- App compilado com as versões declaradas no lockfile. Interface local aberta no navegador, com calendário, etapas, biblioteca e publicação desabilitada até configurar uma conexão própria.
- Migrações editoriais aplicadas em Postgres temporário usando os modelos genéricos do pacote. Testes de proprietário, viewer, visitante, isolamento, revisão concorrente, histórico, agendamento, conexão e publicação passaram; servidor de teste encerrado ao final. Vault, Auth e Storage foram simulados nesse banco local.
- Na instalação privada do criador, o backend e o dashboard foram publicados. A Meta aceitou três imagens e legenda no teste real sem chamar a publicação. O Pulse consultou os modelos do CRM por uma conexão do servidor.
- O adaptador do CRM passou em cinco testes de autenticação, restrição por conta e vínculo repetido. O build do CRM passou. A página protegida da solução passou nos sete testes de acesso e segurança.
- O pacote público usa configurações próprias, sem tokens, contas editoriais pré-cadastradas ou dados do workspace privado. O manifesto SHA-256 identifica os arquivos instaláveis.

## Cobertura e limites

- O botão do Canva recebe as imagens exportadas, de duas a dez páginas. Não é uma conexão direta com a API do Canva.
- O modo local guarda textos no navegador e imagens no IndexedDB; faça backup dos pacotes editoriais e preserve as imagens originais. Publicação, coleta automática e CRM exigem configurar o backend da própria pessoa.
- O teste real da Meta validou a preparação do carrossel. Nenhum novo post de teste foi publicado; ativação de um fluxo não comprova entrega de DM.
- Insights dependem das permissões da Meta. Valores ausentes são exibidos como indisponíveis, sem serem convertidos em zero. Os comandos de atualização trabalham em lotes.
- O adaptador CRM é opcional e específico para o módulo Instagram do CRM IA para médicos. Não se conecta automaticamente a outros produtos.
- Os testes locais de SQL usam interfaces simuladas de Supabase. Cada destino deve validar suas políticas, URLs de retorno, segredos, serviços de agendamento e permissões Meta antes de ativar publicações.

A demonstração pública em `demo/` contém dados fictícios. A versão anterior v1.0.0 permanece disponível no histórico do GitHub.
