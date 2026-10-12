import test from 'node:test'
import assert from 'node:assert/strict'
import { chatSession, chatSignature } from '../api/_lib/chat.js'
import { PLANS } from '../src/shared/checkout.js'
import { generateChatReply } from '../api/_lib/model.js'
import { DEFAULT_SELECTION } from '../src/funnel/data.js'
test('signed chat identity is available to checkout and rejects tampering', () => {
  process.env.CHAT_SESSION_SECRET = 'unit-test-secret'
  const id = '10000000-1000-4000-8000-100000000000'
  let cookie
  const res = {
    setHeader: (key, value) => {
      if (key === 'Set-Cookie') cookie = value
    },
  }
  assert.equal(
    chatSession(
      { headers: { cookie: `piskou_access=${id}.${chatSignature(id)}` } },
      res,
    ),
    id,
  )
  assert.match(cookie, /Path=\/api;/)
  assert.equal(
    chatSession(
      { headers: { cookie: `piskou_access=${id}.${'0'.repeat(64)}` } },
      res,
    ),
    null,
  )
})
test('message products have the authorized fixed prices', () => {
  assert.equal(PLANS['premium-access'].price, 23.85)
  assert.equal(PLANS['luxury-access'].price, 48.85)
  assert.equal(PLANS['messages-six'].price, PLANS['premium-access'].price)
  assert.equal(PLANS['messages-unlimited'].price, PLANS['luxury-access'].price)
  assert.equal(PLANS['messages-six'].purpose, 'messages')
  assert.equal(PLANS['messages-120'].price, PLANS['premium-access'].price)
  assert.equal(PLANS['messages-120'].messageCount, 120)
  assert.equal(PLANS['messages-120'].purpose, 'messages')
})
test('unlimited conversation keeps recent context within bounded model input', async () => {
  let request
  const history = Array.from({ length: 100 }, (_, i) => ({
    role: i % 2 ? 'character' : 'user',
    text: `turn ${i}`,
  }))
  await generateChatReply(
    DEFAULT_SELECTION,
    history,
    'atual',
    50,
    async (url, options) => {
      request = JSON.parse(options.body)
      return new Response(
        JSON.stringify({
          output: [
            {
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    reply: 'Olá',
                    mediaRequest: 'none',
                    imagePrompt: '',
                  }),
                },
              ],
            },
          ],
        }),
      )
    },
    async () => {},
  )
  assert.equal(request.input.length, 26)
  assert.equal(request.input[1].content, 'turn 76')
  assert.match(request.input[0].content, /CONTEXTO ESTRUTURADO/)
  assert.equal(request.input.at(-1).content, 'atual')
  assert.ok(!request.instructions.includes('de 6 da prévia'))
})

test('checkout binds purchase to signed owner and status cannot grant another browser', async () => {
  const { default: checkout } = await import('../api/checkout.js')
  const { default: status } = await import('../api/checkout-status.js')
  const savedEnv = { ...process.env }
  const originalFetch = globalThis.fetch
  Object.assign(process.env, {
    PAYMENT_GATEWAY: 'mock',
    SUPABASE_URL: 'https://db.test',
    SUPABASE_SECRET_KEY: 'sb_secret_test',
    CHAT_SESSION_SECRET: 'test-payment-secret',
    VERCEL_ENV: 'development',
  })
  delete process.env.VERCEL
  const charges = new Map()
  let grants = 0
  let failGrant = false
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('piskou_chat_sessions')) return new Response('[]')
    if (String(url).includes('piskou_store_set')) {
      const d = JSON.parse(options.body)
      charges.set(d.p_key, d.p_value)
      return new Response(null, { status: 204 })
    }
    if (String(url).includes('piskou_payment_store')) {
      const key = new URL(url).searchParams.get('key').slice(3)
      return new Response(
        JSON.stringify(charges.has(key) ? [{ value: charges.get(key) }] : []),
      )
    }
    if (String(url).includes('piskou_chat_grant')) {
      if (failGrant) throw new Error('temporary database failure')
      grants++
      return new Response(JSON.stringify({ allowance: 6, unlimited: false }))
    }
    throw new Error('Unexpected request ' + url)
  }
  const response = () => ({
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v
    },
    status(code) {
      this.code = code
      return this
    },
    json(data) {
      this.data = data
      return this
    },
  })
  try {
    const res = response()
    await checkout(
      {
        method: 'POST',
        headers: { host: 'test.local', origin: 'http://test.local' },
        body: {
          planId: 'premium-access',
          selection: DEFAULT_SELECTION,
          method: 'card',
          cardToken: 'test-token',
          customer: { name: 'Teste', email: 'teste@example.test' },
        },
      },
      res,
    )
    assert.equal(res.code, 200)
    assert.equal(res.data.status, 'paid')
    assert.equal(grants, 1)
    const cookie = res.headers['Set-Cookie'].split(';')[0]
    const other = response()
    await status(
      { method: 'GET', headers: {}, query: { id: res.data.id } },
      other,
    )
    assert.equal(other.code, 404)
    assert.equal(grants, 1)
    const own = response()
    await status(
      { method: 'GET', headers: { cookie }, query: { id: res.data.id } },
      own,
    )
    assert.equal(own.data.status, 'paid')
    assert.equal(grants, 2) // Database idempotency handles repeated confirmations.
    const pixRequest = {
      method: 'POST',
      headers: { host: 'test.local', origin: 'http://test.local', cookie },
      body: { planId: 'luxury-access', method: 'pix', selection: DEFAULT_SELECTION,
        requestId: '20000000-2000-4000-8000-200000000000', amount: 0.01,
        customer: { name: 'Ignored', email: 'ignored@example.test' } },
    }
    const pix = response()
    await checkout(pixRequest, pix)
    assert.equal(pix.code, 200)
    assert.equal(pix.data.amount, PLANS['luxury-access'].price)
    assert.deepEqual(charges.get('charge:' + pix.data.id).customer,
      { name: 'Usuario Piskou', email: 'vasconcelosescala@gmail.com' })
    const repeated = response()
    await checkout(pixRequest, repeated)
    assert.equal(repeated.data.id, pix.data.id)
    const noCustomer = response()
    await checkout({ ...pixRequest, body: { ...pixRequest.body, customer: undefined } }, noCustomer)
    assert.equal(noCustomer.code, 200)
    assert.equal(noCustomer.data.id, pix.data.id)

    failGrant = true
    const deferred = response()
    await checkout({method:'POST',headers:{host:'test.local',origin:'http://test.local'},body:{planId:'premium-access',selection:DEFAULT_SELECTION,method:'card',cardToken:'test-token',customer:{name:'Teste',email:'teste@example.test'}}},deferred)
    assert.equal(deferred.code,200)
    assert.equal(deferred.data.status,'processing')
    assert.equal(charges.get('charge:'+deferred.data.id).status,'paid')

  } finally {
    globalThis.fetch = originalFetch
    for (const key of Object.keys(process.env))
      if (!(key in savedEnv)) delete process.env[key]
    Object.assign(process.env, savedEnv)
  }
})
