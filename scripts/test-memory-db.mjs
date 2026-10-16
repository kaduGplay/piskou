// Install a fixed temporary PGlite and pass its dist/index.js via PGLITE_MODULE.
import { readFile, readdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
if (!process.env.PGLITE_MODULE)
  throw new Error(
    'Set PGLITE_MODULE to a temporary @electric-sql/pglite@0.5.8 dist/index.js',
  )
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href)
const db = new PGlite()
try {
  await db.exec(
    'create role anon; create role authenticated; create role service_role bypassrls;',
  )
  const names = (await readdir('supabase/migrations'))
    .filter((n) => n.endsWith('.sql'))
    .sort()
  for (const name of names)
    await db.exec(await readFile('supabase/migrations/' + name, 'utf8'))
  console.log('PASS all migrations on isolated local PostgreSQL')
  for (const name of [
    'checkout-addons',
    'upsells',
    'operational-status',
    'message-package-120',
    'free-chat-funnel',
    'character-memory',
    'character-preferences',
    'conversation-order',
    'chat-continuity',
    'continuity-security',
    'continuity-memory-audio',
  ]) {
    await db.exec(await readFile('tests/sql/' + name + '.sql', 'utf8'))
    console.log('PASS SQL', name)
  }
} catch (error) {
  console.error(error.message, error.internalQuery || '', error.where || '')
  process.exitCode = 1
} finally {
  await db.close()
}
