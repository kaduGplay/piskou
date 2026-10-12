import { timingSafeEqual } from 'node:crypto'
import { chatDatabase } from './_lib/chat.js'
import { processChat } from './_lib/chat-continuity.js'
import { eraseAudio } from './_lib/chat-storage.js'
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  const expected = Buffer.from(`Bearer ${process.env.CHAT_WORKER_SECRET || ''}`)
  const actual = Buffer.from(String(req.headers.authorization || ''))
  if (
    req.method !== 'POST' ||
    !process.env.CHAT_WORKER_SECRET ||
    expected.length !== actual.length ||
    !timingSafeEqual(expected, actual)
  )
    return res.status(401).json({ error: 'Não autorizado' })
  try {
    await chatDatabase('rpc/piskou_chat_cleanup', {})
    const now = new Date().toISOString()
    const rows = await chatDatabase(
      `piskou_chat_sessions?select=id&queue_due=lte.${encodeURIComponent(now)}&or=(lease_until.is.null,lease_until.lte.${encodeURIComponent(now)})&order=queue_due&limit=3`,
    )
    await Promise.all(rows.map((row) => processChat(row.id)))
    const deletions = await chatDatabase(
      'piskou_chat_media_deletions?select=object_key&limit=20',
    )
    for (const { object_key } of deletions) {
      try {
        await eraseAudio(object_key)
        // Keep a short tombstone against a late, canceled upload recreating the object.
        await chatDatabase('rpc/piskou_media_deletion_done', {
          p_key: object_key,
        })
      } catch {
        /* Durable retry on the next worker invocation. */
      }
    }
    return res.status(200).json({ processed: rows.length })
  } catch {
    return res
      .status(503)
      .json({ error: 'Processamento temporariamente indisponível' })
  }
}
