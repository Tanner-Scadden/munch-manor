// The game surface's pixel pass: everything seen while playing, the 3D world
// and the overlay canvas on it (the HUD, banners, callouts, health bars,
// work rings, edge badges, the pocket, pause, the end card, the intro), in
// every room, a wave and a break, the boss, the finale, a crowd under fire,
// co-op marks, and effects at once. On a 1280x720 desktop, a wide 2560x1080
// and a narrow 1024x768 one, a 1920x1080 one, an 844x390 phone on its side,
// and a 390x844 phone held upright at 1x, 2x, and 3x, as
// `surface-<TAG>-<viewport>-<scene>.png`. Crop and scale them up to read.
//   TAG=after bun run heavy -- --shared bun tools/audit/shotsSurface.ts
// ONLY picks scenes, and VIEWPORTS picks screens.
import { Effect } from 'effect'

import { runHarnessAudit } from './harnessServer'
import {
  ANDROID_915,
  DESKTOP_1280,
  DESKTOP_1920,
  EVERY_EXIT_OPEN,
  LEARNED_ALL,
  OPEN_BREAK,
  PHONE_844,
  UPRIGHT_390,
  auditTag,
  deviceQuery,
  harnessQuery,
  isPickedScene,
  openBrowser,
  pickViewports,
  scenePages,
  settleAnimations,
  shot,
} from './lib'

type Scene = Readonly<{ name: string; query: string }>

const WAVE = `${LEARNED_ALL}&${EVERY_EXIT_OPEN}&wave=4&start=wave&god&darefound=1&money=6`
const FIGHT = `${WAVE}&elapsed=6000`

const SCENES: ReadonlyArray<Scene> = [
  { name: 'dining', query: `${OPEN_BREAK}&px=180&py=150` },
  { name: 'dining-top', query: `${OPEN_BREAK}&px=180&py=40` },
  { name: 'parlour', query: `${OPEN_BREAK}&px=-160&py=130` },
  { name: 'parlour-corner', query: `${OPEN_BREAK}&px=-300&py=200` },
  { name: 'library', query: `${OPEN_BREAK}&px=425&py=120` },
  { name: 'cellar', query: `${OPEN_BREAK}&px=840&py=130` },
  { name: 'cellar-corner', query: `${OPEN_BREAK}&px=960&py=200` },
  { name: 'kitchen', query: `${OPEN_BREAK}&px=100&py=-60` },
  { name: 'wave-banner', query: `${WAVE}&elapsed=400&px=180&py=150` },
  { name: 'fight', query: `${FIGHT}&crowd=14&tough&fill&aim=230,120` },
  { name: 'fight-smg', query: `${FIGHT}&crowd=10&tough&gun=smg&aim=120,160` },
  {
    name: 'fight-shotgun',
    query: `${FIGHT}&crowd=10&tough&gun=shotgun&aim=240,90`,
  },
  {
    name: 'effects',
    query: `${FIGHT}&crowd=12&tough&fill&blast=120&trauma=0.2&boosts=RapidFire,Damage,Pierce&callout=Heart&frenzy&wipe`,
  },
  { name: 'pickups', query: `${FIGHT}&pickups=all` },
  { name: 'lineup', query: `${FIGHT}&lineup=wear` },
  { name: 'boss', query: `${WAVE}&wave=8&elapsed=6000&boss=fighting` },
  { name: 'boss-stomp', query: `${WAVE}&wave=8&elapsed=6000&boss=stomp` },
  { name: 'finale', query: `${WAVE}&wave=8&finale=summoned&boss=fighting` },
  { name: 'coop', query: `${FIGHT}&party=3&crowd=6` },
  { name: 'break-pocket', query: `${OPEN_BREAK}&darefound=2&pocket=1200` },
  { name: 'pause', query: `${FIGHT}&phase=paused` },
  { name: 'end-loss', query: 'wave=5&phase=gameover&stats' },
  { name: 'end-win', query: 'wave=10&phase=escaped&stats' },
  { name: 'intro', query: 'phase=arriving&introMs=2000' },
  { name: 'leaks', query: `${OPEN_BREAK}&px=-160&py=130&clock=4000` },
]

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* pickViewports([
      { ...DESKTOP_1280, name: 'd1280' },
      { ...DESKTOP_1920, name: 'd1920' },
      { ...DESKTOP_1280, width: 2560, height: 1080, name: 'dwide' },
      { ...DESKTOP_1280, width: 1024, height: 768, name: 'dnarrow' },
      { ...PHONE_844, name: 'l844' },
      { ...ANDROID_915, name: 'l915' },
      { ...UPRIGHT_390, name: 'p390' },
      { ...UPRIGHT_390, scale: 2, name: 'p390x2' },
      { ...UPRIGHT_390, scale: 1, name: 'p390x1' },
    ])
    const browser = yield* openBrowser
    const pages = scenePages(browser, ['nodev', 'tick=40'])
    for (const viewport of viewports) {
      for (const scene of SCENES) {
        if (!(yield* isPickedScene(scene.name))) {
          continue
        }
        const page = yield* pages.open(
          viewport,
          harnessQuery(scene.query, deviceQuery(viewport)),
        )
        yield* settleAnimations(page)
        yield* shot(page, `surface-${tag}-${viewport.name}-${scene.name}`)
        pages.release(page)
      }
    }
    yield* pages.close
  }),
)
