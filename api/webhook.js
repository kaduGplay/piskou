import { getGateway } from './_lib/gateway.js'
import { chargeKey, store } from './_lib/store.js'

// POST /api/webhook — o gateway avisa aqui quando um pagamento muda de status.
// É aqui que a venda vira acesso: quando o status passa a 'paid', envie o e-mail de acesso ao cliente.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' })

  const gateway = getGateway()
  if (!gateway?.handleWebhook) return res.status(501).json({ error: 'Webhook não configurado.' })

  let event
  try {
    event = await gateway.handleWebhook(req)
  } catch (error) {
    console.error('webhook: aviso rejeitado', error.message)
    return res.status(401).json({ error: 'Aviso inválido.' })
  }
  console.log('webhook: aviso recebido', {
    orderId: event.orderId,
    id: event.id,
    status: event.rawStatus,
    conferidoNaVoid: event.verified,
    campos: event.fields,
  })

  const key = chargeKey(event.id)
  const charge = await store.get(key)
  if (!charge || charge.orderId !== event.orderId) {
    console.error('webhook: cobrança desconhecida', { orderId: event.orderId, id: event.id })
    return res.status(404).json({ error: 'Cobrança não encontrada.' })
  }
  if (charge.status !== event.status) {
    await store.set(key, { ...charge, status: event.status, updatedAt: new Date().toISOString() })
    if (event.status === 'paid') {
      // liberar acesso: enviar o e-mail com o login para o cliente
    }
  }
  return res.status(200).json({ received: true })
}
