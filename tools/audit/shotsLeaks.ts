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
