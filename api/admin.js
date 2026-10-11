import { adminConversation } from './_lib/advisor.js'
import { createHmac } from 'node:crypto'
import { chatDatabase } from './_lib/chat.js'
import { sameOrigin } from './_lib/analytics.js'
import {
  authorized,
  equalSecret,
  adminToken,
  adminCookie,
} from './_lib/admin.js'
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow')
  if (!process.env.ADMIN_PASSWORD || !process.env.CHAT_SESSION_SECRET)
    return res.status(503).json({ error: 'Painel não configurado' })
  try {
    const action = req.query?.action || req.body?.action
    if (['chats', 'advisor'].includes(action)) {
      if (!authorized(req))
        return res.status(401).json({ error: 'Entre para acessar o painel' })
      if (req.method === 'POST' && !sameOrigin(req))
        return res.status(403).json({ error: 'Origem inválida' })
      const days = Number(req.query?.days || req.body?.days || 7)
      if (![1, 7, 30, 90].includes(days))
        return res.status(400).json({ error: 'Período inválido' })
      return await adminConversation(req, res, days)
    }
    if (req.method === 'POST') {
      if (!sameOrigin(req))
        return res.status(403).json({ error: 'Origem inválida' })
      if (req.body?.action === 'logout') {
        adminCookie(res, '', true)
        return res.status(200).json({ ok: true })
      }
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
        p_key: `login:${key}`,
        p_max: 8,
      })
      if (!allowed)
        return res
          .status(429)
          .json({ error: 'Muitas tentativas. Tente novamente em 15 minutos.' })
      if (
        typeof req.body?.password !== 'string' ||
        req.body.password.length > 200 ||
        !equalSecret(req.body.password, process.env.ADMIN_PASSWORD)
      )
        return res.status(401).json({ error: 'Senha incorreta' })
      adminCookie(res, adminToken())
      return res.status(200).json({ ok: true })
    }
    if (req.method !== 'GET')
      return res.status(405).json({ error: 'Método inválido' })
    if (!authorized(req))
      return res.status(401).json({ error: 'Entre para acessar o painel' })
    const days = Number(req.query?.days || 7)
    if (![1, 7, 30, 90].includes(days))
      return res.status(400).json({ error: 'Período inválido' })
    const data = await chatDatabase('rpc/piskou_admin_report', {
      p_days: days,
    })
    return res.status(200).json(data)
  } catch (error) {
    console.error('admin:', error.message)
    return res.status(503).json({
      error: 'Não foi possível carregar as métricas. Tente novamente.',
    })
  }
}
