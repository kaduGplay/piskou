import test from 'node:test'
import assert from 'node:assert/strict'
import { generateChatReply } from '../api/_lib/model.js'
import { DEFAULT_SELECTION } from '../src/funnel/data.js'
const success = () =>
  new Response(
    JSON.stringify({
      output: [
        {
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                reply: 'Que bom! Como foi seu dia?',
                mediaRequest: 'none',
              }),
            },
          ],
        },
      ],
    }),
    { status: 200 },
  )
for (const status of [429, 500, 503])
  test(`recovers from transient HTTP ${status} without another chat turn`, async () => {
    let calls = 0
    const result = await generateChatReply(
      DEFAULT_SELECTION,
      [],
      'Oi',
      0,
      async () => (++calls === 1 ? new Response('', { status }) : success()),
      async () => {},
    )
    assert.equal(calls, 2)
    assert.equal(result.reply, 'Que bom! Como foi seu dia?')
  })
test('does not retry invalid credentials', async () => {
  let calls = 0
  await assert.rejects(
    generateChatReply(
      DEFAULT_SELECTION,
      [],
      'Oi',
      0,
      async () => {
        calls++
        return new Response('', { status: 401 })
      },
      async () => {},
    ),
  )
  assert.equal(calls, 1)
})
test('recovers from network failure and truncated JSON', async () => {
  for (const failure of [
    () => {
      throw new TypeError('Network failed')
    },
    () => new Response(JSON.stringify({ output: [] })),
  ]) {
    let calls = 0
    const result = await generateChatReply(
      DEFAULT_SELECTION,
      [],
      'Oi',
      0,
      async () => (++calls === 1 ? failure() : success()),
      async () => {},
    )
    assert.equal(calls, 2)
    assert.ok(result.reply)
  }
})
test('persistent outage stops after two attempts', async () => {
  let calls = 0
  await assert.rejects(
    generateChatReply(
      DEFAULT_SELECTION,
      [],
      'Oi',
      0,
      async () => {
        calls++
        throw new TypeError('Offline')
      },
      async () => {},
    ),
  )
  assert.equal(calls, 2)
})
test('model refusal produces a safe response instead of a parsing error', async () => {
  const result = await generateChatReply(
    DEFAULT_SELECTION,
    [],
    'message',
    0,
    async () =>
      new Response(
        JSON.stringify({
          output: [{ content: [{ type: 'refusal', refusal: 'Unable' }] }],
        }),
      ),
  )
  assert.ok(result.reply)
  assert.equal(result.mediaRequest, null)
})

test('character photo requests explain subscription instead of claiming delivery', async () => {
  const result = await generateChatReply(
    DEFAULT_SELECTION,
    [],
    'Me manda uma foto sua',
    0,
    async () =>
      new Response(
        JSON.stringify({
          output: [
            {
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    reply: 'Aqui está a minha foto',
                    mediaRequest: 'photo',
                    imagePrompt: '',
                  }),
                },
              ],
            },
          ],
        }),
      ),
    async () => {},
  )
  assert.equal(result.mediaRequest, 'photo')
  assert.match(result.reply, /Premium/)
  assert.ok(!result.reply.includes('Aqui está'))
})

test('character hobbies stay consistent and vary with personality and identity', async () => {
  const { characterInterests, chatInstructions } = await import('../api/_lib/chat.js')
  const calm = { ...DEFAULT_SELECTION, name: 'Lia', personality: 'Tranquila' }
  const adventure = { ...calm, personality: 'Aventureira' }
  assert.deepEqual(characterInterests(calm), characterInterests({ ...calm }))
  assert.notDeepEqual(characterInterests(calm), characterInterests(adventure))
  assert.ok(characterInterests(adventure).some(value => /trilhas|viagem|paisagens/.test(value)))
  assert.ok(chatInstructions(calm, 0).includes('Gostos atuais configurados têm prioridade'))
  assert.ok(chatInstructions(calm, 0).includes('Nunca finja ser humana'))
})

test('delivered image is marked in context and a reaction cannot generate another image', async () => {
  const history = [
    { role: 'user', text: 'Manda uma imagem de flores' },
    { role: 'character', text: 'Aqui está!', media: { src: 'data:image/jpeg;base64,YWJj' } },
  ]
  let calls = 0
  const result = await generateChatReply(DEFAULT_SELECTION, history, 'gostei', 1,
    async (_url, options) => {
      const body = JSON.parse(options.body)
      assert.match(body.input.find((item) => item.role === 'assistant').content, /já foi gerada e entregue/)
      calls++
      if (calls === 2) assert.match(body.instructions, /apenas em texto/)
      return new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text',
        text: JSON.stringify(calls === 1
          ? { reply: 'Aqui vai outra!', mediaRequest: 'image', imagePrompt: 'flowers' }
          : { reply: 'Qual detalhe você mais gostou?', mediaRequest: 'none', imagePrompt: '' }),
      }] }] }))
    }, async () => {})
  assert.equal(calls, 2)
  assert.equal(result.mediaRequest, null)
  assert.equal(result.imagePrompt, '')
  assert.equal(result.reply, 'Qual detalhe você mais gostou?')
})

test('unrequested photo flags are rejected and repaired into a contextual text reply', async () => {
  const history = [
    { role: 'user', text: 'Me manda uma foto sua?' },
    { role: 'character', text: 'Fotos nos planos Premium e Luxo.', mediaRequest: 'photo' },
  ]
  let calls = 0
  const result = await generateChatReply(DEFAULT_SELECTION, history, 'Você gosta de café?', 1,
    async (_url, options) => {
      const body = JSON.parse(options.body)
      assert.deepEqual(body.text.format.schema.properties.mediaRequest.enum, ['none'])
      assert.match(body.instructions, /PRIORIDADE DO TURNO/)
      assert.match(body.input.find((item) => item.role === 'assistant').content, /Não repetir sem novo pedido/)
      assert.equal(body.input.at(-1).content, 'Você gosta de café?')
      calls++
      return new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text',
        text: JSON.stringify(calls === 1
          ? { reply: 'Aqui vai uma foto!', mediaRequest: 'photo', imagePrompt: '' }
          : { reply: 'Gosto de café com leite. E você?', mediaRequest: 'none', imagePrompt: '' }),
      }] }] }))
    }, async () => {})
  assert.equal(calls, 2)
  assert.equal(result.mediaRequest, null)
  assert.equal(result.reply, 'Gosto de café com leite. E você?')
})
