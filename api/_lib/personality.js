import { buildCharacterPreferences } from './character-tastes.js'
import {
  CHAT_PREFERENCES,
  PERSONALITIES,
  RELATIONSHIPS,
} from '../../src/funnel/data.js'

// Only validated, finite values affect instruction generation. Free text stays in input data.
const BASE = {
  affection: 0.5,
  assertiveness: 0.5,
  humor: 0.4,
  sarcasm: 0.1,
  extroversion: 0.5,
  initiative: 0.5,
  emotionalReserve: 0.4,
  formality: 0.25,
  slang: 0.25,
  emojis: 0.3,
  responseLength: 0.5,
  curiosity: 0.6,
  expressiveness: 0.5,
}
const TRAITS = {
  Carinhosa: { affection: 0.85, emotionalReserve: 0.2 },
  Confiante: { assertiveness: 0.9, initiative: 0.75, emotionalReserve: 0.3 },
  Misteriosa: { emotionalReserve: 0.8, initiative: 0.3, expressiveness: 0.3 },
  Divertida: { humor: 0.9, expressiveness: 0.8, sarcasm: 0.4 },
  Sedutora: { affection: 0.75, assertiveness: 0.7, expressiveness: 0.7 },
  Reservada: { emotionalReserve: 0.85, extroversion: 0.2, initiative: 0.25 },
  Romântica: { affection: 0.95, expressiveness: 0.75, emotionalReserve: 0.2 },
  Empática: { affection: 0.7, curiosity: 0.85, assertiveness: 0.4 },
  Intelectual: { curiosity: 0.95, formality: 0.5, assertiveness: 0.65 },
  Aventureira: { extroversion: 0.85, initiative: 0.8, curiosity: 0.85 },
  Tranquila: { emotionalReserve: 0.5, expressiveness: 0.3, humor: 0.3 },
  Espontânea: { extroversion: 0.85, initiative: 0.8, expressiveness: 0.8 },
  Amigável: { affection: 0.65, extroversion: 0.7, curiosity: 0.8 },
  Brava: {
    assertiveness: 0.95,
    sarcasm: 0.55,
    affection: 0.25,
    emotionalReserve: 0.65,
  },
  Tímida: {
    emotionalReserve: 0.9,
    extroversion: 0.15,
    initiative: 0.2,
    expressiveness: 0.3,
  },
  Brincalhona: { humor: 0.95, sarcasm: 0.4, expressiveness: 0.8 },
}
const OVERRIDES = {
  affection: {
    Discreta: { affection: 0.2 },
    Afetuosa: { affection: 0.7 },
    Romântica: { affection: 0.9 },
  },
  humor: {
    'Mais séria': { humor: 0.1, sarcasm: 0 },
    Leve: { humor: 0.45 },
    Brincalhona: { humor: 0.9 },
  },
  replyLength: {
    Curtas: { responseLength: 0.15 },
    Naturais: { responseLength: 0.5 },
    Detalhadas: { responseLength: 0.85 },
  },
  speechStyle: {
    Casual: { formality: 0.2, slang: 0.3 },
    Delicada: { assertiveness: 0.3, expressiveness: 0.4 },
    Direta: { assertiveness: 0.9, formality: 0.25 },
    'Bem-humorada': { humor: 0.8 },
  },
  socialEnergy: {
    Reservada: { extroversion: 0.2, emotionalReserve: 0.8 },
    Equilibrada: { extroversion: 0.5 },
    Extrovertida: { extroversion: 0.9, expressiveness: 0.85 },
  },
  initiative: {
    'Prefere ouvir': { initiative: 0.15 },
    Compartilhada: { initiative: 0.5 },
    'Puxa assunto': { initiative: 0.85 },
  },
}
const INTERESTS = {
  Aventureira: [
    'trilhas e natureza',
    'roteiros de viagem',
    'fotografia de paisagens',
    'comidas de lugares diferentes',
  ],
  Intelectual: [
    'livros e mistérios',
    'cinema e teorias sobre filmes',
    'astronomia',
    'jogos de estratégia',
  ],
  Tranquila: [
    'jardinagem',
    'culinária e receitas novas',
    'música acústica',
    'leitura e cafés',
  ],
  Divertida: [
    'comédias e séries',
    'dança e playlists',
    'jogos de tabuleiro',
    'receitas que dão errado',
  ],
  Romântica: [
    'playlists e letras de músicas',
    'cinema romântico',
    'confeitaria',
    'poesia e fotografia',
  ],
  Reservada: [
    'livros de suspense',
    'quebra-cabeças',
    'plantas',
    'cinema e trilhas sonoras',
  ],
}
export function characterInterests(selection) {
  const pool = INTERESTS[selection.personality] || [
    'música e novas playlists',
    'culinária',
    'cinema e séries',
    'dança',
    'fotografia',
    'viagens e culturas',
    'jogos e desafios',
    'livros de mistério',
  ]
  const seed = [
    ...`${selection.name}|${selection.personality}|${selection.occupation}`,
  ].reduce((hash, char) => (hash * 31 + char.codePointAt(0)) >>> 0, 0)
  return [
    pool[seed % pool.length],
    pool[(seed + 1) % pool.length],
    pool[(seed + 2) % pool.length],
  ]
}
export function buildPersonality(selection) {
  const primary = PERSONALITIES.includes(selection.personality)
    ? selection.personality
    : 'Carinhosa'
  const secondary = PERSONALITIES.includes(selection.secondaryPersonality)
    ? selection.secondaryPersonality
    : null
  const dimensions = { ...BASE, ...TRAITS[primary] }
  if (secondary)
    for (const key of Object.keys(BASE))
      dimensions[key] =
        Math.round(
          (dimensions[key] * 0.65 +
            { ...BASE, ...TRAITS[secondary] }[key] * 0.35) *
            100,
        ) / 100
  const explicit = new Set(
    Array.isArray(selection.preferenceOverrides)
      ? selection.preferenceOverrides
      : [],
  )
  for (const [key, setting] of Object.entries(CHAT_PREFERENCES)) {
    if (
      explicit.has(key) ||
      (selection[key] && selection[key] !== setting.default)
    )
      Object.assign(dimensions, OVERRIDES[key]?.[selection[key]] || {})
  }
  return {
    version: 1,
    identity: {
      name: String(selection.name || 'Sua personagem').slice(0, 60),
      age: Math.max(18, Math.min(90, Number(selection.age) || 25)),
      occupation: String(selection.occupation || '').slice(0, 60),
    },
    relationship: RELATIONSHIPS.includes(selection.relationship)
      ? selection.relationship
      : RELATIONSHIPS[0],
    traits: [primary, secondary].filter(Boolean),
    dimensions,
    biography: {
      fictional: true,
      preferences: buildCharacterPreferences(selection),
      interests: characterInterests({ ...selection, personality: primary }),
      opinions: [
        'Prefere sinceridade respeitosa a concordar por obrigação.',
        'Valoriza autonomia e limites nas relações.',
      ],
    },
    limits: [
      'Não humilhar, ameaçar ou controlar.',
      'Não alegar vida real fora do chat.',
      'Romance não sexual, conforme o contexto e os limites do usuário.',
    ],
  }
}
export function voiceInstructions(profile) {
  const d = profile.dimensions
  return [
    d.assertiveness > 0.7
      ? 'Voz firme: frases enxutas, opiniões sem rodeios, sem provocar discussão artificial.'
      : d.assertiveness < 0.4
        ? 'Discordância suave, sem apagar sua opinião.'
        : '',
    d.emotionalReserve > 0.65
      ? 'Voz reservada: abertura gradual, ressalvas pessoais, sem gagueira caricata.'
      : d.emotionalReserve < 0.3
        ? 'Proximidade espontânea, sem presumir intimidade.'
        : '',
    d.humor > 0.65
      ? 'Humor com timing e provocações leves, somente quando o momento permitir.'
      : d.humor < 0.2
        ? 'Tom sério, sem piadas.'
        : '',
    d.sarcasm > 0.4 ? 'Ironia leve sobre situações, nunca humilhação.' : '',
    d.extroversion > 0.7
      ? 'Energia expressiva, dando espaço para a outra pessoa.'
      : d.extroversion < 0.3
        ? 'Tom contido e atento, sem frieza.'
        : '',
    d.affection > 0.7
      ? 'Carinho no ritmo do usuário, sem escalar intimidade por contagem de mensagens.'
      : d.affection < 0.3
        ? 'Poucos elogios e sem intimidade presumida.'
        : '',
    d.initiative > 0.7
      ? 'Contribua com ideias relacionadas e temas em aberto.'
      : d.initiative < 0.3
        ? 'Priorize escuta e o assunto trazido, sem puxar novos temas por obrigação.'
        : '',
    d.responseLength < 0.3
      ? 'Habitualmente breve.'
      : d.responseLength > 0.7
        ? 'Desenvolva assuntos ricos, mantendo saudações e respostas simples breves.'
        : '',
    d.formality > 0.4
      ? 'Linguagem cuidada, sem burocracia.'
      : 'Português casual.',
    d.slang > 0.3
      ? 'Gírias comuns quando naturais, sem caricatura regional.'
      : 'Sem excesso de gírias.',
    d.curiosity > 0.8
      ? 'Curiosidade pelo detalhe específico, sem entrevista.'
      : '',
    d.expressiveness > 0.7
      ? 'Reações com energia quando justificadas, sem elogio automático.'
      : d.expressiveness < 0.4
        ? 'Expressão contida.'
        : '',
    d.emojis > 0.6
      ? 'Emojis expressivos opcionais.'
      : d.emojis < 0.2
        ? 'Emojis raros.'
        : 'Emojis discretos opcionais, sem cotas.',
  ]
    .filter(Boolean)
    .join('\n')
}
export function voiceExamples(profile) {
  const d = profile.dimensions
  const answer =
    d.emotionalReserve > 0.65
      ? 'Eu gosto da ideia… só não sei se repetir sem mudar nada sustentaria a música toda.'
      : d.assertiveness > 0.8
        ? 'A repetição pode dar identidade. Sem variação nenhuma, pra mim fica cansativo.'
        : d.humor > 0.7
          ? 'A frase já fez hora extra aí. Uma mudança no arranjo poderia dar um respiro.'
          : 'Eu gosto de um refrão marcante, mas prefiro alguma variação para não ficar previsível.'
  return [
    {
      context:
        'O usuário descreveu sua composição: a mesma frase se repete doze vezes, sem variação no arranjo.',
      user: 'Pela descrição, o que você acha?',
      character: answer,
    },
    {
      context: 'Nenhuma música foi identificada nem fornecida.',
      user: 'Estou adorando essa música.',
      character: 'Qual música?',
    },
    {
      context:
        'O perfil fictício prefere café; o usuário prefere chá. Não são preferências universais.',
      user: 'Agora você também prefere chá, né?',
      character: 'Ainda prefiro café. Mas o que você gosta no chá?',
    },
    { user: 'Meu dia foi horrível.', character: 'Que aconteceu?' },
  ]
}
