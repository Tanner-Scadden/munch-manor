import { Config, Console, Effect, FileSystem, Schema, String } from 'effect'
import type { Page } from 'playwright-core'

import * as NodeServices from '@effect/platform-node/NodeServices'

import { encodeJson } from '../json'
import { runHarnessAuditWith } from './harnessServer'
import { measurePixels } from './inPage/shotsPixel'
import {
  deviceQuery,
  finish,
  harnessQuery,
  isPickedScene,
  openBrowser,
  scenePages,
  settleAnimations,
  shotViewports,
  wait,
} from './lib'
import { attempt, evaluateAs } from './page'

const LEARNED =
  'learned=move,fire,startWave,swap,pickup,timedBreaks,openBreak,dareTour,dareKey,rattles'
const LOBBY_PICK = `${LEARNED}&rank=4200&calling=Handyman&newsseen`
const FOUND =
  'bests&kills=Shambler:1203,Runner:140,Tank:12,Exploder:9,Thrower:3,Boss:2&opened=Shambler,Tank'
const SHOP = `wave=5&money=180&gun=smg&tier=1&px=270&py=142&${LEARNED}`
const BREAK = `wave=4&seen=all&break=open&breakMs=20000&money=60&difficulty=Normal&${LEARNED}`
const MIXED =
  'rank=600&bones=140&spent=50&bought=Fez,shirt:Midnight,print:Skull&hat=Fez'

type Scene = Readonly<{
  name: string
  query: string
  open?: ReadonlyArray<string>
}>

const MANOR = '#home-manor'
const PLAY = '#home-play'
const FINDS = [MANOR, '#hand-card-munchopedia', 'button[aria-label^="Finds,"]']

const SCENES: ReadonlyArray<Scene> = [
  { name: 'home', query: '' },
  { name: 'home-found', query: `${FOUND}&newentries=Thrower&newsseen` },
  { name: 'home-corner', query: `${FOUND}&fit=full&install&newer&newsseen` },
  { name: 'home-guide', query: 'fit=home', open: ['#home-install'] },
  { name: 'greet', query: 'greet' },
  { name: 'hand', query: 'support', open: [MANOR] },
  { name: 'settings-home', query: '', open: ['#home-settings'] },
  { name: 'howto', query: '', open: [MANOR, '#hand-card-howtoplay'] },
  { name: 'difficulty', query: 'ask', open: [PLAY] },
  { name: 'lobby', query: LOBBY_PICK, open: [PLAY] },
  { name: 'lobby-mods', query: `${LOBBY_PICK}&mods=10`, open: [PLAY] },
  {
    name: 'lobby-bots-all',
    query: `${LOBBY_PICK}&lobbybots=1&mods=15`,
    open: [PLAY],
  },
  { name: 'lobby-hero', query: LOBBY_PICK, open: [PLAY, '#lobby-hero'] },
  { name: 'coop-tile', query: 'coop=tile' },
  { name: 'coop-hub', query: 'coop=hub' },
  { name: 'coop-problem', query: 'coop=problem' },
  { name: 'coop-code', query: 'coop=code' },
  { name: 'coop-asking', query: 'coop=asking' },
  { name: 'coop-queue', query: 'coop=queue' },
  { name: 'coop-offer', query: 'coop=offer' },
  { name: 'coop-lobby', query: 'coop=lobby' },
  { name: 'coop-host', query: 'coop=host&mods=10' },
  { name: 'coop-guest', query: 'coop=guest&mods=9' },
  { name: 'coop-heroes', query: 'coop=heroes' },
  { name: 'coop-name', query: 'coop=name' },
  { name: 'coop-ready', query: 'coop=ready' },
  { name: 'coop-result', query: 'coop=result' },
  { name: 'profile-look', query: 'profile=look&rank=1850' },
  {
    name: 'profile-look-hair',
    query: 'profile=look&looksection=Hair&rank=1850',
  },
  {
    name: 'profile-look-outfit',
    query: `profile=look&looksection=Outfit&${MIXED}`,
  },
  {
    name: 'profile-look-gear',
    query: `profile=look&looksection=Gear&${MIXED}`,
  },
  { name: 'profile-name', query: 'profile=name&name=Dr. Chomp&rank=1850' },
  {
    name: 'profile-account',
    query: 'profile=account&sync=synced&devices=2',
  },
  {
    name: 'profile-account-link',
    query: 'profile=account&sync=synced&link=entering',
  },
  { name: 'profile-settings', query: 'profile=settings&fit=full&rotate' },
  { name: 'munch-empty', query: '', open: [MANOR, '#hand-card-munchopedia'] },
  { name: 'munch', query: FOUND, open: [MANOR, '#hand-card-munchopedia'] },
  {
    name: 'munch-entry',
    query: FOUND,
    open: [MANOR, '#hand-card-munchopedia', '.munch-tile >> nth=0'],
  },
  { name: 'munch-shop', query: FOUND, open: FINDS },
  { name: 'whats-new', query: '', open: [MANOR, '#hand-card-whatsnew'] },
  { name: 'shop-guns', query: SHOP },
  { name: 'shop-broke', query: 'wave=3&money=12&gun=shotgun&px=270&py=142' },
  {
    name: 'shop-guide-traps',
    query: FOUND,
    open: [...FINDS, 'role=button[name="Traps"]'],
  },
  {
    name: 'shop-guide-fridge',
    query: `${FOUND}&prizes=Cooker,Freeze`,
    open: [...FINDS, 'role=button[name="Fridge"]'],
  },
  {
    name: 'hud-wave',
    query: `wave=4&seen=all&start=wave&elapsed=6000&crowd=8&gun=smg&money=45&${LEARNED}`,
  },
  { name: 'hud-break', query: BREAK },
  { name: 'hud-nudge', query: `${BREAK}&idle=16000` },
  {
    name: 'hud-coop-break',
    query: `${BREAK}&party=2&mates=ready&idle=4000`,
  },
  {
    name: 'hud-portrait-touch',
    query: `wave=4&seen=all&start=wave&elapsed=6000&crowd=8&${LEARNED}`,
  },
  { name: 'pause', query: 'wave=3&seen=all&start=wave&phase=paused' },
  {
    name: 'end-loss',
    query: `wave=5&phase=gameover&stats&rank=162&rankgain=129`,
  },
  {
    name: 'end-win',
    query: `wave=10&phase=escaped&stats&difficulty=Hard&rank=1900&rankgain=537&mods=14`,
  },
  {
    name: 'end-crew',
    query: `wave=10&phase=escaped&stats&party=3&rank=2400&rankgain=204&mods=9`,
  },
  { name: 'coop-card', query: 'coop=card' },
  { name: 'coop-card-won', query: 'coop=cardwon' },
]

const Control = Schema.Record(
  Schema.String,
  Schema.Union([Schema.String, Schema.Finite, Schema.Boolean]),
)
const Metrics = Schema.Struct({
  controls: Schema.Array(Control),
  images: Schema.Array(Control),
})

const measure = (page: Page) => evaluateAs(page, Metrics, measurePixels)

const problems: Array<string> = []

runHarnessAuditWith(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const dir = yield* Config.String('PIXEL_SHOTS').pipe(
      Config.withDefault('/tmp/pixel-shots'),
    )
    yield* fs.makeDirectory(dir, { recursive: true })
    const viewports = yield* shotViewports
    const browser = yield* openBrowser
    const pages = scenePages(browser, ['nodev', 'tick=72'])
    for (const viewport of viewports) {
      for (const scene of SCENES) {
        if (!(yield* isPickedScene(scene.name))) {
          continue
        }
        const where = `${viewport.name}-${scene.name}`
        yield* Effect.gen(function* () {
          const page = yield* pages.open(
            viewport,
            harnessQuery(scene.query, deviceQuery(viewport)),
          )
          for (const selector of scene.open ?? []) {
            yield* attempt(() =>
              page.locator(selector).first().click({ timeout: 5000 }),
            )
            yield* settleAnimations(page)
          }
          yield* wait(250)
          yield* settleAnimations(page)
          const metrics = yield* measure(page)
          for (const image of metrics.images) {
            const scale = Number(image['scale'])
            if (
              image['tag'] === 'img' &&
              scale > 0 &&
              Math.abs(scale - Math.round(scale)) > 0.02 &&
              image['rendering'] !== 'pixelated' &&
              image['rendering'] !== 'crisp-edges'
            ) {
              problems.push(
                `${where}: ${globalThis.String(image['cls'])} drawn at ${scale}x, ${globalThis.String(image['rendering'])}`,
              )
            }
          }
          yield* fs.writeFileString(
            `${dir}/${where}.json`,
            `${encodeJson(Metrics, 2)(metrics)}\n`,
          )
          yield* attempt(() =>
            page.screenshot({
              path: `${dir}/${where}.png`,
              animations: 'disabled',
            }),
          )
          yield* Console.log(`shot ${where}`)
          pages.release(page)
        }).pipe(
          Effect.catch(error =>
            Effect.sync(() => {
              problems.push(
                `${where}: ${String.split('\n')(globalThis.String(error))[0]}`,
              )
            }),
          ),
        )
      }
    }
    yield* pages.close
    yield* finish(problems, 'The pixel pass found no problems.')
  }),
  NodeServices.layer,
)
