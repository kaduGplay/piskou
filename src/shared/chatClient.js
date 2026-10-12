import { sendAnalytics } from './analytics.js'
const initialLoads = new WeakMap()
// Durable server queue. Browser timers only wake the worker sooner; the database owns deadlines.
export function createChatClient({
  selection,
  onSnapshot,
  onError,
  fetcher = fetch,
  storage = globalThis.localStorage,
  now = Date.now,
  timers = globalThis,
  onResponse = () => {},
}) {
  let lastSnapshot = {},
    disposed = false,
    revision = -1,
    conversationId,
    canonical = [],
    outbox = [],
    displayOrder = [],
    timer,
    processing = false,
    serial = Promise.resolve()
  const controller = new AbortController()
  const sentTimes = new Map()
  let abandoned = false
  const abandon = () => {
    if (
      abandoned ||
      (!outbox.length &&
        !canonical.some((m) =>
          ['pending', 'generating'].includes(m.responseState),
        ))
    )
      return
    abandoned = true
    sendAnalytics('ChatRhythm_grouped_abandoned')
  }
  globalThis.addEventListener?.('pagehide', abandon)
  const selectionQuery = encodeURIComponent(JSON.stringify(selection))
  const key = () => 'piskou:outbox:' + conversationId
  const orderKey = () => 'piskou:message-order:' + conversationId
  const save = () => {
    try {
      storage.setItem(key(), JSON.stringify(outbox))
    } catch {
      /* Storage full: keep current tab state. */
    }
  }
  const publish = (snapshot) => {
    if (!disposed) {
      const messages = new Map([
        ...canonical.map((message) => [message.id, message]),
        ...outbox.map((message) => [message.id, {
          ...message,
          role: 'user',
          localState: message.failed ? 'failed' : 'sending',
        }]),
      ])
      // Confirmation updates a bubble in place. A slow upload or failed send
      // must never put an older bubble below newly received messages.
      displayOrder = displayOrder.filter((id) => messages.has(id))
      const seen = new Set(displayOrder)
      for (const id of messages.keys()) if (!seen.has(id)) displayOrder.push(id)
      try { storage.setItem(orderKey(), JSON.stringify(displayOrder)) } catch { /* Keep tab order if storage is full. */ }
      onSnapshot({
        ...lastSnapshot,
        ...snapshot,
        messages: displayOrder.map((id) => messages.get(id)),
      })
    }
  }
  const apply = (snapshot) => {
    if (
      disposed ||
      snapshot.conversationId !== conversationId ||
      (snapshot.revision ?? 0) < revision
    )
      return
    const initialized = revision >= 0
    revision = snapshot.revision ?? 0
    lastSnapshot = snapshot
    const oldIds = new Set(canonical.map((m) => m.id))
    const oldFailures = new Set(
      canonical.filter((m) => m.responseState === 'failed').map((m) => m.id),
    )
    canonical = snapshot.messages || []
    const ids = new Set([
      ...canonical.map((m) => m.id),
      ...(snapshot.deletedIds || []),
    ])
    outbox = outbox.filter((m) => !ids.has(m.id))
    save()
    publish(snapshot)
    if (
      canonical.some(
        (m) => m.responseState === 'failed' && !oldFailures.has(m.id),
      )
    )
      sendAnalytics('ChatErro')
    const answer = canonical.find(
      (m) => m.role === 'character' && !m.deleted && !oldIds.has(m.id),
    )
    if (initialized && answer) {
      const starts = canonical
        .filter((m) => m.role === 'user' && m.generation === answer.generation)
        .map((m) => sentTimes.get(m.id))
        .filter(Number.isFinite)
      if (starts.length)
        globalThis.requestAnimationFrame?.(() => {
          if (disposed) return
          const ms = Math.max(0, now() - Math.min(...starts))
          sendAnalytics('ChatRhythm_grouped_content', {
            rhythm_step:
              ms < 800
                ? 'under800'
                : ms < 1500
                  ? '800to1499'
                  : ms < 3000
                    ? '1500to2999'
                    : '3000plus',
          })
        })
    }
    if (
      initialized &&
      canonical.some(
        (m) => m.role === 'character' && !m.deleted && !oldIds.has(m.id),
      )
    )
      onResponse(snapshot)
    timers.clearTimeout(timer)
    if (snapshot.dueAt) {
      const delay = Math.max(
        0,
        new Date(snapshot.dueAt) - new Date(snapshot.serverTime || now()),
      )
      timer = timers.setTimeout(process, Math.min(delay, 1000))
    }
  }
  const request = async (action, data = {}) => {
    const response = await fetcher('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, selection, ...data }),
      signal: controller.signal,
    })
    const result = await response.json()
    if (!response.ok)
      throw Object.assign(
        new Error(result.error || 'Não foi possível enviar.'),
        { code: result.code, locked: result.locked },
      )
    return result
  }
  const sync = async (initial = false) => {
    if (disposed) return
    const load = async (signal) => {
      const response = await fetcher('/api/chat?selection=' + selectionQuery, {
        signal,
        cache: 'no-store',
      })
      const data = await response.json()
      if (!response.ok)
        throw new Error(data.error || 'Não foi possível atualizar a conversa.')
      return data
    }
    let snapshot
    if (initial) {
      let loads = initialLoads.get(fetcher)
      if (!loads) initialLoads.set(fetcher, (loads = new Map()))
      if (!loads.has(selectionQuery))
        loads.set(
          selectionQuery,
          load().finally(() => loads.delete(selectionQuery)),
        )
      snapshot = await loads.get(selectionQuery)
    } else snapshot = await load(controller.signal)
    if (disposed) return
    if (!conversationId) {
      conversationId = snapshot.conversationId
      try {
        const savedOrder = JSON.parse(storage.getItem(orderKey()) || '[]')
        displayOrder = Array.isArray(savedOrder) ? [...new Set(savedOrder.filter((id) => typeof id === 'string'))] : []
      } catch { displayOrder = [] }
      try {
        const saved = JSON.parse(storage.getItem(key()) || '[]')
        outbox = Array.isArray(saved)
          ? saved
              .filter(
                (m) => typeof m.text === 'string' && typeof m.id === 'string',
              )
              .slice(-12)
          : []
      } catch {
        outbox = []
      }
    }
    if (snapshot.conversationId !== conversationId) {
      controller.abort()
      throw new Error(
        'A conversa mudou em outra aba. Reabra a personagem para continuar.',
      )
    }
    apply(snapshot)
  }
  const process = async () => {
    if (disposed || processing) return
    processing = true
    try {
      apply(await request('process'))
    } catch (e) {
      if (!disposed && e.name !== 'AbortError')
        onError(
          'Não foi possível atualizar a resposta. A mensagem enviada continua salva.',
        )
    } finally {
      processing = false
    }
  }
  const transmissions = new Map()
  const transmit = (item) => {
    if (transmissions.has(item.id)) return transmissions.get(item.id)
    const operation = (async () => {
      if (disposed || !outbox.some((m) => m.id === item.id)) return
      try {
        // Preparing audio must not hold up persistence of subsequent text messages.
        if (item.recording) {
          const response = await fetcher('/api/chat-audio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              action: 'upload',
              selection,
              messageId: item.id,
              ...item.recording,
            }),
          })
          const audio = await response.json()
          if (!response.ok)
            throw new Error(audio.error || 'Falha no envio do áudio.')
          if (disposed || !outbox.some((m) => m.id === item.id)) return
          item.text = audio.text
          item.audio = { mime: item.recording.mime }
          delete item.recording
          save()
        }
        const enqueue = serial
          .catch(() => {})
          .then(async () => {
            if (disposed || !outbox.some((m) => m.id === item.id)) return
            apply(
              await request('enqueue', {
                messageId: item.id,
                message: item.text,
                replyTo: item.replyTo,
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              }),
            )
          })
        serial = enqueue
        await enqueue
      } catch (error) {
        if (disposed) return
        // Confirmation can be lost after persistence; reconcile before labeling a failure.
        try {
          await sync()
        } catch {
          /* Keep explicit unconfirmed state. */
        }
        const pending = outbox.find((m) => m.id === item.id)
        if (pending) {
          pending.failed = true
          save()
          publish({})
          onError(error.message, error)
        }
      }
    })().finally(() => transmissions.delete(item.id))
    transmissions.set(item.id, operation)
    return operation
  }
  let interval
  return {
    async start() {
      await sync(true)
      if (disposed) return
      for (const item of [...outbox]) transmit(item)
      interval = timers.setInterval(() => sync().catch(() => {}), 1000)
    },
    send(text, { replyTo, recording } = {}) {
      if (disposed || !conversationId) return null
      const item = {
        id: crypto.randomUUID(),
        text,
        replyTo,
        ...(recording ? { recording, audio: { mime: recording.mime } } : {}),
      }
      sentTimes.set(item.id, now())
      sendAnalytics('ChatRhythm_grouped_started')
      outbox.push(item)
      save()
      publish({})
      transmit(item)
      return item.id
    },
    retry(id) {
      const item = outbox.find((m) => m.id === id)
      if (item) {
        item.failed = false
        save()
        publish({})
        return transmit(item)
      }
      return request('retry', { messageId: id }).then(apply)
    },
    async remove(id) {
      // Serialize deletion after an in-flight enqueue: no deleted text can reappear after reconnect.
      await serial.catch(() => {})
      if (disposed) return
      apply(await request('delete', { messageId: id }))
    },
    sync,
    dispose() {
      abandon()
      globalThis.removeEventListener?.('pagehide', abandon)
      disposed = true
      controller.abort()
      timers.clearTimeout(timer)
      timers.clearInterval(interval)
    },
  }
}
