import { createHmac, timingSafeEqual } from 'node:crypto'
import { missingStoreConfig } from './store.js'

// Integração com a Void Payments (só PIX).
// Credenciais: VOIDPAY_PUBLIC_KEY e VOIDPAY_SECRET_KEY nas variáveis de ambiente do servidor.
// O checkout não pede CPF nem telefone ao cliente. A Void exige telefone (apesar da documentação dizer que é opcional),
// então VOIDPAY_FIXED_PHONE e VOIDPAY_FIXED_DOCUMENT vão em todas as cobranças.

const BASE_URL = 'https://dash.voidpayments.com/api/v1/gateway'
const REQUEST_TIMEOUT_MS = 15000

// Status da transação na Void (`transactionStatus` na criação, `status` na consulta) -> status do checkout.
const STATUS_MAP = {
  PENDING: 'pending',
  COMPLETED: 'paid',
  FAILED: 'failed',
  REFUNDED: 'failed',
  CHARGED_BACK: 'failed',
  EXPIRED: 'expired',
}
const FAILED_CREATE_STATUSES = ['FAILED', 'REJECTED', 'CANCELED']

// Campo da Void com erro -> campo do formulário do checkout.
const FIELD_MAP = { 'client.name': 'name', 'client.email': 'email' }
const FIELD_MESSAGES = {
  name: 'Confira como você quer ser chamado.',
  email: 'Confira seu e-mail.',
}

export class GatewayError extends Error {
  constructor(message, { status, errorCode, fields, issues } = {}) {
    super(message)
    this.name = 'GatewayError'
    this.status = status
    this.errorCode = errorCode
    this.fields = fields
    this.issues = issues
  }
}

function credentials() {
  const publicKey = process.env.VOIDPAY_PUBLIC_KEY
  const secretKey = process.env.VOIDPAY_SECRET_KEY
  if (!publicKey || !secretKey) throw new GatewayError('VOIDPAY_PUBLIC_KEY e VOIDPAY_SECRET_KEY não estão configuradas.')
  return { publicKey, secretKey }
}

// Lista legível dos campos recusados (para o log), incluindo erros aninhados em `unionErrors`.
function describeIssues(details) {
  if (!Array.isArray(details)) return undefined
  return details
    .flatMap((item) => (item?.unionErrors ? item.unionErrors.flatMap((u) => u.issues ?? []) : [item]))
    .map((item) => `${[].concat(item?.path ?? []).join('.')}: ${item?.message ?? item?.error?.message ?? '?'}`)
}

// A documentação diz `{ path: "amount", error: { message } }`, mas a API devolve `{ path: ["amount"], message }`.
function fieldErrors(details) {
  if (!Array.isArray(details)) return undefined
  const fields = {}
  for (const item of details) {
    const path = Array.isArray(item?.path) ? item.path.join('.') : String(item?.path ?? '')
    const field = FIELD_MAP[path]
    if (field) fields[field] = FIELD_MESSAGES[field]
  }
  return Object.keys(fields).length > 0 ? fields : undefined
}

async function request(method, path, body) {
  const { publicKey, secretKey } = credentials()
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-public-key': publicKey, 'x-secret-key': secretKey },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new GatewayError(data.message || `Void Payments respondeu HTTP ${response.status}`, {
      status: response.status,
      errorCode: data.errorCode,
      fields: fieldErrors(data.details),
      issues: describeIssues(data.details),
    })
  }
  return data
}

// GET /transactions?id=<transactionId>: não está no trecho da documentação recebido; confirmado na API.
// Devolve { id, clientIdentifier, amount, status, payedAt, paymentMethod, ... } ou null se não existir.
async function getTransaction(id) {
  try {
    return await request('GET', `/transactions?id=${encodeURIComponent(id)}`)
  } catch (error) {
    if (error.status === 404) return null
    throw error
  }
}

// A Void avisa mudanças de status no callbackUrl. Assinamos o próprio URL com HMAC da chave secreta,
// assim o webhook só aceita avisos de pedidos criados por nós, sem precisar de banco de dados.
function callbackSignature(orderId) {
  return createHmac('sha256', credentials().secretKey).update(`callback:${orderId}`).digest('hex')
}

function callbackUrl(siteUrl, orderId) {
  if (!siteUrl) return undefined
  const url = new URL('/api/webhook', siteUrl)
  url.searchParams.set('order', orderId)
  url.searchParams.set('sig', callbackSignature(orderId))
  return url.toString()
}

function isValidCallback(orderId, signature) {
  if (typeof orderId !== 'string' || typeof signature !== 'string') return false
  const expected = Buffer.from(callbackSignature(orderId))
  const received = Buffer.from(signature)
  return expected.length === received.length && timingSafeEqual(expected, received)
}

export const voidpayGateway = {
  testMode: false,
  methods: ['pix'],

  // A Void bloqueia consultas repetidas de status ("Receba atualizações via webhook"):
  // o pagamento é confirmado só pelo webhook, que grava o status no store.
  confirmsByWebhook: true,

  // Sem chaves, sem telefone fixo ou sem Redis (na Vercel) o pagamento não funciona: avisa antes de a pessoa preencher.
  missingConfig() {
    const missing = ['VOIDPAY_PUBLIC_KEY', 'VOIDPAY_SECRET_KEY', 'VOIDPAY_FIXED_PHONE'].filter((key) => !process.env[key])
    return [...missing, ...missingStoreConfig()]
  },

  async createPixCharge(order) {
    const amount = order.amountCents / 100
    const data = await request('POST', '/pix/receive', {
      identifier: order.id,
      amount,
      client: {
        name: order.customer.name,
        email: order.customer.email,
        phone: process.env.VOIDPAY_FIXED_PHONE || undefined,
        document: process.env.VOIDPAY_FIXED_DOCUMENT || undefined,
      },
      products: [{ id: order.plan.id, name: `Piskou ${order.plan.name}`, quantity: 1, price: amount }],
      metadata: { provider: 'Piskou Checkout', orderId: order.id, plan: order.plan.id, ...order.metadata.tracking },
      callbackUrl: callbackUrl(order.siteUrl, order.id),
    })

    if (FAILED_CREATE_STATUSES.includes(data.status)) {
      console.error('voidpay: cobrança recusada', { status: data.status, errorDescription: data.errorDescription })
      return { id: data.transactionId, status: 'failed' }
    }
    return {
      id: data.transactionId,
      status: STATUS_MAP[data.transactionStatus] ?? 'pending',
      pix: { copyPaste: data.pix?.code, expiresAt: data.pix?.expiresAt ?? null },
    }
  },

  // O URL assinado prova que o aviso veio da Void para um pedido nosso. Quando possível, o status é
  // conferido na própria Void (uma consulta por aviso); se a Void limitar a consulta, vale o status do aviso.
  async handleWebhook(req) {
    const orderId = req.query?.order
    if (!isValidCallback(orderId, req.query?.sig)) throw new GatewayError('Assinatura do callback inválida.')
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
    const transactionId = body.transactionId ?? body.id ?? body.transaction?.id ?? body.data?.id
    if (typeof transactionId !== 'string') {
      throw new GatewayError(`Aviso sem ID de transação (campos: ${Object.keys(body).join(', ')}).`)
    }
    let rawStatus = body.transactionStatus ?? body.status ?? body.transaction?.status ?? body.data?.status
    let verified = false
    try {
      const transaction = await getTransaction(transactionId)
      if (!transaction) throw new GatewayError('Transação do aviso não existe na Void.')
      if (transaction.clientIdentifier !== orderId) throw new GatewayError('Transação do aviso não pertence a este pedido.')
      rawStatus = transaction.status
      verified = true
    } catch (error) {
      // Transação inexistente ou de outro pedido: rejeita. Limite/instabilidade da Void: segue com o aviso.
      if (!error.status || (error.status !== 429 && error.status < 500)) throw error
    }
    return { orderId, id: transactionId, status: STATUS_MAP[rawStatus] ?? 'pending', rawStatus, verified, fields: Object.keys(body) }
  },
}
