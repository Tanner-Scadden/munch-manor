import { Schema } from 'effect'
import { defineConfig } from 'vitest/config'

import { encodeJson } from './tools/json.ts'

// The test tiers (docs/TESTING_PLAN.md). Each project is one tier or one
// kind of file:
// - `game`: Story and unit tests, in plain Node. A file that needs a page
//   (it builds elements, dispatches window events, or uses localStorage)
//   says so with `// @vitest-environment happy-dom` on its first line.
// - `page`: Scene tests, `scene.test.ts` and `*.scene.test.ts`, in happy-dom.
// - `atlas`: sprites in HTML with a stand-in atlas (src/atlasHtml.setup.ts).
// - `sim`: whole-wave replays, seed sweeps, and the balance smoke pass,
//   `*.sim.test.ts`. Only `bun run test:full` (and CI) runs them.
// - the two packages, each with its own config.
// `bun run test` runs every project but `sim`.
//
// NOTE: files share a worker's modules (`isolate: false`), so the game is
// imported once per worker instead of once per file. A test that changes a
// global (a spy, a timer, localStorage) must put it back in `afterEach`. The
// nightly run shuffles the file order to catch a test that leaks.
const SIM = '**/*.sim.test.ts'
const SCENE = 'src/**/{*.,}scene.test.ts'
// NOTE: HTML that shows sprites, checked with every sprite in a stand-in
// atlas, as a production build draws them. Its own project, isolated, since
// the atlas must be set before any module loads and no other file may see it.
const ATLAS_HTML = 'src/atlasHtml.scene.test.ts'

export default defineConfig({
  define: { __BUILD_ID__: encodeJson(Schema.String)('test') },
  test: {
    // Some sim tests replay whole waves for many seeds. They take a few
    // seconds locally and passed 5 seconds on a busy CI runner.
    testTimeout: 30_000,
    setupFiles: ['./src/vitest-setup.ts'],
    env: { VITE_COOP: 'On' },
    isolate: false,
    // NOTE: a test reads a stylesheet's text with `?raw` (the corner's tap
    // sizes in src/support.scene.test.ts, the moving animations in
    // src/motion.test.ts). Vitest hands every other CSS file over empty.
    css: { include: [/(menu|profile|shop|styles|coop|calling|closet)\.css/] },
    server: {
      deps: {
        inline: ['foldkit', '@foldkit/ui', '@foldkit/devtools'],
      },
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
            'tools/lint/**/*.test.ts',
          ],
          exclude: [SCENE, SIM],
        },
      },
      {
        extends: true,
        test: {
          name: 'page',
          environment: 'happy-dom',
          include: [SCENE],
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
          setupFiles: ['./src/vitest-setup.ts', './src/atlasHtml.setup.ts'],
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
