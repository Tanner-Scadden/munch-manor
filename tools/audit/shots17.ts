// The camera and depth sort guard: frozen, deterministic shots of the main
// scenes on a desktop and a small landscape phone, as
// `s17-<TAG>-<viewport>-<scene>.png`.
//   TAG=before bun shots17.ts
//   TAG=after COMPARE=before bun shots17.ts
// COMPARE counts the pixels that differ from another tag's set and writes a
// diff image, `s17-diff-<viewport>-<scene>.png`, for any scene that differs.
// ONLY picks scenes by name, BASE points it at another harness port, and
// COMPARE_ONLY=1 compares the sets already on disk without taking new shots.
import {
  Array,
  Config,
  Console,
  Effect,
  FileSystem,
  Option,
  Schema,
  String,
} from 'effect'

import * as NodeServices from '@effect/platform-node/NodeServices'

import { encodeJson } from '../json'
import { runHarnessAuditWith } from './harnessServer'
import {
  DESKTOP_1280,
  PHONE_667,
  SHOTS_DIR,
  type Viewport,
  auditTag,
  closePage,
  comparePngs,
  deviceQuery,
  gotoScene,
  harnessUrl,
  isPickedScene,
  openBrowser,
  openPage,
  shot,
} from './lib'
import { attempt } from './page'

const boxJson = encodeJson(
  Schema.Struct({
    left: Schema.Finite,
    top: Schema.Finite,
    right: Schema.Finite,
    bottom: Schema.Finite,
  }),
)

const VIEWPORTS: ReadonlyArray<Viewport> = [DESKTOP_1280, PHONE_667]

type Scene = Readonly<{ name: string; query: string }>

const SCENES: ReadonlyArray<Scene> = [
  { name: 'title', query: 'freeze=40' },
  {
    name: 'crowd',
    query: 'wave=8&start=wave&god&gun=smg&fill&crowd=30&aim=220,50&freeze=75',
  },
  {
    name: 'crowd-shake',
    query: 'wave=8&start=wave&god&gun=smg&fill&crowd=30&aim=60,140&freeze=200',
  },
  {
    name: 'shop-top',
    query: 'wave=5&money=180&gun=smg&tier=1&px=275&py=142&freeze=40',
  },
  {
    name: 'shop-side',
    query: 'wave=5&money=180&px=262&py=160&freeze=40',
  },
  {
    name: 'powerups',
    query:
      'wave=6&start=wave&god&gun=smg&fill&crowd=10&boosts=RapidFire,Damage,Pierce&boostMs=7000&callout=RapidFire&calloutAge=300&aim=280,40&freeze=36',
  },
  {
    name: 'pickups',
    query: 'wave=4&start=wave&god&seen=all&pickups=all&pickupY=110&freeze=30',
  },
  { name: 'debut-band', query: 'wave=4&seen=all&prep=17000&freeze=30' },
  { name: 'debut-card', query: 'wave=2&seen=Shambler&start=wave&freeze=50' },
  {
    name: 'preview',
    query: 'wave=4&seen=Shambler,Runner&prep=14000&freeze=30',
  },
  {
    name: 'traps',
    query:
      'wave=3&seen=all&prep=12000&barricades=2&turrets=1&money=40&freeze=30',
  },
  { name: 'gameover', query: 'wave=5&phase=gameover&stats&freeze=120' },
  {
    name: 'wear',
    query:
      'wave=8&start=wave&elapsed=3000&lineup=wear&god&seen=all&px=40&py=160&freeze=110',
  },
  {
    name: 'boss',
    query:
      'wave=8&start=wave&elapsed=3000&lineup=boss&god&seen=all&px=40&py=160&freeze=110',
  },
  {
    name: 'gasbags',
    query:
      'wave=6&start=wave&god&gun=smg&fill&gasroom=16&aim=160,40&freeze=150',
  },
  { name: 'looks', query: 'looksheet&freeze=10' },
]

const shotName = (tag: string, viewport: Viewport, scene: Scene) =>
  `s17-${tag}-${viewport.name}-${scene.name}`

runHarnessAuditWith(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const isComparingOnly =
      (yield* Config.String('COMPARE_ONLY').pipe(Config.withDefault(''))) ===
      '1'
    const browser = yield* openBrowser
    for (const viewport of VIEWPORTS) {
      for (const scene of SCENES) {
        if (!(yield* isPickedScene(scene.name)) || isComparingOnly) {
          continue
        }
        const page = yield* openPage(browser, viewport)
        yield* gotoScene(page, harnessUrl(scene.query, deviceQuery(viewport)))
        yield* shot(page, shotName(tag, viewport, scene))
        yield* closePage(page)
      }
    }

    const compareTag = yield* Config.String('COMPARE').pipe(
      Config.withDefault(''),
    )
    if (compareTag !== '') {
      const fs = yield* FileSystem.FileSystem
      const context = yield* attempt(() =>
        browser.newContext({ viewport: { width: 400, height: 300 } }),
      )
      const page = yield* attempt(() => context.newPage())
      const files = yield* fs.readDirectory(SHOTS_DIR)
      for (const viewport of VIEWPORTS) {
        for (const scene of SCENES) {
          if (!(yield* isPickedScene(scene.name))) {
            continue
          }
          const before = `${shotName(compareTag, viewport, scene)}.png`
          const after = `${shotName(tag, viewport, scene)}.png`
          if (!Array.contains(files, before) || !Array.contains(files, after)) {
            continue
          }
          const result = yield* comparePngs(
            page,
            `${SHOTS_DIR}/${before}`,
            `${SHOTS_DIR}/${after}`,
          )
          const label = `${viewport.name}-${scene.name}`
          yield* Console.log(
            `${label}: ${result.differing} of ${result.total} pixels differ, max channel delta ${result.maxDelta}${result.box === null ? '' : `, in ${boxJson(result.box)}`}`,
          )
          if (result.diffUrl !== null) {
            const base64 = Option.getOrElse(
              Array.get(String.split(',')(result.diffUrl), 1),
              () => '',
            )
            yield* fs.writeFile(
              `${SHOTS_DIR}/s17-diff-${label}.png`,
              Buffer.from(base64, 'base64'),
            )
          }
        }
      }
    }
  }),
  NodeServices.layer,
)
