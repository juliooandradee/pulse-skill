# Pulse · by julio andrade

Uma skill para transformar o histórico **público e acessível** de um perfil em um painel editorial: conteúdos, conversas, pessoas, notícias e próximas pautas.

**Não precisa vincular Instagram, sincronizar a conta ou fornecer senha.** A IA usa as publicações e os sinais que conseguir acessar publicamente. Não obtém Insights privados nem garante acesso a todo o histórico.

[**Explore a demonstração e copie o prompt de instalação**](https://pulse-julio-andrade.vercel.app/)

## Comece aqui

1. [Baixe a skill Pulse 1.0.0](https://github.com/juliooandradee/pulse-skill/releases/download/v1.0.0/pulse-v1.0.0.zip), ou use a [pasta `pulse/` na revisão fixa](https://github.com/juliooandradee/pulse-skill/tree/7ce85c2877acca7a79f4720128eb6dc92f7c074e/pulse).
2. Escolha sua ferramenta abaixo. Instale **somente a pasta `pulse`**. Confira origem, revisão e destino; preserve versões existentes. Não execute scripts nem instale dependências/plugins durante a instalação.
3. Informe seu @ público, objetivo, período e identidade visual. Comece com uma amostra e revise o que a IA encontrou.
4. Monte o painel local com a IA. Login para equipe, hospedagem e atualização semanal são etapas opcionais posteriores.

| Ambiente | Como começar |
| --- | --- |
| ChatGPT Codex | Peça ao `$skill-installer` para instalar `pulse/` desta release. Depois use `$pulse`. |
| Claude Code | Copie `pulse/` para `.claude/skills/pulse/` no projeto. Depois use `/pulse`. |
| ChatGPT Work | Forneça a release/ZIP, confira se a interface permite instalar skill avulsa e use `@pulse` quando instalada. Se não permitir, o pacote pode orientar essa tarefa como referência, sem instalação persistente. |
| ChatGPT | Faça o diagnóstico e planeje as pautas. Para construir/validar o app, use Work, Codex ou outro ambiente com arquivos, código e navegação disponíveis. |

[Passo a passo por ferramenta](pulse/references/installation.md) · [O que a análise pública vê](pulse/references/public-analysis.md)

## O que acompanha a skill

- Código do dashboard com modo escuro/claro, ECG animado e assinatura.
- Conteúdos com capas, busca, filtros, métricas disponíveis e fontes.
- Comentários de posts variados e participantes recorrentes, com foto pública quando disponível.
- Pulse News com imagens, fontes primárias, limites e conexão com o conteúdo do perfil.
- Pautas e recriações Reel ↔ carrossel, com **Proposta feita** e opção de desfazer.
- Preservação do histórico e dos checks durante atualizações incrementais.
- App local funcional com base vazia, importação e backup. Código opcional de login, Admin e acesso somente de leitura para uma equipe.

O [código do app](pulse/assets/app/) está incluído e compilado. Para começar localmente, peça à IA para abrir essa pasta em um servidor limitado a `127.0.0.1`; não publique o modo local com dados reais. Se quiser trabalhar em equipe pela internet, siga o [guia de acesso privado](pulse/references/private-access.md) para configurar seu próprio destino. Não há backend ou conta compartilhada incluídos.

## Planos e consumo

A skill não inclui créditos de IA. A primeira coleta pode exigir bastante leitura de posts, imagens e comentários, consumindo mais uso que uma conversa curta. O gasto depende do modelo, do plano e do volume; não existe preço fixo por perfil. Comece em lotes pequenos e atualize só o que mudou.

ChatGPT Work e Codex compartilham uso segundo a [documentação da OpenAI](https://learn.chatgpt.com/docs/pricing). No Claude Code, confira os [limites e custos da sua conta](https://code.claude.com/docs/en/costs). Recursos e disponibilidade podem variar. Hospedagem e banco opcionais podem ter custos próprios.

## Demonstração

`demo/` contém a apresentação visual e um painel interativo com **dados fictícios identificados**. A [demonstração pública](https://pulse-julio-andrade.vercel.app/) foi publicada após a aprovação de 15/09/2026. As capas do criador são imagens de demonstração, não dados de performance. Nenhum comentário real, foto de participante real, e-mail privado, senha, token ou base de produção faz parte do pacote.

## Origem e validação

Pulse 1.0.0 consolida a interface e o fluxo construídos para este projeto, com configuração própria para cada pessoa. A ideia inicial de dashboard orientado por skill foi inspirada no [Gravity Blueprint de Paulo](https://github.com/paulofai/gravity-blueprint). Este pacote não copia ou redistribui os arquivos da skill Gravity Blueprint instalada.

O código e as instruções do Pulse estão sob MIT. Fontes e fotografias mantêm suas licenças: veja [créditos](THIRD_PARTY.md). A marca/assinatura identifica a origem, sem representar endosso a resultados ou perfis analisados.

Consulte [validação da release](VALIDATION.md). Os testes locais não substituem a verificação de login e permissões no seu próprio backend.

Revisão da skill 1.0.0: `7ce85c2877acca7a79f4720128eb6dc92f7c074e`. A demonstração e este guia podem receber ajustes sem alterar os arquivos fixados nessa versão.
