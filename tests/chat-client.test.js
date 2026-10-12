import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatClient } from '../src/shared/chatClient.js'
const id = '11000000-0000-4000-8000-000000000001'
const tick = () => new Promise((resolve) => setImmediate(resolve))
const fakeTimers = {
  setInterval: () => 0,
  clearInterval: () => {},
  setTimeout: () => 0,
  clearTimeout: () => {},
}
const memoryStorage = () => {
  const map = new Map()
  return {
    getItem: (key) => map.get(key),
    setItem: (key, value) => map.set(key, value),
  }
}
const response = (value) => new Response(JSON.stringify(value), { status: 200 })
function server() {
  const state = {
    conversationId: id,
    revision: 0,
    messages: [],
    remaining: 12,
    preparing: false,
  }
  const operations = []
  return {
    state,
    operations,
    async fetcher(url, options) {
      if (!options?.body) return response(state)
      const body = JSON.parse(options.body)
      operations.push(body)
      if (
        body.action === 'enqueue' &&
        !state.messages.some((m) => m.id === body.messageId)
      ) {
        state.messages.push({
          id: body.messageId,
          role: 'user',
          text: body.message,
          state: 'sent',
          sentAt: '2026-10-11T23:00:00.000Z',
          charged: false,
        })
        state.revision++
      }
      if (body.action === 'delete') {
        const m = state.messages.find((m) => m.id === body.messageId)
        if (m) {
          m.text = ''
          m.deleted = true
        }
        state.deletedIds = [body.messageId]
        state.revision++
      }
      return response(state)
    },
  }
}
test('rapid sends are individually optimistic and immediately persisted with unique ids', async () => {
  const backend = server(),
    snapshots = []
  const client = createChatClient({
    selection: {},
    onSnapshot: (s) => snapshots.push(s),
    onError: assert.fail,
    fetcher: backend.fetcher,
    timers: fakeTimers,
    storage: memoryStorage(),
  })
  await client.start()
  for (const text of [
    'Tenho uma entrevista',
    'amanhã',
    'e preciso do currículo',
  ])
    client.send(text)
  assert.equal(snapshots.at(-1).messages.length, 3)
  assert.equal(snapshots.at(-1).messages[0].localState, 'sending')
  await tick()
  await tick()
  assert.equal(backend.operations.length, 3)
  assert.equal(new Set(backend.operations.map((o) => o.messageId)).size, 3)
  assert.ok(
    snapshots.at(-1).messages.every((m) => m.state === 'sent' && !m.viewedAt),
  )
  client.dispose()
})
test('lost confirmation reconciles by id instead of duplicating or labeling persisted content failed', async () => {
  const backend = server(),
    errors = [],
    snapshots = []
  const client = createChatClient({
    selection: {},
    onSnapshot: (s) => snapshots.push(s),
    onError: (e) => errors.push(e),
    timers: fakeTimers,
    storage: memoryStorage(),
    fetcher: async (url, options) => {
      const result = await backend.fetcher(url, options)
      if (options?.body && JSON.parse(options.body).action === 'enqueue')
        throw new TypeError('Lost response')
      return result
    },
  })
  await client.start()
  client.send('Teste')
  await tick()
  await tick()
  assert.equal(backend.state.messages.length, 1)
  assert.equal(errors.length, 0)
  assert.equal(snapshots.at(-1).messages[0].localState, undefined)
  client.dispose()
})
test('reload resumes unconfirmed operation with the same id; late old snapshots never cross clients', async () => {
  const backend = server(),
    storage = memoryStorage(),
    snapshots = []
  let release
  const old = createChatClient({
    selection: {},
    onSnapshot: (s) => snapshots.push(s),
    onError: () => {},
    timers: fakeTimers,
    storage,
    fetcher: async (url, options) =>
      options?.body
        ? new Promise((resolve) => {
            release = () => backend.fetcher(url, options).then(resolve)
          })
        : backend.fetcher(url, options),
  })
  await old.start()
  const messageId = old.send('Persistir ao recarregar')
  await tick()
  old.dispose()
  const count = snapshots.length
  const next = createChatClient({
    selection: {},
    onSnapshot: () => {},
    onError: assert.fail,
    timers: fakeTimers,
    storage,
    fetcher: backend.fetcher,
  })
  await next.start()
  await tick()
  await tick()
  release()
  await tick()
  await tick()
  assert.equal(snapshots.length, count)
  assert.equal(backend.state.messages.length, 1)
  assert.equal(backend.state.messages[0].id, messageId)
  next.dispose()
})
test('deletion and tombstones synchronize to a second authorized device', async () => {
  const backend = server(),
    snapshots = []
  const first = createChatClient({
    selection: {},
    onSnapshot: () => {},
    onError: assert.fail,
    timers: fakeTimers,
    storage: memoryStorage(),
    fetcher: backend.fetcher,
  })
  const second = createChatClient({
    selection: {},
    onSnapshot: (s) => snapshots.push(s),
    onError: assert.fail,
    timers: fakeTimers,
    storage: memoryStorage(),
    fetcher: backend.fetcher,
  })
  await first.start()
  await second.start()
  const messageId = first.send('Apagar isto')
  await tick()
  await tick()
  await second.sync()
  assert.equal(snapshots.at(-1).messages[0].text, 'Apagar isto')
  await first.remove(messageId)
  await second.sync()
  assert.equal(snapshots.at(-1).messages[0].deleted, true)
  assert.equal(snapshots.at(-1).messages[0].text, '')
  first.dispose()
  second.dispose()
})

test('slow audio preparation does not block text persistence and deletion prevents late enqueue', async () => {
  const backend = server()
  let releaseAudio
  const client = createChatClient({
    selection: {},
    onSnapshot: () => {},
    onError: assert.fail,
    timers: fakeTimers,
    storage: memoryStorage(),
    fetcher: (url, options) =>
      url === '/api/chat-audio'
        ? new Promise((resolve) => {
            releaseAudio = () => resolve(response({ text: 'Áudio transcrito' }))
          })
        : backend.fetcher(url, options),
  })
  await client.start()
  const audioId = client.send('Áudio', {
    recording: { mime: 'audio/webm', data: 'fake' },
  })
  client.send('Texto sem esperar o áudio')
  await tick()
  await tick()
  assert.equal(backend.state.messages.length, 1)
  assert.equal(backend.state.messages[0].text, 'Texto sem esperar o áudio')
  await client.remove(audioId)
  releaseAudio()
  await tick()
  await tick()
  assert.equal(
    backend.operations.filter((o) => o.action === 'enqueue').length,
    1,
  )
  client.dispose()
})
