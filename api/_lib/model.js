import { mediaOfferMessage } from '../../src/shared/mediaOffer.js'
import { chatInstructions } from './chat.js'
import { learningProfile, learnedInstructions } from './learning.js'

export async function generateChatReply(
  selection,
  history,
  message,
  turn,
  fetcher = fetch,
  pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  const profile =
    fetcher === fetch ? await learningProfile().catch(() => null) : null
  const styleInstructions = learnedInstructions(profile)
  let lastError
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetcher('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
          store: false,
          max_output_tokens: 500,
          text: {
            format: {
              type: 'json_schema',
              name: 'chat_reply',
              strict: true,
              schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  reply: { type: 'string' },
                  imagePrompt: { type: 'string' },
                  mediaRequest: {
                    type: 'string',
                    enum: ['none', 'photo', 'video', 'image'],
                  },
                },
                required: ['reply', 'mediaRequest', 'imagePrompt'],
              },
            },
          },
          instructions:
            chatInstructions(selection, turn) + '\n' + styleInstructions,
          input: [
            ...history.map((m) => ({
              role: m.role === 'character' ? 'assistant' : 'user',
              content: m.text,
            })),
            { role: 'user', content: message },
          ],
        }),
        signal: AbortSignal.timeout(15000),
      })
      if (!response.ok) {
        const error = new Error(`Model HTTP ${response.status}`)
        error.retryable =
          response.status === 429 ||
          response.status >= 500 ||
          response.status === 408
        throw error
      }
      const data = await response.json()
      if (
        (data.output || []).some((o) =>
          (o.content || []).some((c) => c.type === 'refusal'),
        )
      )
        return {
          reply:
            'Posso conversar com você sobre romance, interesses e outros assuntos, respeitando nossos limites. Sobre o que você quer conversar?',
          mediaRequest: null,
        }
      const output = (data.output || [])
        .flatMap((o) => o.content || [])
        .filter((c) => c.type === 'output_text')
        .map((c) => c.text)
        .join('\n')
        .trim()
      const parsed = JSON.parse(output)
      const reply = typeof parsed.reply === 'string' ? parsed.reply.trim() : ''
      const mediaRequest = ['photo', 'video', 'image'].includes(
        parsed.mediaRequest,
      )
        ? parsed.mediaRequest
        : null
      if (!reply) throw new Error('Empty model response')
      return {
        reply: ['photo', 'video'].includes(mediaRequest)
          ? mediaOfferMessage(selection, mediaRequest)
          : reply,
        mediaRequest,
        imagePrompt: String(parsed.imagePrompt || '').slice(0, 1500),
      }
    } catch (error) {
      lastError = error
      if (error.retryable === false || attempt === 1) break
      await pause(600)
    }
  }
  throw lastError
}
