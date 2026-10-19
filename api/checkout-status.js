import { chatSession, chatDatabase } from './_lib/chat.js'
import { getGateway } from './_lib/gateway.js'
import { chargeKey, store } from './_lib/store.js'

// GET /api/checkout-status?id=... — consultado pela tela de pagamento (SPEI/OXXO) enquanto espera a confirmação.
// Gateways com confirmação por webhook (LiberPay) são lidos do store, nunca consultados direto.
export default async function handler(req, res) {
  if (req.method !== 'GET')
    return res.status(405).json({ error: 'Método no permitido.' })

  const gateway = getGateway()
  if (!gateway)
    return res
      .status(503)
      .json({ error: 'El pago no está disponible en este momento.' })

  const id = typeof req.query?.id === 'string' ? req.query.id : ''
  if (!id || id.length > 120)
    return res.status(400).json({ error: 'Cobro inválido.' })

  try {
    const session = chatSession(req, res)
    const saved = await store.get(chargeKey(id))
    if (!session || saved?.chatId !== session)
      return res.status(404).json({ error: 'No encontramos el cobro.' })
    let status
    if (gateway.confirmsByWebhook) {
      status = saved.status ?? null
    } else {
      const gatewayStatus = await gateway.getChargeStatus(id)
      if (gatewayStatus)
        await store.set(chargeKey(id), {
          ...saved,
          status: gatewayStatus,
          gatewayStatus,
        })
      status = (await store.get(chargeKey(id)))?.status || null
    }
    if (status === 'paid') {
      if (saved.status !== 'paid')
        await store.set(chargeKey(id), { ...saved, status })
      await chatDatabase('rpc/piskou_chat_grant', {
        p_id: session,
        p_charge: id,
      })
    }
    if (!status)
      return res.status(404).json({ error: 'No encontramos el cobro.' })
    res.setHeader('Cache-Control', 'no-store')
    return res
      .status(200)
      .json({ id, status, source: saved.statusSource || 'gateway' })
  } catch (error) {
    console.error('checkout-status: falha ao consultar cobrança', error.message)
    return res
      .status(502)
      .json({ error: 'No se pudo consultar el pago.' })
  }
}
