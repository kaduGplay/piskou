import test from 'node:test'
import assert from 'node:assert/strict'
import admin from '../api/admin.js'
import { adminToken } from '../api/_lib/admin.js'
process.env.ADMIN_PASSWORD = 'transaction-test-password'
process.env.CHAT_SESSION_SECRET = 'transaction-test-secret'
const response = () => ({
  setHeader() {},
  status(code) {
    this.code = code
    return this
  },
  json(body) {
    this.body = body
    return this
  },
})
test('transaction list and changes require admin authentication', async () => {
  for (const method of ['GET', 'POST']) {
    const res = response()
    await admin(
      {
        method,
        headers: {},
        query: { action: 'transactions' },
        body: { action: 'transactions' },
      },
      res,
    )
    assert.equal(res.code, 401)
  }
})
test('authenticated edits reject cross-origin requests before database access', async () => {
  const res = response()
  await admin(
    {
      method: 'POST',
      headers: {
        cookie: 'piskou_admin=' + adminToken(),
        host: 'localhost:5173',
        origin: 'https://external.test',
      },
      query: { action: 'transactions' },
      body: {},
    },
    res,
  )
  assert.equal(res.code, 403)
})
test('rejects invalid filters and forged status/id inputs before database access', async () => {
  const headers = {
    cookie: 'piskou_admin=' + adminToken(),
    host: 'localhost:5173',
    origin: 'http://localhost:5173',
  }
  for (const query of [
    { action: 'transactions', status: 'unknown' },
    { action: 'transactions', offset: '-1' },
  ]) {
    const res = response()
    await admin({ method: 'GET', headers, query }, res)
    assert.equal(res.code, 400)
  }
  for (const body of [
    { id: 'charge?or=1', status: 'paid', note: '', revision: 0 },
    { id: 'valid-id', status: 'refunded', note: '', revision: 0 },
  ]) {
    const res = response()
    await admin(
      { method: 'POST', headers, query: { action: 'transactions' }, body },
      res,
    )
    assert.equal(res.code, 400)
  }
})
