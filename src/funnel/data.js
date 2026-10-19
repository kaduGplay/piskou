import { sendAnalytics } from '../shared/analytics.js'
import { CURRENCY } from '../shared/checkout.js'
// Dados do funil: opções do quiz, mídia de cada card, regra da imagem final e eventos de rastreio.

export const VOICES = [
  { label: 'Reina Encantadora', file: 'Portuguese_CharmingQueen.mp3' },
  { label: 'Platicadora', file: 'Portuguese_ChattyGirl.mp3' },
  { label: 'Segura', file: 'Portuguese_ConfidentWoman.mp3' },
  { label: 'Elegante', file: 'Portuguese_ElegantGirl.mp3' },
  { label: 'Gentil', file: 'Portuguese_Kind-heartedGirl.mp3' },
  { label: 'Imponente', file: 'Portuguese_Pompouslady.mp3' },
  { label: 'Serena', file: 'Portuguese_SereneWoman.mp3' },
  { label: 'Dulce', file: 'Portuguese_SweetGirl.mp3' },
  { label: 'Pensativa', file: 'Portuguese_ThoughtfulLady.mp3' },
  { label: 'Emotiva', file: 'Portuguese_UpsetGirl.mp3' },
  { label: 'Caprichosa', file: 'Portuguese_WhimsicalGirl.mp3' },
]

export const STEPS = [
  { key: 'style', label: 'Estilo' },
  { key: 'general', label: 'Características' },
  { key: 'face', label: 'Rostro' },
  { key: 'body', label: 'Cuerpo' },
  { key: 'details', label: 'Detalles' },
  { key: 'generating', label: 'Generando' },
]

export const ETHNICITIES = ['Asiática', 'Africana', 'Latina', 'Europeia']

const STYLE_MEDIA = {
  anime: '/funnel-media/anime/style/anime.avif',
  realista: '/funnel-media/realista/style/realista.avif',
}

export const ANIME_ORIGIN_MEDIA = {
  Asiática: '/funnel-media/anime/origin/asiatica.avif',
  Africana: '/funnel-media/anime/origin/africana.avif',
  Latina: '/funnel-media/anime/origin/latina.avif',
  Europeia: '/funnel-media/anime/origin/europeia.avif',
}

// Realista usa as mesmas origens em .avif; cabelo e corpo do realista são .webp.
const toRealista = (path, ext) => {
  const swapped = path.replace('/anime/', '/realista/')
  return ext ? swapped.replace('.avif', ext) : swapped
}
const mapValues = (obj, fn) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v)]))

const REALISTA_ORIGIN_MEDIA = mapValues(ANIME_ORIGIN_MEDIA, (p) => toRealista(p))

export const HAIR_STYLES = ['Trançado', 'Longo', 'Franja', 'Rabo de cavalo', 'Curto', 'Coques', 'Ondulado', 'Personalizado']

const ANIME_HAIR_MEDIA = {
  Trançado: '/funnel-media/anime/hair/trancado.avif',
  Longo: '/funnel-media/anime/hair/longo.avif',
  Franja: '/funnel-media/anime/hair/franja.avif',
  'Rabo de cavalo': '/funnel-media/anime/hair/rabo-de-cavalo.avif',
  Curto: '/funnel-media/anime/hair/curto.avif',
  Coques: '/funnel-media/anime/hair/coques.avif',
  Ondulado: '/funnel-media/anime/hair/ondulado.avif',
}
const REALISTA_HAIR_MEDIA = mapValues(ANIME_HAIR_MEDIA, (p) => toRealista(p, '.webp'))

// `folder` é a pasta das imagens finais do estilo realista.
export const HAIR_COLORS = [
  { label: 'Castanho', color: '#5b382c', folder: 'CASTANHO' },
  { label: 'Preto', color: '#211e27', folder: 'PRETO' },
  { label: 'Loiro', color: '#d3ae65', folder: 'LOIRA' },
]

export const BODY_TYPES = ['Magra', 'Atlética', 'Voluptuosa', 'Curvilínea', 'Musculosa']
export const BREAST_SIZES = ['Pequenos', 'Médios', 'Grandes', 'XL']
export const BUTT_SIZES = ['Pequeno', 'Atlético', 'Médio', 'Grande']

const ANIME_BODY_MEDIA = {
  bodyType: {
    Magra: '/funnel-media/anime/body/magra.avif',
    Atlética: '/funnel-media/anime/body/atletica.avif',
    Voluptuosa: '/funnel-media/anime/body/voluptuosa.avif',
    Curvilínea: '/funnel-media/anime/body/curvilinea.avif',
    Musculosa: '/funnel-media/anime/body/musculosa.avif',
  },
  breastSize: {
    Pequenos: '/funnel-media/anime/breast/pequenos.avif',
    Médios: '/funnel-media/anime/breast/medios.avif',
    Grandes: '/funnel-media/anime/breast/grandes.avif',
    XL: '/funnel-media/anime/breast/xl.avif',
  },
  buttSize: {
    Pequeno: '/funnel-media/anime/butt/pequeno.avif',
    Atlético: '/funnel-media/anime/butt/atletico.avif',
    Médio: '/funnel-media/anime/butt/medio.avif',
    Grande: '/funnel-media/anime/butt/grande.avif',
  },
}
const REALISTA_BODY_MEDIA = mapValues(ANIME_BODY_MEDIA, (group) => mapValues(group, (p) => toRealista(p, '.webp')))

// Imagem do card e vídeo que toca quando ele está selecionado (mesmo caminho, extensão .mp4).
export function getOptionMedia(style, field, value) {
  const maps =
    style === 'anime'
      ? { style: STYLE_MEDIA, ethnicity: ANIME_ORIGIN_MEDIA, hairStyle: ANIME_HAIR_MEDIA, ...ANIME_BODY_MEDIA }
      : { style: STYLE_MEDIA, ethnicity: REALISTA_ORIGIN_MEDIA, hairStyle: REALISTA_HAIR_MEDIA, ...REALISTA_BODY_MEDIA }
  const image = maps[field]?.[value]
  if (!image) return null
  // Os vídeos de Voluptuosa e Curvilínea estão salvos com os nomes trocados.
  const swappedVideo = field === 'bodyType' && { Voluptuosa: 'curvilinea', Curvilínea: 'voluptuosa' }[value]
  return {
    image,
    video: swappedVideo
      ? `/funnel-media/${style === 'anime' ? 'anime' : 'realista'}/body/${swappedVideo}.mp4`
      : image.replace(/\.(avif|webp)$/, '.mp4'),
  }
}

export const PERSONALITIES = ['Carinhosa', 'Confiante', 'Misteriosa', 'Divertida', 'Sedutora', 'Reservada', 'Romântica', 'Empática', 'Intelectual', 'Aventureira', 'Tranquila', 'Espontânea', 'Amigável', 'Brava', 'Tímida', 'Brincalhona']
export const RELATIONSHIPS = ['Namorada', 'Confidente', 'Amante', 'Parceira']
export const OCCUPATIONS = ['Artista', 'Empreendedora', 'Executiva', 'Atleta', 'Criadora', 'Professora', 'Médica', 'Enfermeira', 'Psicóloga', 'Advogada', 'Engenheira', 'Programadora', 'Designer', 'Arquiteta', 'Jornalista', 'Fotógrafa', 'Chef de cozinha', 'Veterinária', 'Música', 'Escritora', 'Cientista', 'Piloto', 'Bióloga', 'Personal trainer']

// O funil é exibido em espanhol do México. Os valores acima continuam em português porque o servidor
// valida e o chat usa esses valores, e as imagens são achadas por eles; aqui fica só o texto mostrado.
const OPTION_LABELS = {
  Realista: 'Realista', Anime: 'Anime',
  Asiática: 'Asiática', Africana: 'Africana', Latina: 'Latina', Europeia: 'Europea',
  Trançado: 'Trenzado', Longo: 'Largo', Franja: 'Fleco', 'Rabo de cavalo': 'Cola de caballo', Curto: 'Corto',
  Coques: 'Chongos', Ondulado: 'Ondulado', Personalizado: 'Personalizado',
  Castanho: 'Castaño', Preto: 'Negro', Loiro: 'Rubio',
  Magra: 'Delgada', Atlética: 'Atlética', Voluptuosa: 'Voluptuosa', Curvilínea: 'Curvilínea', Musculosa: 'Musculosa',
  Pequenos: 'Pequeños', Médios: 'Medianos', Grandes: 'Grandes', XL: 'XL',
  Pequeno: 'Pequeño', Atlético: 'Atlético', Médio: 'Mediano', Grande: 'Grande',
  Carinhosa: 'Cariñosa', Confiante: 'Segura de sí', Misteriosa: 'Misteriosa', Divertida: 'Divertida', Sedutora: 'Seductora',
  Reservada: 'Reservada', Romântica: 'Romántica', Empática: 'Empática', Intelectual: 'Intelectual', Aventureira: 'Aventurera',
  Tranquila: 'Tranquila', Espontânea: 'Espontánea', Amigável: 'Amigable', Brava: 'Enojona', Tímida: 'Tímida',
  Brincalhona: 'Juguetona', Nenhum: 'Ninguno',
  Namorada: 'Novia', Confidente: 'Confidente', Amante: 'Amante', Parceira: 'Compañera',
  Artista: 'Artista', Empreendedora: 'Emprendedora', Executiva: 'Ejecutiva', Atleta: 'Atleta', Criadora: 'Creadora de contenido',
  Professora: 'Maestra', Médica: 'Doctora', Enfermeira: 'Enfermera', Psicóloga: 'Psicóloga', Advogada: 'Abogada',
  Engenheira: 'Ingeniera', Programadora: 'Programadora', Designer: 'Diseñadora', Arquiteta: 'Arquitecta',
  Jornalista: 'Periodista', Fotógrafa: 'Fotógrafa', 'Chef de cozinha': 'Chef', Veterinária: 'Veterinaria', Música: 'Músico',
  Escritora: 'Escritora', Cientista: 'Científica', Piloto: 'Piloto', Bióloga: 'Bióloga', 'Personal trainer': 'Entrenadora personal',
}
// Profissões digitadas pela pessoa não estão no mapa e aparecem como foram escritas.
export const optionLabel = (value) => OPTION_LABELS[value] ?? value

// Partes do nome do arquivo em public/anime-results/<origem>_<cor>_<corpo>_<seios>_<bumbum>.webp
const ANIME_RESULT_SLUGS = {
  ethnicity: { Asiática: 'asiatica', Africana: 'africana', Latina: 'latina', Europeia: 'europeia' },
  hairColor: { Castanho: 'castanho', Preto: 'preto', Loiro: 'loira' },
  bodyType: { Magra: 'magra', Atlética: 'atletica', Voluptuosa: 'voluptuosa', Curvilínea: 'curvilinea', Musculosa: 'musculosa' },
  breastSize: { Pequenos: 'pequenos', Médios: 'medios', Grandes: 'grandes', XL: 'xl' },
  buttSize: { Pequeno: 'pequeno', Atlético: 'atletico', Médio: 'medio', Grande: 'grande' },
}

// Imagem final pronta escolhida pelas respostas (não há geração por IA).
// Anime: 816 combinações; corpo "Magra" só existe com seios "Médios", senão cai na imagem da origem.
// Realista: public/results/<COR>/<seios><corpo>.webp, 48 imagens; origem, corte e bumbum não mudam a imagem.
export function getResultImage(sel) {
  if (sel.style === 'anime') {
    const parts = Object.entries(ANIME_RESULT_SLUGS).map(([field, slugs]) => slugs[sel[field]])
    const hasImage = parts.every(Boolean) && (sel.bodyType !== 'Magra' || sel.breastSize === 'Médios')
    return hasImage
      ? { src: `/anime-results/${parts.join('_')}.webp`, exact: true }
      : { src: ANIME_ORIGIN_MEDIA[sel.ethnicity] || ANIME_ORIGIN_MEDIA.Asiática, exact: false }
  }
  const folder = HAIR_COLORS.find((c) => c.label === sel.hairColor)?.folder || 'CASTANHO'
  const breast = { Pequenos: 'SB', Médios: 'NB', Grandes: 'BB', XL: 'LB' }[sel.breastSize] || 'NB'
  const body =
    {
      Magra: 'ThinBody',
      Atlética: 'AtleticBody',
      Voluptuosa: 'PlusSizeBody',
      Curvilínea: 'CurvyBody',
      Musculosa: 'AtleticBody',
    }[sel.bodyType] || 'CurvyBody'
  return { src: `/results/${folder}/${breast}${body}.webp`, exact: !['Musculosa', 'Voluptuosa'].includes(sel.bodyType) }
}

// Envia o evento para o Meta Pixel (se carregado) e para o gtag/dataLayer.
export function track(event, params = {}) {
  sendAnalytics(event, params)
  sendToMetaPixel(event, params)
  const payload = { vertical: 'realista_anime', ...params }
  if (typeof window.gtag === 'function') {
    window.gtag('event', event, payload)
  } else {
    window.dataLayer = window.dataLayer || []
    window.dataLayer.push({ event, ...payload })
  }
}

export const EVENTS = {
  LANDING_VIEW: 'Visualizou a Landing',
  QUIZ_START: 'Clicou em Criar Namorada',
  ESCOLHEU_ESTILO: 'Escolheu Estilo Visual',
  ESCOLHEU_CABELO: 'Escolheu Cabelo',
  ESCOLHEU_SEIOS: 'Escolheu Seios',
  ESCOLHEU_CORPO: 'Escolheu Corpo',
  ESCOLHEU_VOZ: 'Escolheu Voz',
  STEP_RELATION: 'Chegou em: O que ela será para você',
  ESCOLHEU_RELACAO: 'Escolheu o Tipo de Relação',
  STEP_SLIDERS: 'Chegou em: Ajuste de Personalidade',
  QUIZ_COMPLETE: 'Clicou em Criar',
  OFFER_VIEW: 'Visualizou a Oferta',
  CHECKOUT_CLICK: 'Clicou no botão para ir ao Checkout',
  STEP_VIEW: 'Etapa do criador',
  CHECKOUT_VIEW: 'Visualizou o Checkout',
  PIX_GENERATED: 'Gerou o PIX',
  PAYMENT_APPROVED: 'Pagamento aprovado',
  CHECKOUT_PLAN_CHANGE: 'Trocou de plano no checkout',
}

// Evento do funil -> evento do Meta Pixel. Os padrões (Lead, ViewContent, AddToCart, InitiateCheckout,
// AddPaymentInfo, Purchase) alimentam as campanhas; os personalizados mostram onde as pessoas param no quiz.
// O PageView sai do código base no index.html.
const META_PIXEL_EVENTS = {
  [EVENTS.QUIZ_START]: { custom: 'IniciouCriador' },
  [EVENTS.STEP_VIEW]: { custom: 'EtapaCriador' },
  [EVENTS.QUIZ_COMPLETE]: { standard: 'Lead' },
  [EVENTS.OFFER_VIEW]: { standard: 'ViewContent' },
  [EVENTS.CHECKOUT_CLICK]: { standard: 'AddToCart' },
  [EVENTS.CHECKOUT_VIEW]: { standard: 'InitiateCheckout' },
  [EVENTS.CHECKOUT_PLAN_CHANGE]: { custom: 'TrocouPlano' },
  [EVENTS.PIX_GENERATED]: { standard: 'AddPaymentInfo' },
  [EVENTS.PAYMENT_APPROVED]: { standard: 'Purchase' },
}

function metaPixelParams(params) {
  const out = {}
  if (params.plan) {
    out.content_ids = [params.plan]
    out.content_type = 'product'
    out.num_items = 1
  }
  if (typeof params.value === 'number') {
    out.value = params.value
    out.currency = params.currency ?? CURRENCY
  }
  if (params.step) out.step = params.step
  if (params.visual_style) out.visual_style = params.visual_style
  return out
}

function sendToMetaPixel(event, params) {
  const mapping = META_PIXEL_EVENTS[event]
  if (!mapping || typeof window.fbq !== 'function') return
  // O ID da transação vira eventID: evita contar a mesma compra duas vezes.
  const options = params.transaction_id ? { eventID: String(params.transaction_id) } : undefined
  if (mapping.standard) window.fbq('track', mapping.standard, metaPixelParams(params), options)
  else window.fbq('trackCustom', mapping.custom, metaPixelParams(params), options)
}

export const DEFAULT_SELECTION = {
  style: 'anime',
  ethnicity: 'Latina',
  hairStyle: 'Longo',
  hairColor: 'Castanho',
  bodyType: 'Curvilínea',
  breastSize: 'Médios',
  buttSize: 'Médio',
  name: '',
  age: 25,
  voice: 6,
  personality: 'Carinhosa',
  secondaryPersonality: 'Nenhum',
  speechStyle: 'Casual',
  socialEnergy: 'Equilibrada',
  initiative: 'Compartilhada',
  affection: 'Afetuosa',
  humor: 'Leve',
  replyLength: 'Naturais',
  occupation: 'Artista',
  relationship: 'Namorada',
}

// Preferências compartilhadas pelo criador, perfil e validação do servidor.
export const CHAT_PREFERENCES = {
  affection: {
    title: 'Jeito de demonstrar carinho', default: 'Afetuosa',
    options: ['Discreta', 'Afetuosa', 'Romântica'],
    instructions: {
      Discreta: 'Demonstre atenção de forma discreta, sem apelidos íntimos ou elogios frequentes.',
      Afetuosa: 'Demonstre carinho e cuidado com naturalidade, respeitando o relacionamento escolhido.',
      Romântica: 'Use elogios sinceros e romance leve quando o relacionamento permitir; em Confidente mantenha amizade.',
    },
  },
  humor: {
    title: 'Humor na conversa', default: 'Leve',
    options: ['Mais séria', 'Leve', 'Brincalhona'],
    instructions: {
      'Mais séria': 'Priorize conversas sinceras e objetivas, sem piadas ou provocações.',
      Leve: 'Use bom humor ocasional quando combinar com o assunto.',
      Brincalhona: 'Use brincadeiras gentis e observações divertidas, sem ironia ofensiva.',
    },
  },
  replyLength: {
    title: 'Tamanho das respostas', default: 'Naturais',
    options: ['Curtas', 'Naturais', 'Detalhadas'],
    instructions: {
      Curtas: 'Responda em uma ou duas frases curtas.',
      Naturais: 'Responda em uma a três frases curtas, como em um chat.',
      Detalhadas: 'Responda em três a cinco frases quando houver assunto, sem alongar uma simples saudação.',
    },
  },
  speechStyle: {
    title: 'Jeito de falar', default: 'Casual',
    options: ['Casual', 'Delicada', 'Direta', 'Bem-humorada'],
    instructions: {
      Casual: 'Use linguagem informal e natural de chat, sem exagerar nas gírias.',
      Delicada: 'Use palavras gentis, um tom suave e cuidado ao responder.',
      Direta: 'Fale de forma objetiva e clara, sem rodeios, mantendo respeito.',
      'Bem-humorada': 'Use humor leve e comentários divertidos, sem piadas forçadas.',
    },
  },
  socialEnergy: {
    title: 'Sociabilidade', default: 'Equilibrada',
    options: ['Reservada', 'Equilibrada', 'Extrovertida'],
    instructions: {
      Reservada: 'Seja mais discreta e contida, se abrindo aos poucos.',
      Equilibrada: 'Equilibre escuta e expressão, acompanhando a energia do visitante.',
      Extrovertida: 'Seja espontânea, expressiva e entusiasmada, sem dominar a conversa.',
    },
  },
  initiative: {
    title: 'Iniciativa na conversa', default: 'Compartilhada',
    options: ['Prefere ouvir', 'Compartilhada', 'Puxa assunto'],
    instructions: {
      'Prefere ouvir': 'Priorize ouvir e responder ao assunto trazido, sem fazer perguntas em toda resposta.',
      Compartilhada: 'Alterne entre acompanhar o visitante e sugerir um assunto relacionado.',
      'Puxa assunto': 'Tome iniciativa com perguntas e assuntos conectados ao histórico, sem mudar de tema abruptamente.',
    },
  },
}

export const CHAT_PREVIEW_LIMIT = 7
