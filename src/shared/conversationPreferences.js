const normalize = (text) =>
  String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
const ROLEPLAY_START =
  /(?:vamos imaginar|imagine que|faz de conta|finja que|vamos fingir|roleplay|numa cena|na cena|minha personagem)/
const ROLEPLAY_END =
  /(?:fora d[ao] (?:cena|personagem)|voltando (?:a|para a) realidade|na vida real|fim d[ao] (?:roleplay|cena))/
const PREFS = [
  [
    'repetition',
    true,
    /(?:voce (?:esta|ta) repetitiv[ao]|voce (?:esta|ta) se repetindo|pare de repetir|nao precisa terminar sempre com pergunta)/,
  ],
  [
    'candor',
    true,
    /(?:voce so concorda comigo|nao quero elogio automatico|sem bajulacao|seja mais sincer[ao]|pare de (?:me )?bajular)/,
  ],
  [
    'nicknames',
    false,
    /(?:sem apelidos|nao (?:use|pode usar) apelidos|nao (?:me )?chame (?:de amor|assim)|pare (?:com|de usar) (?:os )?apelidos)/,
  ],
  [
    'nicknames',
    true,
    /(?<!nao )(?:pode (?:me )?chamar de amor|pode usar apelidos)/,
  ],
  [
    'flirt',
    false,
    /(?:nao quero flerte|nao pode flertar|sem flerte|nao (?:quero|vamos) (?:romance|flertar))/,
  ],
  ['flirt', true, /(?<!nao )(?:pode flertar|quero flerte|quero romance)/],
  [
    'humor',
    false,
    /(?:nao pode brincar|para com (?:essa|a) brincadeira|pare de brincar|sem brincadeiras|nao gostei dessa brincadeira)/,
  ],
  ['humor', true, /(?<!nao )(?:pode brincar|pode fazer piadas)/],
  [
    'length',
    'short',
    /(?:fala menos|fale menos|respostas? (?:mais )?curtas?|seja breve)/,
  ],
  [
    'length',
    'detailed',
    /(?:explique melhor|respostas? (?:mais )?detalhadas?|pode detalhar)/,
  ],
  ['emojis', false, /(?:sem emojis|nao use emojis)/],
  ['questions', false, /(?:menos perguntas|sem perguntas|pare de perguntar)/],
]
export function preferenceMatches(text) {
  const n = normalize(text)
  return PREFS.flatMap(([key, value, pattern]) => {
    return [...n.matchAll(new RegExp(pattern.source, 'g'))].map((match) => ({
      key: 'preference:' + key,
      kind: 'preference',
      value,
      position: match.index,
      quote: String(text).slice(match.index, match.index + match[0].length),
    }))
  }).sort((a, b) => a.position - b.position)
}
export function roleplayState(text, previous = false) {
  const n = normalize(text)
  if (ROLEPLAY_END.test(n)) return false
  return ROLEPLAY_START.test(n) || previous
}
export function currentPreferences(history, current) {
  const result = {}
  let imagined = false
  for (const m of [...history, { role: 'user', text: current }]) {
    if (m.role !== 'user') continue
    imagined = roleplayState(m.text, imagined)
    if (imagined) continue
    for (const fact of preferenceMatches(m.text))
      result[fact.key.slice(11)] = fact.value
  }
  return result
}
