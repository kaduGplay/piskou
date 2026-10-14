import test from 'node:test'
import assert from 'node:assert/strict'
import { quoteCheckout } from '../src/shared/checkout.js'
test('cart totals use cents and only selected, available extras', () => {
  assert.equal(quoteCheckout('premium-access').totalCents, 1000)
  assert.equal(quoteCheckout('premium-access', ['second-partner']).totalCents, 1890)
  assert.equal(quoteCheckout('premium-access', ['voice-call']).totalCents, 1890)
  assert.deepEqual(quoteCheckout('premium-access', ['voice-call', 'second-partner']).addonIds, ['second-partner', 'voice-call'])
  assert.equal(quoteCheckout('premium-access', ['voice-call', 'second-partner']).totalCents, 2780)
  assert.equal(quoteCheckout('luxury-access').totalCents, 1990)
  assert.equal(quoteCheckout('luxury-access', ['voice-call']).totalCents, 2880)
  assert.equal(quoteCheckout('luxury-access', ['voice-call']).amount, 28.8)
  for (const selected of [['second-partner','second-partner'], ['unknown'], 'second-partner', [null], ['voice-call', 'voice-call', 'second-partner']]) assert.throws(() => quoteCheckout('premium-access', selected))
  assert.throws(() => quoteCheckout('luxury-access', ['second-partner']))
  assert.throws(() => quoteCheckout('messages-120', ['second-partner']))
  assert.throws(() => quoteCheckout('messages-unlimited', ['voice-call']))
})
