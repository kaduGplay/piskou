import { chatDatabase } from './chat.js'
import {
  buildCharacterPreferences,
  preferenceConfiguration,
} from './character-tastes.js'
export { buildCharacterPreferences } from './character-tastes.js'
export async function loadCharacterPreferences(session, selection) {
  const generated = buildCharacterPreferences(selection)
  const result = await chatDatabase('rpc/piskou_character_preferences', {
    p_id: session,
    p_selection: selection,
    p_configuration: preferenceConfiguration(selection),
    p_preferences: generated,
  })
  if (!result?.preferences) throw new Error('Character preferences unavailable')
  return result.preferences
}
