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
  assert.equal(PLANS['premium-access'].price, 14.90)
  assert.equal(PLANS['luxury-access'].price, 27.90)
  assert.equal(PLANS['messages-six'].price, 10)
  assert.equal(PLANS['messages-unlimited'].price, 19.90)
  assert.equal(PLANS['messages-six'].purpose, 'messages')
  assert.equal(PLANS['messages-120'].price, 10)
  assert.deepEqual(['upsell-video-pack', 'upsell-whatsapp', 'upsell-vip'].map((id) => [PLANS[id].price, PLANS[id].purpose]), [[14.90, 'upsell'], [14.90, 'upsell'], [19.90, 'upsell']])
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
  let purchases = []
  let contactSaved = true
  const contacts = []
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('piskou_chat_sessions')) return new Response('[]')
    if (String(url).includes('piskou_chat_purchases')) return new Response(JSON.stringify(purchases))
    if (String(url).includes('piskou_upsell_contact')) {
      contacts.push(JSON.parse(options.body))
      return new Response(JSON.stringify(contactSaved))
    }
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
      { name: 'Ignored', email: 'ignored@example.test' })
    const repeated = response()
    await checkout(pixRequest, repeated)
    assert.equal(repeated.data.id, pix.data.id)
    const noCustomer = response()
    await checkout({ ...pixRequest, body: { ...pixRequest.body, customer: undefined } }, noCustomer)
    assert.equal(noCustomer.code, 400)
    assert.ok(noCustomer.data.fields.email)

    const addonRequest = { ...pixRequest, body: { ...pixRequest.body, planId: 'premium-access', addons: ['second-partner'], amount: 0.01, requestId: '30000000-3000-4000-8000-300000000000' } }
    const addon = response(); await checkout(addonRequest, addon)
    assert.equal(addon.code, 200)
    assert.equal(addon.data.amount, 23.80)
    assert.deepEqual(charges.get('charge:' + addon.data.id).addons, ['second-partner'])
    const addonRepeated = response(); await checkout(addonRequest, addonRepeated)
    assert.equal(addonRepeated.data.id, addon.data.id)
    const voice = response(); await checkout({ ...addonRequest, body: { ...addonRequest.body, addons: ['voice-call', 'second-partner'], requestId: '40000000-4000-4000-8000-400000000000' } }, voice)
    assert.equal(voice.code, 200)
    assert.equal(voice.data.amount, 32.70)
    assert.deepEqual(charges.get('charge:' + voice.data.id).addons, ['second-partner', 'voice-call'])
    const before = charges.size
    const unknown = response(); await checkout({ ...addonRequest, body: { ...addonRequest.body, addons: ['video-call'] } }, unknown)
    assert.equal(unknown.code, 400); assert.equal(charges.size, before)
    const included = response(); await checkout({ ...addonRequest, body: { ...addonRequest.body, planId: 'luxury-access' } }, included)
    assert.equal(included.code, 400); assert.equal(charges.size, before)

    // Upsell de um clique: só depois do Baby/Pro desta conversa, sem adicionais e uma vez por item.
    const upsellRequest = { ...pixRequest, body: { ...pixRequest.body, planId: 'upsell-vip', requestId: '50000000-5000-4000-8000-500000000000' } }
    const early = response(); await checkout(upsellRequest, early)
    assert.equal(early.code, 403); assert.equal(charges.size, before)
    purchases = [{ plan_id: 'premium-access' }]
    const vip = response(); await checkout(upsellRequest, vip)
    assert.equal(vip.code, 200)
    assert.equal(vip.data.amount, 19.90)
    assert.equal(charges.get('charge:' + vip.data.id).planId, 'upsell-vip')
    const withAddon = response(); await checkout({ ...upsellRequest, body: { ...upsellRequest.body, addons: ['voice-call'], requestId: '60000000-6000-4000-8000-600000000000' } }, withAddon)
    assert.equal(withAddon.code, 400)
    purchases = [{ plan_id: 'premium-access' }, { plan_id: 'upsell-vip' }]
    const owned = response(); await checkout({ ...upsellRequest, body: { ...upsellRequest.body, requestId: '70000000-7000-4000-8000-700000000000' } }, owned)
    assert.equal(owned.code, 409); assert.equal(owned.data.code, 'owned')

    const whatsapp = (phone, headers = pixRequest.headers) => { const r = response(); return checkout({ method: 'POST', headers, body: { action: 'whatsapp', phone } }, r).then(() => r) }
    assert.equal((await whatsapp('123')).code, 400)
    assert.equal((await whatsapp('(11) 99999-8888', { host: 'test.local', origin: 'http://test.local' })).code, 403)
    const savedPhone = await whatsapp('+55 (11) 99999-8888')
    assert.equal(savedPhone.code, 200)
    assert.equal(contacts.at(-1).p_phone, '11999998888')
    contactSaved = false
    assert.equal((await whatsapp('11999998888')).code, 403)

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
