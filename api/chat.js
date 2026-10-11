import { UUID } from './_lib/analytics.js'
import { generateChatImage } from './_lib/images.js'
import { generateChatReply } from './_lib/model.js'
import { CHAT_PREVIEW_LIMIT } from '../src/funnel/data.js'
import { randomUUID } from 'node:crypto'
import {
  chatDatabase,
  chatSelection,
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
        return res
          .status(200)
          .json({
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
        if (
          Object.keys(requested).some(
            (key) => row.selection[key] !== requested[key],
          )
        ) {
          chatSession(req, res, true, true)
          return res
            .status(200)
            .json({
              messages: [],
              remaining: CHAT_PREVIEW_LIMIT,
              requiresPayment: false,
              hasPaidAccess: false,
            })
        }
      }
      const messages = row?.messages || []
      return res.status(200).json({
        messages,
        selection: row?.selection,
        remaining: row?.unlimited
          ? null
          : Math.max(
              0,
              (row?.allowance ?? CHAT_PREVIEW_LIMIT) - messages.length / 2,
            ),
        unlimited: row?.unlimited === true,
        requiresPayment: !!row && !row.allowance && !row.unlimited,
        hasPaidAccess:
          !!row &&
          (row.unlimited || row.allowance > (row.trial_allowance || 0)),
      })
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
    let [{ reply, mediaRequest, imagePrompt }] = await Promise.all([
      generateChatReply(selection, claim.messages, message, claim.turn),
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
        media = await generateChatImage(imagePrompt)
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
    return res.status(200).json({
      messages,
      mediaRequest,
      remaining: claim.unlimited
        ? null
        : Math.max(0, claim.allowance - messages.length / 2),
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
      error:
        'Não foi possível receber a resposta. Sua mensagem não foi consumida. Tente novamente.',
    })
  }
}
