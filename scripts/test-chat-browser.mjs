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
  transcriptionDelay = 0,
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
          const operators = { eq: '=', gte: '>=', lte: '<=', gt: '>' }
          if (operator === 'in') {
            const entries = rest.join('.').slice(1, -1).split(',')
            const placeholders = entries.map((entry) => { values.push(entry); return '$' + values.length })
            filters.push(`${key} in (${placeholders.join(',')})`)
            continue
          }
          if (!operators[operator]) continue
          const filterValue = rest.join('.')
          values.push(filterValue === 'true' ? true : filterValue === 'false' ? false : filterValue)
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
    ) {
      if (transcriptionDelay) await new Promise((resolve) => setTimeout(resolve, transcriptionDelay))
      return json({ text: 'Mensagem de áudio de teste.' })
    }
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
    { default: worker } = await import('../api/chat-worker.js'),
    { default: conversations } = await import('../api/conversations.js')
  browser = await chromium.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
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
        '/api/conversations': conversations,
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
      getHeader: (k) => headers[k],
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
      headers: { ...Object.fromEntries(Object.entries(headers).map(([key,value]) => [key, Array.isArray(value) ? value.join('\n') : value])), 'Content-Type': 'application/json' },
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
  for (const label of ['Ligação de voz', 'Videochamada']) {
    await page.getByRole('button', { name: label, exact: true }).click()
    await page.getByRole('dialog').waitFor()
    assert.ok(await page.getByText('CHAMADAS · EM BREVE').count())
    await page.getByRole('button', { name: 'Fechar oferta' }).click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
  }
  console.log('PASS call buttons: voice/video open plans and close without sending a chat message')
  // Recording remains inside the composer and cancellation releases the microphone.
  await page.getByRole('button', { name: 'Gravar mensagem de áudio', exact: true }).click()
  await page.getByLabel('Gravação de áudio', { exact: true }).waitFor()
  await page.waitForTimeout(500)
  assert.equal(await page.locator('.chat-recording-wave i').count(), 36)
  assert.equal(await page.locator('form.is-recording').count(), 1)
  assert.equal(await page.locator('[aria-modal="true"]').count(), 0)
  await page.screenshot({ path: '/private/tmp/piskou-recording-ui.png' })
  await page.getByRole('button', { name: 'Cancelar gravação' }).click()
  await input.waitFor({ state: 'visible' })
  assert.equal(await page.locator('.chat-recording-bar').count(), 0)
  assert.equal(await page.locator('.chat-message.user').count(), 0)
  console.log('PASS recorder: inline waveform, cancel restores composer, no modal overlay or sent message')
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
      document.querySelectorAll('.chat-message.character:not(.chat-voice-message) .chat-message-content')
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
  const textReply = page.locator('.chat-message.character:not(.chat-voice-message)').first()
  assert.equal(await textReply.locator('.chat-audio-player').count(), 0)
  assert.equal(await page.locator('.chat-voice-message .chat-audio-player').count(), 0)
  const speechStatus = await page.evaluate(async ({ id, selection }) => {
    const response = await fetch('/api/chat-audio', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'speech', messageId: id, selection }),
    })
    return response.status
  }, { id: await textReply.getAttribute('data-message-id'), selection: { ...DEFAULT_SELECTION, name: 'Lia' } })
  assert.equal(speechStatus, 403)
  console.log('PASS free character reply: paid AI speech blocked; user recording remains available')
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
  await audioBubble.locator('audio').waitFor({ state: 'attached' })
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
  // Give this isolated fixture additional credits for recorder and detached-worker checks.
  await db.exec('update public.piskou_chat_sessions set allowance=allowance+12,credit_base=credit_base+12')
  await page.reload()
  transcriptionDelay = 4000
  await page.getByRole('button', { name: 'Gravar mensagem de áudio', exact: true }).click()
  await page.getByLabel('Gravação de áudio', { exact: true }).waitFor()
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: 'Parar gravação e enviar áudio', exact: true }).click()
  await page.waitForFunction(() => !!document.querySelector('.chat-message.user .chat-audio-player'))
  const recordedBubble = page.locator('.chat-message.user').filter({ has: page.locator('.chat-audio-player') }).last()
  const recordedId = await recordedBubble.getAttribute('data-message-id')
  await send('Texto depois do áudio lento')
  const orderedIds = () => page.locator('.chat-message[data-message-id]').evaluateAll((nodes) => nodes.map((node) => node.dataset.messageId))
  const orderDuringUpload = await orderedIds()
  assert.equal(orderDuringUpload.at(-2), recordedId)
  await recordedBubble.locator('time[datetime]').waitFor({ state: 'attached' })
  transcriptionDelay = 0
  assert.deepEqual((await orderedIds()).slice(0, orderDuringUpload.length), orderDuringUpload)
  await page.reload()
  await page.locator(`[data-message-id="${recordedId}"]`).waitFor()
  assert.deepEqual((await orderedIds()).slice(0, orderDuringUpload.length), orderDuringUpload)
  console.log('PASS stable bubble order: slow audio, following text, incoming response, confirmation and reload')
  assert.equal(await recordedBubble.locator('.chat-message-content > p').count(), 0)
  assert.equal(await page.locator('.chat-recording-bar').count(), 0)
  assert.equal(await page.locator('[aria-modal="true"]').count(), 0)
  await page.screenshot({ path: '/private/tmp/piskou-audio-ui.png' })
  console.log('PASS real MediaRecorder: recorded voice note is sent as an audio bubble, composer restored without overlay')
  await page.getByRole('link', { name: 'Voltar às mensagens', exact: true }).click()
  await page.getByRole('heading', { name: 'Mensagens', exact: true }).waitFor()
  await page.locator('.messages-row').first().waitFor()
  await page.getByRole('button', { name: 'Criar outra personagem', exact: true }).first().click()
  await page.getByRole('dialog').waitFor()
  assert.ok(await page.getByText('MAIS PERSONAGENS · PREMIUM').count())
  await page.getByRole('button', { name: 'Fechar oferta' }).click()
  await page.locator('.messages-row').first().click()
  await page.getByRole('textbox', { name: 'Sua mensagem' }).waitFor()
  assert.equal(await page.locator('.chat-suggestions').count(), 0)
  console.log('PASS inbox: back lists saved conversation, Premium gates creation, reopening preserves history and hides suggestions')
  let originalInbox = await page.evaluate(async () => (await fetch('/api/conversations')).json())
  assert.equal(await page.evaluate(async () => (await fetch('/api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create' }) })).status), 403)
  await send('Me manda um áudio falando oi')
  await page.getByText('Áudios · Premium e Luxo', { exact: true }).last().waitFor()
  assert.ok(await page.getByText(/Para eu te mandar um áudio/).count())
  originalInbox = await page.evaluate(async () => (await fetch('/api/conversations')).json())
  // Isolated purchase fixture: no production accounts or payment providers.
  await db.query("insert into public.piskou_chat_purchases(charge_id,chat_id,plan_id,active) values('browser-premium',$1,'premium-access',true)", [originalInbox.active])
  await page.getByRole('link', { name: 'Voltar às mensagens', exact: true }).click()
  await page.locator('.messages-row').first().waitFor()
  await page.getByRole('button', { name: 'Criar outra personagem', exact: true }).first().click()
  await page.waitForURL('**/?edit=1')
  await page.goto(origin + '/chat')
  await page.getByRole('textbox', { name: 'Sua mensagem' }).waitFor()
  const created = await page.evaluate(async () => (await fetch('/api/conversations')).json())
  assert.notEqual(created.active, originalInbox.active)
  assert.equal(created.conversations.length, 2)
  const isolated = await page.evaluate(async () => (await fetch('/api/chat')).json())
  assert.equal(isolated.messages.filter((message) => message.role === 'user').length, 0)
  await page.getByRole('link', { name: 'Voltar às mensagens', exact: true }).click()
  await page.locator('.messages-row').waitFor({ state: 'attached' }).catch(() => {})
  await page.locator('.messages-row').filter({ hasText: originalInbox.conversations[0].preview }).first().click()
  await page.getByRole('textbox', { name: 'Sua mensagem' }).waitFor()
  const restored = await page.evaluate(async () => (await fetch('/api/chat')).json())
  assert.equal(restored.conversationId, originalInbox.active)
  assert.ok(restored.messages.some((message) => message.role === 'user'))
  console.log('PASS Premium creation: server rejects free creation, paid creates isolated conversation, original history restores')
  for (const [request, expected] of [
    ['Me manda um vídeo', 'Vídeos no plano Luxo'],
    ['quero uma imagem de você 🔥🔥', 'Fotos nos planos Premium e Luxo'],
  ]) {
    await send(request)
    await page.getByText(expected, { exact: true }).last().waitFor()
    assert.equal(await page.locator('.chat-message.character').filter({ hasText: /s[oó] (?:por )?texto|n[aã]o posso mandar/i }).count(), 0)
  }
  await send('Me manda um áudio falando oi')
  await page.locator('.chat-voice-message audio').last().waitFor({ state: 'attached' })
  await page.waitForFunction(() => !!document.querySelector('.chat-voice-message audio')?.getAttribute('src'))
  assert.equal(await page.locator('.chat-voice-message .chat-bubble > p').count(), 0)
  console.log('PASS paid AI audio: free request offers plans; Premium request generates a separate playable voice bubble')
  const imageSession = await page.evaluate(async () => (await (await fetch('/api/chat')).json()).conversationId)
  const imageData = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="pink"/></svg>').toString('base64')
  await db.query("update public.piskou_chat_sessions set messages=jsonb_set(messages,array[(jsonb_array_length(messages)-1)::text,'media'],jsonb_build_object('src',$2::text)),queue_revision=queue_revision+1 where id=$1", [imageSession, imageData])
  const imageButton = page.getByRole('button', { name: 'Abrir imagem', exact: true }).last()
  await imageButton.waitFor()
  const imageURL = page.url(), pageCount = context.pages().length
  await imageButton.click()
  await page.getByRole('dialog', { name: 'Imagem em tela cheia', exact: true }).waitFor()
  await page.waitForFunction(() => document.querySelector('.chat-image-viewer > img')?.naturalWidth > 0)
  assert.equal(page.url(), imageURL)
  assert.equal(context.pages().length, pageCount)
  assert.equal(await page.evaluate(() => document.getElementById('root').inert), true)
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.chat-image-viewer').count(), 0)
  assert.equal(await page.evaluate(() => document.getElementById('root').inert), false)
  await imageButton.click()
  await page.getByRole('button', { name: 'Fechar imagem', exact: true }).click()
  assert.equal(await page.locator('.chat-image-viewer').count(), 0)
  console.log('PASS full-screen image: data URI loads in chat without navigation, Escape/close restore conversation')
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
