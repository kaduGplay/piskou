// Guarda o status de cada cobrança entre o webhook do gateway e a tela do PIX.
// As funções da Vercel não compartilham memória, então em produção isso vive no Upstash Redis
// (Vercel → Storage/Marketplace → Upstash Redis, que cria KV_REST_API_URL e KV_REST_API_TOKEN).
// Fora da Vercel (npm run dev), usa um Map em memória: o servidor local é um processo só.

const TTL_SECONDS = 2 * 24 * 60 * 60
const memory = (globalThis.__piskouMemoryStore ??= new Map())

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

// Na Vercel o Redis é obrigatório; localmente a memória basta.
export function missingStoreConfig() {
  return process.env.VERCEL && !redisConfig() ? ['KV_REST_API_URL', 'KV_REST_API_TOKEN'] : []
}

export const store = {
  async get(key) {
    if (!redisConfig()) {
      const entry = memory.get(key)
      if (!entry || entry.expiresAt < Date.now()) return null
      return entry.value
    }
    const raw = await redis(['GET', key])
    return raw ? JSON.parse(raw) : null
  },

  async set(key, value) {
    if (!redisConfig()) {
      memory.set(key, { value, expiresAt: Date.now() + TTL_SECONDS * 1000 })
      return
    }
    await redis(['SET', key, JSON.stringify(value), 'EX', String(TTL_SECONDS)])
  },
}

export const chargeKey = (id) => `charge:${id}`
