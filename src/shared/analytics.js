const uuid = () => globalThis.crypto?.randomUUID?.() || '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (Number(c) ^ (globalThis.crypto?.getRandomValues ? crypto.getRandomValues(new Uint8Array(1))[0] : Math.floor(Math.random()*256)) & 15 >> Number(c)/4).toString(16))
let fallback
export function analyticsIdentity() {
  try {
    let visitor = localStorage.getItem('piskou:visitor')
    if (!visitor) localStorage.setItem('piskou:visitor', (visitor = uuid()))
    let session = JSON.parse(
      sessionStorage.getItem('piskou:analytics') || 'null',
    )
    if (!session || Date.now() - session.last > 30 * 60_000)
      session = { id: uuid() }
    session.last = Date.now()
    sessionStorage.setItem('piskou:analytics', JSON.stringify(session))
    return { visitor, session: session.id }
  } catch {
    return (fallback ||= { visitor: uuid(), session: uuid() })
  }
}
let currentStep = ''
export function sendAnalytics(event, params = {}) {
  try { emitAnalytics(event, params) } catch { /* Metrics never interrupt the visitor journey. */ }
}
function emitAnalytics(event, params = {}) {
  if (['Pagamento aprovado', 'Gerou o PIX'].includes(event)) return
  if (
    location.pathname.startsWith('/admin') ||
    new URLSearchParams(location.search).has('dev')
  )
    return
  if (event === 'Etapa do criador') currentStep = params.step || ''
  const page = location.pathname.replace(/\/+$/, '') || '/'
  const query = new URLSearchParams(location.search)
  let referrer = ''
  try {
    referrer = new URL(document.referrer).hostname
  } catch {
    /* direct */
  }
  const body = JSON.stringify({
    ...analyticsIdentity(),
    page,
    event,
    step:
      event === 'ChatMensagemEnviada'
        ? String(params.message_number || '')
        : event === 'Etapa do criador' || event === 'heartbeat'
          ? currentStep
          : '',
    source: query.get('utm_source') || referrer || 'direto',
    device: /Mobi|Android|iPhone/i.test(navigator.userAgent)
      ? 'mobile'
      : 'desktop',
  })
  fetch('/api/analytics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {})
}
export function startAnalytics() {
  if (location.pathname.startsWith('/admin')) return
  sendAnalytics('page_view')
  const heartbeat = () => {
    if (document.visibilityState === 'visible') sendAnalytics('heartbeat')
  }
  setInterval(heartbeat, 30_000)
  document.addEventListener('visibilitychange', heartbeat)
}
