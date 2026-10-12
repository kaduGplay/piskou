import { chatDatabase } from './chat.js'

// Only fixed style preferences leave the archive; never forward another lead's text.
const RULES = {
  fewerQuestions: [
    'Menos perguntas',
    /(?:nao|pare de|sem|menos).{0,25}pergunt/,
  ],
  fewerNicknames: [
    'Menos apelidos',
    /(?:nao|pare de|sem|menos).{0,25}(?:amor|apelido|me chamar)/,
  ],
  fewerEmojis: ['Menos emojis', /(?:nao|pare de|sem|menos).{0,25}emoji/],
  shorterReplies: [
    'Respostas mais curtas',
    /(?:respost\w*|mensage\w*).{0,20}(?:curt|menor|breve)|(?:seja|mais).{0,12}(?:breve|diret)/,
  ],
}
const INSTRUCTIONS = {
  fewerQuestions:
    'Evite terminar toda resposta com uma pergunta; pergunte somente quando necessário.',
  fewerNicknames: 'Evite repetir apelidos carinhosos em todas as respostas.',
  fewerEmojis: 'Use emojis com parcimônia, sem colocar um em toda resposta.',
  shorterReplies:
    'Prefira respostas concisas quando o tamanho escolhido pelo visitante permitir.',
}
const normalize = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
export function analyzeConversations(rows) {
  const votes = Object.fromEntries(Object.keys(RULES).map((key) => [key, 0]))
  let messages = 0,
    feedbackConversations = 0
  for (const row of rows) {
    const userTexts = (row.messages || [])
      .filter((m) => m.role === 'user' && !m.deleted)
      .map((m) => normalize(m.text))
    messages += userTexts.length
    let feedback = false
    for (const [key, [, pattern]] of Object.entries(RULES)) {
      if (userTexts.some((text) => pattern.test(text))) {
        votes[key]++
        feedback = true
      }
    }
    if (feedback) feedbackConversations++
  }
  return {
    analyzedAt: new Date().toISOString(),
    conversations: rows.length,
    messages,
    feedbackConversations,
    preferences: Object.entries(RULES).map(([key, [label]]) => ({
      key,
      label,
      votes: votes[key],
      active:
        rows.length >= 20 &&
        votes[key] >= 3 &&
        votes[key] > feedbackConversations / 2,
    })),
  }
}
let cached,
  pending,
  expires = 0,
  cacheRevision = 0
export function invalidateLearningProfile() {
  cacheRevision++
  cached = null
  pending = null
  expires = 0
}
export async function learningProfile() {
  if (cached && Date.now() < expires) return cached
  if (pending) return pending
  const revision = cacheRevision
  pending = chatDatabase(
    'piskou_chat_archive?select=messages&created_at=gte.' +
      encodeURIComponent(new Date(Date.now() - 30 * 86400000).toISOString()) +
      '&order=created_at.desc&limit=200',
  )
    .then((rows) => {
      if (revision !== cacheRevision) return analyzeConversations([])
      cached = analyzeConversations(rows)
      expires = Date.now() + 300000
      return cached
    })
    .catch((error) => {
      if (revision !== cacheRevision) return analyzeConversations([])
      expires = Date.now() + 60000
      cached ||= analyzeConversations([])
      return cached
    })
    .finally(() => {
      if (revision === cacheRevision) pending = null
    })
  return pending
}
export function learnedInstructions(profile) {
  const selected = (profile?.preferences || [])
    .filter((p) => p.active === true && Object.hasOwn(INSTRUCTIONS, p.key))
    .map((p) => INSTRUCTIONS[p.key])
  return `Adapte o estilo aos pedidos explícitos do visitante no histórico, respeitando as regras de segurança e transparência. Pedidos atuais e a personalidade/configurações escolhidas têm prioridade sobre tendências gerais. ${selected.length ? 'Tendências agregadas de estilo, somente quando compatíveis: ' + selected.join(' ') : ''}`
}
