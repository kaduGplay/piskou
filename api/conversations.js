import { randomUUID } from 'node:crypto'
import { chatSession, chatDatabase } from './_lib/chat.js'
import { ownedConversations, rememberConversations, activateConversation, canCreateCharacter } from './_lib/conversations.js'
import { sameOrigin } from './_lib/analytics.js'
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (!['GET','POST'].includes(req.method)) return res.status(405).json({ error: 'Método inválido.' })
  if (req.method === 'POST' && !sameOrigin(req)) return res.status(403).json({ error: 'Origem inválida.' })
  try {
    const active = chatSession(req, res)
    const ids = ownedConversations(req)
    if (!active || !ids.length) return res.status(200).json({ conversations: [], canCreate: false })
    if (req.method === 'POST' && req.body?.action === 'create') {
      if (!(await canCreateCharacter(req))) return res.status(403).json({ error: 'Adquira Baby ou Pro para criar outra personagem.', code: 'premium_required' })
      if (ids.length >= 40) return res.status(409).json({ error: 'Você atingiu o limite de personagens deste navegador.' })
      activateConversation(req, res, randomUUID())
      return res.status(200).json({ ok: true })
    }
    const rows = await chatDatabase(`piskou_chat_sessions?id=in.(${ids.join(',')})&select=id,selection,messages&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`)
    if (req.method === 'POST') {
      const chosen = rows.find((row) => row.id === req.body?.conversationId)
      if (!chosen) return res.status(403).json({ error: 'Conversa indisponível.' })
      activateConversation(req, res, chosen.id)
      return res.status(200).json({ selection: chosen.selection })
    }
    rememberConversations(req, res, ids)
    return res.status(200).json({ active, canCreate: await canCreateCharacter(req), conversations: rows.map((row) => {
      const last = row.messages.filter((message) => !message.deleted).at(-1)
      return { id: row.id, selection: row.selection, preview: last?.audio ? 'Mensagem de áudio' : last?.text || 'Comece a conversar', updatedAt: last?.sentAt || null }
    }).sort((a,b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))) })
  } catch { return res.status(503).json({ error: 'Não foi possível carregar suas conversas. Tente novamente.' }) }
}
