import test from 'node:test'
import assert from 'node:assert/strict'
import {
  readProgress,
  saveProgress,
  readSavedSelection,
  resumeVisit,
} from '../src/shared/progress.js'
const storage = () => {
  const values = new Map()
  return {
    getItem: (k) => values.get(k) || null,
    setItem: (k, v) => values.set(k, v),
  }
}
function setup(path = '/', search = '') {
  globalThis.localStorage = storage()
  globalThis.sessionStorage = storage()
  globalThis.window = {
    localStorage,
    sessionStorage,
    location: { pathname: path, search },
    history: {
      replaceState: (_, __, url) => {
        const u = new URL(url, 'https://example.test')
        window.location.pathname = u.pathname
        window.location.search = u.search
      },
    },
  }
}
test('restores a known route, migrates selection and keeps a new campaign query', () => {
  setup('/', '?utm_source=return')
  sessionStorage.setItem('piskou:selection', JSON.stringify({ name: 'Clara' }))
  saveProgress({ path: '/chat', step: 5 })
  resumeVisit()
  assert.equal(window.location.pathname, '/chat')
  assert.equal(window.location.search, '?utm_source=return')
  sessionStorage = storage()
  assert.equal(readSavedSelection().name, 'Clara')
})
test('edit/admin routes are accessible, unsafe and expired routes are ignored', () => {
  setup('/', '?edit=1')
  saveProgress({ path: '/chat' })
  resumeVisit()
  assert.equal(window.location.pathname, '/')
  setup('/admin')
  saveProgress({ path: '/chat' })
  resumeVisit()
  assert.equal(readProgress().path, '/chat')
  setup()
  saveProgress({ path: 'https://evil.test' })
  resumeVisit()
  assert.equal(window.location.pathname, '/')
  setup()
  localStorage.setItem(
    'piskou:progress',
    JSON.stringify({ path: '/chat', updatedAt: 0 }),
  )
  resumeVisit()
  assert.equal(window.location.pathname, '/')
})
test('storage restrictions do not prevent opening the site', () => {
  setup()
  localStorage.getItem = () => {
    throw new Error('blocked')
  }
  localStorage.setItem = () => {
    throw new Error('blocked')
  }
  assert.doesNotThrow(() => resumeVisit())
})
