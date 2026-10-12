import test from 'node:test'
import assert from 'node:assert/strict'
import { allowImageGeneration } from '../api/_lib/image-intent.js'
const history = [{ role: 'user', text: 'Manda uma imagem de flores' },
  { role: 'character', text: 'Aqui está!', media: { src: 'data:image/jpeg;base64,YWJj' } }]

test('reactions and normal conversation after an image do not request more images', () => {
  for (const text of ['linda', 'gostei', 'obrigado', 'sim', 'ok', 'como foi seu dia?', 'quero conversar', 'não manda mais imagens'])
    assert.equal(allowImageGeneration(history, text), false, text)
})
test('a fresh explicit request after an image allows one new generation', () => {
  for (const text of ['manda outra imagem', 'quero uma foto de uma montanha', 'gere de novo', 'faz mais uma'])
    assert.equal(allowImageGeneration(history, text), true, text)
})
test('acceptance of a new offer is distinct from reacting to delivered media', () => {
  assert.equal(allowImageGeneration([...history, { role: 'character', text: 'Quer uma imagem de montanhas?' }], 'sim'), true)
  assert.equal(allowImageGeneration([], 'sim'), false)
})

test('ordinary conversation never authorizes media, even before the first image', () => {
  for (const text of ['oi', 'sim', 'gostei', 'quero conversar', 'quero falar sobre fotos', 'não quero fotos', 'pare de enviar vídeos'])
    assert.equal(allowImageGeneration([], text), false, text)
})

test('plan notice completes the photo request and does not turn agreement into a new request', () => {
  const photoHistory = [{ role: 'character', text: 'Fotos nos planos Premium e Luxo.', mediaRequest: 'photo' }]
  for (const text of ['sim', 'ok', 'entendi', 'me conta sobre você', 'gostei da foto'])
    assert.equal(allowImageGeneration(photoHistory, text), false, text)
  assert.equal(allowImageGeneration(photoHistory, 'me manda outra foto'), true)
  assert.equal(allowImageGeneration([], 'Me manda uma foto sua?'), true)
  assert.equal(allowImageGeneration([], 'Me manda um vídeo?'), true)
})

test('character requests default to plan media, while explicit subjects and accepted food offers are images', async () => {
  const { requestedMedia } = await import('../api/_lib/image-intent.js')
  for (const text of ['Me manda uma imagem', 'quero uma imagem de você 🔥🔥', 'me manda uma foto sua', 'quero uma foto 🔥']) assert.equal(requestedMedia([], text), 'photo', text)
  assert.equal(requestedMedia([], 'Me manda um vídeo'), 'video')
  assert.equal(requestedMedia([], 'Me manda um áudio falando oi'), 'audio')
  for (const text of ['quero uma imagem de um prato de comida', 'gere uma imagem de um avião', 'desenhe uma montanha']) assert.equal(requestedMedia([], text), 'image', text)
  const offered = [{ role: 'character', text: 'Podemos imaginar um prato de comida. Quer ver?' }]
  assert.equal(requestedMedia(offered, 'sim'), 'image')
  for (const text of ['não quero áudio', 'não manda foto', 'quero conversar sobre fotos', 'gostei 🔥🔥', 'sim']) assert.equal(requestedMedia([], text), null, text)
  assert.equal(requestedMedia(history, 'sim'), null)
})

test('time and pose modifiers describe character photos, never an unrelated generated subject', async () => {
  const { requestedMedia } = await import('../api/_lib/image-intent.js')
  for (const text of ['tudo bem me manda uma foto de agora', 'me envia uma foto de hoje', 'quero uma foto do momento', 'manda uma foto de frente', 'me manda uma foto de corpo inteiro', 'quero uma imagem de como você está', 'me manda uma foto sua na cozinha'])
    assert.equal(requestedMedia([], text), 'photo', text)
  for (const text of ['me manda uma foto de um prato de comida de agora', 'quero uma imagem de uma montanha hoje'])
    assert.equal(requestedMedia([], text), 'image', text)
})
