import { voidpayGateway } from './voidpay.js'

// Ponto único de integração com o gateway de pagamento.
//
// Para integrar um gateway real, crie um objeto com a mesma forma de `mockGateway`, registre em `GATEWAYS`
// e defina PAYMENT_GATEWAY=<nome> nas variáveis de ambiente da Vercel. Chaves secretas ficam só em
// variáveis de ambiente do servidor, nunca no código do site.
//
//   methods                 -> formas aceitas, ex.: ['pix', 'card']
//   missingConfig()         -> nomes de variáveis de ambiente que faltam (opcional)
//   createPixCharge(order)  -> { id, status, pix: { copyPaste, expiresAt } }
//   createCardCharge(order) -> { id, status }            (order.cardToken vem tokenizado do navegador)
//   confirmsByWebhook       -> true se o status só chega pelo webhook (fica no store; ver store.js)
//   getChargeStatus(id)     -> 'pending' | 'paid' | 'failed' | 'expired'   (gateways sem confirmsByWebhook)
//   handleWebhook(req)      -> { id, orderId, status, ... }                (usado por /api/webhook)
//
// `order` = { id, amountCents, plan, customer: { name, email }, metadata: { tracking }, siteUrl }
// `siteUrl` é o endereço público do site (para o callback do gateway); vem vazio em localhost.

const PIX_TTL_MS = 30 * 60 * 1000
const MOCK_PIX_APPROVAL_MS = 10 * 1000

// Modo de teste: nada é cobrado. O PIX é aprovado sozinho ~10 s depois de gerado;
// cartão é aprovado, exceto números terminados em 0002 (simula recusa).
const mockGateway = {
  testMode: true,
  methods: ['pix', 'card'],

  async createPixCharge(order) {
    const createdAt = Date.now()
    return {
      id: `mock_pix_${createdAt}_${Math.random().toString(36).slice(2, 8)}`,
      status: 'pending',
      pix: {
        copyPaste: `00020126TESTE-PISKOU-NAO-PAGAVEL5204000053039865405${(order.amountCents / 100).toFixed(2)}5802BR6304TEST`,
        expiresAt: new Date(createdAt + PIX_TTL_MS).toISOString(),
      },
    }
  },

  async createCardCharge(order) {
    const declined = order.cardToken.endsWith('0002')
    return {
      id: `mock_card_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      status: declined ? 'failed' : 'paid',
    }
  },

  async getChargeStatus(id) {
    const match = /^mock_(pix|card)_(\d+)_/.exec(id)
    if (!match) return null
    if (match[1] === 'card') return 'paid'
    const age = Date.now() - Number(match[2])
    if (age > PIX_TTL_MS) return 'expired'
    return age >= MOCK_PIX_APPROVAL_MS ? 'paid' : 'pending'
  },
}

const GATEWAYS = {
  mock: mockGateway,
  voidpay: voidpayGateway,
}

// Sem PAYMENT_GATEWAY definido, o checkout fica desligado (as rotas respondem 503).
// No `npm run dev`/`npm run preview` local, o vite.config.js liga o modo de teste automaticamente.
export function getGateway() {
  const name = process.env.PAYMENT_GATEWAY
  // O modo de teste aprova pagamentos sem cobrar: nunca pode rodar na produção da Vercel.
  if (name === 'mock' && process.env.VERCEL_ENV === 'production') {
    console.error('checkout: PAYMENT_GATEWAY=mock bloqueado em produção')
    return null
  }
  const gateway = name ? (GATEWAYS[name] ?? null) : null
  const missing = gateway?.missingConfig?.() ?? []
  if (missing.length > 0) {
    console.error(`checkout: gateway "${name}" sem configuração: ${missing.join(', ')}`)
    return null
  }
  return gateway
}
