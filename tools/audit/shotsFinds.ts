import { Effect } from 'effect'

import { runHarnessAudit } from './harnessServer'
import {
  EVERY_EXIT_OPEN,
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

const findScenes = (
  name: string,
  room: string,
  worked: number,
): ReadonlyArray<Scene> => [
  {
    name: `${name}-before`,
    query: `${OPEN_BREAK}&findroom=${room}&findgap=20&tick=20`,
  },
  {
    name: `${name}-worked`,
    query: `${OPEN_BREAK}&findroom=${room}&findwork=${worked}&findgap=9&tick=20`,
  },
  {
    name: `${name}-found`,
    query: `${OPEN_BREAK}&findroom=${room}&findwork=0.96&findgap=9&tick=20`,
  },
]

const SCENES: ReadonlyArray<Scene> = [
  ...findScenes('parlour', 'Parlour', 0.15),
  ...findScenes('library', 'Library', 0.15),
  ...findScenes('kitchen', 'Kitchen', 0.25),
  {
    name: 'wake-kitchen',
    query: `${LEARNED_ALL}&wave=3&start=wave&elapsed=0&${EVERY_EXIT_OPEN}&wake=Back,Window&god&px=100&py=-40&tick=480`,
  },
]

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* shotViewports
    const browser = yield* openBrowser
    const pages = scenePages(browser, ['nodev'])
    yield* Effect.forEach(viewports, viewport =>
      Effect.forEach(
        SCENES,
        scene =>
          Effect.gen(function* () {
            if (!(yield* isPickedScene(scene.name))) {
              return
            }
            const page = yield* pages.open(
              viewport,
              harnessQuery(scene.query, deviceQuery(viewport)),
            )
            yield* settleAnimations(page)
            yield* shot(page, `finds-${tag}-${viewport.name}-${scene.name}`)
          }),
        { discard: true },
      ),
    )
  }),
)
