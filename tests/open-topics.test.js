import test from 'node:test'
import assert from 'node:assert/strict'
import {
  advanceMemory,
  buildConversationContext,
  emptyMemory,
} from '../api/_lib/memory.js'
import { applicationClock, markTopicAsked } from '../api/_lib/open-topics.js'
import { DEFAULT_SELECTION } from '../src/funnel/data.js'
import { restoreSupportedMemory } from '../api/_lib/chat-continuity.js'
const start = '2026-10-11T23:00:00.000Z'
const enabled = () => ({ ...emptyMemory(), enabled: true })
const pair = (text) => [
  { role: 'user', text, sentAt: start },
  { role: 'character', text: 'Entendi o assunto.' },
]
test('unknown event date stays null; only user reports become opted-in topics', () => {
  const context = buildConversationContext(
    DEFAULT_SELECTION,
    [],
    'Tenho uma entrevista.',
    enabled(),
    start,
  )
  const topic = context.nextMemory.facts[0]
  assert.equal(topic.kind, 'open_topic')
  assert.equal(topic.eventDate, null)
  assert.equal(topic.reported.text, 'Tenho uma entrevista.')
  assert.equal(topic.source.recordedAt, start)
  assert.equal(
    buildConversationContext(
      DEFAULT_SELECTION,
      pair('Tenho uma entrevista.'),
      'Oi',
      context.nextMemory,
      '2026-10-15T23:00:00Z',
    ).data.openTopics.length,
    0,
  )
  for (const text of [
    'Ela tem uma entrevista.',
    'Tenho uma entrevista?',
    'Talvez eu tenha uma entrevista.',
    'Tenho uma entrevista sobre minha religião.',
    'Tenho um projeto de tratamento do câncer.',
  ])
    assert.equal(
      advanceMemory(enabled(), [], text, start).facts.length,
      0,
      text,
    )
  assert.equal(
    advanceMemory(emptyMemory(), [], 'Tenho uma entrevista.', start).facts
      .length,
    0,
  )
})
test('relative date uses application clock and timezone; future event is not treated as past', () => {
  const at = '2026-10-12T01:00:00Z'
  assert.equal(applicationClock(at).localDate, '2026-10-11')
  const state = advanceMemory(enabled(), [], 'Tenho uma entrevista amanhã.', at)
  assert.equal(state.facts[0].eventDate, '2026-10-12')
  const history = pair('Tenho uma entrevista amanhã.')
  const before = buildConversationContext(
    DEFAULT_SELECTION,
    history,
    'Oi',
    state,
    '2026-10-12T22:00:00Z',
  )
  assert.equal(before.data.openTopics.length, 0)
  const after = buildConversationContext(
    DEFAULT_SELECTION,
    history,
    'Oi',
    state,
    '2026-10-13T22:00:00Z',
  )
  assert.equal(after.data.openTopics[0].eventDate, '2026-10-12')
  const asked = markTopicAsked(
    after.nextMemory,
    'Como foi aquela entrevista?',
    after.data.openTopics,
    after.data.systemTime,
  )
  assert.ok(asked.facts[0].lastAskedAt)
  assert.equal(
    buildConversationContext(
      DEFAULT_SELECTION,
      [...history, ...pair('Oi')],
      'Olá',
      asked,
      '2026-10-14T22:00:00Z',
    ).data.openTopics.length,
    0,
  )
})
test('resolved and declined topics never become follow-up candidates; important messages are not interrupted', () => {
  for (const resolution of [
    'Terminei a entrevista, foi bem.',
    'Não quero comentar a entrevista.',
    'Prefiro não falar disso.',
  ]) {
    const state = advanceMemory(
      enabled(),
      [],
      'Tenho uma entrevista em 2026-10-12.',
      start,
    )
    const updated = advanceMemory(
      state,
      pair('Tenho uma entrevista em 2026-10-12.'),
      resolution,
      '2026-10-13T22:00:00Z',
    )
    assert.equal(
      buildConversationContext(
        DEFAULT_SELECTION,
        [...pair('Tenho uma entrevista em 2026-10-12.'), ...pair(resolution)],
        'Oi',
        updated,
        '2026-10-14T22:00:00Z',
      ).data.openTopics.length,
      0,
      resolution,
    )
  }
  const state = advanceMemory(
    enabled(),
    [],
    'Tenho uma entrevista em 2026-10-12.',
    start,
  )
  assert.equal(
    buildConversationContext(
      DEFAULT_SELECTION,
      pair('Tenho uma entrevista em 2026-10-12.'),
      'Meu dia foi horrível, preciso desabafar.',
      state,
      '2026-10-14T22:00:00Z',
    ).data.openTopics.length,
    0,
  )
})
test('deletion rebuild preserves independent support without restoring explicitly forgotten keys', async () => {
  const calls = []
  const snapshot = {
    chatId: 'session',
    memoryState: {
      ...enabled(),
      revision: 3,
      processedThrough: 2,
      facts: [],
      forgottenAfter: {},
    },
    affectedMemory: [{ key: 'interest:cozinhar' }],
    messages: [
      { role: 'user', text: 'Gosto de cozinhar.', sentAt: start },
      { role: 'character', text: 'Tudo bem.' },
      { role: 'user', text: '', deleted: true },
    ],
  }
  await restoreSupportedMemory(snapshot, {
    db: async (path, body) => calls.push({ path, body }),
  })
  assert.equal(calls[0].body.p_state.facts[0].source.turn, 1)
  snapshot.memoryState.forgottenAfter = { 'interest:cozinhar': 1 }
  await restoreSupportedMemory(snapshot, {
    db: async (path, body) => calls.push({ path, body }),
  })
  assert.equal(calls[1].body.p_state.facts.length, 0)
})
test('date-only fragment updates the immediately relevant topic; postponement removes an outdated date', () => {
  const state = advanceMemory(
    enabled(),
    [],
    [{ text: 'Tenho uma entrevista.' }, { text: 'Amanhã.' }],
    start,
  )
  assert.equal(state.facts[0].eventDate, '2026-10-12')
  assert.equal(state.facts[0].eventDateSource.turn, 2)
  const updated = advanceMemory(
    state,
    [...pair('Tenho uma entrevista.'), ...pair('Amanhã.')],
    'A entrevista foi adiada.',
    '2026-10-13T23:00:00Z',
  )
  assert.equal(updated.facts[0].eventDate, null)
  assert.equal(updated.facts[0].status, 'open')
})
test('legacy messages without original timestamps cannot recreate relative dates', () => {
  const state = advanceMemory(
    enabled(),
    [],
    [{ text: 'Tenho uma entrevista amanhã.', historical: true }],
    start,
  )
  assert.equal(state.facts[0].eventDate, null)
  assert.equal(state.facts[0].reported.recordedAt, null)
})
test('ongoing projects can be relevant on a later return without pretending to know a completion date', () => {
  const state = advanceMemory(
    enabled(),
    [],
    'Estou começando um projeto.',
    start,
  )
  const ctx = buildConversationContext(
    DEFAULT_SELECTION,
    pair('Estou começando um projeto.'),
    'Oi',
    state,
    '2026-10-12T23:00:00Z',
  )
  assert.equal(ctx.data.openTopics[0].eventDate, null)
  assert.equal(ctx.data.openTopics[0].dateKnown, false)
  assert.match(ctx.data.openTopics[0].instruction, /não presuma/)
})
