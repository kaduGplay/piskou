import { CHAT_PREVIEW_LIMIT } from '../src/funnel/data.js'
import { randomUUID } from 'node:crypto'
import {
  chatDatabase,
  chatInstructions,
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
    session = chatSession(req, res, req.method === 'POST')
    if (req.method === 'GET') {
      if (!session) return res.status(200).json({ messages: [], remaining: CHAT_PREVIEW_LIMIT })
      const rows = await chatDatabase(
        `piskou_chat_sessions?id=eq.${session}&select=messages,selection&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`,
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
          return res.status(200).json({ messages: [], remaining: CHAT_PREVIEW_LIMIT })
        }
      }
      const messages = row?.messages || []
      return res
        .status(200)
        .json({
          messages,
          selection: row?.selection,
          remaining: Math.max(0, CHAT_PREVIEW_LIMIT - messages.length / 2),
        })
    }
    const selection = chatSelection(req.body?.selection)
    const message =
      typeof req.body?.message === 'string' ? req.body.message.trim() : ''
    if (!selection || !message || message.length > 500)
      return res
        .status(400)
        .json({
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
      return res
        .status(status)
        .json({
          error:
            claim.error === 'limit'
              ? 'Escolha um plano para continuar.'
              : claim.error === 'selection_changed'
                ? 'Esta conversa pertence a outra personagem. Volte à personagem original.'
                : 'Aguarde um pouco antes de tentar novamente.',
          locked: claim.error === 'limit',
          messages: claim.messages,
        })
    }
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        store: false,
        max_output_tokens: 320,
        text: { format: {
          type: 'json_schema', name: 'chat_reply', strict: true,
          schema: {
            type: 'object', additionalProperties: false,
            properties: {
              reply: { type: 'string' },
              mediaRequest: { type: 'string', enum: ['none', 'photo', 'video'] },
            },
            required: ['reply', 'mediaRequest'],
          },
        } },
        instructions: chatInstructions(selection, claim.turn),
        input: [
          ...claim.messages.map((m) => ({
            role: m.role === 'character' ? 'assistant' : 'user',
            content: m.text,
          })),
          { role: 'user', content: message },
        ],
      }),
      signal: AbortSignal.timeout(25000),
    })
    if (!response.ok) {
      console.error('chat: OpenAI HTTP', response.status)
      throw new Error('OpenAI request failed')
    }
    const data = await response.json()
    const output = (data.output || [])
      .flatMap((o) => o.content || [])
      .filter((c) => c.type === 'output_text')
      .map((c) => c.text)
      .join('\n')
      .trim()
    const parsed = JSON.parse(output)
    const reply = typeof parsed.reply === 'string' ? parsed.reply.trim() : ''
    const mediaRequest = ['photo', 'video'].includes(parsed.mediaRequest) ? parsed.mediaRequest : null
    if (!reply) throw new Error('Empty model response')
    const messages = await chatDatabase('rpc/piskou_chat_finish', {
      p_id: session,
      p_lease: lease,
      p_user: message,
      p_reply: reply,
    })
    lease = null
    return res
      .status(200)
      .json({ messages, mediaRequest, remaining: Math.max(0, CHAT_PREVIEW_LIMIT - messages.length / 2) })
  } catch (error) {
    if (session && lease)
      await chatDatabase('rpc/piskou_chat_finish', {
        p_id: session,
        p_lease: lease,
        p_user: null,
        p_reply: null,
      }).catch(() => {})
    console.error('chat: request failed', error.message)
    return res
      .status(502)
      .json({
        error:
          'Não foi possível receber a resposta. Sua mensagem não foi consumida. Tente novamente.',
      })
  }
}
