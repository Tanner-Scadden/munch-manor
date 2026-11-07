// The doorway depth pass: zombies mid-entry at every door, so the north
// wall's face and lintel must cover the ones still in the doorway, on a
// desktop, a landscape phone, and an upright phone, as
// `s35-<TAG>-<viewport>-<scene>.png`. An upright phone sees only part of the
// room, so it takes the room once with the player by each door.
//   TAG=after bun run heavy -- bun tools/audit/shots35.ts
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

const ROOM = 'wave=3&seen=all&start=wave&elapsed=6000&god&doorway&freeze=30'

const SCENES: ReadonlyArray<Readonly<{ name: string; query: string }>> = [
  { name: 'north', query: `${ROOM}&px=220&py=70` },
  { name: 'south', query: `${ROOM}&px=90&py=140` },
  { name: 'west', query: `${ROOM}&px=40&py=90` },
  { name: 'east', query: `${ROOM}&px=280&py=90` },
  { name: 'kitchen', query: `${ROOM}&openexits=Kitchen&px=70&py=70` },
]

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
        const page = yield* openPage(browser, viewport)
        yield* gotoScene(page, harnessUrl(scene.query, deviceQuery(viewport)))
        yield* shot(page, `s35-${tag}-${viewport.name}-${scene.name}`)
        yield* closePage(page)
      }
    }
  }),
)
