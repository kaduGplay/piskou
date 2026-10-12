import test from 'node:test'
import assert from 'node:assert/strict'
import handler from '../api/chat-memory.js'
import { chatSignature, chatSelection } from '../api/_lib/chat.js'
import { DEFAULT_SELECTION } from '../src/funnel/data.js'
const response = () => ({
  headers: {},
  setHeader(k, v) {
    this.headers[k] = v
  },
  status(n) {
    this.code = n
    return this
  },
  json(v) {
    this.data = v
    return this
  },
})
test('memory endpoint enforces signed ownership, character identity, CSRF and revision controls', async () => {
  const before = { ...process.env },
    fetcher = globalThis.fetch
  Object.assign(process.env, {
    CHAT_SESSION_SECRET: 'memory-test',
    SUPABASE_URL: 'https://db.test',
    SUPABASE_SECRET_KEY: 'sb_secret_test',
  })
  delete process.env.VERCEL
  const a = '10000000-0000-4000-8000-000000000001',
    b = '10000000-0000-4000-8000-000000000002'
  const selection = chatSelection({ ...DEFAULT_SELECTION, name: 'Lia' })
  let rpc
  globalThis.fetch = async (url, options) => {
    const target = new URL(url)
    if (target.pathname.endsWith('piskou_chat_sessions'))
      return new Response(JSON.stringify([{ selection }]))
    if (target.pathname.endsWith('piskou_character_memory')) {
      assert.equal(target.searchParams.get('chat_id'), 'eq.' + a)
      return new Response(
        JSON.stringify([
          {
            state: {
              enabled: true,
              revision: 3,
              facts: [
                { key: 'user:name', value: 'Bruno', source: { turn: 1 } },
              ],
            },
          },
        ]),
      )
    }
    if (target.pathname.endsWith('piskou_memory_settings')) {
      rpc = JSON.parse(options.body)
      assert.equal(rpc.p_id, a)
      return new Response(JSON.stringify({ error: 'conflict' }))
    }
    throw new Error('Unexpected URL')
  }
  const base = {
    method: 'GET',
    headers: {
      host: 'test.local',
      cookie: `piskou_access=${a}.${chatSignature(a)}`,
    },
    query: { selection: JSON.stringify(selection), id: b },
  }
  try {
    let r = response()
    await handler(
      {
        ...base,
        headers: { host: 'test.local', cookie: `piskou_access=${b}.bad` },
      },
      r,
    )
    assert.equal(r.code, 401)
    r = response()
    await handler(base, r)
    assert.equal(r.code, 200)
    assert.equal(r.data.state.facts[0].value, 'Bruno')
    r = response()
    await handler(
      {
        ...base,
        query: { selection: JSON.stringify({ ...selection, name: 'Outra' }) },
      },
      r,
    )
    assert.equal(r.code, 409)
    const post = {
      ...base,
      method: 'POST',
      body: { selection, action: 'clear', revision: 3, id: b },
    }
    r = response()
    await handler(
      { ...post, headers: { ...post.headers, origin: 'https://evil.test' } },
      r,
    )
    assert.equal(r.code, 403)
    r = response()
    await handler(
      { ...post, headers: { ...post.headers, origin: 'http://test.local' } },
      r,
    )
    assert.equal(r.code, 409)
    assert.equal(rpc.p_revision, 3)
  } finally {
    globalThis.fetch = fetcher
    for (const key of Object.keys(process.env))
      if (!(key in before)) delete process.env[key]
    Object.assign(process.env, before)
  }
})
