import { randomUUID } from 'node:crypto'
import { PLANS, pickCampaignParams, toCents, validateCustomer } from '../src/shared/checkout.js'
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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' })

  const gateway = getGateway()
  if (!gateway) return res.status(503).json({ error: 'O pagamento está indisponível no momento.' })

  const { planId, method, customer, cardToken, tracking } = req.body ?? {}
  const plan = PLANS[planId]
  if (!plan) return res.status(400).json({ error: 'Plano inválido.' })
  if (!gateway.methods.includes(method)) return res.status(400).json({ error: 'Forma de pagamento indisponível.' })

  const errors = validateCustomer(customer)
  if (Object.keys(errors).length > 0) return res.status(400).json({ error: 'Confira seus dados.', fields: errors })
  if (method === 'card' && (typeof cardToken !== 'string' || !cardToken)) {
    return res.status(400).json({ error: 'Não foi possível validar o cartão.' })
  }

  const order = {
    id: `piskou_${randomUUID()}`,
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
    const charge =
      method === 'pix' ? await gateway.createPixCharge(order) : await gateway.createCardCharge({ ...order, cardToken })
    // Com confirmação por webhook, o pedido precisa ficar registrado para o aviso e a tela do PIX se encontrarem.
    if (gateway.confirmsByWebhook && charge.id) {
      await store.set(chargeKey(charge.id), {
        orderId: order.id,
        planId: plan.id,
        amount: plan.price,
        method,
        status: charge.status,
        createdAt: new Date().toISOString(),
      })
    }
    return res.status(200).json({
      id: charge.id,
      status: charge.status,
      method,
      planId: plan.id,
      amount: plan.price,
      pix: charge.pix ?? null,
      testMode: gateway.testMode === true,
    })
  } catch (error) {
    console.error('checkout: falha ao criar cobrança', {
      message: error.message,
      errorCode: error.errorCode,
      status: error.status,
      issues: error.issues,
    })
    if (error.fields) return res.status(400).json({ error: 'Confira seus dados.', fields: error.fields })
    return res.status(502).json({ error: 'Não foi possível processar o pagamento. Tente novamente.' })
  }
}
