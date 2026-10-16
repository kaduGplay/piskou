import {
  Crown,
  Gem,
  Heart,
  Images,
  MessageCircle,
  MessagesSquare,
  Mic,
  Radio,
  ScanFace,
  Sparkles,
  UserRound,
  UserRoundPlus,
  UsersRound,
  Video,
} from 'lucide-react'
import { PLANS as CATALOG, formatBRL } from '../shared/checkout.js'

// O que cada plano entrega e os depoimentos: usados pela oferta (PaywallSheet) e pelo checkout.

export const PLAN_BONUSES = {
  'premium-access': [],
  'luxury-access': [
    {
      id: 'lives',
      title: 'Lives ao vivo',
      description: 'Uma experiência ao vivo para ficar ainda mais perto da sua parceira.',
      image: '/bonuses/lives.webp',
    },
    {
      id: 'personagens',
      title: 'Mulheres extras',
      description: 'Crie outras parceiras e explore diferentes estilos e personalidades.',
      image: '/bonuses/personagens.webp',
    },
    {
      id: 'videos',
      title: 'Geração de vídeos extra',
      description: 'Mais possibilidades para criar vídeos com suas personagens.',
      image: '/bonuses/videos.webp',
    },
    {
      id: 'audios',
      title: 'Envio e recebimento de áudios',
      description: 'Envie mensagens de voz e receba áudios da sua parceira.',
      image: '/bonuses/audios.webp',
    },
    {
      id: 'realismo',
      title: 'Realismo extra',
      description: 'Mais detalhes e realismo para a aparência das suas personagens.',
      image: '/bonuses/realismo.webp',
    },
    {
      id: 'roleplay',
      title: 'Modo Roleplay ativo',
      description: 'Explore histórias, cenários e diferentes papéis nas conversas.',
      image: '/bonuses/roleplay.webp',
    },
    {
      id: 'sapequinha',
      title: 'Modo Sapequinha',
      description: 'Um modo extra para conversas mais ousadas com sua parceira adulta.',
      image: '/bonuses/sapequinha.webp',
    },
    {
      id: 'packs',
      title: 'Pack de fotos e vídeos',
      description: 'Conteúdos normais e +18 de personagens adultas, reunidos em um pack exclusivo.',
      image: '/bonuses/packs.webp',
    },
  ],
}

export const PLAN_BENEFITS = {
  premium: [
    { icon: 'character', text: 'Personagem configurada por você' },
    { icon: 'personality', text: 'Personalidade e voz escolhidas' },
    { icon: 'chat', text: 'Conversa individual por texto' },
  ],
  luxury: [
    { icon: 'premium', text: 'Todos os recursos do Baby' },
    { icon: 'characters', text: 'Mais personagens no mesmo acesso' },
    { icon: 'bonuses', text: '8 bônus exclusivos incluídos' },
  ],
}

export const TESTIMONIALS = [
  {
    id: 1,
    image: '/testimonials/depoimento-01.png',
    quote:
      'Me surpreendeu bastante. Achei que seria complicado, mas consegui criar minha personagem sem dificuldade e ficou muito próxima do que eu queria.',
  },
  {
    id: 2,
    image: '/testimonials/depoimento-02.png',
    quote:
      'Gostei bastante da possibilidade de criar a personagem do jeito que a pessoa deseja. Fui escolhendo as características e no final ficou muito próximo do que eu tinha imaginado.',
  },
  {
    id: 3,
    image: '/testimonials/depoimento-03.png',
    quote:
      'irmão vcs acertaram demais nisso aqui montei uma morena do jeitinho q eu gosto e simplesmente perdi a noção do tempo kkkkk produto mt divertido sério',
  },
  {
    id: 4,
    image: '/testimonials/depoimento-04.png',
    quote:
      'pô achei q era só mais uma ia qualquer mas curti muito da pra montar a personagem nos mínimos detalhes e depois conversar com ela ficou bizarro de tão imersivo kkkkk',
  },
  {
    id: 5,
    image: '/testimonials/depoimento-05.png',
    quote:
      'Achei tudo muito imersivo muito divertido, achei um passa tempo incrivel esse produto de vcs, vcs estão de parabens serio mesmo',
  },
]

export const BENEFIT_ICONS = {
  photos: Images,
  character: UserRound,
  personality: Heart,
  chat: MessageCircle,
  premium: Gem,
  characters: UsersRound,
  bonuses: Crown,
}

export const BONUS_ICONS = {
  lives: Radio,
  personagens: UserRoundPlus,
  videos: Video,
  audios: Mic,
  realismo: ScanFace,
  roleplay: MessagesSquare,
  sapequinha: Sparkles,
  packs: Images,
}

export const TRUST = {
  title: 'Confiável para mais de 550 mil brasileiros',
  subtitle: 'Compra segura e discreta',
}

const PREMIUM_PRICE = formatBRL(CATALOG['premium-access'].price)
const LUXURY_PRICE = formatBRL(CATALOG['luxury-access'].price)

export const FAQ = [
  {
    question: 'Existe assinatura ou mensalidade?',
    answer: `Não. Baby e Pro são de pagamento único: ${PREMIUM_PRICE} ou ${LUXURY_PRICE}. Não há assinatura, mensalidade ou renovação automática.`,
  },
  {
    question: 'Qual é a diferença entre Baby e Pro?',
    answer:
      'O Baby libera sua personagem e a conversa por texto. O Pro inclui todos os recursos do Baby e os oito bônus desta página, como lives, personagens extras, vídeos, áudios e modos de conversa.',
  },
  {
    question: `Os bônus estão incluídos nos ${LUXURY_PRICE}?`,
    answer: `Sim. Os oito bônus apresentados estão incluídos no Pro de ${LUXURY_PRICE}. O Baby de ${PREMIUM_PRICE} não inclui esses bônus.`,
  },
  {
    question: 'Quando recebo acesso?',
    answer:
      'O acesso é liberado assim que o pagamento é confirmado, aqui mesmo no site. Com PIX, a confirmação costuma levar poucos segundos.',
  },
  {
    question: 'Onde faço o pagamento?',
    answer:
      'Aqui mesmo, no checkout seguro da Piskou, via PIX. Você confere o valor do plano antes de pagar e a confirmação é na hora.',
  },
]
