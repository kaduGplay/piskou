import { ownedConversations, rememberConversations, canCreateCharacter } from './_lib/conversations.js'
import { invalidateLearningProfile } from './_lib/learning.js'
import { processChat, restoreSupportedMemory } from './_lib/chat-continuity.js'
import {
  loadCharacterPreferences,
  buildCharacterPreferences,
} from './_lib/character-preferences.js'
import { loadMemory, saveMemory } from './_lib/memory-store.js'
import { emptyMemory } from './_lib/memory.js'
import { UUID } from './_lib/analytics.js'
import { generateChatImage } from './_lib/images.js'
import { generateChatReply } from './_lib/model.js'
import { CHAT_PREVIEW_LIMIT } from '../src/funnel/data.js'
import { randomUUID } from 'node:crypto'
import {
  chatDatabase,
  chatSelection,
  sameChatSelection,
  chatSession,
  chatSignature,
} from './_lib/chat.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (!['POST', 'GET'].includes(req.method))
    return res.status(405).json({ error: 'Método não permitido.' })
  if (
    !process.env.OPENAI_API_KEY ||
    process.env.OPENAI_API_KEY.startsWith('sk-admin-') ||
    !process.env.CHAT_SESSION_SECRET ||
    !process.env.SUPABASE_URL ||
    !(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)
  )
    return res
      .status(503)
      .json({ error: 'A conversa está indisponível no momento.' })
  if (req.headers.origin) {
    const allowed = new URL(
      process.env.VERCEL ? process.env.SITE_URL : `http://${req.headers.host}`,
    ).origin
    if (req.headers.origin !== allowed)
      return res.status(403).json({ error: 'Origem inválida.' })
  }
  let session, lease
  try {
    session = chatSession(req, res, true)
    if (req.method === 'GET') {
      if (!session)
        return res.status(200).json({
          messages: [],
          remaining: CHAT_PREVIEW_LIMIT,
          requiresPayment: false,
          hasPaidAccess: false,
        })
      if (req.query?.access === '1')
        return res
          .status(200)
          .json(await chatDatabase('rpc/piskou_chat_access', { p_id: session }))
      const rows = await chatDatabase(
        `piskou_chat_sessions?id=eq.${session}&select=messages,selection,allowance,unlimited,trial_allowance`,
      )
      const row = rows[0]
      let requested
      try {
        requested = chatSelection(JSON.parse(req.query?.selection || 'null'))
      } catch {
        requested = null
      }
      if (
        row &&
        requested &&
        JSON.stringify(row.selection) !== JSON.stringify(requested)
      ) {
        // jsonb não preserva a ordem das chaves; compara os campos normalizados.
        if (!sameChatSelection(row.selection, requested)) {
          if (!(await canCreateCharacter(req))) return res.status(403).json({ error: 'Para criar outra personagem, adquira Baby ou Pro.', code: 'premium_required' })
          const previous = ownedConversations(req)
          if (previous.length >= 40) return res.status(409).json({ error: 'Você atingiu o limite de personagens deste navegador.' })
          session = chatSession(req, res, true, true)
          rememberConversations(req, res, [...previous, session])
          return res.status(200).json(
            await chatDatabase('rpc/piskou_chat_initialize', {
              p_id: session,
              p_selection: requested,
            }),
          )
        }
      }
      if (!row && requested && ownedConversations(req).length > 1 && !(await canCreateCharacter(req))) return res.status(403).json({ error: 'Para criar outra personagem, adquira Baby ou Pro.', code: 'premium_required' })
      if (!row && requested)
        return res.status(200).json(
          await chatDatabase('rpc/piskou_chat_initialize', {
            p_id: session,
            p_selection: requested,
          }),
        )
      return res
        .status(200)
        .json(await chatDatabase('rpc/piskou_chat_snapshot', { p_id: session }))
    }
    if (req.body?.action === 'log') {
      const selection = chatSelection(req.body.selection)
      const { eventId, kind, text, analyticsSession } = req.body
      if (
        !selection ||
        !UUID.test(eventId || '') ||
        !['limit', 'photo', 'video'].includes(kind) ||
        typeof text !== 'string' ||
        text.length > 500
      )
        return res.status(400).json({ error: 'Registro inválido' })
      const ip = String(
        req.headers['x-vercel-forwarded-for'] ||
          req.headers['x-forwarded-for'] ||
          req.socket?.remoteAddress ||
          'unknown',
      )
        .split(',')[0]
        .trim()
      const allowed = await chatDatabase('rpc/piskou_analytics_limit', {
        p_key: `chat-log:${chatSignature(ip)}`,
        p_max: 120,
      })
      if (!allowed)
        return res.status(429).json({ error: 'Limite de registros atingido' })
      await chatDatabase('rpc/piskou_chat_journal', {
        p_id: session,
        p_selection: selection,
        p_analytics: UUID.test(analyticsSession || '')
          ? analyticsSession
          : null,
        p_event: eventId,
        p_kind: kind,
        p_text: text,
      })
      return res.status(200).json({ ok: true })
    }
    const selection = chatSelection(req.body?.selection)
    if (['enqueue', 'process', 'delete', 'retry'].includes(req.body?.action)) {
      if (!selection)
        return res.status(400).json({ error: 'Personagem inválida.' })
      const rows = await chatDatabase(
        `piskou_chat_sessions?id=eq.${session}&select=selection`,
      )
      if (rows[0] && !sameChatSelection(rows[0].selection, selection))
        return res.status(409).json({
          error: 'A conversa foi alterada.',
          code: 'selection_changed',
        })
      if (req.body.action === 'process') {
        await processChat(session)
        return res
          .status(200)
          .json(
            await chatDatabase('rpc/piskou_chat_snapshot', { p_id: session }),
          )
      }
      const { messageId, replyTo } = req.body
      if (!UUID.test(messageId || '') || (replyTo && !UUID.test(replyTo)))
        return res.status(400).json({ error: 'Mensagem inválida.' })
      if (req.body.action === 'delete') {
        const snapshot = await chatDatabase('rpc/piskou_chat_delete_message', {
          p_id: session,
          p_message: messageId,
        })
        invalidateLearningProfile()
        await restoreSupportedMemory({ ...snapshot, chatId: session }).catch(
          () => {},
        )
        delete snapshot.affectedMemory
        delete snapshot.memoryState
        return res.status(200).json(snapshot)
      }
      if (req.body.action === 'retry')
        return res.status(200).json(
          await chatDatabase('rpc/piskou_chat_retry', {
            p_id: session,
            p_message: messageId,
          }),
        )
      let timeZone = req.body.timeZone || 'America/Sao_Paulo'
      try {
        new Intl.DateTimeFormat('en', { timeZone }).format()
      } catch {
        timeZone = 'America/Sao_Paulo'
      }
      const ip = String(
        req.headers['x-vercel-forwarded-for'] ||
          req.headers['x-forwarded-for'] ||
          req.socket?.remoteAddress ||
          'unknown',
      )
        .split(',')[0]
        .trim()
      const snapshot = await chatDatabase('rpc/piskou_chat_enqueue', {
        p_id: session,
        p_selection: selection,
        p_budget: `ip:${chatSignature(ip)}`,
        p_message: messageId,
        p_text: typeof req.body.message === 'string' ? req.body.message : '',
        p_reply_to: replyTo || null,
        p_timezone: timeZone,
        p_window_ms: Number.isFinite(Number(process.env.CHAT_GROUP_WINDOW_MS))
          ? Math.round(Number(process.env.CHAT_GROUP_WINDOW_MS))
          : 1500,
      })
      if (snapshot.error)
        return res
          .status(snapshot.error === 'selection_changed' ? 409 : 429)
          .json({
            error:
              snapshot.error === 'limit'
                ? 'Escolha um plano para continuar.'
                : 'Não foi possível enviar a mensagem.',
            code: snapshot.error,
            locked: snapshot.error === 'limit',
          })
      return res.status(200).json(snapshot)
    }
    const message =
      typeof req.body?.message === 'string' ? req.body.message.trim() : ''
    if (!selection || !message || message.length > 500)
      return res.status(400).json({
        error:
          'Confira sua personagem e escreva uma mensagem de até 500 caracteres.',
      })
    lease = randomUUID()
    const ip = String(
      req.headers['x-vercel-forwarded-for'] ||
        req.headers['x-forwarded-for'] ||
        req.socket?.remoteAddress ||
        'unknown',
    )
      .split(',')[0]
      .trim()
    const claim = await chatDatabase('rpc/piskou_chat_claim', {
      p_id: session,
      p_selection: selection,
      p_budget: `ip:${chatSignature(ip)}`,
      p_lease: lease,
    })
    if (claim.error) {
      lease = null
      const status =
        claim.error === 'selection_changed' || claim.error === 'busy'
          ? 409
          : 429
      return res.status(status).json({
        error: ['limit', 'payment_required'].includes(claim.error)
          ? 'Escolha um plano para continuar.'
          : claim.error === 'selection_changed'
            ? 'Esta conversa pertence a outra personagem. Volte à personagem original.'
            : claim.error === 'busy'
              ? 'A resposta anterior ainda está sendo preparada.'
              : 'O limite de novas conversas nesta rede foi atingido. Sua conversa já iniciada continua disponível.',
        code: claim.error,
        locked: ['limit', 'payment_required'].includes(claim.error),
        requiresPayment: claim.error === 'payment_required',
        messages: claim.messages,
      })
    }
    const [memory, characterPreferences] = await Promise.all([
      loadMemory(session).catch(() => emptyMemory()),
      loadCharacterPreferences(session, selection).catch((error) => {
        console.error('chat: character preferences unavailable', error.message)
        return buildCharacterPreferences(selection)
      }),
    ])
    let [{ reply, mediaRequest, imagePrompt, nextMemory }] = await Promise.all([
      generateChatReply(
        selection,
        claim.messages.filter(
          (m) =>
            !m.deleted &&
            !m.contextInvalidated &&
            (m.role === 'character' || m.charged !== false),
        ),
        message,
        claim.turn,
        fetch,
        undefined,
        {
          memory,
          characterPreferences,
          memoryHistory: claim.messages.map((m) =>
            m.deleted ? { ...m, text: '' } : m,
          ),
          timeZone:
            req.body?.timeZone ||
            process.env.CHAT_TIME_ZONE ||
            'America/Sao_Paulo',
        },
      ),
      chatDatabase('rpc/piskou_chat_journal', {
        p_id: session,
        p_selection: selection,
        p_analytics: UUID.test(req.body?.analyticsSession || '')
          ? req.body.analyticsSession
          : null,
        p_event: null,
        p_kind: null,
        p_text: null,
      }).catch((error) => console.error('chat journal:', error.message)),
    ])
    let media = null
    if (mediaRequest === 'image') {
      try {
        media = await generateChatImage(imagePrompt, fetch, selection)
      } catch (error) {
        console.error('chat: image unavailable', error.message)
        reply =
          'Não consegui preparar essa imagem agora. Podemos continuar conversando e tentar de novo depois?'
      }
      mediaRequest = null
    }
    const messages = await chatDatabase('rpc/piskou_chat_finish_media', {
      p_id: session,
      p_lease: lease,
      p_user: message,
      p_reply: reply,
      p_media: media,
    })
    lease = null
    await saveMemory(session, memory, nextMemory).catch((error) =>
      console.error('chat: memory unavailable', error.message),
    )
    return res.status(200).json({
      messages,
      mediaRequest,
      remaining: claim.unlimited
        ? null
        : Math.max(
            0,
            claim.allowance -
              messages.filter((m) => m.role === 'user' && m.charged !== false)
                .length,
          ),
      unlimited: claim.unlimited === true,
    })
  } catch (error) {
    if (session && lease)
      await chatDatabase('rpc/piskou_chat_finish', {
        p_id: session,
        p_lease: lease,
        p_user: null,
        p_reply: null,
      }).catch(() => {})
    console.error('chat: request failed', error.message)
    return res.status(502).json({
      error: ['enqueue', 'delete', 'retry', 'process'].includes(
        req.body?.action,
      )
        ? 'Não foi possível confirmar esta operação. Atualize a conversa antes de tentar novamente.'
        : 'Não foi possível receber a resposta. Sua mensagem não foi consumida. Tente novamente.',
    })
  }
}
