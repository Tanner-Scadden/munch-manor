// Draws every icon in public/ from the pixel maps below: the 16 pixel
// favicon.svg for browser tabs, the 192 and 512 manifest icons, the 512
// maskable icon with the head inside the safe circle, and the 180 Apple touch
// icon. It also writes the same head into the loading splash in index.html,
// between the splash-zombie markers, and a contact sheet of every size to
// shots/icons.png.
//   bun icons.ts
import {
  Array,
  Console,
  Effect,
  FileSystem,
  Option,
  Path,
  String,
} from 'effect'
import type { Browser } from 'playwright-core'

import * as NodeServices from '@effect/platform-node/NodeServices'

import { openBrowser, runAuditWith } from './lib'
import { attempt, failWith } from './page'
import { BIG_HEAD, PALETTE } from './zombieHead'

const BACKGROUND = PALETTE['b'] ?? '#3b2160'

// PIXEL MAPS

// The tab favicon is its own map: at 16 pixels the big head turns to mush, so
// this one keeps only what reads at a glance, the eyes, the teeth, and the
// drip, on a purple tile with a dark rim for light and dark tab bars.
const FAVICON: ReadonlyArray<string> = [
  '.HHHHHHHHHHHHHH.',
  'HHHooooooooooHHH',
  'HHolllgggggkkoHH',
  'HollgggggggkjkoH',
  'HolgddggggddgdoH',
  'HolgrrggggrrgdoH',
  'HolgrrggggrrgdoH',
  'HolmmmmmmmmmmdoH',
  'HolmwwmwwmwwmdoH',
  'HolmmmmttmmmmdoH',
  'HolmmwmmmmwmmdoH',
  'HolmwwwmmwwwmdoH',
  'HoxgggggggggddoH',
  'HHxoddddddddoHHH',
  'HHxHooooooooHHHH',
  '.HXHHHHHHHHHHHH.',
]

// The big art is a 32 cell square: a purple glow of stepped rings behind the
// head, with a few sparkles.
const ART_SIZE = 32
const HEAD_TOP = 4

const glowAt = (x: number, y: number): string => {
  const distance = Math.hypot(x + 0.5 - ART_SIZE / 2, y + 0.5 - ART_SIZE / 2)
  if (distance < 12.5) {
    return 'H'
  }
  if (distance < 15.5) {
    return 'h'
  }
  return 'b'
}

const SPARKLES: ReadonlyArray<readonly [number, number]> = [
  [4, 5],
  [27, 25],
  [26, 6],
  [5, 26],
]

const BIG_ART: ReadonlyArray<string> = globalThis.Array.from(
  { length: ART_SIZE },
  (_row, y) =>
    Array.join(
      globalThis.Array.from({ length: ART_SIZE }, (_cell, x) => {
        const headX = x - (ART_SIZE - (BIG_HEAD[0]?.length ?? 0)) / 2
        const headCell = BIG_HEAD[y - HEAD_TOP]?.[headX]
        if (headCell !== undefined && headCell !== '.') {
          return headCell
        }
        if (Array.some(SPARKLES, ([sx, sy]) => sx === x && sy === y)) {
          return 's'
        }
        return glowAt(x, y)
      }),
      '',
    ),
)

// SVG

const assertSquare = (name: string, rows: ReadonlyArray<string>): void => {
  Array.forEach(rows, (row, y) => {
    if (row.length !== rows.length) {
      throw new Error(
        `${name} row ${y} is ${row.length} wide, not ${rows.length}`,
      )
    }
  })
}

const svgFor = (rows: ReadonlyArray<string>): string => {
  const rects = Array.flatMap(rows, (row, y) => {
    const runs: Array<string> = []
    let start = 0
    for (let x = 1; x <= row.length; x++) {
      if (x === row.length || row[x] !== row[start]) {
        const cell = row[start] ?? '.'
        if (cell !== '.') {
          const fill = PALETTE[cell]
          if (fill === undefined) {
            throw new Error(`no color for ${cell}`)
          }
          runs.push(
            `<rect x="${start}" y="${y}" width="${x - start}" height="1" fill="${fill}"/>`,
          )
        }
        start = x
      }
    }
    return runs
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${rows.length} ${rows.length}" shape-rendering="crispEdges">\n${Array.join(
    Array.map(rects, rect => `  ${rect}`),
    '\n',
  )}\n</svg>\n`
}

assertSquare('FAVICON', FAVICON)
assertSquare('BIG_ART', BIG_ART)

const FAVICON_SVG = svgFor(FAVICON)
const BIG_SVG = svgFor(BIG_ART)
const dataUrl = (svg: string): string =>
  `data:image/svg+xml,${encodeURIComponent(svg)}`

// SPLASH

// The loading splash shows the app icon's head on its own, without the glow,
// inline in index.html so it paints before any request. One path per color
// keeps it small.
const SPLASH_HEAD = Array.filter(BIG_HEAD, row =>
  Array.some(globalThis.Array.from(row), cell => cell !== '.'),
)
const SPLASH_START = '<!-- splash-zombie: written by tools/audit/icons.ts -->'
const SPLASH_END = '<!-- /splash-zombie -->'

const splashSvg = (rows: ReadonlyArray<string>): string => {
  const width = rows[0]?.length ?? 0
  const pathsByColor = new Map<string, Array<string>>()
  Array.forEach(rows, (row, y) => {
    let start = 0
    for (let x = 1; x <= row.length; x++) {
      if (x === row.length || row[x] !== row[start]) {
        const cell = row[start] ?? '.'
        if (cell !== '.') {
          const fill = PALETTE[cell]
          if (fill === undefined) {
            throw new Error(`no color for ${cell}`)
          }
          const runs = pathsByColor.get(fill) ?? []
          runs.push(`M${start} ${y}h${x - start}v1h-${x - start}z`)
          pathsByColor.set(fill, runs)
        }
        start = x
      }
    }
  })
  const paths = Array.map(
    [...pathsByColor.entries()],
    ([fill, runs]) =>
      `        <path fill="${fill}" d="${Array.join(runs, '')}" />`,
  )
  return `<svg class="splash-zombie" viewBox="0 0 ${width} ${rows.length}" aria-hidden="true">\n${Array.join(paths, '\n')}\n      </svg>`
}

// PNG ICONS

// share is how much of the icon the 32 cell art spans. Each cell is a whole
// number of pixels so the art stays sharp; the rest is background.
type Icon = Readonly<{ file: string; size: number; share: number }>

const ICONS: ReadonlyArray<Icon> = [
  { file: 'icon-192.png', size: 192, share: 1 },
  { file: 'icon-512.png', size: 512, share: 1 },
  { file: 'icon-maskable-512.png', size: 512, share: 0.75 },
  { file: 'apple-touch-icon.png', size: 180, share: 1 },
]

const iconPage = ({ size, share }: Icon): string => {
  const art = Math.floor((size * share) / ART_SIZE) * ART_SIZE
  return `<!doctype html><html><body style="margin:0">
<div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;background:${BACKGROUND}">
<img style="width:${art}px;height:${art}px;image-rendering:pixelated" src="${dataUrl(BIG_SVG)}">
</div></body></html>`
}

// CONTACT SHEET

// The favicon at tab sizes on a light and a dark tab bar, each app icon with
// a phone's rounded corner mask, and the maskable icon in its safe circle.

const sheetOf = (publicDir: string): string => {
  const fileUrl = (file: string): string => `file://${publicDir}/${file}`

  const tab = (background: string, text: string): string =>
    `<div style="display:flex;gap:16px;align-items:center;padding:12px;background:${background};color:${text};font:13px sans-serif">
${Array.join(
  Array.map(
    [16, 32, 48],
    size =>
      `<div style="display:flex;gap:6px;align-items:center"><img style="width:${size}px;height:${size}px;image-rendering:pixelated" src="${dataUrl(FAVICON_SVG)}"><span>${size}</span></div>`,
  ),
  '',
)}
<span>Munch Manor</span>
<img style="width:128px;height:128px;image-rendering:pixelated" src="${dataUrl(FAVICON_SVG)}"><span>16 at 8x</span></div>`

  return `<!doctype html><html><body style="margin:0;background:#888;font:12px sans-serif">
${tab('#f1f3f4', '#202124')}
${tab('#202124', '#e8eaed')}
<div style="display:flex;gap:16px;align-items:end;padding:12px;background:#d9d9d9">
${Array.join(
  Array.map(
    Array.filter(ICONS, icon => icon.file !== 'icon-maskable-512.png'),
    icon =>
      `<div><img style="width:${icon.size}px;height:${icon.size}px;border-radius:22%" src="${fileUrl(icon.file)}"><div>${icon.file}</div></div>`,
  ),
  '',
)}
<div><img style="width:512px;height:512px;clip-path:circle(40% at 50% 50%)" src="${fileUrl('icon-maskable-512.png')}"><div>maskable in the 80% safe circle</div></div>
</div>
<div style="display:flex;gap:16px;align-items:center;padding:12px;background:#1a1a1a;color:#eee">
${Array.join(
  Array.map(
    [48, 60, 72],
    size =>
      `<div><img style="width:${size}px;height:${size}px;border-radius:22%" src="${fileUrl('apple-touch-icon.png')}"><div>${size}</div></div>`,
  ),
  '',
)}
<img style="width:72px;height:72px;clip-path:circle(50%)" src="${fileUrl('icon-maskable-512.png')}">
</div></body></html>`
}

// WRITING

const render = (
  browser: Browser,
  html: string,
  width: number,
  height: number,
  path: string,
) =>
  Effect.gen(function* () {
    const context = yield* attempt(() =>
      browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 }),
    )
    const page = yield* attempt(() => context.newPage())
    yield* attempt(() => page.setContent(html))
    yield* attempt(() => page.waitForLoadState('load'))
    yield* attempt(() =>
      page.screenshot({ path, clip: { x: 0, y: 0, width, height } }),
    )
    yield* attempt(() => context.close())
  })

runAuditWith(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const publicDir = path.resolve(import.meta.dir, '../../public')
    const indexFile = path.resolve(import.meta.dir, '../../index.html')
    const shotsDir = path.resolve(import.meta.dir, 'shots')

    yield* fs.writeFileString(`${publicDir}/favicon.svg`, FAVICON_SVG)
    yield* Console.log('wrote public/favicon.svg')

    const indexHtml = yield* fs.readFileString(indexFile)
    const splashStart = String.indexOf(SPLASH_START)(indexHtml)
    const splashEnd = String.indexOf(SPLASH_END)(indexHtml)
    if (
      Option.isNone(splashStart) ||
      Option.isNone(splashEnd) ||
      splashEnd.value < splashStart.value
    ) {
      return yield* failWith('index.html is missing the splash-zombie markers')
    }
    yield* fs.writeFileString(
      indexFile,
      `${String.slice(0, splashStart.value + SPLASH_START.length)(indexHtml)}\n      ${splashSvg(SPLASH_HEAD)}\n      ${String.slice(splashEnd.value)(indexHtml)}`,
    )
    yield* Console.log('wrote the splash head in index.html')

    const browser = yield* openBrowser
    for (const icon of ICONS) {
      yield* render(
        browser,
        iconPage(icon),
        icon.size,
        icon.size,
        `${publicDir}/${icon.file}`,
      )
      yield* Console.log(`wrote public/${icon.file}`)
    }

    yield* fs.makeDirectory(shotsDir, { recursive: true })
    const sheetFile = `${shotsDir}/icons.html`
    yield* fs.writeFileString(sheetFile, sheetOf(publicDir))
    const context = yield* attempt(() =>
      browser.newContext({
        viewport: { width: 1520, height: 900 },
        deviceScaleFactor: 1,
      }),
    )
    const page = yield* attempt(() => context.newPage())
    yield* attempt(() => page.goto(`file://${sheetFile}`))
    yield* attempt(() =>
      page.screenshot({ path: `${shotsDir}/icons.png`, fullPage: true }),
    )
    yield* attempt(() => context.close())
    yield* Console.log('wrote tools/audit/shots/icons.png')
  }),
  NodeServices.layer,
)
