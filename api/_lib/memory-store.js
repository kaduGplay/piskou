import { chatDatabase } from './chat.js'
import { emptyMemory } from './memory.js'
export async function loadMemory(session) {
  const rows = await chatDatabase(
    `piskou_character_memory?chat_id=eq.${session}&select=state`,
  )
  return rows[0]?.state || emptyMemory()
}
export async function saveMemory(session, previous, next) {
  if (!previous.enabled || !next?.enabled) return false
  return chatDatabase('rpc/piskou_memory_commit', {
    p_id: session,
    p_revision: previous.revision,
    p_state: next,
  })
}
