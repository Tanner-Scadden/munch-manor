// The pixel pass: every menu and overlay screen on a 1280x720 desktop, an
// 844x390 phone on its side, and a 390x844 phone held upright, as
// `<viewport>-<scene>.png` in PIXEL_SHOTS (default /tmp/pixel-shots), with
// `<viewport>-<scene>.json` beside each: the computed style of every control
// on screen (size, font, border, radius, shadow, colors) and of every image
// (drawn size against its own, and its image-rendering), so a report can
// compare like with like across screens. It exits with 1 on an image drawn at
// a non-integer scale of its pixels without `pixelated` rendering.
//   bun run heavy -- --shared bun tools/audit/shotsPixel.ts
// ONLY picks scenes, and VIEWPORTS picks screens.
import { Schema } from 'effect'
import { mkdirSync } from 'node:fs'
import type { Page } from 'playwright-core'

import { writeJsonFile } from '../json'
import {
  SHOT_VIEWPORTS,
  deviceQuery,
  finish,
  harnessQuery,
  isPickedScene,
  launch,
  scenePages,
  settleAnimations,
  useHarness,
  wait,
} from './lib'
import { evaluateAs } from './page'

const DIR = process.env['PIXEL_SHOTS'] ?? '/tmp/pixel-shots'

const LEARNED =
  'learned=move,fire,startWave,shop,swap,pickup,timedBreaks,openBreak'
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
  // NOTE: selectors clicked in order, each after the last has settled.
  open?: ReadonlyArray<string>
}>

const MANOR = '#home-manor'
const PLAY = '#home-play'
const tab = (index: number) => `dialog[open] [role=tab] >> nth=${index}`
const SHOP_TABS = [0, 1, 2].map(tab)

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
  {
    name: 'munch-shop',
    query: FOUND,
    open: [MANOR, '#hand-card-munchopedia', 'button[aria-label^="Shop,"]'],
  },
  { name: 'whats-new', query: '', open: [MANOR, '#hand-card-whatsnew'] },
  { name: 'shop-guns', query: SHOP },
  ...SHOP_TABS.slice(1).map(
    (selector, index): Scene => ({
      name: `shop-tab${index + 1}`,
      query: SHOP,
      open: [selector],
    }),
  ),
  { name: 'shop-broke', query: 'wave=3&money=12&gun=shotgun&px=270&py=142' },
  { name: 'shop-help', query: SHOP, open: ['button[aria-label="Shop guide"]'] },
  {
    name: 'shop-guide-traps',
    query: SHOP,
    open: ['button[aria-label="Shop guide"]', 'role=button[name="Traps"]'],
  },
  {
    name: 'shop-guide-fridge',
    query: `${SHOP}&prizes=Cooker,Freeze`,
    open: ['button[aria-label="Shop guide"]', 'role=button[name="Fridge"]'],
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
  { name: 'end-loss', query: `wave=5&phase=gameover&stats&rank=162&rankgain=129` },
  {
    name: 'end-win',
    query: `wave=10&phase=victory&stats&difficulty=Hard&rank=1900&rankgain=537&mods=14`,
  },
  {
    name: 'end-crew',
    query: `wave=10&phase=victory&stats&party=3&rank=2400&rankgain=204&mods=9`,
  },
  { name: 'coop-card', query: 'coop=card' },
  { name: 'coop-card-won', query: 'coop=cardwon' },
]

const Control = Schema.Record(
  Schema.String,
  Schema.Union([Schema.String, Schema.Number, Schema.Boolean]),
)
const Metrics = Schema.Struct({
  controls: Schema.Array(Control),
  images: Schema.Array(Control),
})

const measure = (page: Page) =>
  evaluateAs(page, Metrics, () => {
    const round = (value: number) => Math.round(value * 100) / 100
    const visible = (element: Element) => {
      const box = element.getBoundingClientRect()
      return box.width > 0 && box.height > 0
    }
    const controls = [
      ...document.querySelectorAll(
        'button, [role=tab], input, dialog[open], .coop, .profile, .panel, h1, h2, h3',
      ),
    ]
      .filter(visible)
      .map(element => {
        const box = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        const dialog = element.closest('dialog')
        const inset =
          dialog === null
            ? { right: 0, top: 0 }
            : {
                right: dialog.getBoundingClientRect().right - box.right,
                top: box.top - dialog.getBoundingClientRect().top,
              }
        return {
          tag: element.tagName.toLowerCase(),
          cls: element.className.toString().slice(0, 60),
          label: (
            element.getAttribute('aria-label') ?? element.textContent
          )
            .trim()
            .slice(0, 28),
          x: round(box.left),
          y: round(box.top),
          w: round(box.width),
          h: round(box.height),
          fromDialogRight: round(inset.right),
          fromDialogTop: round(inset.top),
          fontSize: style.fontSize,
          fontFamily: style.fontFamily.slice(0, 30),
          fontWeight: style.fontWeight,
          letterSpacing: style.letterSpacing,
          lineHeight: style.lineHeight,
          color: style.color,
          background: style.backgroundColor,
          borderWidth: style.borderTopWidth,
          borderStyle: style.borderTopStyle,
          borderColor: style.borderTopColor,
          radius: style.borderTopLeftRadius,
          shadow: style.boxShadow.slice(0, 80),
          padding: style.padding,
          opacity: style.opacity,
          cursor: style.cursor,
          isDisabled:
            element instanceof HTMLButtonElement && element.disabled,
        }
      })
    const images = [...document.querySelectorAll('img, canvas')]
      .filter(visible)
      .map(element => {
        const box = element.getBoundingClientRect()
        const natural =
          element instanceof HTMLImageElement
            ? element.naturalWidth
            : element instanceof HTMLCanvasElement
              ? element.width
              : 0
        return {
          tag: element.tagName.toLowerCase(),
          cls: element.className.toString().slice(0, 60),
          parent: element.parentElement?.className.toString().slice(0, 40) ?? '',
          natural,
          drawn: round(box.width),
          scale: natural === 0 ? 0 : round(box.width / natural),
          rendering: getComputedStyle(element).imageRendering,
        }
      })
    return { controls, images }
  })

const problems: Array<string> = []

mkdirSync(DIR, { recursive: true })
await useHarness()
const browser = await launch()
const pages = scenePages(browser, ['nodev', 'tick=72'])
for (const viewport of SHOT_VIEWPORTS) {
  for (const scene of SCENES) {
    if (!isPickedScene(scene.name)) {
      continue
    }
    const where = `${viewport.name}-${scene.name}`
    // NOTE: a scene whose query the harness refuses, or whose control is
    // missing, is a problem to report, never a reason to stop the pass.
    try {
      const page = await pages.open(
        viewport,
        harnessQuery(scene.query, deviceQuery(viewport)),
      )
      for (const selector of scene.open ?? []) {
        await page.locator(selector).first().click({ timeout: 5000 })
        await settleAnimations(page)
      }
      await wait(250)
      await settleAnimations(page)
      const metrics = await measure(page)
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
            `${where}: ${String(image['cls'])} drawn at ${scale}x, ${String(image['rendering'])}`,
          )
        }
      }
      writeJsonFile(Metrics, `${DIR}/${where}.json`, metrics)
      await page.screenshot({
        path: `${DIR}/${where}.png`,
        animations: 'disabled',
      })
      console.log(`shot ${where}`)
      pages.release(page)
    } catch (error) {
      problems.push(`${where}: ${String(error).split('\n')[0]}`)
    }
  }
}
await pages.close()
await browser.close()
finish(problems, 'The pixel pass found no problems.')
