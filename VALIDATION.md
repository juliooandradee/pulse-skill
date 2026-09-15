# Validação · Pulse 1.0.0

Conferência em 15/09/2026. O pacote distribui código, instruções e um exemplo sintético. Não executa uma coleta por conta própria ao ser instalado.

## Conferido

- 27 testes Node passaram: variedade de comentários e pessoas; recuperação de imagens; persistência, falhas e concorrência dos checks; importação incremental sem perder evidências; validação de estruturas inválidas; regras do handler de acesso da equipe.
- App compilado com as dependências já existentes no ambiente. Nenhuma dependência foi instalada para preparar esta versão.
- Metadados da skill e interface OpenAI, links locais e arquivos de referência conferidos. Validação equivalente do frontmatter feita com o parser YAML disponível; o validador Python da skill-creator não foi executado por falta de PyYAML.
- App local aberto com a base vazia: dados desconhecidos permanecem ausentes. Cópia isolada com dados sintéticos validou as sete áreas, comentário de exemplo e recriação Reel → carrossel; check persistiu após recarregar e pôde ser desfeito.
- Demonstração conferida no Chrome em desktop e 390 px: oito abas, temas claro/escuro, filtros, busca, ordenação, período, cópia dos prompts e persistência dos checks. As três fotografias do Pulse News carregaram. Sem transbordamento horizontal externo nas oito abas.
- Origem das instruções de plataforma conferida na documentação oficial, citada no guia de instalação. Não foram instaladas cópias de teste em cada serviço.
- Distribuição separada dos dados privados, com exemplos fictícios. Manifesto SHA-256 lista os arquivos da pasta instalável.

## Limites

- A importação e mesclagem de JSON foram testadas em código. O seletor de upload do Chrome não pôde ser validado de ponta a ponta porque a extensão recusou acesso a arquivos locais. A configuração do navegador não foi alterada.
- Login e Admin online acompanham modelos de código. Nenhum novo backend foi provisionado; políticas SQL/RLS, storage e entrega de login precisam ser validados no destino de cada pessoa. Testes do handler usam respostas simuladas e não comprovam configuração real do servidor.
- O exemplo sintético comprova renderização e persistência local, não coleta de Instagram. Não há promessa de acesso a todo histórico, comentários, fotos ou métricas privadas.
- Instalar o pacote não programa atualizações, publica um app, conecta contas ou contrata serviços. A publicação original da skill no GitHub distribui os arquivos. A demonstração foi publicada posteriormente, após aprovação expressa, conforme o registro abaixo.

## Publicação da demonstração

Em 15/09/2026, após aprovação do criador, a página foi publicada em [https://pulse-julio-andrade.vercel.app/](https://pulse-julio-andrade.vercel.app/). Projeto Vercel `pulse-apresentacao`, diretório `demo/`, produção com estado READY. A interface pública abriu no Chrome; as três imagens do Pulse News carregaram e o botão de cópia apresentou sucesso com a revisão fixa da skill. Não há backend, variáveis de aplicação ou dados privados na página demonstrativa. O pacote fixado em 1.0.0 não foi alterado pela publicação da página.
