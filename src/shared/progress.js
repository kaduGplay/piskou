const PROGRESS_KEY = 'piskou:progress'
const SELECTION_KEY = 'piskou:selection'
const MAX_AGE = 90 * 86400000
export function readProgress() {
  try {
    const data = JSON.parse(localStorage.getItem(PROGRESS_KEY) || 'null')
    return data && Date.now() - data.updatedAt < MAX_AGE ? data : {}
  } catch {
    return {}
  }
}
export function saveProgress(patch) {
  try {
    localStorage.setItem(
      PROGRESS_KEY,
      JSON.stringify({ ...readProgress(), ...patch, updatedAt: Date.now() }),
    )
  } catch {
    /* private browsing/storage full */
  }
}
export function readSavedSelection() {
  try {
    const saved =
      localStorage.getItem(SELECTION_KEY) ||
      sessionStorage.getItem(SELECTION_KEY)
    const selection = JSON.parse(saved || 'null')
    if (selection && typeof selection === 'object' && !Array.isArray(selection))
      return selection
  } catch {
    /* storage unavailable */
  }
  return {}
}
export function saveSelection(selection) {
  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      window[name].setItem(SELECTION_KEY, JSON.stringify(selection))
    } catch {
      /* storage unavailable */
    }
  }
}
export function resumeVisit() {
  const { pathname, search } = window.location
  const params = new URLSearchParams(search)
  if (pathname === '/admin' || params.has('dev')) return
  saveSelection(readSavedSelection())
  const previous = readProgress()
  if (
    pathname === '/' &&
    !params.has('edit') &&
    ['/chat', '/checkout'].includes(previous.path)
  ) {
    window.history.replaceState(
      null,
      '',
      previous.path +
        (search ||
          (typeof previous.search === 'string' &&
          previous.search.startsWith('?')
            ? previous.search
            : '')),
    )
  }
  if (['/', '/chat', '/checkout'].includes(window.location.pathname)) {
    const query = new URLSearchParams(window.location.search)
    query.delete('edit')
    saveProgress({
      path: window.location.pathname,
      search: query.size ? '?' + query.toString() : '',
    })
  }
}
