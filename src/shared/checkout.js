// Compartilhado entre o site e as rotas /api. Os preços saem só daqui: o paywall mostra estes valores
// e o servidor cobra estes valores, ignorando qualquer preço que venha do navegador.

export const PLANS = {
  'messages-120': {
    id: 'messages-120',
    tier: 'premium',
    name: 'Mais 120 mensagens',
    price: 10,
    bonusCount: 0,
    purpose: 'messages',
    messageCount: 120,
  },
  'messages-six': {
    id: 'messages-six',
    tier: 'premium',
    name: 'Mais 6 mensagens',
    price: 10,
    bonusCount: 0,
    purpose: 'messages',
  },
  'messages-unlimited': {
    id: 'messages-unlimited',
    tier: 'luxury',
    name: 'Mensagens ilimitadas',
    price: 19.90,
    bonusCount: 0,
    purpose: 'messages',
  },
  'premium-access': {
    id: 'premium-access',
    tier: 'premium',
    name: 'Baby',
    price: 14.90,
    bonusCount: 0,
  },
  'luxury-access': {
    id: 'luxury-access',
    tier: 'luxury',
    name: 'Pro',
    price: 27.90,
    bonusCount: 8,
  },
  // Upsells de um clique, oferecidos em sequência logo depois do pagamento do Baby ou do Pro.
  'upsell-video-pack': {
    id: 'upsell-video-pack',
    tier: 'premium',
    name: 'Pack de vídeos dela',
    price: 14.90,
    bonusCount: 0,
    purpose: 'upsell',
  },
  'upsell-whatsapp': {
    id: 'upsell-whatsapp',
    tier: 'premium',
    name: 'Ela te chama no WhatsApp',
    price: 14.90,
    bonusCount: 0,
    purpose: 'upsell',
  },
  'upsell-vip': {
    id: 'upsell-vip',
    tier: 'luxury',
    name: 'Acesso VIP vitalício',
    price: 19.90,
    bonusCount: 0,
    purpose: 'upsell',
  },
}

export const UPSELL_SEQUENCE = ['upsell-video-pack', 'upsell-whatsapp', 'upsell-vip']

// sessionStorage: o paywall guarda a personagem aqui e o checkout lê para mostrar no resumo.
export const SELECTION_STORAGE_KEY = 'piskou:selection'
// sessionStorage: nome e e-mail do comprador, reaproveitados nas ofertas de um clique após o pagamento.
export const BUYER_STORAGE_KEY = 'piskou:buyer'

export const formatBRL = (value) => `R$ ${value.toFixed(2).replace('.', ',')}`
export const toCents = (value) => Math.round(value * 100)

// Order bumps do primeiro checkout (Baby/Pro). O banco confere os mesmos valores em piskou_purchase_addons.
export const ORDER_BUMPS = {
  'voice-call': { id: 'voice-call', name: 'Chamada de voz', description: 'Ligações de voz com ela, em tempo real 📞', price: 8.90, originalPrice: 14.90, image: '/checkout-media/voice-call-192.jpg', available: true },
  'second-partner': { id: 'second-partner', name: 'Segunda Parceira', description: 'Crie uma segunda parceira só sua 👯‍♀️', price: 8.90, originalPrice: 14.90, image: '/checkout-media/second-partner-192.jpg', available: true, includedIn: ['luxury-access'] },
}

export function quoteCheckout(planId, selected = []) {
  const plan = typeof planId === 'string' && Object.hasOwn(PLANS, planId) ? PLANS[planId] : null
  if (!plan || !Array.isArray(selected) || selected.length > Object.keys(ORDER_BUMPS).length || new Set(selected).size !== selected.length) throw new Error('Confira o plano e os adicionais do pedido.')
  const addons = [...selected].sort().map((id) => {
    const item = typeof id === 'string' && Object.hasOwn(ORDER_BUMPS, id) ? ORDER_BUMPS[id] : null
    if (!item || !item.available || plan.purpose || item.includedIn?.includes(planId)) throw new Error('Adicional indisponível para este plano.')
    return item
  })
  const totalCents = toCents(plan.price) + addons.reduce((sum, item) => sum + toCents(item.price), 0)
  return { addons, addonIds: addons.map((item) => item.id), totalCents, amount: totalCents / 100 }
}

// Parâmetros de campanha levados do anúncio até o pedido (atribuição de venda).
export const CAMPAIGN_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'src',
  'sck',
]

export function pickCampaignParams(source) {
  const params =
    source instanceof URLSearchParams
      ? Object.fromEntries(source)
      : (source ?? {})
  const picked = {}
  for (const key of CAMPAIGN_PARAMS) {
    if (typeof params[key] === 'string' && params[key])
      picked[key] = params[key].slice(0, 200)
  }
  return picked
}

export const onlyDigits = (value = '') => String(value).replace(/\D/g, '')

export const isValidEmail = (value = '') =>
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value).trim())

// Devolve { campo: mensagem } com os erros dos dados do comprador (vazio = tudo certo).
// O checkout pede só como a pessoa quer ser chamada e o e-mail da conta.
export function validateCustomer(customer = {}) {
  const errors = {}
  const name = String(customer.name ?? '').trim()
  if (name.length < 2) errors.name = 'Diga como você quer ser chamado.'
  else if (name.length > 60) errors.name = 'Use até 60 caracteres.'
  if (!isValidEmail(customer.email)) errors.email = 'Informe um e-mail válido.'
  return errors
}
