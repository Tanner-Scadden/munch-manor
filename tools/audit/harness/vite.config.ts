import { Config, Effect, Path, Schema } from 'effect'
import { defineConfig } from 'vite'

import tailwindcss from '@tailwindcss/vite'

import { encodeJson } from '../../json.ts'
import { spriteAtlas } from '../../sprites/vitePlugin.ts'

const encodeString = encodeJson(Schema.String)

const settings = Effect.runSync(
  Effect.gen(function* () {
    const path = yield* Path.Path
    const profile = yield* Config.String('PROFILE').pipe(Config.withDefault(''))
    return {
      game: path.resolve(import.meta.dirname, '../../..'),
      isProfile: profile !== '',
    }
  }).pipe(Effect.provide(Path.layer)),
)
const GAME = settings.game
const isProfile = settings.isProfile

export default defineConfig({
  root: import.meta.dirname,
  publicDir: `${GAME}/public`,
  plugins: [tailwindcss(), spriteAtlas()],
  define: {
    __BUILD_ID__: encodeString('dev'),
    'import.meta.env.VITE_COOP': encodeString('On'),
  },
  resolve: { alias: { '@game': `${GAME}/src` } },
  server: { fs: { allow: [GAME, import.meta.dirname] } },
  optimizeDeps: {
    entries: ['entry.ts'],
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
  worker: { format: 'es' },
  build: {
    outDir: isProfile
      ? `${import.meta.dirname}/dist-profile`
      : `${import.meta.dirname}/dist`,
    emptyOutDir: true,
    minify: !isProfile,
  },
})
