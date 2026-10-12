import test from 'node:test'
import assert from 'node:assert/strict'
import { chatTimeline } from '../src/shared/chatTimeline.js'
const order = (messages, notices) => chatTimeline(messages, notices)
  .map((entry) => entry.type === 'media' ? entry.item.id : entry.message.id)

test('video notice stays before subsequent optimistic and confirmed messages', () => {
  const messages = [{ id: 'request' }, { id: 'response' }]
  const notices = [{ id: 'video-plan', afterMessageId: 'response', kind: 'video' }]
  const next = { id: 'next', localState: 'sending' }
  assert.deepEqual(order([...messages, next], notices),
    ['request', 'response', 'video-plan', 'next'])
  assert.deepEqual(order([...messages, { id: 'next' }, { id: 'reply' }], notices),
    ['request', 'response', 'video-plan', 'next', 'reply'])
})

test('multiple photo and video notices stay at their original responses after reload', () => {
  const notices = JSON.parse(JSON.stringify([
    { id: 'photo-plan', afterMessageId: 'a' },
    { id: 'video-plan', afterMessageId: 'b' },
  ]))
  assert.deepEqual(order([{ id: 'a' }, { id: 'b' }, { id: 'c' }], notices),
    ['a', 'photo-plan', 'b', 'video-plan', 'c'])
})

test('missing anchors keep notices visible without moving later messages above them', () => {
  assert.deepEqual(order([{ id: 'next' }], [{ id: 'notice', afterMessageId: 'removed' }]),
    ['notice', 'next'])
})
