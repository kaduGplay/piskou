import { getGateway } from './_lib/gateway.js'

// GET /api/checkout-config — diz à página quais formas de pagamento o gateway atual aceita.
export default async function handler(req, res) {
  const gateway = getGateway()
  res.setHeader('Cache-Control', 'no-store')
  if (!gateway) return res.status(200).json({ available: false, methods: [], testMode: false })
  return res.status(200).json({ available: true, methods: gateway.methods, testMode: gateway.testMode === true })
}
