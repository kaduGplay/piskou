const normalize = (text) =>
  String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
const TOPICS = {
  interview: /\bentrevista\b/,
  project: /\bprojeto\b/,
  recipe: /\b(?:receita|bolo|jantar)\b/,
  film: /\bfilme\b/,
}
export function applicationClock(
  now = new Date().toISOString(),
  timeZone = 'America/Sao_Paulo',
) {
  const timestamp = new Date(now).toISOString()
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format(new Date(timestamp))
  } catch {
    timeZone = 'America/Sao_Paulo'
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(new Date(timestamp))
      .map((p) => [p.type, p.value]),
  )
  return {
    timestamp,
    timeZone,
    localDate: `${parts.year}-${parts.month}-${parts.day}`,
  }
}
function eventDate(text, clock) {
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
  const br = text.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/)
  const value = iso
    ? `${iso[1]}-${iso[2]}-${iso[3]}`
    : br
      ? `${br[3]}-${br[2]}-${br[1]}`
      : null
  if (value) {
    const parsed = new Date(value + 'T12:00:00Z')
    return Number.isFinite(+parsed) &&
      parsed.toISOString().slice(0, 10) === value
      ? value
      : null
  }
  const n = normalize(text)
  if (clock.relativeDatesKnown !== false && /\b(?:hoje|amanha)\b/.test(n)) {
    const date = new Date(clock.localDate + 'T12:00:00Z')
    if (/\bamanha\b/.test(n)) date.setUTCDate(date.getUTCDate() + 1)
    return date.toISOString().slice(0, 10)
  }
  return null
}
export function advanceTopics(facts, text, source, clock, allowed) {
  if (!allowed) return facts
  const n = normalize(text)
  const mentioned = Object.entries(TOPICS)
    .filter(([, pattern]) => pattern.test(n))
    .map(([key]) => key)
  const declined =
    /nao retome|nao pergunte mais|nao volte a perguntar|nao (?:quero|gostaria de|precisa|volte a|vamos) (?:mais )?(?:falar|comentar|retomar|tocar|perguntar)|prefiro nao (?:falar|comentar)|deixa (?:isso|esse assunto) pra la/.test(
      n,
    )
  const allowedAgain =
    /(?:pode|quero|vamos) (?:voltar a )?(?:falar|comentar|retomar)|pode perguntar/.test(
      n,
    )
  const postponed = /adiad[ao]|remarcad[ao]|adiaram|remarcaram/.test(n)
  const resolved =
    /(?:ja )?(?:terminei|conclui|finalizei|resolvi|acabei de (?:ver|assistir|fazer))|\b(?:foi (?:muito )?(?:bem|mal|bom|boa|otim[oa]|ruim|legal|tranquil[oa])|cancelad[ao]|desisti|deu certo|nao deu certo|gostei|nao gostei)\b/.test(
      n,
    )
  const contextual = facts
    .filter((f) => f.kind === 'open_topic' && f.status === 'open')
    .sort((a, b) =>
      (b.lastAskedAt || b.updatedAt).localeCompare(
        a.lastAskedAt || a.updatedAt,
      ),
    )[0]
  const dateOnly =
    /^(?:amanha|hoje|(?:em )?\d{4}-\d{2}-\d{2}|(?:em )?\d{2}\/\d{2}\/\d{4})[.!\s]*$/.test(
      n,
    )
  const targets = mentioned.length
    ? mentioned
    : (declined || resolved || postponed || allowedAgain || dateOnly) &&
        contextual
      ? [contextual.key.slice(6)]
      : []
  for (const kind of targets) {
    const key = 'topic:' + kind
    const old = facts.find((f) => f.key === key)
    const initial =
      /\b(?:tenho|terei|vou ter|estou|to|comecei|vou (?:fazer|preparar|assistir|comecar)|meu projeto|minha entrevista|minha receita)\b/.test(
        n,
      )
    if (!old && !initial) continue
    // A question, quotation, hypothetical or third-party report must never create a user event.
    if (
      /\?|["“”]|(?:ele|ela|amigo|amiga) (?:disse|falou|tem|esta)|por exemplo|se eu|talvez|hipotetic/.test(
        n,
      )
    )
      continue
    const reopening =
      old?.status === 'resolved' && initial && /(?:outr[oa]|nov[oa])/.test(n)
    const knownDate = eventDate(text, clock)
    const topic = {
      ...old,
      key,
      kind: 'open_topic',
      value: old && !reopening ? old.value : text.slice(0, 240),
      status: declined
        ? old?.status || 'open'
        : resolved
          ? 'resolved'
          : reopening
            ? 'open'
            : old?.status || 'open',
      revisit: declined
        ? 'declined'
        : allowedAgain || !old
          ? 'allowed'
          : old.revisit,
      eventDate:
        knownDate || (reopening || postponed ? null : old?.eventDate) || null,
      eventTimeZone: clock.timeZone,
      source,
      eventDateSource: knownDate
        ? source
        : reopening || postponed
          ? null
          : old?.eventDateSource || null,
      reported:
        !old || reopening
          ? {
              text: text.slice(0, 240),
              recordedAt: source.recordedAt,
              sourceTurn: source.turn,
            }
          : old.reported,
      statusSource: {
        text: text.slice(0, 240),
        recordedAt: source.recordedAt,
        sourceTurn: source.turn,
      },
      createdAt: old?.createdAt || clock.timestamp,
      updatedAt: clock.timestamp,
      ...(reopening ? { lastAskedAt: null, lastAskedTurn: null } : {}),
    }
    facts = [...facts.filter((f) => f.key !== key), topic]
  }
  return facts
}
export function topicContext(state, message, clock) {
  if (!state.enabled) return []
  const n = normalize(message).trim()
  const casualReturn =
    /^(?:oi|ola|bom dia|boa tarde|boa noite|voltei|e ai|tudo bem)[!.?,\s]*$/.test(
      n,
    )
  return state.facts
    .filter(
      (f) =>
        f.kind === 'open_topic' &&
        f.status === 'open' &&
        f.revisit === 'allowed' &&
        !f.lastAskedAt,
    )
    .filter(
      (f) =>
        TOPICS[f.key.slice(6)]?.test(n) ||
        (casualReturn &&
          (f.eventDate
            ? f.eventDate < clock.localDate
            : f.key !== 'topic:interview' &&
              Date.parse(clock.timestamp) - Date.parse(f.updatedAt) >=
                30 * 60_000)),
    )
    .slice(-1)
    .map((f) => ({
      ...f,
      mayFollowUp: true,
      dateKnown: !!f.eventDate,
      instruction: f.eventDate
        ? 'Retomada opcional, se pertinente. Priorize o envio atual.'
        : 'Data desconhecida: não presuma que o evento já ocorreu.',
    }))
}
export function markTopicAsked(state, reply, offered, now) {
  if (
    !state?.enabled ||
    !/\?/.test(reply) ||
    !/como (?:foi|esta|ficou|anda)|conseguiu|terminou|deu certo|andamento/.test(
      normalize(reply),
    )
  )
    return state
  const keys = new Set(
    offered
      .filter((f) => TOPICS[f.key.slice(6)]?.test(normalize(reply)))
      .map((f) => f.key),
  )
  return {
    ...state,
    facts: state.facts.map((f) =>
      keys.has(f.key)
        ? { ...f, lastAskedAt: now, lastAskedTurn: state.processedThrough }
        : f,
    ),
  }
}
export const TOPIC_INSTRUCTIONS =
  'CONTINUIDADE: currentUserMessages são envios distintos do mesmo turno; considere o conjunto, não responda isoladamente a cada fragmento. openTopics contém somente relatos do usuário com origem, data conhecida ou null e permissão de retomada. Retome no máximo um quando pertinente; nunca interrompa desabafo, urgência ou pergunta importante. Data desconhecida não autoriza supor que o evento passou. Resolvidos, já perguntados e recusados não são convites para perguntar de novo. Nunca cobre retorno nem contate fora do chat.'
