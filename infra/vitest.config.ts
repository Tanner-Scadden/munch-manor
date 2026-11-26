import { String } from 'effect'
import { type Plugin, defineConfig } from 'vitest/config'

const INFRA = import.meta.dirname

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

export default defineConfig({
  plugins: [oneEffect],
  test: {
    include: ['worker/**/*.test.ts'],
  },
})
