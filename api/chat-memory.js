import {
  chatDatabase,
  chatSelection,
  chatSession,
  sameChatSelection,
} from './_lib/chat.js'
import { sameOrigin } from './_lib/analytics.js'
import { loadMemory } from './_lib/memory-store.js'
import { memorySummary } from './_lib/memory.js'
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (!['GET', 'POST'].includes(req.method))
    return res.status(405).json({ error: 'Método não permitido.' })
  if (req.method === 'POST' && !sameOrigin(req))
    return res.status(403).json({ error: 'Origem inválida.' })
  const session = chatSession(req, res)
  if (!session)
    return res
      .status(401)
      .json({ error: 'Abra sua conversa para gerenciar a memória.' })
  let raw = req.body?.selection
  if (req.method === 'GET') {
    try {
      raw = JSON.parse(req.query?.selection || 'null')
    } catch {}
  }
  const selection = chatSelection(raw)
  if (!selection) return res.status(400).json({ error: 'Personagem inválida.' })
  try {
    const rows = await chatDatabase(
      `piskou_chat_sessions?id=eq.${session}&select=selection`,
    )
    if (rows[0] && !sameChatSelection(rows[0].selection, selection))
      return res
        .status(409)
        .json({ error: 'A memória pertence à personagem desta conversa.' })
    let state
    if (req.method === 'GET') state = await loadMemory(session)
    else {
      const { action, key, enabled, revision } = req.body
      if (
        !['toggle', 'clear', 'delete'].includes(action) ||
        !Number.isSafeInteger(revision) ||
        revision < 0 ||
        revision > 2147483647 ||
        (action === 'toggle' && typeof enabled !== 'boolean') ||
        (action === 'delete' &&
          (typeof key !== 'string' ||
            !/^(?:user:name|topic:(?:interview|project|recipe|film)|interest:[a-z ]{1,40}|preference:[a-z]{1,20})$/.test(
              key,
            )))
      )
        return res.status(400).json({ error: 'Alteração de memória inválida.' })
      const result = await chatDatabase('rpc/piskou_memory_settings', {
        p_id: session,
        p_selection: selection,
        p_action: action,
        p_key: key || null,
        p_enabled: typeof enabled === 'boolean' ? enabled : null,
        p_revision: revision,
      })
      if (result.error)
        return res.status(409).json({
          error:
            'A conversa foi atualizada. Recarregue as lembranças e tente novamente.',
        })
      state = result.state
    }
    return res.status(200).json({ state, summary: memorySummary(state) })
  } catch {
    return res.status(503).json({
      error:
        'Não foi possível acessar a memória agora. Sua conversa continua disponível.',
    })
  }
}
