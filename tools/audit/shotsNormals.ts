import { Effect } from 'effect'

import { runHarnessAudit } from './harnessServer'
import {
  auditTag,
  closePage,
  deviceQuery,
  gotoScene,
  harnessUrl,
  isPickedScene,
  openBrowser,
  openPage,
  shot,
  shotViewports,
} from './lib'

const SCENES: ReadonlyArray<Readonly<{ name: string; query: string }>> = [
  {
    name: 'lineup',
    query: 'wave=3&seen=all&start=wave&elapsed=6000&god&lineup=sizes&freeze=20',
  },
  {
    name: 'crowd',
    query:
      'wave=5&seen=all&start=wave&elapsed=6000&god&crowd=24&tough&gun=smg&aim=250,60&freeze=40',
  },
  {
    name: 'boss',
    query:
      'wave=8&seen=all&start=wave&elapsed=6000&god&boss=fighting&bx=200&by=80&freeze=20',
  },
]

const LOOKS = ['shaded', 'flat'] as const

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* shotViewports
    const browser = yield* openBrowser
    for (const viewport of viewports) {
      for (const scene of SCENES) {
        if (!(yield* isPickedScene(scene.name))) {
          continue
        }
        for (const look of LOOKS) {
          const page = yield* openPage(browser, viewport)
          const query = look === 'flat' ? `${scene.query}&flat` : scene.query
          yield* gotoScene(page, harnessUrl(query, deviceQuery(viewport)))
          yield* shot(
            page,
            `normals-${tag}-${viewport.name}-${scene.name}-${look}`,
          )
          yield* closePage(page)
        }
      }
    }
  }),
)
