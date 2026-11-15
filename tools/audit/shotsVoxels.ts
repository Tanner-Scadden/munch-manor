// The voxel bodies and the 3D blasts (src/render/iso/voxels.ts,
// explosions.ts): every kind in a row and at every wear stage, a crowd under
// fire, guns aimed every way, the boss, and Kaboomers bursting, each as
// voxels and as the old flat billboards (`billboards`), as
// `voxels-<TAG>-<viewport>-<scene>-<voxel|billboard>.png`.
//   TAG=try bun run heavy -- --shared bun tools/audit/shotsVoxels.ts
import { Array, Effect } from 'effect'

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
    name: 'wear',
    query: 'wave=3&seen=all&start=wave&elapsed=6000&god&lineup=wear&freeze=20',
  },
  {
    name: 'crowd',
    query:
      'wave=5&seen=all&start=wave&elapsed=6000&god&crowd=24&tough&gun=smg&aim=250,60&freeze=40',
  },
  {
    name: 'aim-down',
    query: 'wave=3&seen=all&god&gun=shotgun&aim=170,190&freeze=20',
  },
  {
    name: 'aim-up',
    query: 'wave=3&seen=all&god&gun=shotgun&aim=150,10&freeze=20',
  },
  {
    name: 'boss',
    query:
      'wave=8&seen=all&start=wave&elapsed=6000&god&boss=fighting&bx=200&by=80&freeze=20',
  },
  ...Array.map([30, 33, 36, 39], frames => ({
    name: `hotfoot-${frames}`,
    query: `wave=3&seen=all&start=wave&elapsed=6000&god&crowd=8&tough&freeze=${frames}`,
  })),
  {
    name: 'powerups',
    query: 'wave=3&seen=all&god&pickups=all&freeze=20',
  },
  ...Array.map(['RapidFire', 'Damage', 'Speed', 'Pierce'], kind => ({
    name: `boost-${kind}`,
    query: `wave=3&seen=all&god&boosts=${kind}&freeze=20`,
  })),
  {
    name: 'kaboom-flash',
    query: 'wave=3&seen=all&god&blast=20&freeze=1',
  },
  {
    name: 'kaboom-fire',
    query: 'wave=3&seen=all&god&blast=110&freeze=1',
  },
  {
    name: 'kaboom-smoke',
    query: 'wave=3&seen=all&god&blast=230&freeze=1',
  },
]

const LOOKS = ['voxel', 'billboard'] as const

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
          const query =
            look === 'billboard' ? `${scene.query}&billboards` : scene.query
          yield* gotoScene(page, harnessUrl(query, deviceQuery(viewport)))
          yield* shot(
            page,
            `voxels-${tag}-${viewport.name}-${scene.name}-${look}`,
          )
          yield* closePage(page)
        }
      }
    }
  }),
)
