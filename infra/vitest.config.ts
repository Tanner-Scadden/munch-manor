import { String } from 'effect'
import { type Plugin, defineConfig } from 'vitest/config'

const INFRA = import.meta.dirname

// NOTE: src/platform/analytics.ts, src/shared/playerData.ts, src/platform/playerScope.ts, the sync
// engine in packages/sync-engine, and the netcode in packages/netcode are
// shared with the game, so their `effect` imports would resolve from the
// game's own node_modules, an older Effect, and two Effects would meet in
// one Schema. This plugin resolves an `effect` import (and subpaths such as
// `effect/sql`) from outside infra as if infra made it, as the Worker
// bundle's alias in alchemy.run.ts and the `paths` in tsconfig.json do.
const oneEffect: Plugin = {
  name: 'one-effect',
  enforce: 'pre',
  resolveId(source, importer) {
    if (
      importer === undefined ||
      String.startsWith(INFRA)(importer) ||
      !/^effect(\/|$)/.test(source)
    ) {
      return null
    }
    return this.resolve(source, `${INFRA}/vitest.config.ts`, {
      skipSelf: true,
    })
  },
}

// NOTE: the tests run under Bun (`bun --bun vitest run`), since the
// in-memory database is @effect/sql-sqlite-bun on bun:sqlite.
export default defineConfig({
  plugins: [oneEffect],
  test: {
    include: ['worker/**/*.test.ts'],
    // NOTE: foldkit's Schema helpers (foldkit/schema, which the World's
    // Schemas use) go through the plugin too, so they build on infra's
    // Effect like the Schemas they wrap.
    server: { deps: { inline: [/foldkit/] } },
  },
})
