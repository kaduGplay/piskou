import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Em produção a Vercel serve as funções de api/. Localmente este plugin faz o mesmo, lendo as chaves
// do .env.local, com o gateway em modo de teste se PAYMENT_GATEWAY não estiver definido.
function localApi() {
  const mount = (middlewares, load, mode) => {
    // O Vite reinicia no mesmo processo quando um .env muda. Remove o que foi injetado na carga anterior,
    // senão o valor antigo (inclusive o 'mock' padrão) teria prioridade sobre o arquivo novo.
    const injected = (globalThis.__localApiInjectedEnv ??= new Set())
    for (const key of injected) delete process.env[key]
    injected.clear()
    for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ''))) {
      if (key in process.env) continue
      process.env[key] = value
      injected.add(key)
    }
    if (!process.env.PAYMENT_GATEWAY) {
      process.env.PAYMENT_GATEWAY = 'mock'
      injected.add('PAYMENT_GATEWAY')
    }
    middlewares.use('/api', async (req, res, next) => {
      const url = new URL(req.url, 'http://localhost')
      const name = url.pathname.replace(/^\/+|\/+$/g, '')
      if (!/^[a-z-]+$/.test(name)) return next()

      let handler
      try {
        handler = (await load(name)).default
      } catch {
        return next()
      }

      const chunks = []
      try {
        for await (const chunk of req) chunks.push(chunk)
      } catch {
        // Fechar a aba durante uma resposta de IA não deve encerrar o servidor local.
        return
      }
      const raw = Buffer.concat(chunks).toString()
      try {
        req.body = raw ? JSON.parse(raw) : undefined
      } catch {
        req.body = undefined
      }
      req.query = Object.fromEntries(url.searchParams)
      res.status = (code) => {
        res.statusCode = code
        return res
      }
      res.json = (data) => {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(data))
      }

      try {
        await handler(req, res)
      } catch (error) {
        console.error(error)
        res.statusCode = 500
        res.end()
      }
    })
  }

  return {
    name: 'local-api',
    configureServer(server) {
      mount(server.middlewares, (name) => server.ssrLoadModule(`/api/${name}.js`), server.config.mode)
    },
    configurePreviewServer(server) {
      mount(server.middlewares, (name) => import(pathToFileURL(resolve('api', `${name}.js`)).href), server.config.mode)
    },
  }
}

export default defineConfig({
  plugins: [react(), localApi()],
  // O chunk da animação (three.js) passa de 500 kB por natureza; ele só carrega na etapa final do funil.
  build: { chunkSizeWarningLimit: 600 },
})
