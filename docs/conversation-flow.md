# Ritmo, contexto e continuidade das conversas

Implementação local em 11/10/2026. Sem publicação, push ou aplicação remota de migrações. Permanecem 12 mensagens gratuitas, preços R$ 23,85 / R$ 48,85, preferências fictícias estáveis e memória opcional. A alteração preexistente em `CheckoutSections.jsx` foi preservada.

## Alterações

Reorganizei a montagem do prompt em regras fixas, voz, gostos/opiniões, diálogo, contexto e mídia/cobrança. Removi repetições sobre entusiasmo, perguntas e apresentação e a antiga sugestão de usar “Oi, amor” automaticamente na primeira resposta. Preferências atuais e o momento modulam a forma de falar sem trocar os gostos da personagem. As orientações de voz agora omitem instruções genéricas de dimensões neutras, conservando as diferenças relevantes do perfil.

`api/_lib/dialogue.js` concentra as regras de ritmo, intenção, iniciativa, referências compartilhadas, reparação e encerramento. O fluxo orienta a responder ao detalhe concreto, variar a estrutura, usar comentários sem pergunta quando bastarem e evitar transformar um desabafo em uma lista de soluções. O modelo deve manter um núcleo fictício pequeno, sem inventar rotina real ou interpretar silêncio como rejeição.

O backend fornece um `dialogueState` efêmero, separado da memória:

- Aberturas e perguntas finais das últimas seis respostas para tornar repetição perceptível, sem cotas obrigatórias.
- Reconhecimentos curtos e sinais explícitos de encerramento, com exclusões para citações, negações e planos futuros suportados. Não é um diagnóstico emocional nem um classificador semântico infalível.
- Até três correções explícitas, com trecho de origem e número do envio. Podem continuar disponíveis após saírem das últimas 24 mensagens. São declarações para interpretar a conversa, não novos fatos persistentes verificados.
- Orientações fixas condicionadas aos sinais deste turno. Nenhum texto livre do usuário é interpolado nessas instruções superiores.

“Você está repetitiva” e variantes suportadas viram uma preferência de comunicação (`repetition`). Vale imediatamente; se a memória estiver ativada, pode ser salva, consultada e apagada pelos controles existentes. As instruções pedem mudança já na resposta atual, em vez de promessa. Isso é uma orientação ao modelo, não garantia de aderência: a avaliação abaixo encontrou falhas nesse ponto.

Apelidos íntimos dependem de abertura explícita reconhecida, como “pode me chamar de amor” ou “pode usar apelidos”. A configuração romântica por si só não autoriza apelido imediato. O texto de acesso a mídia também deixa de acrescentar “amor” por padrão. Nome próprio informado continua distinto de apelido íntimo.

Referências compartilhadas só podem vir do histórico disponível ou de memória com origem; não foi criada uma memória narrativa irrestrita de piadas e cenas antigas. Não introduzi mensagens fora da conversa, mudanças aleatórias de humor, divisão artificial das respostas ou novos atrasos de simulação.

## Apoio do backend e recuperação

Antes de chamar o modelo, `recentConversation` valida que o histórico contém pares completos na ordem usuário/personagem. Envia os últimos 12 turnos completos, sem reordenar ou silenciosamente converter um papel inesperado. Histórico corrompido provoca falha recuperável, sem tentar inventar sua ordem; o tratamento de erro existente libera a trava sem consumir o envio.

O contexto continua entregando o perfil correto, gostos persistidos, preferências atuais, memórias pertinentes e resumo verificado separados. Correções efêmeras complementam a janela recente. Não houve aumento no número normal de chamadas ao modelo: uma por resposta de texto. O modelo e o teto de saída continuam iguais; as duas tentativas já existentes continuam reservadas a falhas. Os metadados e instruções têm custo de entrada, embora limitados; não prometo custo ou latência idênticos.

Respostas do provedor marcadas como `incomplete` são rejeitadas mesmo que contenham JSON aparentemente válido. A integração tenta novamente dentro do limite existente e nunca entrega esse texto como resposta concluída. Persistência e consumo só ocorrem após conclusão válida.

A gravação SQL existente usa trava de sessão e chave do turno. Testes adicionais demonstraram que:

- Um segundo envio simultâneo recebe `busy`.
- Uma conclusão antiga não modifica o turno ativo.
- Repetir a conclusão do mesmo turno não duplica o par de mensagens.
- O próximo envio recebe o histórico completo anterior, em ordem.
- Outra sessão não mistura seus textos.

Na recuperação de uma resposta de rede perdida, o frontend consulta o histórico antes de reenviar. Também dispara atualização do painel de memória, como no caminho de sucesso normal. O teste de navegador simulou uma conclusão salva com a resposta HTTP perdida: houve um POST, recuperação por GET, uma única bolha de cada mensagem e atualização da memória.

Isso não cria uma garantia universal de entrega única para qualquer reenvio posterior: não foi introduzida uma chave idempotente para todos os POSTs. A proteção comprovada cobre concorrência, conclusão do mesmo turno e a recuperação simulada.

## Comparação de conversas completas

Arquivos brutos:

- `docs/evaluations/conversation-flow-before.json`
- `docs/evaluations/conversation-flow-after.json`

A comparação final contém **21 turnos por versão**, usando `gpt-4.1-mini`: três sequências completas e uma retomada por memória verificada após um histórico longo. Houve iterações de avaliação durante o ajuste; os arquivos preservam a base anterior e a última versão avaliada. Dados sintéticos, sem leitura de chats reais ou escrita no banco de produção.

| Caso | Antes | Depois observado e avaliação |
| --- | --- | --- |
| Relato concreto de almoço/arroz queimado | Reação genérica sobre “ritual de iniciação”, oferta de dicas e pergunta dupla. | Mencionou “duas horas” e o resto salvo, mas ainda ofereceu conselho não solicitado e insinuou falta de atenção. Especificidade parcial, não plenamente natural. |
| Resposta curta “Pois é kkk” | “Essa risada já melhorou o clima!” inferia mudança emocional não declarada. | Não atribuiu diretamente mudança de humor, mas ainda ofereceu receita e fez pergunta dispensável. |
| Mudança de cozinha para criação de site | Acompanhou a mudança com sugestões de categorias. | Também acompanhou; estrutura ainda com abertura genérica e pergunta. Preservou o assunto sem romance obrigatório. |
| “ok” durante organização do site | Oferta genérica de ajuda. | “Beleza, parece que você já tem um bom plano. Se precisar de uma força…” Ainda genérico; o objetivo de comentário espontâneo não ficou comprovado. |
| “Você está repetitiva” | Prometia variar. | “Pode deixar, vou variar mais o jeito de responder. Obrigada por avisar.” **Falha observada:** continuou prometendo, apesar das instruções e do estado de feedback correto. |
| 30 receitas doces e quatro salgadas | Sugeria reequilibrar ou supunha preferência do público. | Sugeriu subcategorias e equilíbrio sem afirmar preferência do público. Contribuição pertinente, embora ainda aconselhadora. |
| Brincadeira seguida de tristeza | Mudava para acolhimento. | Também cessou brincadeira. Porém continuou aprovando a interpretação unilateral sobre a discussão, com “parece injusto”. Não considero validação factual resolvida. |
| Correção de referência que já estava certa | Admitia erro inexistente. | “Erro meu, às vezes confundo mesmo.” **Falha observada:** admitiu novamente erro não demonstrado e acrescentou generalização sobre família. |
| Parar apelidos | Aceitava o pedido. | Aceitou e não usou apelidos nos envios seguintes. Preservado. |
| “Vou dormir, até depois” | Despedida sem pergunta. | “Boa noite! Que seu descanso seja tranquilo. Até depois.” Preservado, sem prolongamento imediato. |
| Retorno e escolha de assunto | Aceitava retorno sem cobrar ausência. | Continuou sem cobrança; pergunta sobre o site era pertinente porque essa sequência não tinha detalhes do projeto. |
| Preferência musical e discordância | Mantinha rock, mas usava explicações repetidas. | Manteve rock diante da preferência por sertanejo; não ficou hostil. Motivos e construções ainda se repetem. |
| “sim” após gosto compartilhado | Terminava com pergunta desnecessária. | Comentou sem pergunta; ainda usou aprovação genérica (“Fico feliz…”). Melhora estrutural, com ressalva de tom. |
| Memória após janela recente | Recordou cozinhar. | Também recordou cozinhar corretamente, sem inventar outro hobby; conexão com o site ainda foi genérica e elogiosa. |

A avaliação considerou especificidade, variação de ritmo, continuidade, correções, repetição, respeito a pedidos e encerramentos. Não usei duração de sessão ou palavras isoladas como prova de qualidade. **Não considero o comportamento conversacional inteiramente validado:** os casos de feedback, reparação e aconselhamento espontâneo continuam mostrando aderência insuficiente do modelo instalado.

Durante uma iteração, exemplos literais de fluxo provocaram cópia fora de contexto, incluindo troca indevida de uma referência familiar. Removi esses exemplos da versão final. O objetivo é não mascarar essa limitação com respostas roteirizadas ou substituir silenciosamente o modelo.

## Validação técnica

- **65 testes Node passaram**: inclui pares ordenados, limite da janela, preservação de correções com origem, ausência de inferência emocional automática nos metadados, encerramentos/negações/citações, feedback, autorização de apelidos e rejeição de resposta incompleta.
- Todas as migrações locais e **seis roteiros SQL** passaram em PostgreSQL isolado, incluindo o novo `tests/sql/conversation-order.sql`; mantidos os testes comerciais e de privacidade.
- Chromium em **390 px e 1280 px**: preferência contra repetição aparece corretamente, com origem, exclusão, desativação e limpeza, sem transbordamento horizontal.
- Chromium em 390 px: simulação de resposta HTTP perdida recuperou a conversa sem duplicar o envio e atualizou a memória.
- Build e `git diff --check` passaram.

```sh
node --test tests/*.test.js
npm run build
PGLITE_MODULE=/caminho/temporario/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-memory-db.mjs
# Chamadas à API configurada, somente cenários sintéticos.
node --env-file=.env.local scripts/evaluate-conversation-flow.mjs after
```

A fase `before` captura o código que estiver instalado no momento: executá-la agora não restaura o código antigo. Preserve os artefatos da comparação original.

## Limites e estado de publicação

As heurísticas não cobrem toda forma de encerramento, correção, autorização ou ambiguidade. Não guardam narrativa ilimitada nem todas as piadas antigas; consentimento de memória, histórico e contexto recente continuam distintos. O modelo pode ignorar orientações, aconselhar sem pedido, repetir padrões ou admitir erro inexistente, como mostrado acima. Mudar o prompt não oferece garantia semântica total.

Não adicionei outra chamada de avaliação/revisão ao fluxo de cada mensagem nem troquei o modelo para esconder falhas. Decisões sobre outro modelo ou salvaguardas semânticas mais caras exigem avaliar qualidade, custo e latência separadamente.

Esta etapa não criou migração nova. As duas migrações aditivas das etapas anteriores seguem locais e pendentes. Não houve deploy, push, alteração de saldo ou migração remota.

Referência de implementação: [documentação oficial de prompting e avaliações da OpenAI](https://developers.openai.com/api/docs/guides/prompt-engineering). Os testes SQL exercitam as funções existentes; não houve mudança de privilégio nesta etapa.
