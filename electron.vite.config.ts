import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const alias = {
  '@shared': resolve(__dirname, 'shared'),
  '@': resolve(__dirname, 'src')
}

/**
 * Injeta a Content Security Policy no index.html.
 * Em desenvolvimento o Vite precisa de script inline (React Refresh) e WebSocket (HMR);
 * no build de produção a política é estrita.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'sc-csp',
    transformIndexHtml(html, ctx) {
      const dev = Boolean(ctx.server)
      const policy = [
        "default-src 'self'",
        dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: sc-media:",
        "font-src 'self' data:",
        dev ? "connect-src 'self' ws://localhost:* http://localhost:*" : "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'"
      ].join('; ')
      return html.replace(
        '<!-- CSP -->',
        `<meta http-equiv="Content-Security-Policy" content="${policy}" />`
      )
    }
  }
}

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      outDir: 'out/main',
      rollupOptions: { input: { index: resolve(__dirname, 'electron/main/index.ts') } }
    }
  },
  preload: {
    resolve: { alias },
    build: {
      outDir: 'out/preload',
      // Preload em sandbox: tudo deve ficar em um único arquivo CommonJS.
      externalizeDeps: false,
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].js' }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src'),
    resolve: { alias },
    plugins: [react(), tailwindcss(), contentSecurityPolicy()],
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      rollupOptions: { input: resolve(__dirname, 'src/index.html') }
    }
  }
})
