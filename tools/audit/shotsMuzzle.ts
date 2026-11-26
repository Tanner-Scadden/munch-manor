import { Array, Effect, Schema } from 'effect'

import { runHarnessAudit } from './harnessServer'
import {
  DESKTOP_1280,
  type Viewport,
  auditTag,
  closePage,
  gotoScene,
  harnessUrl,
  isPickedScene,
  modelAs,
  openBrowser,
  openPage,
  shot,
} from './lib'

const VIEWPORT: Viewport = { ...DESKTOP_1280, name: 'd1280x3', scale: 3 }

const BASE_QUERY = 'god&nodev&nohud&seen=all&wave=3&start=wave&px=180&py=150'

const GUNS: ReadonlyArray<Readonly<{ name: string; query: string }>> = [
  { name: 'pistol', query: '' },
  { name: 'shotgun', query: 'gun=shotgun' },
  { name: 'rifle', query: 'gun=rifle' },
]

const AIMS: ReadonlyArray<Readonly<{ name: string; at: string }>> = [
  { name: 'right', at: '260,150' },
  { name: 'left', at: '100,150' },
  { name: 'up', at: '180,70' },
  { name: 'down', at: '180,230' },
  { name: 'downright', at: '240,210' },
  { name: 'upleft', at: '120,90' },
]

const FRAMES = Array.makeBy(10, index => index + 1)

const Recoil = Schema.Struct({
  seats: Schema.Array(
    Schema.Struct({
      player: Schema.Struct({ recoilRemainingMs: Schema.Finite }),
    }),
  ),
})

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const browser = yield* openBrowser
    for (const gun of GUNS) {
      for (const aim of AIMS) {
        const name = `${gun.name}-${aim.name}`
        if (!(yield* isPickedScene(name))) {
          continue
        }
        const page = yield* openPage(browser, VIEWPORT)
        const urlAt = (frame: number) =>
          harnessUrl(BASE_QUERY, gun.query, `aim=${aim.at}`, `freeze=${frame}`)
        let best = { frame: 1, recoil: -1 }
        for (const frame of FRAMES) {
          yield* gotoScene(page, urlAt(frame))
          const model = yield* modelAs(page, Recoil)
          const recoil = Array.match(model.seats, {
            onEmpty: () => 0,
            onNonEmpty: ([lead]) => lead.player.recoilRemainingMs,
          })
          if (recoil > best.recoil) {
            best = { frame, recoil }
          }
        }
        yield* gotoScene(page, urlAt(best.frame))
        yield* shot(page, `muzzle-${tag}-${name}`)
        yield* closePage(page)
      }
    }
  }),
)
