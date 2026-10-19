// One-click offers after payment, with every API mocked (no payment provider or database).
// PLAYWRIGHT_MODULE=<playwright index.mjs> CHAT_TEST_ORIGIN=http://127.0.0.1:5173 node scripts/test-upsell-browser.mjs
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { DEFAULT_SELECTION } from '../src/funnel/data.js'
import { PLANS, formatPrice } from '../src/shared/checkout.js'
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
const origin = process.env.CHAT_TEST_ORIGIN || 'http://127.0.0.1:5173'
const browser = await chromium.launch({ headless: true })

async function run(choices) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
  await context.addInitScript(({ selection, buyer }) => {
    localStorage.setItem('piskou:selection', JSON.stringify(selection))
    if (!sessionStorage.getItem('piskou:buyer')) sessionStorage.setItem('piskou:buyer', JSON.stringify(buyer))
  }, { selection: { ...DEFAULT_SELECTION, name: 'Lia' }, buyer: { name: 'Comprador Teste', email: 'comprador@example.test' } })
  const charges = [], contacts = [], polls = new Map()
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/checkout' && route.request().method() === 'POST') {
      const body = route.request().postDataJSON()
      if (body.action === 'whatsapp') {
        contacts.push(body.phone)
        return route.fulfill({ json: { ok: true } })
      }
      charges.push(body)
      return route.fulfill({ json: { id: `tx-${body.planId}`, status: 'pending', method: body.method, planId: body.planId, amount: PLANS[body.planId].price, deposit: { method: 'spei', code: '684180417019567955', barcodeUrl: null, expiresAt: null } } })
    }
    if (url.pathname === '/api/checkout-status') {
      const id = url.searchParams.get('id')
      polls.set(id, (polls.get(id) || 0) + 1)
      return route.fulfill({ json: { id, status: polls.get(id) >= 2 ? 'paid' : 'pending' } })
    }
    return route.fulfill({ json: {} })
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(origin + '/oferta')
  await page.getByText('¡Pago aprobado! Tu acceso ya está asegurado.').waitFor()
  for (const [index, [planId, choice]] of Object.entries(choices).entries()) {
    await page.locator(`ol[aria-label="Oferta ${index + 1} de 3"]`).waitFor()
    await page.locator('#upsell-title').waitFor()
    const accept = page.locator('.upsell-accept')
    assert.ok((await accept.innerText()).includes(formatPrice(PLANS[planId].price)), `${planId} price on button`)
    if (choice === 'decline') {
      await page.getByRole('button', { name: 'No, gracias' }).click()
      continue
    }
    await accept.click()
    await page.locator('#upsell-clabe').waitFor()
    assert.equal(await page.locator('#upsell-clabe').inputValue(), '684180417019567955')
    assert.ok((await page.locator('.upsell-pix-amount').innerText()).includes(formatPrice(PLANS[planId].price)))
    await page.locator('.upsell-done').waitFor({ timeout: 15000 })
    if (planId === 'upsell-whatsapp') {
      await page.locator('#upsell-phone').fill('+52 1 55 1234 5678')
      await page.getByRole('button', { name: 'CONFIRMAR MI WHATSAPP' }).click()
    } else {
      await page.getByRole('button', { name: 'CONTINUAR' }).click()
    }
  }
  await page.waitForURL('**/chat', { timeout: 10000 })
  assert.deepEqual(errors, [])
  await context.close()
  return { charges, contacts }
}

try {
  const first = await run({ 'upsell-video-pack': 'accept', 'upsell-whatsapp': 'decline', 'upsell-vip': 'accept' })
  assert.deepEqual(first.charges.map((c) => c.planId), ['upsell-video-pack', 'upsell-vip'])
  for (const charge of first.charges) {
    assert.deepEqual(charge.customer, { name: 'Comprador Teste', email: 'comprador@example.test' })
    assert.equal(charge.method, 'spei')
    assert.equal(charge.addons, undefined)
  }
  const second = await run({ 'upsell-video-pack': 'decline', 'upsell-whatsapp': 'accept', 'upsell-vip': 'decline' })
  assert.deepEqual(second.charges.map((c) => c.planId), ['upsell-whatsapp'])
  assert.deepEqual(second.contacts, ['5512345678'])
  console.log('PASS one-click offers: accept generates a SPEI CLABE with saved buyer, decline shows the next offer, WhatsApp asks for the number, then chat')
} finally {
  await browser.close()
}
