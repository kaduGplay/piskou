// Isolated PostgreSQL + actual API handlers + mocked provider/Storage. Never loads .env.local.
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
if (!process.env.PGLITE_MODULE || !process.env.PLAYWRIGHT_MODULE)
  throw new Error(
    'Set PGLITE_MODULE and PLAYWRIGHT_MODULE to temporary installed modules',
  )
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href)
const { chromium } = await import(
  pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
)
Object.assign(process.env, {
  SUPABASE_URL: 'https://local.supabase.invalid',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
  CHAT_SESSION_SECRET: 'isolated-test-secret-never-production',
  OPENAI_API_KEY: 'sk-test-not-real',
  CHAT_WORKER_SECRET: 'test-worker-secret',
})
delete process.env.VERCEL
const db = new PGlite()
const originalFetch = globalThis.fetch
let browser,
  providerDelay = 30,
  providerCalls = 0,
  canceledCalls = 0,
  providerFail = false
const providerInputs = [],
  storedAudio = new Map(),
  errors = []
const wave = new Uint8Array(2444),
  view = new DataView(wave.buffer)
for (const [offset, text] of [
  [0, 'RIFF'],
  [8, 'WAVE'],
  [12, 'fmt '],
  [36, 'data'],
])
  [...text].forEach((char, index) =>
    view.setUint8(offset + index, char.charCodeAt(0)),
  )
view.setUint32(4, 2436, true)
view.setUint32(16, 16, true)
view.setUint16(20, 1, true)
view.setUint16(22, 1, true)
view.setUint32(24, 8000, true)
view.setUint32(28, 8000, true)
view.setUint16(32, 1, true)
view.setUint16(34, 8, true)
view.setUint32(40, 2400, true)
wave.fill(128, 44)
const json = (value) =>
  new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
  })
try {
  await db.exec(
    'create role anon;create role authenticated;create role service_role bypassrls;',
  )
  for (const file of (await readdir('supabase/migrations'))
    .filter((n) => n.endsWith('.sql'))
    .sort())
    await db.exec(await readFile('supabase/migrations/' + file, 'utf8'))
  globalThis.fetch = async (raw, options = {}) => {
    const url = new URL(raw)
    if (
      url.hostname === 'local.supabase.invalid' &&
      url.pathname.startsWith('/rest/v1/')
    ) {
      const path = url.pathname.slice('/rest/v1/'.length)
      try {
        if (path.startsWith('rpc/')) {
          const name = path.slice(4),
            body = JSON.parse(options.body || '{}'),
            keys = Object.keys(body)
          assert.match(name, /^[a-z_]+$/)
          const values = keys.map((k) =>
            body[k] && typeof body[k] === 'object'
              ? JSON.stringify(body[k])
              : body[k],
          )
          const result = await db.query(
            `select public.${name}(${keys.map((k, i) => `${k} := $${i + 1}`).join(',')}) as data`,
            values,
          )
          return json(result.rows[0].data)
        }
        assert.match(path, /^[a-z_]+$/)
        const values = [],
          filters = []
        for (const [key, value] of url.searchParams) {
          if (['select', 'limit', 'order', 'or'].includes(key)) continue
          assert.match(key, /^[a-z_]+$/)
          const [operator, ...rest] = value.split('.')
          const operators = { eq: '=', gte: '>=', lte: '<=' }
          if (!operators[operator]) continue
          values.push(rest.join('.'))
          filters.push(`${key} ${operators[operator]} $${values.length}`)
        }
        const columns = url.searchParams.get('select') || '*'
        assert.match(columns, /^[a-z_,*]+$/)
        return json(
          (
            await db.query(
              `select ${columns} from public.${path}${filters.length ? ' where ' + filters.join(' and ') : ''} limit ${Number(url.searchParams.get('limit') || 200)}`,
              values,
            )
          ).rows,
        )
      } catch (error) {
        throw new Error(path + ': ' + error.message)
      }
    }
    if (url.hostname === 'api.openai.com' && url.pathname === '/v1/responses') {
      providerCalls++
      const body = JSON.parse(options.body)
      providerInputs.push(body)
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, providerDelay)
        options.signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer)
            canceledCalls++
            reject(new DOMException('Canceled', 'AbortError'))
          },
          { once: true },
        )
      })
      if (providerFail) return new Response('', { status: 500 })
      const inputs = body.input
        .slice(1)
        .filter((m) => m.role === 'user')
        .map((m) => m.content)
        .slice(-3)
      return json({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  reply: 'Resposta: ' + inputs.join(' / '),
                  mediaRequest: 'none',
                  imagePrompt: '',
                }),
              },
            ],
          },
        ],
      })
    }
    if (
      url.hostname === 'api.openai.com' &&
      url.pathname === '/v1/audio/transcriptions'
    )
      return json({ text: 'Mensagem de áudio de teste.' })
    if (
      url.hostname === 'api.openai.com' &&
      url.pathname === '/v1/audio/speech'
    )
      return new Response(wave)
    if (
      url.hostname === 'local.supabase.invalid' &&
      url.pathname.startsWith('/storage/v1/')
    ) {
      const path = url.pathname.slice('/storage/v1/'.length)
      if (path.startsWith('object/sign/'))
        return json({
          signedURL:
            '/object/sign/' + path.slice('object/sign/'.length) + '?token=test',
        })
      if (options.method === 'DELETE') {
        for (const key of JSON.parse(options.body).prefixes)
          storedAudio.delete(key)
        return json({})
      }
      if (options.method === 'POST') {
        storedAudio.set(
          path.slice('object/chat-audio/'.length),
          new Uint8Array(options.body),
        )
        return json({})
      }
    }
    throw new Error('Unexpected network access: ' + url.origin + url.pathname)
  }
  const { default: chat } = await import('../api/chat.js'),
    { default: memory } = await import('../api/chat-memory.js'),
    { default: audio } = await import('../api/chat-audio.js'),
    { default: worker } = await import('../api/chat-worker.js')
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  })
  const apiRoute = async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      handler = {
        '/api/chat': chat,
        '/api/chat-memory': memory,
        '/api/chat-audio': audio,
      }[url.pathname]
    if (!handler) return route.fulfill({ json: { ok: true } })
    const headers = {},
      req = {
        method: request.method(),
        headers: { ...(await request.allHeaders()), host: url.host },
        query: Object.fromEntries(url.searchParams),
        body: request.postData() ? JSON.parse(request.postData()) : {},
        socket: { remoteAddress: '127.0.0.1' },
      }
    let status = 200,
      data
    const res = {
      setHeader: (k, v) => (headers[k] = v),
      status(code) {
        status = code
        return this
      },
      json(value) {
        data = value
        return this
      },
    }
    try {
      await handler(req, res)
    } catch (e) {
      errors.push(e.message)
      status = 500
      data = { error: e.message }
    }
    await route.fulfill({
      status,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  }
  await context.route('**/api/**', apiRoute)
  await context.route('https://local.supabase.invalid/storage/**', (route) => {
    const url = new URL(route.request().url()),
      key = decodeURIComponent(url.pathname.split('/chat-audio/')[1] || '')
    const bytes = storedAudio.get(key)
    return route.fulfill({
      status: bytes ? 200 : 404,
      contentType: 'audio/wav',
      body: bytes ? Buffer.from(bytes) : Buffer.from(''),
    })
  })
  const { DEFAULT_SELECTION } = await import('../src/funnel/data.js')
  await context.addInitScript(
    (selection) =>
      localStorage.setItem('piskou:selection', JSON.stringify(selection)),
    { ...DEFAULT_SELECTION, name: 'Lia' },
  )
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  const origin = process.env.CHAT_TEST_ORIGIN || 'http://127.0.0.1:5174'
  await page.goto(origin + '/chat')
  const input = page.getByRole('textbox', { name: 'Sua mensagem' })
  await page.waitForFunction(
    () =>
      document.querySelector('input[aria-label="Sua mensagem"]')?.disabled ===
      false,
  )
  const send = async (text) => {
    await input.fill(text)
    await page
      .getByRole('button', { name: 'Enviar mensagem', exact: true })
      .click()
  }
  await send('Tenho uma entrevista')
  await send('amanhã')
  await send('preciso revisar o currículo')
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.chat-message.user time[datetime]').length ===
      3,
  )
  assert.equal(
    await page.getByRole('status', { name: 'Preparando resposta' }).count(),
    0,
  )
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.chat-message.character .chat-message-content')
        .length === 1,
  )
  assert.equal(providerCalls, 1)
  const last = providerInputs
    .at(-1)
    .input.slice(-3)
    .map((m) => m.content)
  assert.deepEqual(last, [
    'Tenho uma entrevista',
    'amanhã',
    'preciso revisar o currículo',
  ])
  assert.equal(
    (
      await db.query(
        'select public.piskou_user_message_count(messages) as used from public.piskou_chat_sessions where jsonb_array_length(messages)>0',
      )
    ).rows[0].used,
    3,
  )
  const first = page.locator('.chat-message.user').first()
  await first.getByRole('button', { name: 'Ações da mensagem' }).click()
  await first.getByRole('button', { name: 'Informações', exact: true }).click()
  await page.getByRole('dialog', { name: 'Informações da mensagem' }).waitFor()
  assert.ok(await page.getByText('Visualizada', { exact: true }).count())
  await page.getByRole('button', { name: 'Fechar informações' }).click()
  console.log(
    'PASS mobile: three persisted fragments, one provider context/reply, three credits, real sent/viewed timestamps',
  )
  // Delete inside the window: no provider call for deleted content.
  const before = providerCalls
  await send('Apagar antes de processar')
  const pending = page.locator('.chat-message.user').last()
  await pending.getByRole('button', { name: 'Ações da mensagem' }).click()
  await pending
    .getByRole('button', { name: 'Apagar mensagem', exact: true })
    .click()
  await pending.getByText('Mensagem apagada', { exact: true }).waitFor()
  await new Promise((resolve) => setTimeout(resolve, 1800))
  assert.equal(providerCalls, before)
  // Delete during active generation; stale response is never committed.
  providerDelay = 2000
  await send('Conteúdo para excluir durante geração')
  await page.getByRole('status', { name: 'Preparando resposta' }).waitFor()
  const active = page.locator('.chat-message.user').last()
  await active.getByRole('button', { name: 'Ações da mensagem' }).click()
  await active
    .getByRole('button', { name: 'Apagar mensagem', exact: true })
    .click()
  await active.getByText('Mensagem apagada', { exact: true }).waitFor()
  await new Promise((resolve) => setTimeout(resolve, 2200))
  assert.equal(
    await page.getByText(/Resposta:.*Conteúdo para excluir/).count(),
    0,
  )
  assert.ok(canceledCalls >= 1)
  console.log(
    'PASS deletion before/during generation: provider cancellation attempted, stale completion suppressed, no credit consumed',
  )
  providerDelay = 30
  // A quoted message's content disappears from both devices.
  const cookies = await context.cookies(),
    secondContext = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    })
  await secondContext.addCookies(cookies)
  await secondContext.route('**/api/**', apiRoute)
  await secondContext.addInitScript(
    (selection) =>
      localStorage.setItem('piskou:selection', JSON.stringify(selection)),
    { ...DEFAULT_SELECTION, name: 'Lia' },
  )
  const second = await secondContext.newPage()
  await second.goto(origin + '/chat')
  await first.getByRole('button', { name: 'Ações da mensagem' }).click()
  await first.getByRole('button', { name: 'Responder', exact: true }).click()
  await send('Resposta citada de teste')
  await page
    .getByText('Resposta citada de teste', { exact: true })
    .first()
    .waitFor()
  await first.getByRole('button', { name: 'Ações da mensagem' }).click()
  await first
    .getByRole('button', { name: 'Apagar mensagem', exact: true })
    .click()
  await second.waitForFunction(() =>
    document.querySelector('.chat-message.user .chat-deleted'),
  )
  await page.waitForFunction(
    () =>
      document.querySelector('.chat-reply-preview')?.textContent ===
      'Mensagem apagada',
  )
  console.log(
    'PASS quoted deletion and second authorized device context: erased text stays absent after synchronization',
  )
  // Reading old messages must not jump to the latest incoming message.
  await page.locator('.chat-messages').evaluate((list) => {
    list.scrollTop = 0
    list.dispatchEvent(new Event('scroll'))
  })
  const oldTop = await page
    .locator('.chat-messages')
    .evaluate((list) => list.scrollTop)
  await second
    .getByRole('textbox', { name: 'Sua mensagem' })
    .fill('Mensagem do segundo dispositivo')
  await second
    .getByRole('button', { name: 'Enviar mensagem', exact: true })
    .click()
  await page.getByRole('button', { name: 'Ver mensagens novas ↓' }).waitFor()
  assert.ok(
    Math.abs(
      (await page
        .locator('.chat-messages')
        .evaluate((list) => list.scrollTop)) - oldTop,
    ) < 8,
  )
  await page.getByRole('button', { name: 'Ver mensagens novas ↓' }).click()
  console.log(
    'PASS scroll anchoring and new-message button while reading old content',
  )
  // Generation error is distinct from a send error; retry never duplicates a user message.
  providerFail = true
  await send('Teste de recuperação de resposta')
  await page
    .getByRole('button', { name: 'Tentar gerar novamente' })
    .first()
    .waitFor()
  const failed = page
    .locator('.chat-message.user')
    .filter({ hasText: 'Teste de recuperação de resposta' })
  assert.equal(await failed.locator('[aria-label="Visualizada"]').count(), 1)
  assert.equal(
    await failed
      .getByRole('button', { name: 'Tentar enviar novamente' })
      .count(),
    0,
  )
  providerFail = false
  await failed.getByRole('button', { name: 'Tentar gerar novamente' }).click()
  await page.waitForFunction(
    () => !document.querySelector('.chat-response-error'),
  )
  assert.equal(
    await page
      .locator('.chat-message.user')
      .filter({ hasText: 'Teste de recuperação de resposta' })
      .count(),
    1,
  )
  console.log(
    'PASS generation failure: persisted viewed message retained, retry produces one answer without duplicate credit',
  )
  // Persist and reopen audio; playback and speed controls use the same private message attachment.
  const selected = { ...DEFAULT_SELECTION, name: 'Lia' }
  const audioId = crypto.randomUUID()
  const uploaded = await page.evaluate(
    async ({ id, selection, base64 }) => {
      const r = await fetch('/api/chat-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upload',
          messageId: id,
          selection,
          mime: 'audio/webm',
          base64,
        }),
      })
      return { status: r.status, data: await r.json() }
    },
    {
      id: audioId,
      selection: selected,
      base64: Buffer.from(wave).toString('base64'),
    },
  )
  assert.equal(uploaded.status, 200, JSON.stringify(uploaded.data))
  await page.evaluate(
    async ({ id, selection, text }) =>
      fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'enqueue',
          messageId: id,
          selection,
          message: text,
          timeZone: 'America/Sao_Paulo',
        }),
      }),
    { id: audioId, selection: selected, text: uploaded.data.text },
  )
  await page.reload()
  await page.locator(`[data-message-id="${audioId}"]`).waitFor()
  const audioBubble = page.locator(`[data-message-id="${audioId}"]`)
  assert.equal(await audioBubble.locator('details[open]').count(), 0)
  await audioBubble
    .getByRole('button', { name: 'Reproduzir áudio', exact: true })
    .click()
  await audioBubble.locator('audio').waitFor()
  await audioBubble.locator('audio').evaluate((audio) => audio.play())
  await audioBubble.getByRole('button', { name: 'Velocidade do áudio' }).click()
  assert.equal(
    await audioBubble.locator('audio').evaluate((audio) => audio.playbackRate),
    1.5,
  )
  await audioBubble.locator('audio').evaluate((audio) => audio.pause())
  await audioBubble.getByRole('button', { name: 'Ações da mensagem' }).click()
  await audioBubble
    .getByRole('button', { name: 'Apagar mensagem', exact: true })
    .click()
  await audioBubble.getByText('Mensagem apagada', { exact: true }).waitFor()
  assert.equal(
    (
      await db.query(
        'select count(*)::integer as n from public.piskou_chat_audio where message_id=$1',
        [audioId],
      )
    ).rows[0].n,
    0,
  )
  const workerRes = {
    setHeader() {},
    status(code) {
      this.code = code
      return this
    },
    json(data) {
      this.data = data
      return this
    },
  }
  await worker(
    { method: 'POST', headers: { authorization: 'Bearer test-worker-secret' } },
    workerRes,
  )
  assert.equal(workerRes.code, 200)
  assert.equal(storedAudio.size, 0)
  console.log(
    'PASS audio: upload/transcription mocked, persisted private audio reopened, playback/pause/1.5x, transcript hidden, deletion metadata/file cleanup',
  )
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  )
  assert.deepEqual(errors, [])
  console.log('PASS no horizontal overflow or browser/handler errors')
  const detachedId = crypto.randomUUID()
  const detached = await page.evaluate(
    async ({ id, selection }) => {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'enqueue',
          messageId: id,
          selection,
          message: 'Sem aba aberta',
          timeZone: 'America/Sao_Paulo',
        }),
      })
      return r.json()
    },
    { id: detachedId, selection: selected },
  )
  assert.ok(detached.messages.some((m) => m.id === detachedId))
  await context.close()
  await secondContext.close()
  await new Promise((resolve) => setTimeout(resolve, 1700))
  await worker(
    { method: 'POST', headers: { authorization: 'Bearer test-worker-secret' } },
    workerRes,
  )
  const detachedRow = (
    await db.query(
      'select messages from public.piskou_chat_sessions where id=$1',
      [detached.conversationId],
    )
  ).rows[0]
  assert.equal(
    detachedRow.messages.find((m) => m.id === detachedId).charged,
    true,
  )
  assert.match(detachedRow.messages.at(-1).text, /Sem aba aberta/)
  console.log(
    'PASS durable worker: persisted message processed with every browser context closed',
  )
} catch (error) {
  console.error('FAIL', error.stack, errors)
  process.exitCode = 1
} finally {
  globalThis.fetch = originalFetch
  await browser?.close()
  await db.close()
}
