import { plugin } from 'bun'
import { Array, Console, Effect, FileSystem, Path, Schema } from 'effect'

// Draws public/og-image.png, the 1200x630 card shown when a link to the game
// is shared: the dripping MUNCH MANOR logo from the title screen, the chomping
// Groaner head from the app icon, and one line in the game's pixel font, on
// the icon's purple. Nothing on it names a wave, a feature, or a version, so
// it only needs a rerun when the logo or the icon art changes.
//   bun og.ts
// It also writes shots/og-600.png and shots/og-300.png, the card scaled down
// the way chat apps shrink a link preview.
import * as NodeServices from '@effect/platform-node/NodeServices'

import { openBrowser, runAuditWith } from './lib'
import { attempt } from './page'
import { BIG_HEAD, PALETTE } from './zombieHead'

// SOURCES

// The logo is private to src/screens.ts, so it is loaded with a few exports
// added. The head is the app icon's (zombieHead.ts).
plugin({
  name: 'og-sources',
  setup(build) {
    build.onLoad({ filter: /src\/screens\.ts$/ }, ({ path }) =>
      Bun.file(path)
        .text()
        .then(text => ({
          contents: `${text}
export { logoLetterPixels, MUNCH_LOOK, MANOR_LOOK, TITLE_WORDS, LOGO_GAP, LOGO_LINE_PX, LOGO_BOB_PX }
`,
          loader: 'ts' as const,
        })),
    )
  },
})

type Rows = ReadonlyArray<string>
type Palette = Readonly<Record<string, string>>

// NOTE: the added exports are invisible to TypeScript, so the module is
// decoded: a renamed or reshaped export fails here by name.
const LogoLook = Schema.Struct({
  palette: Schema.Record(Schema.String, Schema.String),
})
const Screens = Schema.Struct({
  logoLetterPixels: Schema.declare(
    (value: unknown): value is (glyph: string, seed: number) => Rows =>
      typeof value === 'function',
  ),
  MUNCH_LOOK: LogoLook,
  MANOR_LOOK: LogoLook,
  TITLE_WORDS: Schema.Array(Schema.String),
  LOGO_GAP: Schema.Finite,
  LOGO_LINE_PX: Schema.Finite,
  LOGO_BOB_PX: Schema.Finite,
})

runAuditWith(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const ROOT = path.resolve(import.meta.dir, '../..')
    const OUT = `${ROOT}/public/og-image.png`
    const SHOTS = path.resolve(import.meta.dir, 'shots')

    const screensModule = yield* attempt(() => import('../../src/screens.ts'))
    const screens = yield* Schema.decodeUnknownEffect(Screens)(screensModule)
    const font: { textPixels: (text: string) => Rows } = yield* attempt(
      () => import('../../src/font.ts'),
    )

    // CARD

    const WIDTH = 1200
    const HEIGHT = 630

    const COLORS = {
      base: '#3b2160',
      rim1: '#331c55',
      rim2: '#2b1749',
      rim3: '#22123b',
      glowOuter: '#4b2c78',
      glow: '#6d4a9a',
      glowInner: '#8a62c0',
      sparkle: '#c39be8',
      board: '#1c0f30',
      boardTop: '#2a1748',
      seam: '#130a22',
      ink: '#f4f1de',
      shadow: '#140c10',
      soft: '#c39be8',
    }

    type Rect = Readonly<{
      x: number
      y: number
      width: number
      height: number
      fill: string
    }>

    const rects: Array<Rect> = []
    const fill = (
      x: number,
      y: number,
      width: number,
      height: number,
      color: string,
    ): void => {
      rects.push({ x, y, width, height, fill: color })
    }

    // Paints a pixel map at a whole number scale, one rectangle per run of
    // cells that share a color.
    const paintRows = (
      rows: Rows,
      palette: Palette,
      left: number,
      top: number,
      scale: number,
    ): void => {
      Array.forEach(rows, (row, y) => {
        let start = 0
        for (let x = 1; x <= row.length; x++) {
          if (x === row.length || row[x] !== row[start]) {
            const cell = row[start] ?? '.'
            if (cell !== '.') {
              const color = palette[cell]
              if (color === undefined) {
                throw new Error(`no color for ${cell}`)
              }
              fill(
                left + start * scale,
                top + y * scale,
                (x - start) * scale,
                scale,
                color,
              )
            }
            start = x
          }
        }
      })
    }

    const widthOf = (rows: Rows): number =>
      Math.max(0, ...Array.map(rows, row => row.length))

    // LAYOUT

    const HEAD_SCALE = 14
    const LOGO_SCALE = 6
    const TEXT_SCALE = 5

    const HEAD = Array.filter(BIG_HEAD, row => /[^.]/.test(row))
    const HEAD_W = widthOf(HEAD) * HEAD_SCALE
    const HEAD_H = HEAD.length * HEAD_SCALE

    type Letter = Readonly<{ rows: Rows; palette: Palette; bob: number }>

    // The same seeds and the same bob as the title screen, frozen at its first
    // frame, so the letters sit at the jaunty tilt the game opens on.
    const LOGO: ReadonlyArray<ReadonlyArray<Letter>> = Array.map(
      screens.TITLE_WORDS,
      (word, line) =>
        Array.map(globalThis.Array.from(word), (glyph, index) => ({
          rows: screens.logoLetterPixels(glyph, line * 5 + index),
          palette: (line % 2 === 0 ? screens.MUNCH_LOOK : screens.MANOR_LOOK)
            .palette,
          bob: Math.round(
            Math.sin((index + line * 2) * 0.9) * screens.LOGO_BOB_PX,
          ),
        })),
    )

    const lineCells = (letters: ReadonlyArray<Letter>): number =>
      Array.reduce(
        letters,
        0,
        (sum, { rows }) => sum + widthOf(rows) + screens.LOGO_GAP,
      ) - screens.LOGO_GAP

    const LOGO_W = Math.max(...Array.map(LOGO, lineCells)) * LOGO_SCALE
    const LETTER_ROWS = Math.max(
      ...Array.flatMap(LOGO, line =>
        Array.map(line, ({ rows }) => rows.length),
      ),
    )
    const LOGO_H =
      ((LOGO.length - 1) * screens.LOGO_LINE_PX + LETTER_ROWS) * LOGO_SCALE

    const TAGLINE = font.textPixels('TRY NOT TO GET EATEN.')
    const TAG_W = widthOf(TAGLINE) * TEXT_SCALE
    const SUBLINE = font.textPixels('PLAY FREE IN YOUR BROWSER')
    const SUB_SCALE = 3
    const SUB_W = widthOf(SUBLINE) * SUB_SCALE

    const GAP = 52
    const BLOCK_W = HEAD_W + GAP + Math.max(LOGO_W, TAG_W)
    const LEFT = Math.round((WIDTH - BLOCK_W) / 2)
    const FLOOR_TOP = 560
    const MIDDLE = 292

    const HEAD_X = LEFT
    const HEAD_Y = Math.round(MIDDLE - HEAD_H / 2)
    const TEXT_X = LEFT + HEAD_W + GAP
    const TEXT_W = Math.max(LOGO_W, TAG_W)
    const LOGO_Y = Math.round(MIDDLE - (LOGO_H + 40 + 6 * TEXT_SCALE) / 2) - 8
    const TAG_Y = LOGO_Y + LOGO_H + 30

    // BACKGROUND

    // A stepped vignette in 10 pixel cells: the purple darkens toward the
    // corners, the way the icon's glow steps.
    const CELL = 10
    for (let cy = 0; cy < HEIGHT / CELL; cy++) {
      for (let cx = 0; cx < WIDTH / CELL; cx++) {
        const dx = (cx + 0.5) / (WIDTH / CELL) - 0.5
        const dy = (cy + 0.5) / (HEIGHT / CELL) - 0.5
        const distance = Math.hypot(dx * 1.1, dy * 1.5)
        const color =
          distance < 0.42
            ? COLORS.base
            : distance < 0.52
              ? COLORS.rim1
              : distance < 0.62
                ? COLORS.rim2
                : COLORS.rim3
        fill(cx * CELL, cy * CELL, CELL, CELL, color)
      }
    }

    // The icon's glow behind the head, in the head's own cells.
    const GLOW_X = HEAD_X + HEAD_W / 2
    const GLOW_Y = HEAD_Y + HEAD_H / 2
    for (let gy = -16; gy <= 16; gy++) {
      for (let gx = -16; gx <= 16; gx++) {
        const x = GLOW_X + (gx - 0.5) * HEAD_SCALE
        const y = GLOW_Y + (gy - 0.5) * HEAD_SCALE
        const distance = Math.hypot(gx, gy)
        const color =
          distance < 11.5
            ? COLORS.glowInner
            : distance < 14
              ? COLORS.glow
              : distance < 16
                ? COLORS.glowOuter
                : undefined
        if (color !== undefined && y + HEAD_SCALE <= FLOOR_TOP) {
          fill(Math.round(x), Math.round(y), HEAD_SCALE, HEAD_SCALE, color)
        }
      }
    }

    // Sparkles, as on the icon: small pixel crosses.
    const SPARKLES: ReadonlyArray<readonly [number, number, number]> = [
      [GLOW_X - 190, GLOW_Y - 150, 6],
      [GLOW_X + 175, GLOW_Y + 140, 6],
      [TEXT_X + TEXT_W + 30, LOGO_Y + 10, 5],
      [1110, 470, 4],
      [1080, 96, 4],
      [120, 470, 4],
    ]
    for (const [x, y, size] of SPARKLES) {
      const sx = Math.round(x)
      const sy = Math.round(y)
      fill(sx - size, sy - size * 3, size * 2, size * 6, COLORS.sparkle)
      fill(sx - size * 3, sy - size, size * 6, size * 2, COLORS.sparkle)
    }

    // Floorboards along the bottom, dark so they frame without pulling the eye.
    fill(0, FLOOR_TOP, WIDTH, HEIGHT - FLOOR_TOP, COLORS.board)
    fill(0, FLOOR_TOP, WIDTH, 5, COLORS.boardTop)
    const BOARD_H = 24
    for (let row = 0; FLOOR_TOP + 5 + row * BOARD_H < HEIGHT; row++) {
      const top = FLOOR_TOP + 5 + row * BOARD_H
      fill(0, top + BOARD_H - 4, WIDTH, 4, COLORS.seam)
      for (let x = (row % 2) * 90 - 60; x < WIDTH; x += 180) {
        fill(x, top, 4, BOARD_H - 4, COLORS.seam)
      }
    }

    // FOREGROUND

    paintRows(HEAD, PALETTE, HEAD_X, HEAD_Y, HEAD_SCALE)

    Array.forEach(LOGO, (letters, line) => {
      let x =
        TEXT_X + Math.round((TEXT_W - lineCells(letters) * LOGO_SCALE) / 2)
      Array.forEach(letters, ({ rows, palette, bob }) => {
        paintRows(
          rows,
          palette,
          x,
          LOGO_Y + (line * screens.LOGO_LINE_PX + bob) * LOGO_SCALE,
          LOGO_SCALE,
        )
        x += (widthOf(rows) + screens.LOGO_GAP) * LOGO_SCALE
      })
    })

    // The tagline with a hard drop shadow, like the game's text.
    const TAG_X = TEXT_X + Math.round((TEXT_W - TAG_W) / 2)
    paintRows(
      TAGLINE,
      { '#': COLORS.shadow },
      TAG_X,
      TAG_Y + TEXT_SCALE,
      TEXT_SCALE,
    )
    paintRows(TAGLINE, { '#': COLORS.ink }, TAG_X, TAG_Y, TEXT_SCALE)

    const SUB_X = TEXT_X + Math.round((TEXT_W - SUB_W) / 2)
    const SUB_Y = TAG_Y + 6 * TEXT_SCALE + 22
    paintRows(
      SUBLINE,
      { '#': COLORS.shadow },
      SUB_X,
      SUB_Y + SUB_SCALE,
      SUB_SCALE,
    )
    paintRows(SUBLINE, { '#': COLORS.soft }, SUB_X, SUB_Y, SUB_SCALE)

    // RENDER

    const browser = yield* openBrowser
    const context = yield* attempt(() =>
      browser.newContext({
        viewport: { width: WIDTH, height: HEIGHT },
        deviceScaleFactor: 1,
      }),
    )
    const page = yield* attempt(() => context.newPage())
    yield* attempt(() =>
      page.setContent(
        `<!doctype html><html><body style="margin:0"><canvas width="${WIDTH}" height="${HEIGHT}"></canvas></body></html>`,
      ),
    )
    yield* attempt(() =>
      page.evaluate((list: ReadonlyArray<Rect>) => {
        const canvas = document.querySelector('canvas')
        const context2d = canvas?.getContext('2d')
        if (context2d === null || context2d === undefined) {
          throw new Error('no canvas')
        }
        for (const rect of list) {
          context2d.fillStyle = rect.fill
          context2d.fillRect(rect.x, rect.y, rect.width, rect.height)
        }
      }, rects),
    )
    yield* attempt(() =>
      page.screenshot({
        path: OUT,
        clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
      }),
    )
    yield* Console.log(`wrote public/og-image.png (${WIDTH}x${HEIGHT})`)

    // PREVIEWS

    yield* fs.makeDirectory(SHOTS, { recursive: true })
    const cardBytes = yield* fs.readFile(OUT)
    const card = `data:image/png;base64,${Buffer.from(cardBytes).toString('base64')}`
    for (const width of [600, 300]) {
      const height = Math.floor((width * HEIGHT) / WIDTH)
      yield* attempt(() =>
        page.setContent(
          `<!doctype html><html><body style="margin:0"><img style="display:block;width:${width}px;height:${height}px" src="${card}"></body></html>`,
        ),
      )
      yield* attempt(() => page.waitForLoadState('load'))
      yield* attempt(() =>
        page.screenshot({
          path: `${SHOTS}/og-${width}.png`,
          clip: { x: 0, y: 0, width, height },
        }),
      )
      yield* Console.log(`wrote tools/audit/shots/og-${width}.png`)
    }

    yield* attempt(() => context.close())
  }),
  NodeServices.layer,
)
