import { Array, Option, Record, String } from 'effect'
import { type Plugin, type Rollup, defineConfig } from 'vite'

import tailwindcss from '@tailwindcss/vite'

import { spriteAtlas } from './tools/sprites/vitePlugin.ts'
import { buildId, serviceWorker } from './tools/vite/buildPlugins.ts'
import { studioNotes } from './tools/vite/studioNotes.ts'
import { foldkitBrandingViews } from './tools/vite/viewIdentity.ts'

const BUILT_STYLESHEET =
  /<link rel="stylesheet" crossorigin href="([^"]+\.css)">/

// NOTE: the built stylesheet would block the first paint, splash included,
// until it downloads. Preloading it instead lets the inline splash in
// index.html paint at once. The game waits for it before the splash goes:
// see LoadStyles in src/app/main.ts.
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

// NOTE: src/platform/early.ts starts the SQLite worker before the game's modules run
// (see src/platform/storeEarly.ts). Bundled into the game's entry, it would wait for
// the whole bundle to download, and the worker would not start until the
// bundle finished its first long task. So the build emits it as its own small
// entry, and the page loads it ahead of the game's.
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

export default defineConfig({
  base: './',
  plugins: [
    tailwindcss(),
    ...foldkitBrandingViews(),
    buildId(),
    loadStylesBehindSplash(),
    earlyEntry(),
    spriteAtlas(),
    serviceWorker(),
    studioNotes(),
  ],
  // NOTE: sqlite-wasm finds sqlite3.wasm next to its own module with
  // `new URL(..., import.meta.url)`. Pre-bundling would move the module and
  // break that, so it is left out. The SQLite worker is an ES module worker,
  // since it shares chunks with the game.
  optimizeDeps: {
    entries: ['src/app/entry.ts'],
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
  worker: {
    format: 'es',
  },
})
