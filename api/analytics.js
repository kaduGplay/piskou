import { createHmac } from 'node:crypto'
import { chatDatabase } from './_lib/chat.js'
import { sameOrigin, UUID } from './_lib/analytics.js'
const events = new Set([
  'ChatRespostaRecebida',
  'ChatLimiteExibido',
  'ChatErro',
  'CheckoutErro',
  'page_view',
  'heartbeat',
  'Etapa do criador',
  'Clicou em Criar Namorada',
  'Clicou em Criar',
  'Visualizou a Oferta',
  'Clicou no botão para ir ao Checkout',
  'Visualizou o Checkout',
  'ChatMensagemEnviada',
  'ChatFotoSolicitada',
  'ChatVideoSolicitado',
  'Trocou de plano no checkout',
])
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Método inválido' })
  if (!sameOrigin(req))
    return res.status(403).json({ error: 'Origem inválida' })
  const b = req.body || {}
  if (
    !UUID.test(b.session || '') ||
    !UUID.test(b.visitor || '') ||
    !events.has(b.event) ||
    !['/', '/chat', '/checkout'].includes(b.page) ||
    ![
      '',
      'style',
      'general',
      'face',
      'body',
      'details',
      'generating',
      '1',
      '2',
      '3',
    ].includes(b.step || '') ||
    JSON.stringify(b).length > 1800
  )
    return res.status(400).json({ error: 'Evento inválido' })
  try {
    const ip = String(
      req.headers['x-vercel-forwarded-for'] ||
        req.headers['x-forwarded-for'] ||
        req.socket?.remoteAddress ||
        'unknown',
    )
      .split(',')[0]
      .trim()
    const key = createHmac('sha256', process.env.CHAT_SESSION_SECRET)
      .update(ip)
      .digest('hex')
    const allowed = await chatDatabase('rpc/piskou_analytics_limit', {
      p_key: `traffic:${key}`,
      p_max: 3000,
    })
    if (!allowed) return res.status(429).json({ error: 'Limite de eventos' })
    await chatDatabase('rpc/piskou_analytics_record', {
      p_id: b.session,
      p_visitor: b.visitor,
      p_page: b.page,
      p_event: b.event,
      p_step: b.step || '',
      p_source:
        String(b.source || 'direto')
          .replace(/[^a-zA-Z0-9._ -]/g, '')
          .slice(0, 80) || 'direto',
      p_device: b.device === 'mobile' ? 'mobile' : 'desktop',
    })
    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error('analytics:', error.message)
    return res.status(503).json({ error: 'Métricas indisponíveis' })
  }
}
