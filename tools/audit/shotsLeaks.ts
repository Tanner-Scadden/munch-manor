// The roof leaks' puddles (src/world/level/leaks.ts, src/render/iso/leaks.ts):
// the dining room's and the library's puddles in a break, the cellar's in
// its dark caught by the flashlight's beam, the player standing in the
// dining room's, and wading east through it on the game's
// own clock, splashing, on a 1280x720 desktop, an 844x390 phone on its side,
// and a 390x844 phone held upright, as `leaks-<TAG>-<viewport>-<scene>.png`.
// The wade walks with a held key, which turns an upright phone to the
// keyboard's layout, so it is taken on the screens on their side only.
//   TAG=after bun run heavy -- --shared bun tools/audit/shotsLeaks.ts
// ONLY picks scenes, and VIEWPORTS picks screens.
import { Effect } from 'effect'

import { runHarnessAudit } from './harnessServer'
import {
  auditTag,
  deviceQuery,
  finish,
  harnessQuery,
  isPickedScene,
  openBrowser,
  scenePages,
  settleAnimations,
  shot,
  shotViewports,
  wait,
} from './lib'
import { attempt } from './page'

const BASE = 'god&seen=all&wave=3&openexits=West,East,Far,Kitchen&kitchen'

// NOTE: the first arrangement's dining room puddle lies about (83, 65), the
// library's about (575, 46), and the cellar's about (826, 86), east of a
// player facing east; `walk` holds a key that long before the
// shot, which is taken with it still held, so the splash is in the air.
const SCENES: ReadonlyArray<
  Readonly<{ name: string; query: string; walk?: number }>
> = [
  { name: 'dining-break', query: 'px=83&py=40&break=open&tick=10' },
  { name: 'library-break', query: 'px=575&py=22&break=open&tick=10' },
  { name: 'cellar-dark', query: 'px=796&py=80&break=open&tick=10' },
  { name: 'dining-stand', query: 'px=80&py=60&break=open&tick=10' },
  {
    name: 'dining-wade',
    query: 'px=58&py=60&break=open',
    walk: 420,
  },
]

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* shotViewports
    const browser = yield* openBrowser
    const pages = scenePages(browser, ['nodev'])
    for (const viewport of viewports) {
      for (const scene of SCENES) {
        const isUpright = viewport.height > viewport.width
        if (
          !(yield* isPickedScene(scene.name)) ||
          (isUpright && scene.walk !== undefined)
        ) {
          continue
        }
        const page = yield* pages.open(
          viewport,
          harnessQuery(BASE, scene.query, deviceQuery(viewport)),
        )
        yield* settleAnimations(page)
        const { walk } = scene
        if (walk !== undefined) {
          yield* attempt(() => page.keyboard.down('KeyD'))
          yield* wait(walk)
        }
        yield* shot(page, `leaks-${tag}-${viewport.name}-${scene.name}`)
        if (walk !== undefined) {
          yield* attempt(() => page.keyboard.up('KeyD'))
        }
        pages.release(page)
      }
    }
    yield* pages.close
    yield* finish([], 'Shots taken.')
  }),
)
