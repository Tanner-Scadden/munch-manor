import { Console, Effect, Schema } from 'effect'

import { runHarnessAudit } from './harnessServer'
import {
  auditTag,
  deviceQuery,
  finish,
  harnessQuery,
  isPickedScene,
  modelAs,
  openBrowser,
  scenePages,
  shot,
  shotViewports,
} from './lib'
import { LEARNED } from './scenes'

type Scene = Readonly<{ name: string; query: string }>

const ARRIVING = `wave=1&seen=all&phase=arriving&${LEARNED}`

const SCENES: ReadonlyArray<Scene> = [
  {
    name: 'drive-first',
    query: `${ARRIVING}&cut=full&introMs=2000&carLine=NoRunYet`,
  },
  {
    name: 'drive-munched',
    query: `${ARRIVING}&cut=full&introMs=2000&carLine=Munched`,
  },
  {
    name: 'drive-longest',
    query: `${ARRIVING}&cut=full&introMs=2600&carLine=Munched&lineAt=1`,
  },
  {
    name: 'knock',
    query: `${ARRIVING}&cut=short&introMs=600&carLine=Escaped`,
  },
]

const PhaseRead = Schema.Struct({
  phase: Schema.Struct({ _tag: Schema.String }),
})

const problems: Array<string> = []

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* shotViewports
    const browser = yield* openBrowser
    const pages = scenePages(browser, ['nodev'])
    for (const viewport of viewports) {
      for (const scene of SCENES) {
        if (!(yield* isPickedScene(scene.name))) {
          continue
        }
        const label = `${viewport.name} ${scene.name}`
        const page = yield* pages.open(
          viewport,
          harnessQuery(scene.query, deviceQuery(viewport)),
        )
        const { phase } = yield* modelAs(page, PhaseRead)
        if (phase._tag !== 'Arriving') {
          problems.push(`${label}: the page is ${phase._tag}, not the intro`)
        }
        yield* shot(page, `sIntro-${tag}-${viewport.name}-${scene.name}`)
        yield* Console.log(`shot ${label}`)
        pages.release(page)
      }
    }
    yield* pages.close
    yield* finish(problems, "Your friends' line shows in the intro.")
  }),
)
