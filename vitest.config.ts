import { Schema } from 'effect'
import { defineConfig } from 'vitest/config'

import { encodeJson } from './tools/json.ts'
import { TimedSequencer } from './tools/vite/testSequencer.ts'

const SIM = '**/*.sim.test.ts'
const SCENE = 'src/**/{*.,}scene.test.ts'
const DOM = 'src/**/*.dom.test.ts'
const ATLAS_HTML = 'src/art/__tests__/atlasHtml.scene.test.ts'

export default defineConfig({
  define: { __BUILD_ID__: encodeJson(Schema.String)('test') },
  test: {
    testTimeout: 30_000,
    setupFiles: ['./src/test/vitest-setup.ts'],
    env: { VITE_COOP: 'On' },
    isolate: false,
    sequence: { sequencer: TimedSequencer },
    css: {
      include: [
        /(menu|profile|shop|styles|coop|calling|closet|lobby|proof|journal|mastery)\.css/,
      ],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'game',
          environment: 'node',
          include: [
            'src/**/*.test.ts',
            'tools/heavy/**/*.test.ts',
            'tools/sprites/**/*.test.ts',
            'tools/vite/**/*.test.ts',
            'tools/balance/**/*.test.ts',
            'tools/determinism/**/*.test.ts',
            'tools/learn/**/*.test.ts',
            'tools/lint/**/*.test.ts',
            'tools/studio/**/*.test.ts',
          ],
          exclude: [SCENE, DOM, SIM],
        },
      },
      {
        extends: true,
        test: {
          name: 'page',
          environment: 'happy-dom',
          include: [SCENE, DOM],
          exclude: [SIM, ATLAS_HTML],
        },
      },
      {
        extends: true,
        test: {
          name: 'atlas',
          environment: 'happy-dom',
          include: [ATLAS_HTML],
          isolate: true,
          setupFiles: [
            './src/test/vitest-setup.ts',
            './src/test/atlasHtml.setup.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'sim',
          environment: 'node',
          include: [`src/${SIM}`, `tools/${SIM}`],
        },
      },
      'packages/*',
    ],
  },
})
