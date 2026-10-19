import { timingSafeEqual } from 'node:crypto'
import { chargeKey, missingStoreConfig, store } from './store.js'

// Integração com a LiberPay para o México: depósito em pesos por SPEI (CLABE) ou OXXO (referência + código de barras).
// Credenciais: LIBERPAY_CLIENT_ID e LIBERPAY_CLIENT_SECRET, trocadas por um token em POST /auth/token.
// A conta da LiberPay só aceita chamadas de IPs liberados: as chamadas saem só das regiões da Vercel com IP fixo
// (LIBERPAY_STATIC_REGIONS, padrão iad1), e api/checkout.js roda nessa região (vercel.json).

const BASE_URL = 'https://api.liberpay.pro'
const REQUEST_TIMEOUT_MS = 12000
const CREATE_ATTEMPTS = 3
// O token pode não informar a validade; renova com folga antes de expirar.
const DEFAULT_TOKEN_TTL_MS = 30 * 60 * 1000
const TOKEN_MARGIN_MS = 60 * 1000

// Status da LiberPay (criação e webhook) -> status do checkout.
const STATUS_MAP = {
  pending: 'pending',
  paid: 'paid',
  failed: 'failed',
  cancelled: 'expired',
  canceled: 'expired',
  refunded: 'failed',
}
const EVENT_STATUS = {
  'payment.created': 'pending',
  'payment.paid': 'paid',
  'payment.failed': 'failed',
  'payment.cancelled': 'expired',
  'payment.refunded': 'failed',
}

export class GatewayError extends Error {
  constructor(message, { status, errorCode, issues } = {}) {
    super(message)
    this.name = 'GatewayError'
    this.status = status
    this.errorCode = errorCode
    this.issues = issues
  }
}

const staticRegions = () =>
  (process.env.LIBERPAY_STATIC_REGIONS || 'iad1')
    .split(',')
    .map((region) => region.trim())
    .filter(Boolean)

// Só gera cobrança saindo pelos IPs fixos: fora dessas regiões (inclusive localmente) a chamada nem é feita.
function assertStaticEgress() {
  const region = process.env.VERCEL_REGION
  if (!staticRegions().includes(region)) {
    throw new GatewayError(
      `LiberPay só é chamada pelas regiões com IP fixo (${staticRegions().join(', ')}); esta função rodou em ${region || 'ambiente sem região da Vercel'}.`,
      { status: 503, errorCode: 'STATIC_IP_REQUIRED' },
    )
  }
}

// IP de saída desta função, para o log quando a LiberPay recusar o endereço.
async function egressIp() {
  try {
    const response = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(3000) })
    return (await response.json()).ip
  } catch {
    return 'desconhecido'
  }
}

let cachedToken = null

async function accessToken(force = false) {
  if (!force && cachedToken && cachedToken.expiresAt - TOKEN_MARGIN_MS > Date.now()) return cachedToken.value
  const response = await fetch(`${BASE_URL}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: process.env.LIBERPAY_CLIENT_ID, client_secret: process.env.LIBERPAY_CLIENT_SECRET }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 403) console.error('liberpay: IP recusado ao pedir o token', { ip: await egressIp(), message: data.error })
    throw new GatewayError(`LiberPay /auth/token: ${data.error || data.message || `HTTP ${response.status}`}`, { status: response.status })
  }
  // O formato da resposta do token não está na documentação recebida: aceita os nomes usuais.
  const source = data.data ?? data
  const value = source.access_token ?? source.accessToken ?? source.token
  if (typeof value !== 'string' || !value) {
    throw new GatewayError(`LiberPay /auth/token sem token (campos: ${Object.keys(source).join(', ')}).`)
  }
  const seconds = Number(source.expires_in ?? source.expiresIn)
  cachedToken = { value, expiresAt: Date.now() + (seconds > 0 ? seconds * 1000 : DEFAULT_TOKEN_TTL_MS) }
  return value
}

async function request(method, path, body) {
  assertStaticEgress()
  for (let refreshed = false; ; refreshed = true) {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await accessToken(refreshed)}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const data = await response.json().catch(() => ({}))
    // Token vencido antes do previsto: pede outro uma vez.
    if (response.status === 401 && !refreshed) continue
    if (!response.ok) {
      if (response.status === 403) console.error('liberpay: IP recusado', { ip: await egressIp(), message: data.error })
      throw new GatewayError(`LiberPay ${path}: ${data.message || data.error || `HTTP ${response.status}`}`, {
        status: response.status,
        errorCode: data.code,
      })
    }
    return data
  }
}

// Tempo esgotado, falha de rede ou 5xx: vale tentar de novo (o external_id evita cobrança duplicada).
function retryable(error) {
  return error?.name === 'TimeoutError' || error?.name === 'AbortError' || error instanceof TypeError || error?.status >= 500
}

// O webhook é cadastrado no portal da LiberPay como <site>/api/webhook?key=<LIBERPAY_WEBHOOK_SECRET>.
function isValidWebhookKey(key) {
  const expected = Buffer.from(process.env.LIBERPAY_WEBHOOK_SECRET || '')
  const received = Buffer.from(typeof key === 'string' ? key : '')
  return expected.length > 0 && expected.length === received.length && timingSafeEqual(expected, received)
}

export const liberpayGateway = {
  testMode: false,
  currency: 'MXN',
  methods: ['spei', 'oxxo'],

  // SPEI confirma em segundos e OXXO em horas; os dois chegam pelo webhook payment.paid, gravado no store.
  confirmsByWebhook: true,

  missingConfig() {
    const missing = ['LIBERPAY_CLIENT_ID', 'LIBERPAY_CLIENT_SECRET', 'LIBERPAY_WEBHOOK_SECRET'].filter((key) => !process.env[key])
    return [...missing, ...missingStoreConfig()]
  },

  async createDeposit(order, method) {
    if (!this.methods.includes(method)) throw new GatewayError(`Forma de pagamento não suportada: ${method}`)
    const site = order.siteUrl || ''
    const body = {
      amount: order.amountCents / 100,
      external_id: order.id,
      payment_method: method,
      currency: 'MXN',
      // O e-mail é obrigatório em MXN; documento não é usado por SPEI/OXXO.
      payer: { name: order.customer.name, email: order.customer.email },
      metadata: {
        provider: 'Piskou',
        user_email: order.customer.email,
        order_id: order.id,
        checkout_url: site && new URL('/checkout', site).toString(),
        shop_url: site,
      },
    }
    let data
    for (let attempt = 1; ; attempt++) {
      try {
        data = await request('POST', '/payments/deposit', body)
        break
      } catch (error) {
        if (attempt >= CREATE_ATTEMPTS || !retryable(error)) throw error
        console.warn('liberpay: nova tentativa de criar o depósito', { attempt, message: error.message, status: error.status })
      }
    }
    const result = data.qrCodeResponse ?? data
    if (!result.transactionId || !result.qrcode) {
      throw new GatewayError(`LiberPay: depósito sem transactionId/qrcode (campos: ${Object.keys(result).join(', ')}).`)
    }
    return {
      id: result.transactionId,
      status: STATUS_MAP[result.status] ?? 'pending',
      // SPEI: qrcode é a CLABE (18 dígitos). OXXO: a referência, com a imagem do código de barras.
      // O instructionText da LiberPay vem em português; a página mostra as próprias instruções em espanhol.
      deposit: { method, code: String(result.qrcode), barcodeUrl: result.barcodeUrl ?? null, expiresAt: null },
    }
  },

  // A chave secreta no URL prova que o aviso veio da LiberPay. A transação precisa existir no nosso store
  // e o valor precisa bater com a cobrança; avisos repetidos não mudam nada (o webhook é idempotente).
  async handleWebhook(req) {
    if (!isValidWebhookKey(req.query?.key)) throw new GatewayError('Chave do webhook inválida.')
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
    const data = body.data ?? {}
    const id = data.transaction_id ?? data.transactionId ?? data.id
    if (typeof id !== 'string' || !id) {
      throw new GatewayError(`Aviso sem ID de transação (campos: ${Object.keys(body).join(', ')}).`)
    }
    const charge = await store.get(chargeKey(id))
    if (!charge?.orderId) throw new GatewayError('Cobrança do aviso não encontrada.')
    if (data.amount != null && Math.round(Number(data.amount) * 100) !== Math.round(Number(charge.amount) * 100)) {
      throw new GatewayError(`Valor do aviso (${data.amount}) não confere com a cobrança (${charge.amount}).`)
    }
    const rawStatus = body.event ?? data.status
    return {
      orderId: charge.orderId,
      id,
      status: EVENT_STATUS[body.event] ?? STATUS_MAP[data.status] ?? 'pending',
      rawStatus,
      verified: false,
      fields: Object.keys(body),
    }
  },
}
