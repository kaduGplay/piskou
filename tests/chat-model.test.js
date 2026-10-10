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
