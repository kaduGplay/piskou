# Piskou Create

Código-fonte recuperado de create.piskou.com (o deploy não tinha source maps). O código foi reconstruído a partir do bundle publicado e testado contra o site no ar: o HTML gerado é idêntico e a diferença de pixels é 0% em todas as etapas do funil. Depois disso ganhou checkout próprio e rastreio pelo Meta Pixel. Hoje o funil é para o México: textos em espanhol, preços em pesos (MXN) e pagamento por SPEI ou OXXO pela LiberPay.

## Rodar localmente

```bash
npm install
npm run dev       # http://localhost:5173  (?dev=creating ou ?dev=offer pulam direto para o fim)
npm run build     # gera dist/
```

Sem `PAYMENT_GATEWAY` no `.env.local`, o checkout roda em modo de teste: nada é cobrado e o SPEI/OXXO de teste é aprovado sozinho em uns 10 s. A LiberPay real não funciona localmente: a conta só aceita os IPs fixos da Vercel, e o código recusa chamar a LiberPay fora das regiões com IP fixo.

## Deploy na Vercel

O projeto já está configurado (`vercel.json`): preset Vite, `npm ci`, saída `dist`, funções da pasta `api/` na região São Paulo (`gru1`), exceto `api/checkout.js`, que roda em `iad1` para sair pelos IPs fixos da Vercel (ver “Como o pagamento é confirmado”), cache longo para as mídias e headers de segurança. O `.vercelignore` impede que `.env*` e o backup `original-build/` sejam enviados.

1. **Suba o código.** Pode ser pelo GitHub (crie o repositório e importe em vercel.com/new) ou pela CLI (`npx vercel` na pasta do projeto).
2. **Crie o banco no Supabase Free.** Aplique a migration `supabase/migrations/202610100001_payment_store.sql`. A tabela tem RLS habilitado, sem acesso para visitantes ou usuários do navegador. As funções da Vercel usam uma chave secreta de servidor. Redis continua disponível como alternativa; com ambos configurados, Supabase tem prioridade.
3. **Cadastre as variáveis** em Settings → Environment Variables (ambiente Production):

   | Variável | Valor |
   |---|---|
   | `PAYMENT_GATEWAY` | `liberpay` |
   | `LIBERPAY_CLIENT_ID` | client_id da LiberPay |
   | `LIBERPAY_CLIENT_SECRET` | client_secret da LiberPay (`lp_sk_...`) |
   | `LIBERPAY_WEBHOOK_SECRET` | segredo longo e aleatório; vai no endereço do webhook cadastrado no portal da LiberPay |
   | `LIBERPAY_STATIC_REGIONS` | opcional; regiões da Vercel com IP fixo (padrão `iad1`) |
   | `META_PIXEL_ID` | `1429884866005189` |
   | `META_ACCESS_TOKEN` | token da API de Conversões do Pixel |
   | `SITE_URL` | `https://piskoumx.vercel.app` |
   | `SUPABASE_URL` | URL do projeto Supabase |
   | `SUPABASE_SECRET_KEY` | chave secreta `sb_secret_...` (ou use `SUPABASE_SERVICE_ROLE_KEY` legada) |

4. **Faça o deploy** (ou "Redeploy" depois de cadastrar as variáveis, porque as funções só leem variáveis novas num deploy novo).
5. **Aponte o domínio** `create.piskou.com` para o projeto em Settings → Domains.
6. **Confira:** `https://create.piskou.com/api/checkout-config` deve responder `"available":true`. Se responder `false`, o log da função (Vercel → Logs) diz qual variável falta.

Se faltar qualquer variável, o checkout mostra "pagamento indisponível" em vez de deixar a pessoa preencher e falhar. O modo de teste (`PAYMENT_GATEWAY=mock`) é bloqueado em produção.

## Estrutura

```
index.html                      fonte Outfit e o Meta Pixel (só fora do localhost)
vercel.json / .vercelignore     configuração de deploy
src/main.jsx                    entrada; /checkout abre o checkout, o resto é o funil
src/index.css                   base (saída compilada do Tailwind v4 + .app-loading)
src/funnel/data.js              opções do quiz, mídia dos cards, imagem final, eventos de rastreio e Pixel
src/funnel/Funnel.jsx           as 6 etapas, carrosséis, folhas de escolha, resumo, rodapé
src/funnel/GeneratingPanel.jsx  animação de partículas (three.js) que revela a imagem final
src/funnel/PaywallSheet.jsx     oferta; os botões levam para /checkout
src/funnel/offer.js             benefícios, bônus, depoimentos, frase de confiança e FAQ (oferta e checkout)
src/checkout/                   página /checkout (fluxo em CheckoutPage.jsx, seções em CheckoutSections.jsx)
src/shared/checkout.js          preços dos planos e validações, usados pelo site e pelo servidor
api/checkout.js                 cria a cobrança
api/checkout-status.js          status lido pela tela de pagamento (SPEI/OXXO)
api/checkout-config.js          formas de pagamento disponíveis / se o pagamento está configurado
api/webhook.js                  recebe o aviso de pagamento do gateway
api/_lib/gateway.js             escolhe o gateway (mock ou liberpay)
api/_lib/liberpay.js            integração com a LiberPay (SPEI/OXXO em MXN)
api/_lib/meta.js                compra confirmada enviada à API de Conversões da Meta
api/_lib/store.js               status das cobranças (Supabase ou Redis na Vercel, memória localmente)
public/                         todas as mídias do site (66 MB)
original-build/                 o build publicado antigo, intacto, como backup (não vai para a Vercel)
```

## Onde mudar cada coisa

| O quê | Onde |
|---|---|
| Preços dos planos | `PLANS` em `src/shared/checkout.js` (oferta, checkout e servidor leem daqui) |
| Bônus, benefícios, depoimentos, frase de confiança, FAQ | `src/funnel/offer.js` |
| ID do Meta Pixel | `fbq('init', …)` em `index.html` |
| Quais eventos vão para o Pixel | `META_PIXEL_EVENTS` em `src/funnel/data.js` |
| Opções do quiz e valores padrão | `src/funnel/data.js` |
| Texto em espanhol das opções do quiz | `OPTION_LABELS` em `src/funnel/data.js` (o funil é exibido em espanhol do México; os valores salvos e validados pelo servidor continuam em português) |
| Qual imagem aparece no final | `getResultImage()` em `src/funnel/data.js` |
| Textos das etapas | JSX em `src/funnel/Funnel.jsx` |

## Rastreio (Meta Pixel 1429884866005189)

O código base em `index.html` faz o `PageView`; o resto sai de `track()` em `src/funnel/data.js`:

| Momento | Evento do Pixel | Dados |
|---|---|---|
| Abriu o funil | `IniciouCriador` (personalizado) | |
| Cada etapa do quiz | `EtapaCriador` (personalizado) | `step` |
| Clicou em "Dê vida à sua IA" | `Lead` | |
| Viu a oferta | `ViewContent` | |
| Clicou para ir ao checkout | `AddToCart` | plano, valor, MXN |
| Abriu o checkout | `InitiateCheckout` | plano, valor, MXN |
| Trocou de plano no checkout | `TrocouPlano` (personalizado) | plano, valor |
| Gerou o SPEI/OXXO | `AddPaymentInfo` | plano, valor |
| Pagamento aprovado | `Purchase` | plano, valor, MXN, `eventID` = ID da transação |

O Pixel não carrega em localhost, para os testes não entrarem nas métricas. O `Purchase` sai do navegador quando a pessoa ainda está na tela de pagamento e também do servidor: quando o webhook confirma o pagamento, `api/_lib/meta.js` envia a compra à API de Conversões (`META_PIXEL_ID` + `META_ACCESS_TOKEN`), com e-mail e nome com hash, IP, navegador e os cookies `_fbp`/`_fbc` guardados ao gerar a cobrança. O `event_id` é o ID da transação, o mesmo `eventID` do navegador, então a Meta conta a venda uma vez. Assim entram também as vendas do OXXO, que caem horas depois com a página fechada.

## Checkout

Após “Dê vida”, o criador abre os planos Baby (MX$ 99) e Pro (MX$ 179), com pagamento único. O checkout solicita somente nome e e-mail e oferece **SPEI** (transferência; a página mostra a CLABE de 18 dígitos para copiar e confirma em segundos) ou **OXXO** (dinheiro na loja; a página mostra a referência e o código de barras, e a confirmação pode levar horas), com os order bumps Llamada de voz e Segunda compañera (+MX$ 29 cada, de MX$ 49; a Segunda compañera já vem no Pro). Os preços são validados no servidor e no banco (`piskou_purchase_addons`), só em pesos. Pacotes adicionais: 120 mensagens por MX$ 39 e mensagens ilimitadas na conversa por MX$ 69. Recompras preservam o histórico.

### Ofertas de um clique (`/oferta`)

Depois do pagamento do Baby ou do Pro, o checkout abre `/oferta`, com três ofertas em sequência: **Pack de videos de ella** (MX$ 49), **Ella te escribe por WhatsApp** (MX$ 49) e **Acceso VIP de por vida** (MX$ 69). “Quero” gera na hora uma CLABE do SPEI com o nome e o e-mail já informados no checkout; “Não, obrigado” mostra a próxima oferta. No fim, a pessoa vai para o chat.

- O servidor só vende uma oferta para quem já pagou o Baby/Pro na mesma conversa, e uma vez por item.
- **VIP vitalício:** mensagens ilimitadas e conversa que não expira (enquanto a compra estiver ativa; um estorno no painel desfaz).
- **WhatsApp:** após o pagamento, a página pede o celular de 10 dígitos (aceita +52/+521), gravado com o código do país (`52…`) em `piskou_upsell_contacts` (só aceito para quem comprou). O envio da mensagem pelo WhatsApp não está automatizado.
- **Pack de vídeos:** a compra fica registrada em `piskou_chat_purchases` (`upsell-video-pack`); a entrega do conteúdo não está automatizada.

As compras e os créditos são privados no Supabase. O cookie assinado HttpOnly `piskou_access`, com caminho `/api`, vincula checkout e chat. Uma compra confirmada só é creditada uma vez, mesmo com webhook/polling repetidos. Uma resposta com falha não consome crédito. Sessões são mantidas por 90 dias; um novo envio renova essa retenção. Dados mínimos da cobrança pendente ficam no navegador para retomada, sem dados de cartão. O modelo recebe até as últimas 24 mensagens para limitar o contexto enviado, com `store: false`. Personalidade, relacionamento e preferências continuam orientando o chat, com romance sem conteúdo sexual explícito.

Configure `OPENAI_API_KEY`, `OPENAI_MODEL` e `CHAT_SESSION_SECRET` apenas no servidor e aplique todas as migrações. O fluxo principal segue criação → planos → checkout → SPEI/OXXO → pagamento → chat; as métricas anteriores à mudança conservam os eventos históricos e precisam ser interpretadas separadamente.

Os botões da oferta levam para `/checkout?plano=<id>`, junto com as UTMs. A página mostra, nesta ordem:

1. **Personagem montada no funil:** imagem, nome, idade, personalidade e relação, lidas do `sessionStorage`.
2. **Escolha do plano:** dá para trocar entre Premium e Luxo ali mesmo.
3. **Formulário:** só como a pessoa quer ser chamada e o e-mail da conta, com selos de confiança.
4. **O que o plano inclui:** no Luxo, os 8 bônus com imagens; no Premium, o que fica de fora e um botão para passar ao Luxo.
5. **Como funciona**, **avaliações** e **perguntas frequentes.**
6. **Barra fixa** com preço e botão quando o botão principal sai da tela.

O `html`/`body` do site não rolam (o funil rola dentro de `.creator-body`), então o checkout tem a própria área de rolagem (`.checkout-root`). O servidor cobra sempre o preço do catálogo, nunca um valor vindo do navegador.

### Como o pagamento é confirmado

A conta da LiberPay só aceita chamadas de IPs liberados. O projeto tem IPs fixos da Vercel na região `iad1`, e só `api/checkout.js` (a única rota que chama a LiberPay) roda nessa região. Além disso, `api/_lib/liberpay.js` recusa fazer qualquer chamada fora das regiões de `LIBERPAY_STATIC_REGIONS` (inclusive localmente): nenhuma cobrança sai por outro IP. Os IPs fixos aparecem em Vercel → Settings → Networking e precisam estar liberados no portal da LiberPay.

1. `api/checkout.js` pede um token (`POST /auth/token` com `client_id`/`client_secret`, guardado enquanto vale) e cria o depósito (`POST /payments/deposit`, `currency: "MXN"`, `payment_method: "spei"` ou `"oxxo"`, `external_id` = `piskou_<uuid>_<hash>`, que evita cobrança repetida). Depois grava a cobrança no banco, com moeda, forma de pagamento e os dados da visita para a Meta. O `instructionText` da LiberPay vem em português, então a página mostra as próprias instruções em espanhol.
2. A LiberPay avisa `api/webhook.js` (`payment.paid`, `payment.failed`, `payment.cancelled`, `payment.refunded`). O aviso só é aceito com a chave secreta no endereço (`?key=<LIBERPAY_WEBHOOK_SECRET>`), para uma transação gravada no banco e com o mesmo valor. Avisos repetidos não liberam duas vezes, e um `payment.created` atrasado não desfaz um pagamento confirmado. Com o pagamento confirmado, o webhook libera a conversa e envia o `Purchase` à API de Conversões.
3. A tela de pagamento consulta `api/checkout-status.js` a cada 5 s, por até 1 hora; essa rota lê o banco e nunca a LiberPay. No OXXO a pessoa pode fechar a página: ao voltar ao checkout no mesmo navegador, a cobrança pendente é retomada e, se já foi paga, segue para as ofertas.

Endereço do webhook para cadastrar no portal da LiberPay: `https://piskoumx.vercel.app/api/webhook?key=<LIBERPAY_WEBHOOK_SECRET>`.

## Pendências antes de vender

- **Formato do token da LiberPay:** a documentação recebida não mostra a resposta de `/auth/token`; o código aceita `access_token`, `accessToken` ou `token` (com `expires_in` opcional). Confirme no log da primeira cobrança real.
- **Assinatura do webhook:** a documentação recebida não descreve a assinatura dos avisos; a proteção é a chave secreta no endereço. Se a LiberPay assinar os avisos, vale conferir também a assinatura.
- **Chaves:** o `client_secret` foi compartilhado durante o desenvolvimento. Gere um novo no portal e atualize na Vercel.
- **Entrega do pack de vídeos e do WhatsApp:** as compras ficam registradas, mas a entrega não é automática.

## Como a "geração" funciona

Não existe chamada de IA. `getResultImage()` monta o caminho de uma imagem pronta:

- **Anime:** `public/anime-results/<origem>_<cor>_<corpo>_<seios>_<bumbum>.webp` (816 imagens). Corpo "Magra" só tem imagem com seios "Médios"; nas outras combinações aparece a imagem da origem.
- **Realista:** `public/results/<CASTANHO|PRETO|LOIRA>/<SB|NB|BB|LB><ThinBody|AtleticBody|PlusSizeBody|CurvyBody>.webp` (48 imagens). Origem, corte de cabelo e bumbum não mudam a imagem; "Musculosa" usa a imagem de "Atlética".

A revelação toca o vídeo `public/funnel-media/v2/loader/loader.mp4` com o progresso acompanhando o vídeo e, no fim, mostra a imagem, como no create.piskou.com. Com movimento reduzido, economia de dados ou falha no vídeo, mostra a imagem assim que ela carrega. Os cards do criador usam as imagens e vídeos de `public/funnel-media/anime/` e `public/funnel-media/realista/`.

## Detalhes herdados do original

Mantidos como estavam no site no ar:

- Os vídeos de Voluptuosa e Curvilínea estão com os nomes de arquivo trocados; `getOptionMedia()` compensa isso.
- O título da seção de bônus é "8 Bonus incluso" (sem acento e com concordância diferente do resto da página).
- O plano que abre selecionado na oferta é o Premium.
- A animação de saída do paywall (`exit`) não roda, porque o componente não está dentro de um `AnimatePresence`.

No celular, os campos de texto usam fonte mínima de 16 px para evitar o zoom automático ao focar no iOS, mantendo o zoom manual disponível. O chat acompanha a altura do Visual Viewport quando o teclado abre ou fecha.

O chat fixa seu contêiner na área visível e acompanha altura e deslocamento do Visual Viewport. Apenas a lista de mensagens rola; durante o teclado, banner e sugestões ficam ocultos para dar espaço ao histórico. O campo permanece habilitado e focado durante o envio. Controles nativos de navegação entre campos do Safari/iOS não são personalizáveis pelo site.

Pedidos nos botões de mídia mostram digitação e explicação do requisito de assinatura, com botão de planos. Não fingem entregar uma nova foto ou vídeo.

Pedidos de foto e vídeo mostram o pedido do visitante, digitação por 3 s e resposta personalizada com banner de planos. Cliques repetidos ficam bloqueados durante a sequência; temporizadores são cancelados ao sair do chat.

O criador oferece 12 personalidades, 24 profissões e profissão personalizada (até 60 caracteres). Carinho, humor e tamanho das respostas também são configuráveis, exibidos no perfil e enviados ao servidor para orientar a IA. Fotos e vídeos aparecem apenas quando solicitados nos respectivos botões.

Pedidos de foto ou vídeo digitados no chat são identificados via saída estruturada e exibem a explicação de assinatura com o banner, sem duplicar respostas ou simular entrega. O banner de planos no topo desaparece após 4 s da abertura do chat.

Geração: uma retentativa automática para falhas temporárias de rede, HTTP 408/429/5xx ou saída incompleta, dentro da mesma reserva. Recusas do modelo viram redirecionamento seguro. Se o navegador perder a resposta, consulta o histórico antes de pedir reenvio; mensagens concluídas são recuperadas sem duplicação. Uma indisponibilidade persistente ainda pode impedir respostas, preservando o texto e os créditos. Testes de geração: `node --test tests/chat-model.test.js`.


### Painel de administração

Acesse `/admin` com a senha `ADMIN_PASSWORD` configurada somente no servidor.
A sessão de acesso dura 8 horas, usa cookie HttpOnly e expira ao trocar a senha.
O login permite até 8 tentativas por rede a cada 15 minutos.

As métricas próprias começam após a instalação da migração `funnel_analytics`.
Não coletam nomes, e-mails, conversas, dados de cartão ou IP em texto. O IP é usado
somente como HMAC temporário para limitar requisições. Os identificadores de visitante
ficam no navegador. Uma sessão é renovada após 30 minutos sem atividade; múltiplas
abas podem criar sessões diferentes. Eventos são deduplicados por sessão e etapa.
Atividade visível envia heartbeat a cada 30 segundos; online significa atividade nos
últimos 90 segundos. O painel consulta os agregados a cada 5 segundos enquanto autenticado e com a aba visível.

Os filtros usam sessões iniciadas no período (horário de Brasília), incluindo o dia
atual. As taxas entre etapas exigem a mesma sessão passando pela anterior primeiro.
Entradas diretas aparecem nos totais de cada etapa. O gargalo é a maior proporção de
sessões que ainda não avançaram, com no mínimo 5 sessões na etapa anterior; sessões
em andamento também entram nessa diferença. O painel não é contado nas visitas.
Pagamento gerado e pagamento aprovado são registrados no servidor, por sessão (não representam
quantidade de transações nem receita). O histórico é retido por até 90 dias, com
limpeza ao consultar o painel. Bloqueadores e armazenamento indisponível podem
reduzir a precisão. Métricas indisponíveis nunca impedem o fluxo de chat ou checkout.

### Conversas dos leads e analista do painel

O painel `/admin` tem abas de métricas, conversas e análise com IA, protegidas pelo
mesmo login. A lista de leads é paginada em 25 conversas e usa o período selecionado.
Cada conversa mostra as configurações da personagem, os textos, pedidos de mídia,
tentativas após o limite grátis e a trajetória no funil quando há vínculo de sessão.
Os códigos são anônimos: o nome mostrado é o da personagem, não o do visitante.

A migração `admin_chat_history_advisor` preserva textos em um arquivo privado por
até 90 dias, independente da expiração de 2 dias da sessão de chat. Não duplica
imagens em base64 no arquivo. Conversas ainda existentes são importadas; conversas
já excluídas não podem ser recuperadas, e horários antigos não estavam disponíveis.
A limpeza do arquivo ocorre na consulta administrativa. O diário de pedidos locais
usa a sessão assinada do visitante, limita 30 eventos por conversa e deduplica IDs.

O analista usa a Responses API com o modelo `OPENAI_MODEL` e `store: false`, somente
quando o administrador envia uma pergunta. O servidor fornece todas as métricas do
período selecionado e o contexto do produto. Uma conversa individual só é anexada
quando selecionada no painel; e-mails, números e padrões de chaves são mascarados
nos textos e no perfil enviados à OpenAI. As sugestões são apenas para leitura.
O histórico do administrador fica no Supabase por até 90 dias; a interface mostra
as últimas 100 análises e o modelo recebe as últimas 12. As respostas indicam o
período e o horário do snapshot utilizado. Pedidos são serializados e têm ID para
recuperar a mesma resposta em caso de repetição. Limite de 30 análises em 15 minutos.

O chat adapta seu contexto a pedidos explícitos de estilo nas últimas 200 conversas de até 30 dias. O agregado é recalculado com atividade, em cache por instância durante cinco minutos, sem chamada extra ao modelo. São contadas conversas distintas, não repetições de uma mesma pessoa: mudanças exigem 20 conversas na amostra, três pedidos e maioria entre as conversas com feedback reconhecido. O painel mostra os votos e os ajustes ativos. Essa detecção é limitada a pedidos reconhecidos em português, não mede satisfação nem treina o modelo. Preferências da personagem e pedidos do visitante atual têm prioridade; nenhum texto arquivado de outro visitante entra no prompt. Se a consulta falhar, o chat continua com o estilo individual.

Retomada do visitante: escolhas da personagem, etapa do criador, rascunho e pedidos de mídia ficam no navegador; a entrada pela página inicial retoma o chat ou checkout salvo. A volta explícita ao criador usa `?edit=1`. As mensagens continuam protegidas pelo cookie HttpOnly assinado e pela API, com retenção de 90 dias no Supabase. A identificação funciona no mesmo navegador/aparelho; limpar cookies/dados ou trocar de aparelho impede a retomada sem login. Dados de cartão não são persistidos por esse recurso.

A entrada do criador avança para Características ao escolher explicitamente um estilo; o botão inferior permite continuar com o estilo já selecionado. Os cartões iniciais usam imagens estáticas, sem baixar o vídeo automaticamente. Características permite escolher a origem ou manter a opção atual, com CTA explícito para Rosto. A análise de 11/10/2026 (últimos 7 dias) encontrou 20 sessões em Estilo, 7 em Características e 7 em Rosto: a perda observada estava na entrada em Características, sem evidência de abandono dentro dela. A amostra é pequena e não comprova causa; compare novas sessões depois desta alteração, sem prometer conversão garantida.

A aba **Transações** do admin lista cobranças guardadas no servidor, com período, filtro de status e páginas de 50 registros. Atualiza a cada 5 segundos enquanto está visível. O status manual tem efeito operacional: “Pago” confirma o checkout e libera os créditos do pedido; pendente, falhou e expirou retiram os créditos daquela compra, preservando o histórico e o consumo já realizado. Reconfirmar a mesma cobrança não duplica créditos. “Acompanhar o gateway” remove a prioridade manual e aplica a última confirmação recebida do gateway. O checkout e o chat verificam alterações a cada 5 segundos com a tela ativa; o servidor controla o acesso mesmo se a tela estiver desatualizada. Alterar o status não movimenta dinheiro nem faz estorno no banco. A última informação do gateway é preservada separadamente e avisos posteriores não sobrescrevem uma decisão manual ativa.

Alterações têm observação, revisão para evitar sobrescritas entre abas e histórico privado. Marcações manuais já existentes são sincronizadas na migração. Cobranças antigas sem vínculo com uma conversa podem ter seu status alterado, mas não liberam automaticamente o chat; o painel informa essa limitação ao salvar. Nome/e-mail do comprador aparecem nas novas cobranças. A disponibilidade dos registros segue a retenção do armazenamento de pagamentos, sem reconstrução de cobranças já expiradas.
