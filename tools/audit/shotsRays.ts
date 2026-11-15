// The god rays, the rose window, and what glows (src/render/iso/godRays.ts,
// emissives.ts): the dining room, the library with its rose window in each
// slot it rolls into (west, east, far) in a break, a wave, and on a
// lightning strike, and behind its boards before it opens, the cellar in the
// dark with zombies near and their eyes, Kaboomers' fuses sparking, and the
// kitchen's soup with Kaboomers in it, as
// `rays-<TAG>-<viewport>-<scene>.png`.
//   TAG=before bun run heavy -- --shared bun tools/audit/shotsRays.ts
import { Array, Effect } from 'effect'

import { strikeClockOf } from '../../src/render/iso/mood'
import { runHarnessAudit } from './harnessServer'
import {
  DESKTOP_1280,
  PHONE_844,
  UPRIGHT_390,
  auditTag,
  closePage,
  deviceQuery,
  gotoScene,
  harnessUrl,
  isPickedScene,
  openBrowser,
  openPage,
  pickViewports,
  shot,
} from './lib'

const BASE_QUERY =
  'god&nodev&seen=all&wave=3&openexits=West,East,Far,Kitchen&kitchen'

// NOTE: `freeze=20` plays 20 frames of 1/60 s, so a clock set this far
// before the strike holds the picture 30 ms into its first flick.
const FROZEN_MS = Math.round((20 * 1000) / 60)
const STRIKE = `clock=${strikeClockOf(3) - 10 + 30 - FROZEN_MS}&start=wave&heat=0.3`

type Scene = Readonly<{ name: string; query: string }>

// NOTE: the library's top left in each house it rolls into a slot of
// (ARRANGEMENTS in src/world/level/plan.ts), in game pixels, and the slot.
const LIBRARY_HOUSES: ReadonlyArray<
  Readonly<{ house: number; slot: string; x: number; y: number }>
> = [
  { house: 0, slot: 'east', x: 360, y: 0 },
  { house: 1, slot: 'far', x: 680, y: 0 },
  { house: 2, slot: 'west', x: -320, y: 40 },
]

// NOTE: in the room before the rose window in a break, so its shaft and pool show
// whole; in a wave; and on a strike.
const LIBRARY_SCENES: ReadonlyArray<Scene> = Array.flatMap(
  LIBRARY_HOUSES,
  ({ house, slot, x, y }) => {
    const at = `house=${house}&px=${x + 232}&py=${y + 110}`
    return [
      { name: `library-${slot}-break`, query: `${at}&break=open&freeze=20` },
      {
        name: `library-${slot}-wave`,
        query: `${at}&start=wave&heat=0.5&freeze=20`,
      },
      { name: `library-${slot}-strike`, query: `${at}&${STRIKE}&freeze=20` },
    ]
  },
)

const SCENES: ReadonlyArray<Scene> = [
  { name: 'dining-break', query: 'px=250&py=60&break=open&freeze=20' },
  { name: 'dining-strike', query: `px=250&py=60&${STRIKE}&freeze=20` },
  {
    name: 'dining-crowd',
    query: 'px=180&py=150&start=wave&heat=0.8&crowd=12&freeze=20',
  },
  ...LIBRARY_SCENES,
  // NOTE: the library still boarded in the east slot, from the dining
  // room's east side, where its wall shows over the boards.
  {
    name: 'library-boarded',
    query: 'house=0&openexits=West,Kitchen&px=320&py=60&break=open&freeze=20',
  },
  {
    name: 'cellar-dark',
    query: 'px=780&py=110&start=wave&heat=0.8&crowd=8&crowdx=680&freeze=20',
  },
  // NOTE: the cellar's dark with the crowd round the player, so their eyes
  // glow where their bodies do not show.
  {
    name: 'cellar-eyes',
    query: 'px=760&py=125&start=wave&heat=0.8&crowd=10&crowdx=700&freeze=20',
  },
  // NOTE: Kaboomers walking up on the player, their fuses sparking.
  {
    name: 'kaboomer-fuse',
    query: 'px=250&py=110&start=wave&heat=0.8&gasroom=8&freeze=20',
  },
  {
    name: 'kitchen-wave',
    query:
      'px=160&py=-75&start=wave&heat=0.8&crowd=8&crowdx=20&crowdy=-130&gasbags&freeze=20',
  },
]

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* pickViewports([
      DESKTOP_1280,
      { ...PHONE_844, name: 'l844' },
      UPRIGHT_390,
    ])
    const browser = yield* openBrowser
    for (const viewport of viewports) {
      for (const scene of SCENES) {
        if (!(yield* isPickedScene(scene.name))) {
          continue
        }
        const page = yield* openPage(browser, viewport)
        yield* gotoScene(
          page,
          harnessUrl(`${BASE_QUERY}&${scene.query}`, deviceQuery(viewport)),
        )
        yield* shot(page, `rays-${tag}-${viewport.name}-${scene.name}`)
        yield* closePage(page)
      }
    }
  }),
)
