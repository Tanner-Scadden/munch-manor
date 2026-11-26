import { Array, Option, Record, String } from 'effect'
import { fileURLToPath } from 'node:url'
import { type Plugin, type Rollup, defineConfig } from 'vite'

import tailwindcss from '@tailwindcss/vite'

import { spriteAtlas } from './tools/sprites/vitePlugin.ts'
import { buildId, serviceWorker } from './tools/vite/buildPlugins.ts'
import { studioNotes } from './tools/vite/studioNotes.ts'

const BUILT_STYLESHEET =
  /<link rel="stylesheet" crossorigin href="([^"]+\.css)">/

const loadStylesBehindSplash = (): Plugin => ({
  name: 'load-styles-behind-splash',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler: html =>
      String.replace(
        BUILT_STYLESHEET,
        `<link id="game-styles" rel="preload" as="style" crossorigin href="$1" onload="this.rel='stylesheet'">`,
      )(html),
  },
})

const EARLY_ENTRY = 'src/platform/early.ts'

const earlyEntry = (): Plugin => ({
  name: 'munch-manor:early-entry',
  buildStart() {
    if (this.environment.mode === 'build') {
      this.emitFile({ type: 'chunk', id: EARLY_ENTRY, name: 'early' })
    }
  },
  transformIndexHtml: {
    order: 'post',
    handler: (_html, { bundle }) => {
      const maybeChunk = Option.getOrUndefined(
        Array.findFirst(
          Record.values<string, Rollup.OutputAsset | Rollup.OutputChunk>(
            bundle ?? {},
          ),
          output =>
            output.type === 'chunk' &&
            output.facadeModuleId !== null &&
            String.endsWith(EARLY_ENTRY)(output.facadeModuleId),
        ),
      )
      return [
        {
          tag: 'script',
          attrs: {
            type: 'module',
            crossorigin: true,
            src:
              maybeChunk === undefined
                ? `/${EARLY_ENTRY}`
                : `./${maybeChunk.fileName}`,
          },
          injectTo: 'head-prepend',
        },
      ]
    },
  },
})

const GAME_SOURCE = fileURLToPath(new URL('./src', import.meta.url))

export default defineConfig({
  base: './',
  resolve: { alias: { '@game': GAME_SOURCE } },
  plugins: [
    tailwindcss(),
    buildId(),
    loadStylesBehindSplash(),
    earlyEntry(),
    spriteAtlas(),
    serviceWorker(),
    studioNotes(),
  ],
  optimizeDeps: {
    entries: ['src/app/entry.ts'],
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
  worker: {
    format: 'es',
  },
})
