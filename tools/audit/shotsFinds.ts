// The finds and wake-ups pass (docs/ESCAPE_PLAN.md, layer 21): each room's
// find (the parlour's trunk, the library's hollow book, the kitchen's
// dumbwaiter) before it is worked, being worked with its gold ring, and the
// moment it is found, then the kitchen woken mid-wave, its rush coming
// through its own doors. On a 1280x720 desktop, an 844x390 phone on its
// side, and a 390x844 phone held upright, as
// `finds-<TAG>-<viewport>-<scene>.png`.
//   TAG=after bun run heavy -- --shared bun tools/audit/shotsFinds.ts
// ONLY picks scenes, and VIEWPORTS picks screens.
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

// NOTE: 20 frames (a third of a second) play before each shot: `findwork`
// sets how far the work stands before them, so `found` finishes the work
// a few frames in and shows the find's burst.
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

// NOTE: the kitchen bought mid-wave: its rush comes a pack warning in
// (1 s) and over 10 s, so 8 s of play shows it pouring through the back
// door and the window.
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
