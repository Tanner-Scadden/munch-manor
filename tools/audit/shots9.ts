import {
  Array,
  Config,
  Console,
  Effect,
  FileSystem,
  Schema,
  String,
} from 'effect'

import * as NodeServices from '@effect/platform-node/NodeServices'
import { Vector } from '@game/world/schema/entitySchema'

import { encodeJson } from '../json'
import { runHarnessAuditWith } from './harnessServer'
import {
  PHONE_844,
  SHOTS_DIR,
  closePage,
  comparePngs,
  desktop,
  gotoScene,
  harnessUrl,
  modelAs,
  openBrowser,
  openPage,
  shot,
  tagOr,
} from './lib'

// NOTE: the Model's fields the log line reads.
const SceneCounts = Schema.Struct({
  shake: Schema.Struct({ offset: Vector }),
  zombies: Schema.Array(Schema.Unknown),
  particles: Schema.Array(Schema.Unknown),
  decals: Schema.Array(Schema.Unknown),
})

const offsetJson = encodeJson(Vector)

const scenes: ReadonlyArray<
  Readonly<{ name: string; q: string; isMobile?: boolean }>
> = [
  { name: 'title', q: '?freeze=40' },
  { name: 'prep', q: '?wave=2&prep=60000&freeze=40' },
  {
    name: 'worst',
    q: '?wave=8&start=wave&god&gun=smg&fill&crowd=30&aim=220,50&freeze=75',
  },
  {
    name: 'worst-later',
    q: '?wave=8&start=wave&god&gun=smg&fill&crowd=30&aim=60,140&freeze=200',
  },
  {
    name: 'endless15',
    q: '?wave=15&mode=endless&start=wave&god&gun=smg&tier=3&fill&aim=100,120&freeze=150',
  },
  { name: 'gameover', q: '?wave=5&phase=gameover&stats&freeze=90' },
  { name: 'victory', q: '?wave=8&phase=victory&stats&freeze=90' },
  {
    name: 'touch',
    q: '?device=touch&wave=3&start=wave&god&fill&crowd=10&freeze=60',
    isMobile: true,
  },
  {
    name: 'touch-shake',
    q: '?device=touch&wave=8&start=wave&god&gun=smg&fill&crowd=30&aim=60,140&freeze=200',
    isMobile: true,
  },
]

runHarnessAuditWith(
  Effect.gen(function* () {
    const tag = yield* tagOr('now')
    const browser = yield* openBrowser
    for (const scene of scenes) {
      const page =
        scene.isMobile === true
          ? yield* openPage(browser, PHONE_844)
          : yield* desktop(browser)
      yield* gotoScene(page, harnessUrl(String.replace(/^\?/, '')(scene.q)))
      const m = yield* modelAs(page, SceneCounts)
      yield* shot(page, `s9-${tag}-${scene.name}`)
      yield* Console.log(
        scene.name,
        `shake ${offsetJson(m.shake.offset)}`,
        `zombies ${m.zombies.length} particles ${m.particles.length} decals ${m.decals.length}`,
      )
      yield* closePage(page)
    }

    const compareTag = yield* Config.String('COMPARE').pipe(
      Config.withDefault(''),
    )
    if (compareTag !== '') {
      const fs = yield* FileSystem.FileSystem
      const page = yield* desktop(browser)
      const files = yield* fs.readDirectory(SHOTS_DIR)
      for (const scene of scenes) {
        const before = `s9-${compareTag}-${scene.name}.png`
        const after = `s9-${tag}-${scene.name}.png`
        if (!Array.contains(files, before) || !Array.contains(files, after)) {
          continue
        }
        const result = yield* comparePngs(
          page,
          `${SHOTS_DIR}/${before}`,
          `${SHOTS_DIR}/${after}`,
        )
        yield* Console.log(
          `${scene.name}: ${result.differing} of ${result.total} pixels differ, max channel delta ${result.maxDelta}`,
        )
      }
    }
  }),
  NodeServices.layer,
)
