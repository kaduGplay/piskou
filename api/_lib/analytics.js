export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function sameOrigin(req) {
  const expected = process.env.VERCEL
    ? process.env.SITE_URL
    : `http://${req.headers.host}`
  try {
    return req.headers.origin === new URL(expected).origin
  } catch {
    return false
  }
}
