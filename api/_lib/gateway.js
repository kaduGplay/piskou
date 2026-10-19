import { CURRENCY } from '../../src/shared/checkout.js'
import { liberpayGateway } from './liberpay.js'

// Ponto único de integração com o gateway de pagamento.
//
// Para integrar outro gateway, crie um objeto com a mesma forma de `mockGateway`, registre em `GATEWAYS`
// e defina PAYMENT_GATEWAY=<nome> nas variáveis de ambiente da Vercel. Chaves secretas ficam só em
// variáveis de ambiente do servidor, nunca no código do site.
//
//   currency                     -> moeda cobrada (precisa ser a CURRENCY de src/shared/checkout.js)
//   methods                      -> formas aceitas: ['spei', 'oxxo']
//   missingConfig()              -> nomes de variáveis de ambiente que faltam (opcional)
//   createDeposit(order, method) -> { id, status, deposit: { method, code, barcodeUrl, expiresAt } }
//                                   (SPEI: code é a CLABE; OXXO: code é a referência e barcodeUrl a imagem)
//   confirmsByWebhook            -> true se o status só chega pelo webhook (fica no store; ver store.js)
//   getChargeStatus(id)          -> 'pending' | 'paid' | 'failed' | 'expired'   (gateways sem confirmsByWebhook)
//   handleWebhook(req)           -> { id, orderId, status, ... }                (usado por /api/webhook)
//
// `order` = { id, amountCents, plan, customer: { name, email }, metadata: { tracking }, siteUrl }
// `siteUrl` é o endereço público do site; vem vazio em localhost.

const MOCK_APPROVAL_MS = 10 * 1000

// Modo de teste: nada é cobrado. SPEI e OXXO são aprovados sozinhos ~10 s depois de gerados.
const mockGateway = {
  testMode: true,
  currency: CURRENCY,
  methods: ['spei', 'oxxo'],

  async createDeposit(order, method) {
    const createdAt = Date.now()
    return {
      id: `mock_${method}_${createdAt}_${Math.random().toString(36).slice(2, 8)}`,
      status: 'pending',
      deposit: {
        method,
        code: method === 'oxxo' ? '9300000000000000' : '000000000000000000',
        barcodeUrl: null,
        expiresAt: null,
      },
    }
  },

  async getChargeStatus(id) {
    const match = /^mock_(spei|oxxo)_(\d+)_/.exec(id)
    if (!match) return null
    return Date.now() - Number(match[2]) >= MOCK_APPROVAL_MS ? 'paid' : 'pending'
  },
}

const GATEWAYS = {
  mock: mockGateway,
  liberpay: liberpayGateway,
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
  // Os preços do site estão em CURRENCY: um gateway de outra moeda cobraria o número errado.
  if (gateway && gateway.currency !== CURRENCY) {
    console.error(`checkout: gateway "${name}" cobra em ${gateway.currency}, mas os preços estão em ${CURRENCY}`)
    return null
  }
  const missing = gateway?.missingConfig?.() ?? []
  if (missing.length > 0) {
    console.error(`checkout: gateway "${name}" sem configuração: ${missing.join(', ')}`)
    return null
  }
  return gateway
}
