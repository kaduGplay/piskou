import { timingSafeEqual } from 'node:crypto'
import { chatSignature, chatDatabase } from './chat.js'
const cookieValue = (req, name) => String(req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(name + '='))?.slice(name.length + 1)
const validSignature = (value, signature) => /^[a-f0-9]{64}$/.test(signature || '') && timingSafeEqual(Buffer.from(signature), Buffer.from(chatSignature(value)))
export function ownedConversations(req) {
  let ids = []
  const [payload, signature] = (cookieValue(req, 'piskou_conversations') || '').split('.')
  if (payload && validSignature('conversations:' + payload, signature)) {
    try { ids = JSON.parse(Buffer.from(payload, 'base64url').toString()) } catch { /* Invalid cookie. */ }
  }
  if (!Array.isArray(ids)) ids = []
  const [id, sig] = (cookieValue(req, 'piskou_access') || cookieValue(req, 'piskou_chat') || '').split('.')
  if (/^[a-f0-9-]{36}$/.test(id || '') && validSignature(id, sig)) ids.push(id)
  return [...new Set(ids.filter((value) => /^[a-f0-9-]{36}$/.test(value)))].slice(-40)
}
export function rememberConversations(req, res, ids) {
  const payload = Buffer.from(JSON.stringify([...new Set(ids)].slice(-40))).toString('base64url')
  const value = `piskou_conversations=${payload}.${chatSignature('conversations:' + payload)}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=7776000${process.env.VERCEL ? '; Secure' : ''}`
  const existing = res.getHeader?.('Set-Cookie')
  res.setHeader('Set-Cookie', existing ? [...(Array.isArray(existing) ? existing : [existing]), value] : value)
}
export function activateConversation(req, res, id) {
  res.setHeader('Set-Cookie', `piskou_access=${id}.${chatSignature(id)}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=7776000${process.env.VERCEL ? '; Secure' : ''}`)
  rememberConversations(req, res, [...ownedConversations(req), id])
}
export async function hasCharacterPlan(req, db = chatDatabase) {
  const ids = ownedConversations(req)
  if (!ids.length) return false
  const purchases = await db(`piskou_chat_purchases?chat_id=in.(${ids.join(',')})&active=eq.true&plan_id=in.(premium-access,luxury-access)&select=chat_id&limit=1`)
  return purchases.length > 0
}
// Order bumps pagos (ex.: 'voice-call') valem para todas as conversas deste navegador.
export async function ownedAddons(req, db = chatDatabase) {
  const ids = ownedConversations(req)
  if (!ids.length) return []
  const purchases = await db(`piskou_chat_purchases?chat_id=in.(${ids.join(',')})&active=eq.true&select=addons`)
  return [...new Set(purchases.flatMap((item) => item.addons ?? []))].sort()
}
export async function canCreateCharacter(req, db = chatDatabase) {
  const ids = ownedConversations(req)
  if (!ids.length) return false
  const purchases = await db(`piskou_chat_purchases?chat_id=in.(${ids.join(',')})&active=eq.true&plan_id=in.(premium-access,luxury-access)&select=chat_id,character_slots`)
  const slots = Math.min(40, purchases.reduce((sum, item) => sum + (item.character_slots ?? 40), 0))
  return ids.length < slots
}
