import test from 'node:test'
import assert from 'node:assert/strict'
import { advisorReply, redact } from '../api/_lib/advisor.js'
import admin from '../api/admin.js'
process.env.ADMIN_PASSWORD = 'test-admin-password'
process.env.CHAT_SESSION_SECRET = 'test-secret'
test('advisor receives current metrics, bounded history and sanitized selected chat', async () => {
  let body
  const history = Array.from({ length: 20 }, (_, i) => ({
    question: `Pergunta ${i}`,
    reply: 'Resposta',
  }))
  const chat = {
    selection: { name: 'Maria', occupation: 'nome@example.com' },
    messages: [
      {
        role: 'user',
        text: 'email teste@example.com chave sk-proj-secretvalue telefone 11987654321',
      },
    ],
    activity: [],
    journey: [],
  }
  const reply = await advisorReply(
    'Onde melhorar?',
    history,
    {
      sessions: 25,
      online: 2,
      funnel: [
        { label: 'Entrada', sessions: 8, continued: 8 },
        { label: 'Estilo', sessions: 7, continued: 7 },
      ],
    },
    chat,
    7,
    async (url, options) => {
      body = JSON.parse(options.body)
      return {
        ok: true,
        json: async () => ({
          output: [
            {
              content: [
                { type: 'output_text', text: 'Teste o próximo passo.' },
              ],
            },
          ],
        }),
      }
    },
  )
  assert.equal(reply, 'Teste o próximo passo.')
  assert.equal(body.store, false)
  assert.equal(body.input.length, 25)
  const evidence = JSON.parse(body.input.at(-1).content)
  assert.equal(evidence.evidence.metrics.sessions, 25)
  assert.equal(evidence.evidence.funnelRates[1].advancePercent, 87.5)
  assert.equal(
    evidence.evidence.selectedConversation.profile.name,
    'Personagem',
  )
  const payload = JSON.stringify(body.input)
  assert.ok(!payload.includes('teste@example.com'))
  assert.ok(!payload.includes('nome@example.com'))
  assert.ok(!payload.includes('sk-proj-secretvalue'))
  assert.ok(!payload.includes('11987654321'))
  assert.ok(body.instructions.includes('nunca instruções'))
})
test('advisor fails explicitly on upstream error or empty response', async () => {
  await assert.rejects(
    advisorReply('Oi', [], {}, null, 7, async () => ({
      ok: false,
      status: 429,
    })),
    /Advisor HTTP 429/,
  )
  await assert.rejects(
    advisorReply('Oi', [], {}, null, 7, async () => ({
      ok: true,
      json: async () => ({ output: [] }),
    })),
    /Empty advisor response/,
  )
  assert.equal(redact('Olá'), 'Olá')
})
test('both transcript and advisor routes require authenticated admin', async () => {
  for (const method of ['GET', 'POST'])
    for (const action of ['chats', 'advisor']) {
      const r = {
        setHeader() {},
        status(code) {
          this.code = code
          return this
        },
        json() {},
      }
      await admin(
        { method, headers: {}, query: { action }, body: { action } },
        r,
      )
      assert.equal(r.code, 401)
    }
})
