const bucket = 'chat-audio'
export async function audioStorage(
  path,
  { method = 'GET', body, contentType = 'application/json' } = {},
  fetcher = fetch,
) {
  const key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  const headers = {
    apikey: key,
    'Content-Type': contentType,
    ...(body instanceof Uint8Array ? { 'x-upsert': 'true' } : {}),
  }
  if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`
  const response = await fetcher(
    `${process.env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/${path}`,
    {
      method,
      headers,
      body:
        body instanceof Uint8Array
          ? body
          : body === undefined
            ? undefined
            : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    },
  )
  if (!response.ok) throw new Error('Não foi possível acessar o áudio.')
  return response.status === 204 ? null : response.json()
}
export const audioObjectPath = (key) =>
  `object/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`
export async function eraseAudio(key) {
  await audioStorage(`object/${bucket}`, {
    method: 'DELETE',
    body: { prefixes: [key] },
  })
}
export async function audioURL(key) {
  const result = await audioStorage(
    `object/sign/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`,
    { method: 'POST', body: { expiresIn: 60 } },
  )
  return (
    process.env.SUPABASE_URL.replace(/\/$/, '') +
    '/storage/v1/' +
    result.signedURL.replace(/^\//, '')
  )
}
