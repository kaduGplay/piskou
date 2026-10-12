import test from 'node:test'
import assert from 'node:assert/strict'
import { generateChatImage } from '../api/_lib/images.js'

test('generates one JPEG of the requested subject without exposing a remote URL', async () => {
  const result = await generateChatImage('a flower drawing', async (url, options) => {
    const body = JSON.parse(options.body)
    assert.equal(body.n, 1)
    assert.equal(body.output_format, 'jpeg')
    assert.ok(body.prompt.includes('a flower drawing'))
    return { ok: true, json: async () => ({ data: [{ b64_json: 'YWJj' }] }) }
  })
  assert.equal(result.src, 'data:image/jpeg;base64,YWJj')
})

test('does not substitute the avatar or retry a failed generation', async () => {
  let calls = 0
  await assert.rejects(generateChatImage('flowers', async () => {
    calls++
    return { ok: false, status: 403 }
  }), /Image HTTP 403/)
  assert.equal(calls, 1)
})

test('rejects missing subjects and malformed image data', async () => {
  await assert.rejects(generateChatImage(''), /Missing image subject/)
  await assert.rejects(generateChatImage('flowers', async () => ({ok: true, json: async () => ({data:[{b64_json:'https://example.com'}]})})), /Invalid image output/)
})

test('defaults to high quality photography for realistic characters', async () => {
  await generateChatImage('a mountain landscape', async (_url, options) => {
    const body = JSON.parse(options.body)
    assert.match(body.prompt, /maximum photorealism/)
    assert.match(body.prompt, /respect that requested medium/)
    assert.equal(body.quality, 'high')
    assert.equal(body.output_compression, 85)
    return { ok: true, json: async () => ({ data: [{ b64_json: 'YWJj' }] }) }
  }, { style: 'realista' })
})

test('uses anime style for anime characters', async () => {
  await generateChatImage('a mountain landscape', async (_url, options) => {
    const body = JSON.parse(options.body)
    assert.match(body.prompt, /Use Japanese anime style/)
    assert.doesNotMatch(body.prompt, /maximum photorealism/)
    return { ok: true, json: async () => ({ data: [{ b64_json: 'YWJj' }] }) }
  }, { style: 'anime' })
})
