# Piskou Create

Código-fonte recuperado de create.piskou.com (o deploy não tinha source maps). O código foi reconstruído a partir do bundle publicado e testado contra o site no ar: o HTML gerado é idêntico e a diferença de pixels é 0% em todas as etapas do funil. Depois disso ganhou checkout próprio (Void Payments, PIX) e rastreio pelo Meta Pixel.

## Rodar localmente

```bash
npm install
npm run dev       # http://localhost:5173  (?dev=creating ou ?dev=offer pulam direto para o fim)
npm run build     # gera dist/
```

Sem `.env.local`, o checkout roda em modo de teste: nada é cobrado e o PIX é aprovado sozinho em uns 10 s. Com as chaves da Void no `.env.local` (modelo em `.env.example`), os PIX gerados são reais. Em localhost, porém, a tela nunca muda para "aprovado", porque a Void não consegue mandar o aviso de pagamento para o seu computador.

## Deploy na Vercel

O projeto já está configurado (`vercel.json`): preset Vite, `npm ci`, saída `dist`, funções da pasta `api/` na região São Paulo (`gru1`), cache longo para as mídias e headers de segurança. O `.vercelignore` impede que `.env*` e o backup `original-build/` sejam enviados.

1. **Suba o código.** Pode ser pelo GitHub (crie o repositório e importe em vercel.com/new) ou pela CLI (`npx vercel` na pasta do projeto).
2. **Crie o banco no Supabase Free.** Aplique a migration `supabase/migrations/202610100001_payment_store.sql`. A tabela tem RLS habilitado, sem acesso para visitantes ou usuários do navegador. As funções da Vercel usam uma chave secreta de servidor. Redis continua disponível como alternativa; com ambos configurados, Supabase tem prioridade.
3. **Cadastre as variáveis** em Settings → Environment Variables (ambiente Production):

   | Variável | Valor |
   |---|---|
   | `PAYMENT_GATEWAY` | `voidpay` |
   | `VOIDPAY_PUBLIC_KEY` | chave pública da Void |
   | `VOIDPAY_SECRET_KEY` | chave secreta da Void |
   | `VOIDPAY_FIXED_PHONE` | telefone enviado em todas as cobranças (a Void exige) |
   | `VOIDPAY_FIXED_DOCUMENT` | CPF enviado em todas as cobranças |
   | `SITE_URL` | `https://create.piskou.com` |
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
api/checkout-status.js          status lido pela tela do PIX
api/checkout-config.js          formas de pagamento disponíveis / se o pagamento está configurado
api/webhook.js                  recebe o aviso de pagamento do gateway
api/_lib/gateway.js             escolhe o gateway (mock ou voidpay)
api/_lib/voidpay.js             integração com a Void Payments
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
| Qual imagem aparece no final | `getResultImage()` em `src/funnel/data.js` |
| Textos das etapas | JSX em `src/funnel/Funnel.jsx` |

## Rastreio (Meta Pixel 1512882057313106)

O código base em `index.html` faz o `PageView`; o resto sai de `track()` em `src/funnel/data.js`:

| Momento | Evento do Pixel | Dados |
|---|---|---|
| Abriu o funil | `IniciouCriador` (personalizado) | |
| Cada etapa do quiz | `EtapaCriador` (personalizado) | `step` |
| Clicou em "Dê vida à sua IA" | `Lead` | |
| Viu a oferta | `ViewContent` | |
| Clicou para ir ao checkout | `AddToCart` | plano, valor, BRL |
| Abriu o checkout | `InitiateCheckout` | plano, valor, BRL |
| Trocou de plano no checkout | `TrocouPlano` (personalizado) | plano, valor |
| Gerou o PIX | `AddPaymentInfo` | plano, valor |
| Pagamento aprovado | `Purchase` | plano, valor, BRL, `eventID` = ID da transação |

O Pixel não carrega em localhost, para os testes não entrarem nas métricas. O `Purchase` sai do navegador, então só é registrado se a pessoa ainda estiver na tela do PIX quando o pagamento cair. Para registrar toda venda, mesmo com a aba fechada, dá para enviar o `Purchase` também pelo servidor (API de Conversões do Meta) no webhook, usando o mesmo `eventID` para não contar em dobro. Isso precisa de um token de acesso gerado no Gerenciador de Eventos.

## Checkout

Após "Dê vida à sua IA", o visitante entra em `/chat` com o nome, a imagem e as características selecionadas. A prévia permite três mensagens livres, com sugestões clicáveis de mensagens. As respostas roteirizadas variam com o relacionamento, a personalidade e alguns assuntos da mensagem; após a terceira resposta mostra o aviso para adquirir um plano e uma prévia de foto bloqueada. O perfil abre por toque. Pedir uma foto mostra uma prévia bloqueada com requisito Premium (também incluído no Luxo), sem consumir as mensagens gratuitas. Fotos e continuação da conversa têm botões próprios para abrir os planos Premium e Luxo existentes. A conversa é salva nesta aba e retomada ao recarregar. Não há integração com um modelo de IA, vídeo novo ou liberação automática de chat pago nesta etapa.

Os botões da oferta levam para `/checkout?plano=<id>`, junto com as UTMs. A página mostra, nesta ordem:

1. **Personagem montada no funil:** imagem, nome, idade, personalidade e relação, lidas do `sessionStorage`.
2. **Escolha do plano:** dá para trocar entre Premium e Luxo ali mesmo.
3. **Formulário:** só como a pessoa quer ser chamada e o e-mail da conta, com selos de confiança.
4. **O que o plano inclui:** no Luxo, os 8 bônus com imagens; no Premium, o que fica de fora e um botão para passar ao Luxo.
5. **Como funciona**, **avaliações** e **perguntas frequentes.**
6. **Barra fixa** com preço e botão quando o botão principal sai da tela.

O `html`/`body` do site não rolam (o funil rola dentro de `.creator-body`), então o checkout tem a própria área de rolagem (`.checkout-root`). O servidor cobra sempre o preço do catálogo, nunca um valor vindo do navegador.

### Como o pagamento é confirmado

A Void **bloqueia consultas repetidas de status**: a resposta é "Tentativa de polling bloqueada. Receba atualizações via webhook", com bloqueio de 5 minutos. Por isso o fluxo é este:

1. `api/checkout.js` cria o PIX na Void (`POST /pix/receive`) com o identificador `piskou_<uuid>` e um endereço de aviso assinado (`/api/webhook?order=…&sig=…`, um HMAC da chave secreta). Depois grava a cobrança no banco.
2. Quando o status muda, a Void chama `api/webhook.js`. O aviso só é aceito com assinatura válida e para uma cobrança gravada daquele mesmo pedido. O status é conferido uma vez na Void (`GET /transactions?id=…`); se ela limitar a consulta, vale o status do aviso.
3. A tela do PIX consulta `api/checkout-status.js` a cada 5 s, por até 1 hora. Essa rota lê o banco e nunca a Void. No Supabase, registros expiram após dois dias, deixam de aparecer nas consultas e são removidos na próxima escrita.

O telefone e o CPF fixos existem porque o checkout não pede esses dados, e a Void recusa cobrança sem telefone, apesar de a documentação dizer que é opcional.

## Pendências antes de vender

- **Entrega do acesso:** quando o webhook confirma o pagamento, falta enviar o acesso ao cliente (`api/webhook.js`, no `if (event.status === 'paid')`). Antes a Kirvano fazia isso. **Sem isso, o cliente paga e não recebe nada.**
- **Formato do aviso da Void:** o webhook lê `transactionId` e `status`/`transactionStatus`. Confirme no log da primeira venda real (o log mostra os campos recebidos).
- **Chave secreta:** ela foi compartilhada durante o desenvolvimento. Gere uma nova na Void e use a nova na Vercel.
- **Cartão:** a Void foi integrada só para PIX.

## Como a "geração" funciona

Não existe chamada de IA. `getResultImage()` monta o caminho de uma imagem pronta:

- **Anime:** `public/anime-results/<origem>_<cor>_<corpo>_<seios>_<bumbum>.webp` (816 imagens). Corpo "Magra" só tem imagem com seios "Médios"; nas outras combinações aparece a imagem da origem.
- **Realista:** `public/results/<CASTANHO|PRETO|LOIRA>/<SB|NB|BB|LB><ThinBody|AtleticBody|PlusSizeBody|CurvyBody>.webp` (48 imagens). Origem, corte de cabelo e bumbum não mudam a imagem; "Musculosa" usa a imagem de "Atlética".

A animação junta partículas nas máscaras `public/loading-states/silhouette-3.webp`, `silhouette-7.webp` e `<anime|real>-final-mask.webp` e depois mostra a imagem. Com movimento reduzido ou sem WebGL, só faz um fade.

## Detalhes herdados do original

Mantidos como estavam no site no ar:

- Os vídeos de Voluptuosa e Curvilínea estão com os nomes de arquivo trocados; `getOptionMedia()` compensa isso.
- O título da seção de bônus é "8 Bonus incluso" (sem acento e com concordância diferente do resto da página).
- O plano que abre selecionado na oferta é o Premium.
- A animação de saída do paywall (`exit`) não roda, porque o componente não está dentro de um `AnimatePresence`.
