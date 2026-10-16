import { useSyncExternalStore } from 'react'

// Vídeos do criador só tocam com a aba visível, sem "reduzir movimento" e fora de conexões lentas ou de economia de dados.
const listeners = new Set()
let unsubscribe = null
const connection = () => (typeof navigator === 'undefined' ? undefined : navigator.connection)
const reducedMotion = () => (typeof window === 'undefined' ? null : window.matchMedia('(prefers-reduced-motion: reduce)'))

function playbackMode() {
  if (typeof document === 'undefined') return 'hidden'
  if (reducedMotion()?.matches) return 'reduced'
  if (connection()?.saveData || ['slow-2g', '2g'].includes(connection()?.effectiveType)) return 'limited'
  return document.hidden ? 'hidden' : 'play'
}

function subscribe(listener) {
  listeners.add(listener)
  if (!unsubscribe) {
    const motion = reducedMotion()
    const network = connection()
    const notify = () => listeners.forEach((fn) => fn())
    document.addEventListener('visibilitychange', notify)
    motion?.addEventListener('change', notify)
    network?.addEventListener('change', notify)
    unsubscribe = () => {
      document.removeEventListener('visibilitychange', notify)
      motion?.removeEventListener('change', notify)
      network?.removeEventListener('change', notify)
    }
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      unsubscribe?.()
      unsubscribe = null
    }
  }
}

export const usePlaybackMode = () => useSyncExternalStore(subscribe, playbackMode, () => 'hidden')
export const useCanPlayVideo = () => usePlaybackMode() === 'play'
