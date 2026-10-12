# Ritmo de apresentação

A implementação atual está descrita em [Continuidade, estados e áudio](chat-continuity.md).

A antiga pausa de apresentação de 800–1.500 ms e a preferência “Respostas imediatas” foram substituídas pela janela única de agrupamento no servidor, conforme o pedido posterior de continuidade e áudio. Não há uma segunda espera após a resposta do provedor. As antigas variáveis `VITE_CHAT_PRESENTATION_MIN_MS` e `VITE_CHAT_PRESENTATION_MAX_MS` não são usadas.

Os eventos históricos `ChatRhythm_paced_*` e `ChatRhythm_immediate_*` continuam aceitos pelo coletor para comparação com `ChatRhythm_grouped_*`. Não há resultados de usuários reais para a nova implementação local.
