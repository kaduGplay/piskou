import { chatSession, chatSelection, chatDatabase } from './_lib/chat.js'
import { sameOrigin } from './_lib/analytics.js'
import { UUID } from './_lib/analytics.js'
import { randomUUID } from 'node:crypto'
import {
  PLANS,
  pickCampaignParams,
  toCents,
  validateCustomer,
} from '../src/shared/checkout.js'
import { getGateway } from './_lib/gateway.js'
import { chargeKey, store } from './_lib/store.js'

// Endereço público do site, usado no callback do gateway. Em localhost não há como o gateway chamar de volta.
function publicSiteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL
  const host = req.headers['x-forwarded-host'] ?? req.headers.host
  if (!host || /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return null
  return `https://${host}`
}

// POST /api/checkout — cria a cobrança (PIX ou cartão) do plano escolhido.
// O valor vem sempre do catálogo de planos; o navegador só informa qual plano é.
export default async function handler(req, res) {
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Método não permitido.' })

  if (!sameOrigin(req))
    return res.status(403).json({ error: 'Origem inválida.' })
  const selection = chatSelection(req.body?.selection)
  if (!selection)
    return res
      .status(400)
      .json({ error: 'Configure sua personagem antes de comprar.' })
  let session = chatSession(req, res, true)
  const gateway = getGateway()
  if (!gateway)
    return res
      .status(503)
      .json({ error: 'O pagamento está indisponível no momento.' })

  const {
    planId,
    method,
    customer: suppliedCustomer,
    cardToken,
    tracking,
    analyticsSession,
    requestId,
  } = req.body ?? {}
  const customer =
    method === 'pix'
      ? { name: 'Usuario Piskou', email: 'vasconcelosescala@gmail.com' }
      : suppliedCustomer
  if (requestId && !UUID.test(requestId))
    return res.status(400).json({ error: 'Pedido inválido.' })
  const plan = PLANS[planId]
  if (!plan) return res.status(400).json({ error: 'Plano inválido.' })
  if (!gateway.methods.includes(method))
    return res.status(400).json({ error: 'Forma de pagamento indisponível.' })

  const errors = validateCustomer(customer)
  if (Object.keys(errors).length > 0)
    return res
      .status(400)
      .json({ error: 'Confira seus dados.', fields: errors })
  if (method === 'card' && (typeof cardToken !== 'string' || !cardToken)) {
    return res.status(400).json({ error: 'Não foi possível validar o cartão.' })
  }

  const order = {
    id: `piskou_${requestId || randomUUID()}`,
    amountCents: toCents(plan.price),
    plan,
    customer: {
      name: customer.name.trim(),
      email: customer.email.trim().toLowerCase(),
    },
    metadata: { tracking: pickCampaignParams(tracking) },
    siteUrl: publicSiteUrl(req),
  }

  try {
    const existing = await chatDatabase(
      `piskou_chat_sessions?id=eq.${session}&select=allowance,unlimited,selection&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`,
    )
    const changed =
      existing[0] &&
      Object.keys(selection).some(
        (key) => existing[0].selection[key] !== selection[key],
      )
    if (plan.purpose === 'messages' && (!existing[0]?.allowance || changed))
      return res.status(403).json({
        error: 'Compre mensagens para a personagem do seu acesso atual.',
      })
    if (changed) session = chatSession(req, res, true, true)
    const requestKey =
      method === 'pix' && requestId
        ? `checkout:${session}:${plan.id}:${requestId}`
        : null
    if (requestKey) {
      const previous = await store.get(requestKey)
      if (
        previous &&
        Object.keys(selection).every(
          (key) => previous.selection?.[key] === selection[key],
        ) &&
        (!previous.response.pix?.expiresAt ||
          new Date(previous.response.pix.expiresAt).getTime() > Date.now())
      )
        return res.status(200).json(previous.response)
    }
    const charge =
      method === 'pix'
        ? await gateway.createPixCharge(order)
        : await gateway.createCardCharge({ ...order, cardToken })
    // Com confirmação por webhook, o pedido precisa ficar registrado para o aviso e a tela do PIX se encontrarem.
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
        amount: plan.price,
        method,
        status: charge.status,
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
      amount: plan.price,
      pix: charge.pix ?? null,
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
        .json({ error: 'Confira seus dados.', fields: error.fields })
    return res.status(502).json({
      error: 'Não foi possível processar o pagamento. Tente novamente.',
    })
  }
}
