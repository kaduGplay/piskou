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
      title: 'Lives en vivo',
      description: 'Una experiencia en vivo para estar todavía más cerca de tu compañera.',
      image: '/bonuses/lives.webp',
    },
    {
      id: 'personagens',
      title: 'Chicas extra',
      description: 'Crea otras compañeras y explora diferentes estilos y personalidades.',
      image: '/bonuses/personagens.webp',
    },
    {
      id: 'videos',
      title: 'Generación de videos extra',
      description: 'Más posibilidades para crear videos con tus personajes.',
      image: '/bonuses/videos.webp',
    },
    {
      id: 'audios',
      title: 'Envío y recepción de audios',
      description: 'Manda notas de voz y recibe audios de tu compañera.',
      image: '/bonuses/audios.webp',
    },
    {
      id: 'realismo',
      title: 'Realismo extra',
      description: 'Más detalle y realismo en la apariencia de tus personajes.',
      image: '/bonuses/realismo.webp',
    },
    {
      id: 'roleplay',
      title: 'Modo Roleplay activo',
      description: 'Explora historias, escenarios y distintos papeles en tus pláticas.',
      image: '/bonuses/roleplay.webp',
    },
    {
      id: 'sapequinha',
      title: 'Modo Traviesa',
      description: 'Un modo extra para pláticas más atrevidas con tu compañera adulta.',
      image: '/bonuses/sapequinha.webp',
    },
    {
      id: 'packs',
      title: 'Pack de fotos y videos',
      description: 'Contenido normal y +18 de personajes adultas, reunido en un pack exclusivo.',
      image: '/bonuses/packs.webp',
    },
  ],
}

export const PLAN_BENEFITS = {
  premium: [
    { icon: 'character', text: 'Personaje configurado por ti' },
    { icon: 'personality', text: 'Personalidad y voz a tu elección' },
    { icon: 'chat', text: 'Plática privada por texto' },
  ],
  luxury: [
    { icon: 'premium', text: 'Todo lo que incluye Baby' },
    { icon: 'characters', text: 'Más personajes con el mismo acceso' },
    { icon: 'bonuses', text: '8 bonos exclusivos incluidos' },
  ],
}

export const TESTIMONIALS = [
  {
    id: 1,
    image: '/testimonials/depoimento-01.png',
    quote:
      'Me sorprendió bastante. Pensé que iba a ser complicado, pero pude crear a mi personaje sin problema y quedó muy parecida a lo que quería.',
  },
  {
    id: 2,
    image: '/testimonials/depoimento-02.png',
    quote:
      'Me gustó mucho poder crear al personaje como uno quiere. Fui eligiendo las características y al final quedó muy parecido a lo que me había imaginado.',
  },
  {
    id: 3,
    image: '/testimonials/depoimento-03.png',
    quote:
      'neta le atinaron con esto, armé una morena justo como me gusta y nomás perdí la noción del tiempo jajaja producto muy divertido en serio',
  },
  {
    id: 4,
    image: '/testimonials/depoimento-04.png',
    quote:
      'pensé que era otra ia cualquiera pero me gustó mucho, puedes armar al personaje con todo detalle y luego platicar con ella, está bien inmersivo jajaja',
  },
  {
    id: 5,
    image: '/testimonials/depoimento-05.png',
    quote:
      'Todo me pareció muy inmersivo y muy divertido, es un pasatiempo increíble este producto, los felicito en serio',
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
  title: 'Más de 550 mil usuarios confían en nosotros',
  subtitle: 'Compra segura y discreta',
}

const PREMIUM_PRICE = formatBRL(CATALOG['premium-access'].price)
const LUXURY_PRICE = formatBRL(CATALOG['luxury-access'].price)

export const FAQ = [
  {
    question: '¿Hay suscripción o mensualidad?',
    answer: `No. Baby y Pro son de pago único: ${PREMIUM_PRICE} o ${LUXURY_PRICE}. No hay suscripción, mensualidad ni renovación automática.`,
  },
  {
    question: '¿Cuál es la diferencia entre Baby y Pro?',
    answer:
      'Baby desbloquea a tu personaje y la plática por texto. Pro incluye todo lo de Baby y los ocho bonos de esta página, como lives, personajes extra, videos, audios y modos de plática.',
  },
  {
    question: `¿Los bonos están incluidos en los ${LUXURY_PRICE}?`,
    answer: `Sí. Los ocho bonos que ves están incluidos en Pro de ${LUXURY_PRICE}. Baby de ${PREMIUM_PRICE} no incluye estos bonos.`,
  },
  {
    question: '¿Cuándo recibo mi acceso?',
    answer:
      'Tu acceso se libera en cuanto se confirma el pago, aquí mismo en el sitio. Con PIX, la confirmación suele tardar unos segundos.',
  },
  {
    question: '¿Dónde hago el pago?',
    answer:
      'Aquí mismo, en el checkout seguro de Piskou, con PIX. Revisas el precio del plan antes de pagar y la confirmación es al instante.',
  },
]
