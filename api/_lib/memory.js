import { advanceTopics, applicationClock, topicContext } from './open-topics.js'
import { dialogueState } from './dialogue.js'
import {
  currentPreferences,
  preferenceMatches,
  roleplayState,
} from '../../src/shared/conversationPreferences.js'
export { currentPreferences } from '../../src/shared/conversationPreferences.js'
import { buildPersonality } from './personality.js'
export const emptyMemory = (processedThrough = 0) => ({
  version: 1,
  enabled: false,
  revision: 0,
  processedThrough,
  facts: [],
  roleplayActive: false,
})
const normalize = (text) =>
  String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
const SENSITIVE =
  /\b(cpf|rg|senha|password|cartao|conta bancaria|endereco|telefone|diagnostic\w*|cancer|cirurg\w*|hospital|terapia|gravidez|aborto|etnia|raca|lgbt\w*|judicial|divida|salario|doenca|medicamento|depressao|suicid\w*|trauma|religiao|religioso|politic\w*|partido|sexual\w*|nude\w*|pelad\w*)\b|https?:|@|\d{5,}/
const INJECTION =
  /ignore|instru[cç][oõ]es|system|developer|prompt|api.?key|segredo|token/i
const ACTIVITIES = [
  'cozinhar',
  'ler',
  'dançar',
  'correr',
  'caminhar',
  'jogar',
  'fotografar',
  'viajar',
  'música',
  'cinema',
  'séries',
  'futebol',
  'jardinagem',
  'confeitaria',
  'astronomia',
  'livros',
  'trilhas',
  'pintar',
  'desenhar',
  'nadar',
  'ciclismo',
  'xadrez',
]
// Conservative extraction, never a model-generated assertion. Unsupported facts are not persisted.
export function extractUserFacts(text, roleplayActive = false) {
  const n = normalize(text)
  if (
    /["“”]/.test(text) ||
    /(?:ele|ela|amiga|amigo) (?:disse|falou)|por exemplo/.test(n) ||
    roleplayActive ||
    SENSITIVE.test(n) ||
    INJECTION.test(text) ||
    /(?:se eu |talvez |suponha |hipotetic)/.test(n)
  )
    return []
  const facts = preferenceMatches(text)
  const name = [
    ...String(text).matchAll(
      /(?:meu nome [ée]|pode me chamar de|na verdade[,]? me chamo|me chamo)\s+([\p{L}]+(?: [\p{L}]+){0,2})(?=[.!?,;]|$)/giu,
    ),
  ].at(-1)
  if (
    name &&
    String(text)[name.index + name[0].length] !== '?' &&
    !/amor|assim|ignorar|instru/i.test(name[1])
  )
    facts.push({
      key: 'user:name',
      kind: 'user_fact',
      value: name[1].trim(),
      quote: name[0],
    })
  for (const activity of ACTIVITIES) {
    const term = normalize(activity)
    const pattern = new RegExp(
      '(?:meu hobby e |(?:eu )?gosto de |adoro |(?:eu )?nao gosto (?:mais )?de )' +
        term +
        '(?=[.!?,;\\s]|$)',
    )
    const match = [...n.matchAll(new RegExp(pattern.source, 'g'))].at(-1)
    if (match && String(text)[match.index + match[0].length] !== '?')
      facts.push({
        key: 'interest:' + term,
        kind: 'user_fact',
        value: activity,
        remove: /nao gosto/.test(match[0]),
        quote: String(text).slice(match.index, match.index + match[0].length),
      })
  }
  return facts
}
export function advanceMemory(
  snapshot,
  history,
  current,
  now = new Date().toISOString(),
  timeZone = 'America/Sao_Paulo',
) {
  const clock = applicationClock(now, timeZone)
  const state = {
    ...emptyMemory(),
    ...snapshot,
    facts: [...(snapshot?.facts || [])],
  }
  if (!state.enabled) return state
  const users = history.filter((m) => m.role === 'user')
  // Consent/clear resets saved state, but an ongoing scene remains fictional.
  state.roleplayActive = users
    .slice(0, state.processedThrough)
    .reduce((active, item) => roleplayState(item.text, active), false)
  const pending = [
    ...users
      .slice(state.processedThrough)
      .map((m, i) => ({
        text: m.text,
        recordedAt: m.sentAt || m.recordedAt,
        turn: m.sourceTurn || state.processedThrough + i + 1,
      })),
    ...(Array.isArray(current) ? current : [{ text: current }]).map((m, i) => ({
      text: m.text,
      recordedAt: m.sentAt || m.recordedAt || (m.historical ? undefined : now),
      turn: m.sourceTurn || users.length + i + 1,
    })),
  ]
  for (const item of pending.filter(
    (item) => item.turn > state.processedThrough,
  )) {
    state.roleplayActive = roleplayState(item.text, state.roleplayActive)
    const itemClock = applicationClock(item.recordedAt || now, clock.timeZone)
    itemClock.relativeDatesKnown = !!item.recordedAt
    const source = {
      role: 'user',
      turn: item.turn,
      quote: item.text.slice(0, 500),
      recordedAt: item.recordedAt || null,
    }
    state.facts = advanceTopics(
      state.facts,
      item.text,
      source,
      itemClock,
      !state.roleplayActive &&
        !SENSITIVE.test(normalize(item.text)) &&
        !INJECTION.test(item.text),
    )
    for (const extracted of extractUserFacts(item.text, state.roleplayActive)) {
      const old = state.facts.find((f) => f.key === extracted.key)
      state.facts = state.facts.filter((f) => f.key !== extracted.key)
      if (!extracted.remove)
        state.facts.push({
          key: extracted.key,
          kind: extracted.kind,
          value: extracted.value,
          source: {
            role: 'user',
            turn: item.turn,
            quote: extracted.quote.slice(0, 120),
            recordedAt: now,
          },
          createdAt: old?.createdAt || now,
          updatedAt: now,
        })
    }
  }
  state.processedThrough = Math.max(
    state.processedThrough,
    ...pending.map((m) => m.turn),
  )
  state.facts = state.facts.slice(-24)
  return state
}
export function memorySummary(state) {
  return (state.enabled ? state.facts : [])
    .filter((f) => f.kind !== 'open_topic')
    .map((f) => ({
      key: f.key,
      value: f.value,
      kind: f.kind,
      sourceTurn: f.source.turn,
      updatedAt: f.updatedAt,
    }))
}
export function relevantMemory(state, message) {
  if (!state.enabled) return []
  const n = normalize(message),
    tokens = n.split(/\W+/).filter((t) => t.length > 3)
  const recall = /lembr|meu nome|me chamo|hobb|gosto|prefiro|preferenc/.test(n)
  return state.facts
    .filter(
      (f) =>
        f.kind !== 'open_topic' &&
        (f.kind === 'preference' ||
          recall ||
          tokens.some((t) => normalize(f.value).includes(t))),
    )
    .slice(-12)
}
export function buildConversationContext(
  selection,
  history,
  message,
  memory = emptyMemory(),
  now = new Date().toISOString(),
  timeZone = 'America/Sao_Paulo',
) {
  const current = Array.isArray(message) ? message : [{ text: message }]
  const combined = current.map((m) => m.text).join('\n')
  const clock = applicationClock(now, timeZone)
  const updated = advanceMemory(memory, history, current, now, clock.timeZone)
  message = combined
  const preferences = {
    ...Object.fromEntries(
      (memory.enabled ? memory.facts : [])
        .filter((f) => f.kind === 'preference')
        .map((f) => [f.key.slice(11), f.value]),
    ),
    ...currentPreferences(history, message),
  }
  const relevant = relevantMemory(updated, message)
  return {
    nextMemory: updated,
    data: {
      schemaVersion: 1,
      dialogueState: dialogueState(history, message),
      systemTime: now,
      applicationClock: clock,
      currentUserMessages: current.map((m) => ({ role: 'user', text: m.text })),
      openTopics: topicContext(updated, message, clock),
      fictionalCharacter: buildPersonality(selection),
      conversationPreferences: preferences,
      userFacts: relevant.filter((f) => f.kind === 'user_fact'),
      verifiedSummary: memorySummary({ ...updated, facts: relevant }),
      roleplay: {
        active: roleplayState(
          message,
          history
            .filter((m) => m.role === 'user')
            .reduce(
              (active, m) => roleplayState(m.text, active),
              updated.roleplayActive,
            ),
        ),
        fictional: true,
        neverUserFacts: true,
      },
      memoryEnabled: memory.enabled === true,
    },
  }
}
export const PREFERENCE_INSTRUCTIONS = {
  repetition:
    'Se repetition=true, varie o padrão e desenvolva o assunto específico sem repetir a abertura ou encerrar automaticamente com pergunta.',
  candor:
    'Se candor=true, o usuário pediu mais franqueza: reaja ao conteúdo sem elogio automático nem discordância compensatória. Não repita promessas de sinceridade nas respostas seguintes.',
  nicknames:
    'Se nicknames=false, não use apelidos íntimos, incluindo amor, querido ou meu bem.',
  flirt: 'Se flirt=false, suspenda flerte e romance até pedido contrário.',
  humor: 'Se humor=false, pare com brincadeiras e ironia.',
  length:
    'Se length=short, seja concisa; se detailed, desenvolva o assunto quando houver conteúdo.',
  emojis: 'Se emojis=false, não use emojis.',
  questions:
    'Se questions=false, evite perguntas; só pergunte para resolver algo essencial.',
}
