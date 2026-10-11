import { chatSession, chatDatabase } from './_lib/chat.js'
import { getGateway } from './_lib/gateway.js'
import { chargeKey, store } from './_lib/store.js'

// GET /api/checkout-status?id=... — consultado pela tela do PIX enquanto espera o pagamento.
// Gateways com confirmação por webhook (Void) são lidos do store, nunca consultados direto.
export default async function handler(req, res) {
  if (req.method !== 'GET')
    return res.status(405).json({ error: 'Método não permitido.' })

  const gateway = getGateway()
  if (!gateway)
    return res
      .status(503)
      .json({ error: 'O pagamento está indisponível no momento.' })

  const id = typeof req.query?.id === 'string' ? req.query.id : ''
  if (!id || id.length > 120)
    return res.status(400).json({ error: 'Cobrança inválida.' })

  try {
    const session = chatSession(req, res)
    const saved = await store.get(chargeKey(id))
    if (!session || saved?.chatId !== session)
      return res.status(404).json({ error: 'Cobrança não encontrada.' })
    let status
    if (gateway.confirmsByWebhook) {
      status = saved.status ?? null
    } else {
      status = await gateway.getChargeStatus(id)
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
      return res.status(404).json({ error: 'Cobrança não encontrada.' })
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({ id, status })
  } catch (error) {
    console.error('checkout-status: falha ao consultar cobrança', error.message)
    return res
      .status(502)
      .json({ error: 'Não foi possível consultar o pagamento.' })
  }
}
