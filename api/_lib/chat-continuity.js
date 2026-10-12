import { randomUUID } from 'node:crypto'
import { chatDatabase } from './chat.js'
import { generateChatReply } from './model.js'
import { generateChatImage } from './images.js'
import { requestedMedia } from './image-intent.js'
import { loadMemory } from './memory-store.js'
import { emptyMemory, advanceMemory } from './memory.js'
import {
  loadCharacterPreferences,
  buildCharacterPreferences,
} from './character-preferences.js'

export async function processChat(session, dependencies = {}) {
  const db = dependencies.db || chatDatabase
  const lease = randomUUID()
  const job = await db('rpc/piskou_chat_process_claim', {
    p_id: session,
    p_lease: lease,
  })
  if (!job) return { idle: true }
  const controller = new AbortController()
  let checking = false
  const check = async () => {
    if (checking) return
    checking = true
    try {
      if (
        !(await db('rpc/piskou_chat_generation_current', {
          p_id: session,
          p_lease: lease,
          p_generation: job.generation,
        }))
      )
        controller.abort()
    } catch {
      /* Atomic finish remains the authoritative cancellation check. */
    } finally {
      checking = false
    }
  }
  const timer = setInterval(check, 400)
  try {
    const [memory, characterPreferences] = await Promise.all([
      (dependencies.loadMemory || loadMemory)(session).catch(() =>
        emptyMemory(),
      ),
      (dependencies.loadPreferences || loadCharacterPreferences)(
        session,
        job.selection,
      ).catch(() => buildCharacterPreferences(job.selection)),
    ])
    let ordinal = 0
    const indexed = job.sourceHistory.map((m) =>
      m.role === 'user' ? { ...m, sourceTurn: ++ordinal } : m,
    )
    const ids = new Set(job.users.map((m) => m.id))
    const users = indexed.filter((m) => ids.has(m.id))
    const first = indexed.findIndex((m) => ids.has(m.id))
    const memoryHistory = indexed
      .slice(0, first)
      .map((m) => (m.deleted ? { ...m, text: '' } : m))
    const references = users
      .filter((m) => m.replyTo)
      .map((m) => ({
        messageId: m.id,
        replyTo: m.replyTo,
        target:
          indexed.find(
            (target) => target.id === m.replyTo && !target.deleted,
          ) || null,
      }))
    const audioRequested = requestedMedia(job.history, users.map((m) => m.text).join('\n')) === 'audio'
    const audioAccess = audioRequested && (await db(`piskou_chat_purchases?chat_id=eq.${session}&active=eq.true&plan_id=in.(premium-access,luxury-access)&select=chat_id&limit=1`)).length > 0
    const result = await (dependencies.generate || generateChatReply)(
      job.selection,
      job.history,
      users.map((m) => m.text).join('\n'),
      job.turn,
      dependencies.fetcher || fetch,
      undefined,
      {
        memory,
        audioAccess,
        characterPreferences,
        messages: users,
        memoryHistory,
        replyReferences: references,
        timeZone:
          users[0]?.timeZone ||
          process.env.CHAT_TIME_ZONE ||
          'America/Sao_Paulo',
        signal: controller.signal,
      },
    )
    if (controller.signal.aborted) return { canceled: true }
    let media = null
    if (result.mediaRequest === 'image') {
      try {
        media = await (dependencies.generateImage || generateChatImage)(
          result.imagePrompt,
          dependencies.fetcher || fetch,
          job.selection,
        )
      } catch {
        result.reply =
          'Não consegui preparar essa imagem agora. Podemos tentar novamente depois.'
      }
      result.mediaRequest = null
    }
    return await db('rpc/piskou_chat_process_finish', {
      p_id: session,
      p_lease: lease,
      p_generation: job.generation,
      p_reply: result.reply,
      p_media: media,
      p_offer: result.mediaRequest,
      p_memory_before: memory,
      p_memory_next: result.nextMemory || null,
    })
  } catch (error) {
    await db('rpc/piskou_chat_process_fail', {
      p_id: session,
      p_lease: lease,
      p_generation: job.generation,
    }).catch(() => {})
    if (controller.signal.aborted) return { canceled: true }
    // Persisted user messages remain sent/viewed; only response generation failed.
    return { responseFailed: true }
  } finally {
    clearInterval(timer)
  }
}

export async function restoreSupportedMemory(snapshot, dependencies = {}) {
  if (!snapshot.memoryState?.enabled || !snapshot.affectedMemory?.length) return
  const db = dependencies.db || chatDatabase
  const users = snapshot.messages
    .filter((m) => m.role === 'user')
    .map((m, index) => ({
      ...m,
      text: m.deleted ? '' : m.text,
      sourceTurn: index + 1,
      historical: !m.sentAt && !m.recordedAt,
    }))
  const rebuilt = advanceMemory({ ...emptyMemory(), enabled: true }, [], users)
  const keys = new Set(snapshot.affectedMemory.map((f) => f.key))
  const replacements = rebuilt.facts.filter(
    (f) =>
      keys.has(f.key) &&
      f.source.turn >
        Math.max(
          snapshot.memoryState.consentedAfter || 0,
          snapshot.memoryState.forgottenAfter?.[f.key] || 0,
        ),
  )
  await db('rpc/piskou_memory_commit', {
    p_id: snapshot.chatId,
    p_revision: snapshot.memoryState.revision,
    p_state: {
      ...snapshot.memoryState,
      facts: [...snapshot.memoryState.facts, ...replacements].slice(-24),
    },
  })
}
