# Continuidade, estados e áudio do chat

Implementação local, sem publicação nem alteração do banco remoto. A janela única solicitada no complemento de áudio substitui a proposta anterior de agrupamento de 800 ms e a pausa posterior de apresentação.

## Envio e geração

Cada envio ganha UUID e aparece imediatamente como envio em andamento. Texto é persistido pelo servidor sem esperar a janela de agrupamento; áudio precisa primeiro concluir upload e transcrição. A preparação de áudio não bloqueia a persistência de textos seguintes. O histórico canônico ordena as mensagens pela persistência no servidor.

O banco registra `sentAt` ao persistir e `viewedAt` quando um worker assume as mensagens para processamento. “Visualizada” significa encaminhada para processamento pela IA, e não leitura humana. Falha de geração mantém a confirmação de envio e oferece nova geração; confirmação perdida é reconciliada pelo UUID antes de mostrar falha de envio. Repetir operações não cria mensagens nem cobranças duplicadas. Históricos antigos sem datas continuam sem datas inventadas.

A janela padrão é de 1.500 ms após o último envio, limitada a 3.000 ms desde o primeiro envio pendente. `CHAT_GROUP_WINDOW_MS` configura a janela. Durante essa espera não há indicador de preparação nem confirmação de visualização. O indicador acessível “Preparando resposta” só aparece durante geração ativa. Não há pausa adicional após a resposta. A integração atual recebe JSON completo; não simula streaming nem digitação letra a letra.

Uma mensagem que chega durante a primeira geração pode invalidá-la e regenerar uma vez com o conjunto atualizado. Novos complementos durante essa segunda tentativa ficam no próximo turno, evitando regeneração infinita. Identificador da geração, lease, revisão do histórico e operações atômicas impedem publicação de respostas canceladas ou repetidas. Trocar ou fechar a conversa interrompe a interface antiga, enquanto a fila persistida permanece recuperável.

Os limites e preços existentes são preservados. Agrupar três mensagens não transforma três créditos em um. Apenas uma resposta concluída validamente confirma os créditos do grupo, conforme o tratamento anterior de falhas. Apagar mensagem já processada não restitui crédito. Reenvios idempotentes, áudio e mudanças de estado não cobram novamente a mesma mensagem.

## Assuntos e memória

A memória continua opcional e isolada pela identidade autorizada da conversa. Entrevistas, projetos, receitas e filmes explicitamente mencionados pelo usuário podem registrar relato original, horário conhecido, fonte, data do evento quando fornecida, status e permissão para retomar. Não inferimos datas desconhecidas nem datas relativas de históricos sem horário. O aplicativo fornece o fuso; o relógio de referência é do servidor.

Um assunto pode ser retomado quando pertinente à conversa, sem interromper uma mensagem importante. Assuntos resolvidos, já perguntados ou que o usuário não quer comentar são excluídos das sugestões. Informações sensíveis não entram nessa extração por padrão. Exclusão de memória, limpeza e desativação usam revisões e marcos de consentimento para impedir que respostas antigas restaurem informações apagadas. Não há notificações ou mensagens fora do chat.

## Interface e exclusão

Balões separados, horários, datas, menu por toque prolongado ou botão, responder, copiar, informações e apagar usam o histórico real. Citações resolvem a mensagem original; se apagada, exibem somente o marcador neutro. A rolagem mantém a mensagem visível quando o usuário lê o histórico e oferece botão para novas mensagens. O perfil continua identificando a personagem como IA.

Apagar remove texto, transcrição, metadados ativos de áudio e memórias derivadas identificadas pela fonte. Também invalida gerações em andamento e impede que requisições atrasadas restaurem o mesmo UUID. Respostas já recebidas permanecem visíveis, mas respostas dependentes do conteúdo apagado deixam de integrar o contexto futuro. Arquivos entram em uma fila durável de exclusão com tentativas posteriores. Não há promessa de remoção instantânea de backups, cópias já baixadas ou retenção do provedor. URLs privadas temporárias expiram em 60 segundos.

O áudio tem gravação de até 30 segundos/2 MB, reprodução, pausa, velocidades 1×/1,5×/2× e transcrição opcional recolhida. A voz sintetizada é identificada como voz de IA. O bucket é privado e todas as operações exigem a identidade da conversa. A aplicação usa identidade anônima em cookie assinado: a sincronização exige a mesma identidade autorizada; esta alteração não cria login nem vinculação automática entre dispositivos.

## Ativação posterior, com autorização

1. Aplicar as migrações locais em ordem, incluindo memória, preferências e continuidade.
2. Configurar as variáveis de `.env.example`, especialmente `CHAT_WORKER_SECRET`, os modelos de áudio e as credenciais existentes.
3. Publicar os endpoints e a interface somente após autorização.
4. Configurar no Vault do Supabase a URL HTTPS de `/api/chat-worker` e o mesmo segredo, conforme `supabase/setup/chat-worker.sql`, e instalar o agendamento descrito nesse arquivo.
5. Verificar geração com todas as abas fechadas, exclusão de arquivos e captura de áudio em aparelhos físicos.

O worker recebe chamadas autenticadas e consulta a fila do banco; o navegador é apenas uma otimização de despertar. O script preparado usa verificação a cada segundo e limpeza diária. O agendamento remoto ainda não foi instalado nem validado. A execução tem latência de agendamento e rede além da janela: não há garantia de início exato em milissegundos.

## Verificação e avaliação

Os testes locais incluem UUID/idempotência, três envios rápidos, complemento durante geração, exclusão antes e durante geração, resposta antiga rejeitada, consumo por mensagem, falha e nova tentativa, isolamento, datas desconhecidas, assuntos resolvidos/recusados, limpeza de memória, permissões e RLS. O teste de navegador usa os handlers reais com banco PGlite isolado e provedores/Storage simulados. Verifica também referências apagadas, dois contextos autorizados, rolagem, reprodução de áudio, remoção de arquivo e processamento com as abas fechadas.

Esses testes não substituem validação em iPhone/Android físicos, chamadas reais aos provedores ou cron remoto. Não há ainda dados reais de satisfação ou abandono dessa implementação.

Eventos `ChatRhythm_grouped_{started|content|abandoned|rating}` permitem comparar faixas de tempo até o primeiro conteúdo, saídas observadas e avaliação opcional do ritmo. Eventos antigos `paced` e `immediate` continuam aceitos para consulta histórica. O coletor deduplica por sessão/evento/faixa: não são contagens exatas de respostas. Saída da página não prova abandono definitivo; compare também erros. Uma comparação observacional não comprova que esperar melhora a experiência.
