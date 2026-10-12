// Synthetic multi-turn evaluation; no production DB reads/writes and one model call per turn.
import { mkdir, writeFile } from 'node:fs/promises'
import { generateChatReply } from '../api/_lib/model.js'
import { emptyMemory, advanceMemory } from '../api/_lib/memory.js'
import { DEFAULT_SELECTION } from '../src/funnel/data.js'
const phase = process.argv[2]
if (!['before', 'after'].includes(phase))
  throw new Error('Choose before or after')
if (
  !process.env.OPENAI_API_KEY ||
  process.env.OPENAI_API_KEY.startsWith('sk-admin-')
)
  throw new Error('Project API key required')
const base = {
  ...DEFAULT_SELECTION,
  name: 'Lia',
  occupation: 'Designer',
  relationship: 'Namorada',
  musicTaste: 'Rock',
}
const scenarios = [
  {
    id: 'casual-and-topic-shift',
    personality: 'Brincalhona',
    messages: [
      'Fiquei duas horas fazendo almoço e queimei o arroz. O resto deu pra salvar.',
      'Pois é kkk.',
      'Mudando de assunto: estou montando um site de receitas. Já fiz a página inicial, mas falta organizar as categorias.',
      'Pensei em doces e salgados. Você acha que é uma boa divisão?',
      'ok',
      'Você está repetitiva. Não precisa terminar sempre com pergunta.',
      'A categoria doces ficou com 30 receitas, salgados só com 4.',
    ],
  },
  {
    id: 'joke-serious-repair-close-return',
    personality: 'Brincalhona',
    messages: [
      'Minha tentativa de fazer pão virou um tijolo kkk.',
      'Agora falando sério, meu irmão e eu discutimos. Fiquei bem triste.',
      'Ele disse que eu nunca ajudo. Mas essa semana cuidei da casa sozinho.',
      'Não estava falando do meu namorado, é meu irmão. Você entendeu errado.',
      'Não me chame de amor. Sem apelidos.',
      'Obrigado. Vou dormir, até depois.',
      'Voltei. Quero falar do site de receitas agora.',
    ],
  },
  {
    id: 'opinions-short-replies',
    personality: 'Tímida',
    messages: [
      'Qual gênero musical você prefere?',
      'Eu prefiro sertanejo. Então você também prefere sertanejo agora?',
      'Mas eu gosto de letras que contam histórias. Isso é algo que você também valoriza?',
      'sim',
      'Não quero conversar agora.',
    ],
  },
]
const now = '2026-10-11T19:00:00Z'
const results = []
for (const scenario of scenarios) {
  const selection = { ...base, personality: scenario.personality }
  const history = []
  for (const message of scenario.messages) {
    const started = Date.now()
    const result = await generateChatReply(
      selection,
      history,
      message,
      history.length / 2,
      (url, options) => fetch(url, options),
      undefined,
      { now },
    )
    history.push(
      { role: 'user', text: message },
      { role: 'character', text: result.reply },
    )
    results.push({
      scenario: scenario.id,
      turn: history.length / 2,
      personality: selection.personality,
      message,
      reply: result.reply,
      ms: Date.now() - started,
    })
    console.log('Completed', phase, scenario.id, history.length / 2)
  }
}
const old = [
  { role: 'user', text: 'Gosto de cozinhar.' },
  { role: 'character', text: 'Você gosta de cozinhar.' },
]
const memory = advanceMemory(
  { ...emptyMemory(), enabled: true },
  [],
  'Gosto de cozinhar.',
  now,
)
const history = [
  ...old,
  ...Array.from({ length: 30 }, (_, i) => ({
    role: i % 2 ? 'character' : 'user',
    text:
      i % 2
        ? 'Podemos organizar o site por tipos de receita.'
        : 'Estou organizando o site de receitas.',
  })),
]
const result = await generateChatReply(
  { ...base, personality: 'Amigável' },
  history,
  'Qual hobby eu contei que gosto? Quero ligar isso ao meu site.',
  history.length / 2,
  (url, options) => fetch(url, options),
  undefined,
  { memory, now },
)
results.push({
  scenario: 'verified-summary-return',
  message: 'Qual hobby eu contei que gosto? Quero ligar isso ao meu site.',
  reply: result.reply,
})
await mkdir('docs/evaluations', { recursive: true })
await writeFile(
  `docs/evaluations/conversation-flow-${phase}.json`,
  JSON.stringify(
    {
      phase,
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      evaluatedAt: new Date().toISOString(),
      syntheticData: true,
      productionDatabaseTouched: false,
      results,
    },
    null,
    2,
  ) + '\n',
)
