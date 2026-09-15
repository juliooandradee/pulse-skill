# Pulse · by julio andrade — demonstração 1.0.0

Revisão de 15/09/2026. A apresentação permanece **rascunho para revisão**, sem ativação de site público. O pacote da skill tem distribuição própria em [GitHub](https://github.com/juliooandradee/pulse-skill).

## Experiência

ECG animado, assinatura, Inter e paleta escura com alternância para o modo claro. O painel interativo apresenta Visão geral, Conteúdos, Comunidade, Pautas, Pessoas, Pulse News, Fontes e método e Admin.

Há filtros, busca, ordenação, capas, gráficos, comentários de posts variados e uma simulação do acompanhamento das propostas feitas. Os checks da demonstração persistem somente neste navegador e podem ser desfeitos. O formulário de equipe é uma simulação: não concede acesso nem envia mensagens.

O guia explica a montagem em quatro etapas e termina em **Copie esse prompt**, com instruções próprias para ChatGPT, ChatGPT Work, Codex e Claude Code. A instalação usa somente a pasta da skill, sem executar scripts ou instalar dependências. Montar o aplicativo e configurar acesso online são etapas posteriores.

## Dados e imagens

Indicadores, comentários, participantes e pautas são fictícios e estão identificados. As três capas são do criador e não representam os resultados ilustrativos mostrados ao lado. As fotografias do Pulse News são contextuais, licenciadas e creditadas; os cartões são exemplos de temas, não anúncios de notícias ou estudos específicos.

A página informa que a análise usa apenas informações públicas acessíveis, sem vincular, sincronizar ou fornecer senha do Instagram. Também informa lacunas possíveis, ausência de Insights privados e maior consumo de uso/créditos em análises extensas.

## Arquivos e validação

- `index.html`, `styles.css`, `release.css`: estrutura e apresentação.
- `app.js`, `release.js`: interações da demonstração.
- `content.js`: versão, links e prompts por ambiente.
- `assets/`: ECG, fontes, capas e fotografias com licença/créditos no repositório.

Conferidos em desktop e 390 px: oito abas, carregamento das três fotos de notícias, busca e ordenação, período ilustrativo, check/reabertura persistente, tema claro/escuro e cópia dos prompts. Sem transbordamento horizontal na página nas oito abas. O pacote do app e os limites da validação estão documentados em `../VALIDATION.md` no repositório público.

A pasta é independente do painel privado e não publica nem sincroniza a base de produção. Abra por um servidor local limitado a `127.0.0.1`. A prévia preparada para revisão usa a porta 8751.
