import {
  chatSession,
  chatSelection,
  chatDatabase,
  sameChatSelection,
} from './_lib/chat.js'
import { sameOrigin } from './_lib/analytics.js'
import { UUID } from './_lib/analytics.js'
import { randomUUID, createHash } from 'node:crypto'
import {
  CURRENCY,
  PLANS,
  pickCampaignParams,
  validateCustomer,
  quoteCheckout,
} from '../src/shared/checkout.js'
import { getGateway } from './_lib/gateway.js'
import { metaVisit } from './_lib/meta.js'
import { chargeKey, store } from './_lib/store.js'

// Endereço público do site, usado no callback do gateway. Em localhost não há como o gateway chamar de volta.
function publicSiteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL
  const host = req.headers['x-forwarded-host'] ?? req.headers.host
  if (!host || /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return null
  return `https://${host}`
}

// Telefone de quem comprou o upsell "ela te chama no WhatsApp". O banco confere a compra.
async function saveWhatsapp(req, res) {
  const session = chatSession(req, res, false)
  // Celular mexicano: 10 dígitos, aceitos também com +52 ou +521; grava com o código do país (52).
  const local = String(req.body?.phone ?? '').replace(/\D/g, '').replace(/^52(1)?(?=\d{10}$)/, '')
  if (!session) return res.status(403).json({ error: 'No encontramos tu sesión.' })
  if (!/^\d{10}$/.test(local)) return res.status(400).json({ error: 'Escribe tu WhatsApp a 10 dígitos.' })
  try {
    const saved = await chatDatabase('rpc/piskou_upsell_contact', { p_id: session, p_phone: `52${local}` })
    if (!saved) return res.status(403).json({ error: 'El pago todavía no está confirmado.' })
    return res.status(200).json({ ok: true })
  } catch {
    return res.status(502).json({ error: 'No se pudo guardar en este momento. Intenta de nuevo.' })
  }
}

// POST /api/checkout — cria a cobrança (depósito SPEI ou OXXO, em pesos) do plano escolhido.
// O valor vem sempre do catálogo de planos; o navegador só informa qual plano é.
export default async function handler(req, res) {
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Método no permitido.' })

  if (!sameOrigin(req))
    return res.status(403).json({ error: 'Origen inválido.' })
  if (req.body?.action === 'whatsapp') return saveWhatsapp(req, res)
  const selection = chatSelection(req.body?.selection)
  if (!selection)
    return res
      .status(400)
      .json({ error: 'Configura a tu personaje antes de comprar.' })
  let session = chatSession(req, res, true)
  const gateway = getGateway()
  if (!gateway)
    return res
      .status(503)
      .json({ error: 'El pago no está disponible en este momento.' })

  const {
    planId,
    method,
    customer: suppliedCustomer,
    tracking,
    analyticsSession,
    requestId,
  } = req.body ?? {}
  const customer = suppliedCustomer
  if (requestId && !UUID.test(requestId))
    return res.status(400).json({ error: 'Pedido inválido.' })
  const plan = PLANS[planId]
  if (!plan) return res.status(400).json({ error: 'Plan inválido.' })
  let quote
  try { quote = quoteCheckout(planId, req.body?.addons) } catch (error) { return res.status(400).json({ error: error.message }) }
  if (!gateway.methods.includes(method))
    return res.status(400).json({ error: 'Forma de pago no disponible.' })

  const errors = validateCustomer(customer)
  if (Object.keys(errors).length > 0)
    return res
      .status(400)
      .json({ error: 'Revisa tus datos.', fields: errors })

  const order = {
    id: `piskou_${requestId || randomUUID()}_${createHash('sha256').update(`${plan.id}:${quote.totalCents}:${quote.addonIds.join(',')}:${method}`).digest('hex').slice(0, 10)}`,
    amountCents: quote.totalCents,
    plan,
    customer: {
      name: customer.name.trim(),
      email: customer.email.trim().toLowerCase(),
    },
    metadata: { tracking: pickCampaignParams(tracking), addons: quote.addonIds },
    siteUrl: publicSiteUrl(req),
  }

  try {
    const existing = await chatDatabase(
      `piskou_chat_sessions?id=eq.${session}&select=allowance,unlimited,selection&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`,
    )
    const changed =
      existing[0] && !sameChatSelection(existing[0].selection, selection)
    if (plan.purpose === 'messages' && (!existing[0]?.allowance || changed))
      return res.status(403).json({
        error: 'Compra mensajes para el personaje de tu acceso actual.',
      })
    if (plan.purpose === 'upsell') {
      // Upsell de um clique: só depois do Baby/Pro desta conversa, e uma vez por item.
      const owned = changed
        ? []
        : await chatDatabase(`piskou_chat_purchases?chat_id=eq.${session}&active=eq.true&select=plan_id`)
      if (!owned.some((item) => ['premium-access', 'luxury-access'].includes(item.plan_id)))
        return res.status(403).json({ error: 'Completa tu acceso antes de esta oferta.' })
      if (owned.some((item) => item.plan_id === plan.id))
        return res.status(409).json({ error: 'Ya tienes esta oferta.', code: 'owned' })
    }
    if (changed) session = chatSession(req, res, true, true)
    const requestKey =
      requestId
        ? `checkout:${session}:${plan.id}:${quote.totalCents}:${quote.addonIds.join(',')}:${method}:${requestId}`
        : null
    if (requestKey) {
      const previous = await store.get(requestKey)
      const pending = previous?.response.deposit
      if (
        previous &&
        sameChatSelection(previous.selection, selection) &&
        (!pending?.expiresAt || new Date(pending.expiresAt).getTime() > Date.now())
      )
        return res.status(200).json(previous.response)
    }
    const charge = await gateway.createDeposit(order, method)
    // Com confirmação por webhook, o pedido precisa ficar registrado para o aviso e a tela de pagamento se encontrarem.
    if (charge.id) {
      await store.set(chargeKey(charge.id), {
        customer: {
          name: String(customer.name).trim(),
          email: String(customer.email).trim(),
        },
        chatId: session,
        selection,
        analyticsSession: UUID.test(analyticsSession || '')
          ? analyticsSession
          : null,
        orderId: order.id,
        planId: plan.id,
        amount: quote.amount,
        currency: CURRENCY,
        addons: quote.addonIds,
        method,
        status: charge.status,
        meta: metaVisit(req, order.siteUrl),
        createdAt: new Date().toISOString(),
      })
    }
    let accessReady = charge.status !== 'paid'
    if (charge.status === 'paid') {
      try {
        await chatDatabase('rpc/piskou_chat_grant', {
          p_id: session,
          p_charge: charge.id,
        })
        accessReady = true
      } catch {
        console.error(
          'checkout: liberação pendente; consulta de status tentará novamente',
        )
      }
    }
    const result = {
      id: charge.id,
      status: accessReady ? charge.status : 'processing',
      method,
      planId: plan.id,
      amount: quote.amount,
      addons: quote.addonIds,
      deposit: charge.deposit ?? null,
      testMode: gateway.testMode === true,
    }
    if (requestKey && charge.id && charge.status !== 'failed')
      await store.set(requestKey, { selection, response: result })
    return res.status(200).json(result)
  } catch (error) {
    console.error('checkout: falha ao criar cobrança', {
      message: error.message,
      errorCode: error.errorCode,
      status: error.status,
      issues: error.issues,
    })
    if (error.fields)
      return res
        .status(400)
        .json({ error: 'Revisa tus datos.', fields: error.fields })
    return res.status(502).json({
      error: 'No se pudo procesar el pago. Intenta de nuevo.',
    })
  }
}
