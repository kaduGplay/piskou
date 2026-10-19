import test from 'node:test'
import assert from 'node:assert/strict'
import { liberpayGateway } from '../api/_lib/liberpay.js'
import { store, chargeKey } from '../api/_lib/store.js'
process.env.LIBERPAY_CLIENT_ID = 'test-client'
process.env.LIBERPAY_CLIENT_SECRET = 'test-secret'
process.env.LIBERPAY_WEBHOOK_SECRET = 'hook-secret'
const order = { id: 'piskou_req_hash', amountCents: 12800, plan: { id: 'premium-access', name: 'Baby' }, customer: { name: 'Juan Pérez', email: 'juan@ejemplo.com' }, siteUrl: 'https://piskoumx.vercel.app', metadata: { tracking: {} } }
const withFetch = async (handler, run) => { const original = globalThis.fetch; globalThis.fetch = handler; try { return await run() } finally { globalThis.fetch = original } }
test('deposits are only created from the static IP regions', async () => {
  delete process.env.VERCEL_REGION
  let called = false
  await withFetch(async () => { called = true; return Response.json({}) }, () => assert.rejects(liberpayGateway.createDeposit(order, 'spei'), /IP fixo/))
  process.env.VERCEL_REGION = 'gru1'
  await withFetch(async () => { called = true; return Response.json({}) }, () => assert.rejects(liberpayGateway.createDeposit(order, 'spei'), /gru1/))
  assert.equal(called, false)
})
test('SPEI and OXXO deposits use the token and return the CLABE or reference', async () => {
  process.env.VERCEL_REGION = 'iad1'
  const calls = []
  const result = await withFetch(async (url, options) => {
    calls.push({ url, options })
    if (url.endsWith('/auth/token')) return Response.json({ access_token: 'tok-1', expires_in: 3600 })
    return Response.json({ message: 'Deposit created successfully.', qrCodeResponse: { transactionId: 'tx-oxxo', status: 'pending', amount: 128, qrcode: '8203650002620292', barcodeUrl: 'https://static.muwe.mx/bar.png' } }, { status: 201 })
  }, () => liberpayGateway.createDeposit(order, 'oxxo'))
  assert.deepEqual(JSON.parse(calls[0].options.body), { client_id: 'test-client', client_secret: 'test-secret' })
  const deposit = calls.find((call) => call.url.endsWith('/payments/deposit'))
  assert.equal(deposit.options.headers.Authorization, 'Bearer tok-1')
  const body = JSON.parse(deposit.options.body)
  assert.deepEqual({ amount: body.amount, method: body.payment_method, currency: body.currency, email: body.payer.email, external: body.external_id }, { amount: 128, method: 'oxxo', currency: 'MXN', email: 'juan@ejemplo.com', external: 'piskou_req_hash' })
  assert.equal(body.metadata.checkout_url, 'https://piskoumx.vercel.app/checkout')
  assert.deepEqual(result, { id: 'tx-oxxo', status: 'pending', deposit: { method: 'oxxo', code: '8203650002620292', barcodeUrl: 'https://static.muwe.mx/bar.png', expiresAt: null } })
  await assert.rejects(liberpayGateway.createDeposit(order, 'pix'), /não suportada/)
})
test('webhooks need the secret key, a stored charge and the same amount', async () => {
  await store.set(chargeKey('tx-paid'), { orderId: 'piskou_paid', amount: 128, status: 'pending' })
  const hook = (key, body) => liberpayGateway.handleWebhook({ query: { key }, body })
  const paid = { event: 'payment.paid', data: { transaction_id: 'tx-paid', status: 'paid', amount: 128, net_amount: 118, end_to_end: null } }
  await assert.rejects(hook('wrong', paid), /Chave/)
  await assert.rejects(hook(undefined, paid), /Chave/)
  await assert.rejects(hook('hook-secret', { event: 'payment.paid', data: { transaction_id: 'unknown', amount: 128 } }), /não encontrada/)
  await assert.rejects(hook('hook-secret', { event: 'payment.paid', data: { transaction_id: 'tx-paid', amount: 1 } }), /Valor/)
  const event = await hook('hook-secret', paid)
  assert.deepEqual({ orderId: event.orderId, id: event.id, status: event.status }, { orderId: 'piskou_paid', id: 'tx-paid', status: 'paid' })
  assert.equal((await hook('hook-secret', { event: 'payment.cancelled', data: { transaction_id: 'tx-paid', amount: 128 } })).status, 'expired')
  assert.equal((await hook('hook-secret', { event: 'payment.failed', data: { transaction_id: 'tx-paid', amount: 128 } })).status, 'failed')
})
