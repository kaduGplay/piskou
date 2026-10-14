import test from 'node:test'
import assert from 'node:assert/strict'
import { chatSignature } from '../api/_lib/chat.js'
import { ownedConversations, rememberConversations, activateConversation, canCreateCharacter } from '../api/_lib/conversations.js'
process.env.CHAT_SESSION_SECRET = 'isolated-conversation-test'
const a = '11000000-0000-4000-8000-000000000001', b = '11000000-0000-4000-8000-000000000002'
const request = (cookie = '') => ({ headers: { cookie } })
const response = () => ({ headers: {}, setHeader(k,v) { this.headers[k]=v }, getHeader(k) { return this.headers[k] } })
test('ownership accepts only signed conversations and rejects forged cookies', () => {
  assert.deepEqual(ownedConversations(request(`piskou_access=${a}.${chatSignature(a)}`)), [a])
  assert.deepEqual(ownedConversations(request(`piskou_access=${b}.${chatSignature(a)}`)), [])
  assert.deepEqual(ownedConversations(request('piskou_conversations=e30.bad')), [])
})
test('switching preserves signed ownership of both conversations and active cookie', () => {
  const req = request(`piskou_access=${a}.${chatSignature(a)}`), res=response()
  activateConversation(req,res,b)
  assert.equal(res.headers['Set-Cookie'].length, 2)
  const cookies = res.headers['Set-Cookie'].map((value)=>value.split(';')[0]).join('; ')
  assert.deepEqual(ownedConversations(request(cookies)), [a,b])
  assert.match(cookies, new RegExp(`piskou_access=${b}`))
})
test('creation requires an active initial Baby or Pro purchase from owned conversations', async () => {
  const req = request(`piskou_access=${a}.${chatSignature(a)}`)
  assert.equal(await canCreateCharacter(request(), () => { throw new Error('No query expected') }), false)
  assert.equal(await canCreateCharacter(req, async (path) => {
    assert.ok(path.includes(a))
    assert.ok(path.includes('active=eq.true'))
    assert.ok(path.includes('plan_id=in.(premium-access,luxury-access)'))
    return []
  }), false)
  assert.equal(await canCreateCharacter(req, async () => [{ chat_id:a }]), true)
})

test('a paid second-partner slot is usable once, while voice access remains paid at full capacity', async () => {
  const { hasCharacterPlan } = await import('../api/_lib/conversations.js')
  const first = request(`piskou_access=${a}.${chatSignature(a)}`)
  assert.equal(await canCreateCharacter(first, async()=>[{ chat_id:a,character_slots:1 }]), false)
  assert.equal(await canCreateCharacter(first, async()=>[{ chat_id:a,character_slots:2 }]), true)
  const res=response();activateConversation(first,res,b)
  const second=request(res.headers['Set-Cookie'].map(value=>value.split(';')[0]).join('; '))
  assert.equal(await canCreateCharacter(second,async()=>[{ chat_id:a,character_slots:2 }]),false)
  assert.equal(await hasCharacterPlan(second,async()=>[{chat_id:a}]),true)
})

test('paid add-ons from any owned conversation unlock the voice call', async () => {
  const { ownedAddons } = await import('../api/_lib/conversations.js')
  assert.deepEqual(await ownedAddons(request(''), async () => { throw new Error('no query without conversations') }), [])
  const req = request(`piskou_access=${a}.${chatSignature(a)}`)
  let query = ''
  assert.deepEqual(await ownedAddons(req, async (path) => { query = path; return [{ addons: ['voice-call'] }, { addons: [] }, { addons: ['second-partner', 'voice-call'] }] }), ['second-partner', 'voice-call'])
  assert.match(query, /active=eq\.true/)
})
