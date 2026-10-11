// Compartilhado entre o site e as rotas /api. Os preços saem só daqui: o paywall mostra estes valores
// e o servidor cobra estes valores, ignorando qualquer preço que venha do navegador.

export const PLANS = {
  'messages-120': {
    id: 'messages-120',
    tier: 'premium',
    name: 'Mais 120 mensagens',
    price: 9.90,
    bonusCount: 0,
    purpose: 'messages',
    messageCount: 120,
  },
  'messages-six': {
    id: 'messages-six',
    tier: 'premium',
    name: 'Mais 6 mensagens',
    price: 9.90,
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
    name: 'Premium',
    price: 9.90,
    bonusCount: 0,
  },
  'luxury-access': {
    id: 'luxury-access',
    tier: 'luxury',
    name: 'Luxo',
    price: 19.90,
    bonusCount: 8,
  },
}

// sessionStorage: o paywall guarda a personagem aqui e o checkout lê para mostrar no resumo.
export const SELECTION_STORAGE_KEY = 'piskou:selection'

export const formatBRL = (value) => `R$ ${value.toFixed(2).replace('.', ',')}`
export const toCents = (value) => Math.round(value * 100)

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
