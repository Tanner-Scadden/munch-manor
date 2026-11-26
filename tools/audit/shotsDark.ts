import { Array, Config, Effect, Option, String } from 'effect'

import { runHarnessAudit } from './harnessServer'
import {
  LEARNED_ALL,
  OPEN_BREAK,
  auditTag,
  deviceQuery,
  harnessQuery,
  isPickedScene,
  openBrowser,
  scenePages,
  settleAnimations,
  shot,
  shotViewports,
} from './lib'

type Scene = Readonly<{ name: string; query: string }>

const breakWith = (exits: string): string =>
  `${LEARNED_ALL}&wave=3&break=open&openexits=${exits}`

const SCENES: ReadonlyArray<Scene> = [
  { name: 'west-w', query: `${OPEN_BREAK}&px=-300&py=130` },
  { name: 'west-e', query: `${OPEN_BREAK}&px=-20&py=130` },
  { name: 'dining-w', query: `${OPEN_BREAK}&px=20&py=110` },
  { name: 'dining-e', query: `${OPEN_BREAK}&px=340&py=110` },
  { name: 'kitchen-w', query: `${OPEN_BREAK}&px=20&py=-75` },
  { name: 'kitchen-e', query: `${OPEN_BREAK}&px=300&py=-75` },
  { name: 'east-w', query: `${OPEN_BREAK}&px=380&py=90` },
  { name: 'east-e', query: `${OPEN_BREAK}&px=660&py=90` },
  { name: 'far-w', query: `${OPEN_BREAK}&px=700&py=90` },
  { name: 'far-e', query: `${OPEN_BREAK}&px=980&py=90` },
  {
    name: 'shut-far',
    query: `${breakWith('Kitchen,West,East')}&px=660&py=90`,
  },
  { name: 'shut-east', query: `${breakWith('Kitchen,West')}&px=340&py=110` },
  { name: 'shut-west', query: `${breakWith('Kitchen,East')}&px=20&py=130` },
]

const housesPicked = Config.String('HOUSES').pipe(
  Config.map(String.split(',')),
  Config.option,
)

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* shotViewports
    const picked = yield* housesPicked
    const houses = Option.match(picked, {
      onNone: () => Array.range(0, 5),
      onSome: Array.map(Number),
    })
    const browser = yield* openBrowser
    const pages = scenePages(browser, ['nodev', 'nohud', 'tick=20'])
    for (const viewport of viewports) {
      for (const house of houses) {
        for (const scene of SCENES) {
          if (!(yield* isPickedScene(scene.name))) {
            continue
          }
          const page = yield* pages.open(
            viewport,
            harnessQuery(
              `${scene.query}&house=${house}`,
              deviceQuery(viewport),
            ),
          )
          yield* settleAnimations(page)
          yield* shot(
            page,
            `dark-${tag}-${viewport.name}-h${house}-${scene.name}`,
          )
          pages.release(page)
        }
      }
    }
  }),
)
