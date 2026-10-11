// Guarda o status de cada cobrança entre o webhook do gateway e a tela do PIX.
// As funções da Vercel não compartilham memória: em produção usamos Supabase ou Redis.
// Fora da Vercel (npm run dev), usa um Map em memória: o servidor local é um processo só.

const TTL_SECONDS = 90 * 24 * 60 * 60
const memory = (globalThis.__piskouMemoryStore ??= new Map())

function supabaseConfig() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  return url && key ? { url, key } : null
}

async function supabase(path, options = {}) {
  const { url, key } = supabaseConfig()
  const headers = { apikey: key, 'Content-Type': 'application/json' }
  // As chaves novas sb_secret_ usam apikey; service_role legado também é um JWT.
  if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`
  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...options,
    headers,
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) throw new Error(`Supabase: HTTP ${response.status}`)
  if (response.status === 204) return null
  return response.json()
}

function redisConfig() {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
  return url && token ? { url, token } : null
}

// API REST do Upstash: POST com o comando em JSON, ex.: ["SET", "chave", "valor", "EX", "60"].
async function redis(command) {
  const { url, token } = redisConfig()
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(5000),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.error) throw new Error(`Redis: ${data.error ?? `HTTP ${response.status}`}`)
  return data.result
}

// Na Vercel um banco é obrigatório; localmente a memória basta.
export function missingStoreConfig() {
  return process.env.VERCEL && !supabaseConfig() && !redisConfig()
    ? ['SUPABASE_URL', 'SUPABASE_SECRET_KEY (ou SUPABASE_SERVICE_ROLE_KEY)']
    : []
}

function requireProductionStore() {
  if (missingStoreConfig().length) throw new Error('Banco de pagamentos não configurado.')
}

export const store = {
  async get(key) {
    requireProductionStore()
    if (supabaseConfig()) {
      const query = new URLSearchParams({
        key: `eq.${key}`,
        expires_at: `gt.${new Date().toISOString()}`,
        select: 'value',
        limit: '1',
      })
      const rows = await supabase(`piskou_payment_store?${query}`)
      return rows[0]?.value ?? null
    }
    if (!redisConfig()) {
      const entry = memory.get(key)
      if (!entry || entry.expiresAt < Date.now()) return null
      return entry.value
    }
    const raw = await redis(['GET', key])
    return raw ? JSON.parse(raw) : null
  },

  async set(key, value) {
    requireProductionStore()
    if (supabaseConfig()) {
      await supabase('rpc/piskou_store_set', {
        method: 'POST',
        body: JSON.stringify({ p_key: key, p_value: value }),
      })
      return
    }
    if (!redisConfig()) {
      memory.set(key, { value, expiresAt: Date.now() + TTL_SECONDS * 1000 })
      return
    }
    await redis(['SET', key, JSON.stringify(value), 'EX', String(TTL_SECONDS)])
  },
}

export const chargeKey = (id) => `charge:${id}`
