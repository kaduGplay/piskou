import { createHash } from 'node:crypto'

// API de Conversões da Meta: envia a compra confirmada pelo servidor. No OXXO o pagamento cai horas depois,
// com a página fechada, e o Pixel do navegador não veria a venda. O event_id é o ID da transação, o mesmo
// eventID que o Pixel usa no navegador, então a Meta conta a compra uma vez só.
// Configuração: META_PIXEL_ID e META_ACCESS_TOKEN nas variáveis de ambiente do servidor.

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0'
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

function cookie(req, name) {
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(req.headers?.cookie ?? '')
  return match ? decodeURIComponent(match[1]) : undefined
}

// Dados da visita guardados junto da cobrança, para a Meta casar a compra com o anúncio quando o pagamento chegar.
export function metaVisit(req, siteUrl) {
  return {
    ip: String(req.headers?.['x-forwarded-for'] ?? req.headers?.['x-real-ip'] ?? '').split(',')[0].trim() || undefined,
    userAgent: String(req.headers?.['user-agent'] ?? '').slice(0, 400) || undefined,
    fbp: cookie(req, '_fbp'),
    fbc: cookie(req, '_fbc'),
    sourceUrl: req.headers?.referer || (siteUrl ? new URL('/checkout', siteUrl).toString() : undefined),
  }
}

// Nunca derruba o pagamento: falha da Meta só vai para o log.
export async function sendMetaPurchase(chargeId, charge) {
  const pixelId = process.env.META_PIXEL_ID
  const accessToken = process.env.META_ACCESS_TOKEN
  if (!pixelId || !accessToken) return false
  const email = charge.customer?.email?.trim().toLowerCase()
  const firstName = charge.customer?.name?.trim().split(/\s+/)[0]?.toLowerCase()
  const visit = charge.meta ?? {}
  const event = {
    event_name: 'Purchase',
    event_time: Math.floor(Date.now() / 1000),
    event_id: String(chargeId),
    action_source: 'website',
    event_source_url: visit.sourceUrl,
    user_data: {
      em: email ? [sha256(email)] : undefined,
      fn: firstName ? [sha256(firstName)] : undefined,
      external_id: charge.chatId ? [sha256(String(charge.chatId))] : undefined,
      client_ip_address: visit.ip,
      client_user_agent: visit.userAgent,
      fbp: visit.fbp,
      fbc: visit.fbc,
    },
    custom_data: {
      currency: charge.currency || 'MXN',
      value: Number(charge.amount),
      content_ids: [charge.planId],
      content_type: 'product',
      num_items: 1,
    },
  }
  try {
    const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [event], access_token: accessToken }),
      signal: AbortSignal.timeout(5000),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      console.error('meta: compra recusada pela API de Conversões', { status: response.status, error: data.error?.message })
      return false
    }
    return true
  } catch (error) {
    console.error('meta: falha ao enviar a compra', error.message)
    return false
  }
}
