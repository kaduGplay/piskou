import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { DEFAULT_SELECTION } from '../src/funnel/data.js'
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await context.addInitScript((selection) => localStorage.setItem('piskou:selection', JSON.stringify(selection)), { ...DEFAULT_SELECTION, name: 'Lia' })
  let charges = [], chatRequests = 0
  await context.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/chat') chatRequests++
    if (path === '/api/checkout-config') return route.fulfill({ json: { available: true, methods: ['pix'] } })
    if (path === '/api/checkout' && route.request().method() === 'POST') {
      const body = route.request().postDataJSON(); charges.push(body)
      return route.fulfill({ json: { id: 'test-order', status: 'pending', method: 'pix', planId: body.planId, amount: 10, pix: { copyPaste: '000201SYNTHETIC-TEST', expiresAt: new Date(Date.now() + 1800000).toISOString() } } })
    }
    if (path === '/api/checkout-status') return route.fulfill({ json: { status: 'pending' } })
    return route.fulfill({ json: {} })
  })
  const page = await context.newPage()
  const errors = []; page.on('pageerror', (error) => errors.push(error.message))
  const origin = process.env.CHAT_TEST_ORIGIN || 'http://127.0.0.1:5174'
  await page.goto(origin + '/?dev=creating')
  const next = page.locator('.creator-next')
  await next.click()
  await page.getByRole('dialog').waitFor()
  assert.equal(new URL(page.url()).pathname, '/')
  assert.equal(chatRequests, 0)
  assert.ok(await page.getByText('R$ 10,00', { exact: true }).count())
  assert.ok(await page.getByText('R$ 19,90', { exact: true }).count())
  await page.locator('a[href*="plano=premium-access"]').first().click()
  await page.locator('input[name="email"]').waitFor()
  await page.waitForTimeout(500)
  assert.equal(charges.length, 0)
  assert.equal(await page.locator('input[name="name"]').inputValue(), '')
  assert.equal(await page.locator('input[name="email"]').inputValue(), '')
  assert.equal(await page.locator('input[name="cpf"],input[name="phone"],input[name="telephone"]').count(), 0)
  await page.locator('input[name="name"]').fill('Comprador Teste')
  await page.locator('input[name="email"]').fill('comprador@example.test')
  await page.locator('button[type="submit"]').click()
  await page.locator('#pix-code').waitFor()
  assert.equal(charges.length, 1)
  assert.deepEqual(charges[0].customer, { name: 'Comprador Teste', email: 'comprador@example.test' })
  assert.equal(new URL(page.url()).pathname, '/checkout')
  assert.equal(chatRequests, 0)
  assert.deepEqual(errors, [])
  console.log('PASS purchase-first funnel: Baby/Pro prices, plans before chat, name/email-only checkout, explicit PIX creation, pending payment stays at checkout')
} finally { await browser.close() }
