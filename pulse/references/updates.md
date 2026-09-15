# Atualizações e propostas feitas

Antes de atualizar: ler a última conferência real, guardar cópia de trabalho e capturar os IDs de ideias e checks existentes. Preservar arquivos brutos imutáveis. Registrar acréscimos, correções, lacunas e falhas por fonte.

Uma atualização semanal deve cobrir desde a última rodada concluída, com pequena sobreposição para evitar perdas; deduplicar a sobreposição. Não refazer a análise integral a cada semana. Retomar registros parciais e evitar gerar a mesma ideia novamente.

## Recriações

Selecionar posts antigos com métricas públicas conhecidas e bons sinais relativos ao próprio perfil. Preferir variedade de temas e formatos; datas desconhecidas não comprovam que um post é antigo. Separar CTA de conversa espontânea. Um exemplo não serve como prova causal do que gerou resultado.

ID sugerido `remake-<post-id>-<formato-destino>`. Reel vira carrossel ou carrossel vira Reel. Mostrar capa, origem, métricas com data, motivo da seleção e transformação concreta: demonstração em passos, caso comentado, checklist etc. Não só trocar o rótulo do formato. Marcar a extensão da revisão antes de criar o roteiro final.

## Checks

Dataset editorial e progresso são separados. Na versão local, use armazenamento por workspace e permita exportar os checks; sincronização entre dispositivos requer backend. No modo de equipe, `pulse_idea_progress` guarda `workspace_id`, `idea_id`, `completed_at`, `completed_by`. Atualizador de conteúdo não escreve nessa tabela. Somente o proprietário marca/desfaz; viewer não altera.

Após atualização, compare a lista de IDs anteriores, ideias/edições preservadas e os checks. Uma nova marcação feita pela pessoa durante a coleta deve sobreviver. Nunca marcar ideias reais para testar: use dados sintéticos isolados.

## Agenda

Modo manual é suficiente para começar. Ao receber pedido de recorrência, usar o agendador disponível no ambiente, sem criar hooks ou cron de sistema como substituição silenciosa. Confirmar apenas campos essenciais ausentes: frequência, horário/fuso, fonte, escopo e destino autorizado. Uma agenda local depende do computador, app e pasta disponíveis. Instalar a skill não cria atualização contínua na nuvem.

Notificar apenas conteúdo útil novo, falha relevante ou decisão. Sem novidades, permanecer quieto. Registrar semanal no painel apenas se houver uma agenda semanal de fato configurada.
