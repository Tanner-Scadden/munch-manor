// The 3D spike's dev server: the audit harness's page with the PixiJS 3D
// renderer over its world window. Dev only, never built into the game.
// node_modules/.bin/vite tools/spike3d --port 4190
import { defineConfig } from 'vite'

import tailwindcss from '@tailwindcss/vite'

import { spriteAtlas } from '../sprites/vitePlugin.ts'
import { foldkitBrandingViews } from '../vite/viewIdentity.ts'

const GAME = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')

export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  publicDir: `${GAME}/public`,
  plugins: [tailwindcss(), ...foldkitBrandingViews(), spriteAtlas()],
  define: {
    __BUILD_ID__: JSON.stringify('dev'),
    'import.meta.env.VITE_COOP': JSON.stringify('On'),
  },
  resolve: { alias: { '@game': `${GAME}/src` } },
  server: { fs: { allow: [GAME] } },
  optimizeDeps: {
    entries: ['entry.ts'],
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
  worker: { format: 'es' },
})
