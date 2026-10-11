import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
export function equalSecret(a, b) {
  return timingSafeEqual(
    createHash('sha256').update(String(a)).digest(),
    createHash('sha256').update(String(b)).digest(),
  )
}
function sign(value) {
  return createHmac('sha256', process.env.CHAT_SESSION_SECRET)
    .update(`admin:${process.env.ADMIN_PASSWORD}:${value}`)
    .digest('hex')
}
export function adminToken(now = Date.now()) {
  const expiry = String(now + 8 * 60 * 60_000)
  return `${expiry}.${sign(expiry)}`
}
export function authorized(req, now = Date.now()) {
  if (!process.env.ADMIN_PASSWORD || !process.env.CHAT_SESSION_SECRET)
    return false
  const token =
    String(req.headers.cookie || '')
      .split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith('piskou_admin='))
      ?.slice(13) || ''
  const [expiry, signature] = token.split('.')
  return (
    /^\d{13}$/.test(expiry || '') &&
    Number(expiry) > now &&
    Number(expiry) <= now + 8 * 60 * 60_000 &&
    equalSecret(signature || '', sign(expiry))
  )
}
export function adminCookie(res, token, logout = false) {
  res.setHeader(
    'Set-Cookie',
    `piskou_admin=${token}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${logout ? 0 : 28800}${process.env.VERCEL ? '; Secure' : ''}`,
  )
}
