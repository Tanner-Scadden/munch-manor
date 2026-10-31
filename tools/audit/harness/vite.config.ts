import { Schema } from 'effect'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

import tailwindcss from '@tailwindcss/vite'

import { encodeJson } from '../../json.ts'
import { spriteAtlas } from '../../sprites/vitePlugin.ts'
import { foldkitBrandingViews } from '../../vite/viewIdentity.ts'

const GAME = resolve(__dirname, '../../..')
const encodeString = encodeJson(Schema.String)

const isProfile = (process.env['PROFILE'] ?? '') !== ''

export default defineConfig({
  root: __dirname,
  publicDir: `${GAME}/public`,
  plugins: [tailwindcss(), ...foldkitBrandingViews(), spriteAtlas()],
  define: {
    __BUILD_ID__: encodeString('dev'),
    'import.meta.env.VITE_COOP': encodeString('On'),
  },
  resolve: { alias: { '@game': `${GAME}/src` } },
  server: { fs: { allow: [GAME, __dirname] } },
  optimizeDeps: {
    entries: ['entry.ts'],
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
  worker: { format: 'es' },
  build: {
    outDir: isProfile ? `${__dirname}/dist-profile` : `${__dirname}/dist`,
    emptyOutDir: true,
    minify: !isProfile,
  },
})
