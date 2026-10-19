import test from 'node:test'
import assert from 'node:assert/strict'
import { quoteCheckout } from '../src/shared/checkout.js'
test('cart totals use cents and only selected, available extras', () => {
  assert.equal(quoteCheckout('premium-access').totalCents, 9900)
  assert.equal(quoteCheckout('premium-access', ['second-partner']).totalCents, 12800)
  assert.equal(quoteCheckout('premium-access', ['voice-call']).totalCents, 12800)
  assert.deepEqual(quoteCheckout('premium-access', ['voice-call', 'second-partner']).addonIds, ['second-partner', 'voice-call'])
  assert.equal(quoteCheckout('premium-access', ['voice-call', 'second-partner']).totalCents, 15700)
  assert.equal(quoteCheckout('luxury-access').totalCents, 17900)
  assert.equal(quoteCheckout('luxury-access', ['voice-call']).totalCents, 20800)
  assert.equal(quoteCheckout('luxury-access', ['voice-call']).amount, 208)
  for (const selected of [['second-partner','second-partner'], ['unknown'], 'second-partner', [null], ['voice-call', 'voice-call', 'second-partner']]) assert.throws(() => quoteCheckout('premium-access', selected))
  assert.throws(() => quoteCheckout('luxury-access', ['second-partner']))
  assert.throws(() => quoteCheckout('messages-120', ['second-partner']))
  assert.throws(() => quoteCheckout('messages-unlimited', ['voice-call']))
  assert.throws(() => quoteCheckout('upsell-vip', ['voice-call']))
  assert.equal(quoteCheckout('upsell-video-pack').totalCents, 4900)
})
