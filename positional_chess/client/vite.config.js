import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createReadStream, copyFileSync, mkdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const clientDir = fileURLToPath(new URL('.', import.meta.url))
const stockfishDir = resolve(clientDir, '../../engines/stockfish19')
const stockfishFiles = new Map([
  ['stockfish-19-lite-single.js', 'text/javascript; charset=utf-8'],
  ['stockfish.wasm', 'application/wasm'],
])

function useMainSiteStockfish() {
  return {
    name: 'use-main-site-stockfish-19',
    configureServer(server) {
      server.middlewares.use('/engines/stockfish19', (req, res, next) => {
        const name = decodeURIComponent((req.url || '/').split('?')[0].slice(1))
        const contentType = stockfishFiles.get(name)
        if (!contentType) return next()

        const file = resolve(stockfishDir, name)
        try {
          if (!statSync(file).isFile()) return next()
        } catch {
          return next()
        }

        res.setHeader('Content-Type', contentType)
        createReadStream(file).pipe(res)
      })
    },
    closeBundle() {
      const outputDir = resolve(clientDir, 'dist/engines/stockfish19')
      mkdirSync(outputDir, { recursive: true })
      for (const name of stockfishFiles.keys()) {
        copyFileSync(resolve(stockfishDir, name), resolve(outputDir, name))
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), useMainSiteStockfish()],
})
