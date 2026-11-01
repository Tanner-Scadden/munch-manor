import { Array, Option, Result, String } from 'effect'
import type { Canvas } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { FEEDBACK_LINE, VIEW_HEIGHT, VIEW_WIDTH } from './constants'
import {
  CREW_BOARD_PX,
  PANEL_EDGE,
  PANEL_FILL,
  crewBoardShapes,
  sparkShapes,
} from './crewBoardView'
import { QUARTER_TURN, rect } from './drawing'
import {
  BEST_POP_MS,
  type EndKind,
  FALL_MS,
  FALL_START_MS,
  FLASH_MS,
  STAMP_MS,
  TIMELINES,
  TROPHY_DROP_MS,
  type TallyRow,
  easeOut,
  easeOutBack,
  endKindOf,
  hasRankStrip,
  progressOf,
  rowLandMs,
  rowStartMs,
  shownValue,
  skullAtMs,
  skullCountOf,
  tallyRowsOf,
} from './endBeat'
import {
  type BakedText,
  GLYPH_HEIGHT,
  type TextTone,
  bakeText,
  placeBaked,
  textShapes,
  textWidth,
} from './font'
import { isAskingForFeedback } from './home'
import {
  SKULL_ART,
  SKULL_OFF_ART,
  TROPHY_PALETTE,
  TROPHY_PIXELS,
} from './icons'
import { Invulnerability, type Model, Phase, type Zombie } from './model'
import { isCoop } from './party'
import type { Difficulty } from './playerData'
import { playerFootY } from './playerView'
import { STRIP_PX, rankStripShapes } from './rankStripView'
import { type Sprite, group, placeAt, spriteShapes } from './sprite'
import { ZOMBIE_SPRITES } from './sprites/zombies'
import { defeatQuip, victoryVerdict } from './stats'
import { ICON_SHIFT, TALLY_ICONS, type TallyIcon } from './tallyIcons'
import { roundWave } from './waves'
import { ZOMBIE_KIND_ORDER } from './zombies'

// The end of a run on the overlay canvas, in the landscape frame: the flash,
// the stamp, the trophy and skulls, the tally card (a crew's board in
// co-op, src/crewBoardView.ts), and confetti. Every piece is placed by the end screen's clock
// (src/endBeat.ts), so a frame is a pure function of the Model.

const CENTER_X = VIEW_WIDTH / 2
const TITLE_SCALE = 2

// ART

const TROPHY = spriteShapes(TROPHY_PIXELS, TROPHY_PALETTE)
const TROPHY_SCALE = 2

const SKULLS: Readonly<Record<Difficulty, Sprite>> = {
  Easy: spriteShapes(SKULL_ART.Easy.pixels, SKULL_ART.Easy.palette),
  Normal: spriteShapes(SKULL_ART.Normal.pixels, SKULL_ART.Normal.palette),
  Hard: spriteShapes(SKULL_ART.Hard.pixels, SKULL_ART.Hard.palette),
  Nightmare: spriteShapes(
    SKULL_ART.Nightmare.pixels,
    SKULL_ART.Nightmare.palette,
  ),
}
const SKULL_OFF = spriteShapes(SKULL_OFF_ART.pixels, SKULL_OFF_ART.palette)

// TEXT

const TITLES: Readonly<Record<EndKind, BakedText>> = {
  Munched: bakeText('MUNCHED!', 'Defeat'),
  Won: bakeText('YOU SURVIVED!', 'Victory'),
}

const LABELS: Readonly<Record<string, BakedText>> = {
  WAVE: bakeText('WAVE', 'Hint'),
  TIME: bakeText('TIME', 'Hint'),
  SPLATTED: bakeText('SPLATTED', 'Hint'),
  STREAK: bakeText('STREAK', 'Hint'),
  AIM: bakeText('AIM', 'Hint'),
  CASH: bakeText('CASH', 'Hint'),
}

const NEW_BEST = bakeText('NEW BEST!', 'Fresh')
const NEW_BEST_LIT = bakeText('NEW BEST!', 'Victory')
const FEEDBACK = bakeText(String.toUpperCase(FEEDBACK_LINE), 'Hint')
const NIGHTMARE_UNLOCKED = bakeText('NIGHTMARE UNLOCKED!', 'Victory')
const NIGHTMARE_UNLOCKED_DIM = bakeText('NIGHTMARE UNLOCKED!', 'Alert')

// LAYOUT

type Layout = Readonly<{
  trophyX: number
  trophyY: number
  titleY: number
  skullsY: number
  quipY: number
  panelTop: number
}>

const LAYOUTS: Readonly<Record<EndKind, Layout>> = {
  Munched: {
    trophyX: 0,
    trophyY: 0,
    titleY: 12,
    skullsY: 30,
    quipY: 43,
    panelTop: 53,
  },
  Won: {
    trophyX: 0,
    trophyY: 3,
    titleY: 24,
    skullsY: 39,
    quipY: 51,
    panelTop: 61,
  },
}

// NOTE: a crew's card is the tallest, with the board and the rank strip
// under it, so on a phone on its side the stack has to end above the buttons.
// Its title rides the top edge with the trophy beside it, and the board
// starts right under (CREW_BOARD_TOP_PX).
const CREW_LAYOUT: Layout = {
  trophyX: -74,
  trophyY: 1,
  titleY: 4,
  skullsY: 0,
  quipY: 0,
  panelTop: 0,
}
export const CREW_BOARD_TOP_PX = 18

const layoutOf = (model: Model, kind: EndKind): Layout =>
  isCoop(model) ? CREW_LAYOUT : LAYOUTS[kind]

const PANEL_LEFT = 82
const PANEL_RIGHT = VIEW_WIDTH - PANEL_LEFT
const PANEL_PAD = 5
const ROW_PX = 10
// NOTE: with the rank strip in the panel the rows sit a pixel closer, so
// the card still ends above the buttons on a phone on its side.
const STRIPPED_ROW_PX = 9
const STRIP_GAP_PX = 2
const KINDS_PX = 11
const SKULL_STRIDE = 12
const SKULL_SLOTS = 4

// NOTE: reaches well past the landscape screen, so in portrait it covers
// the HUD band and the thumb area too. The canvas clips the rest.
const wash = (fill: string, opacity: number): Canvas.Shape =>
  group({
    opacity,
    shapes: [
      rect(
        -VIEW_WIDTH,
        -VIEW_HEIGHT * 2,
        VIEW_WIDTH * 3,
        VIEW_HEIGHT * 5,
        fill,
      ),
    ],
  })

// FLASH AND DIM

const flashShapes = (kind: EndKind, ms: number): ReadonlyArray<Canvas.Shape> =>
  ms < FLASH_MS
    ? [
        wash(
          kind === 'Munched' ? '#ff2030' : '#fff6d0',
          (kind === 'Munched' ? 0.5 : 0.3) * (1 - ms / FLASH_MS),
        ),
      ]
    : []

const DIM_MAX = 0.72

const dimShapes = (kind: EndKind, ms: number): ReadonlyArray<Canvas.Shape> => {
  const { stampAtMs, cardAtMs } = TIMELINES[kind]
  const opacity =
    DIM_MAX * progressOf(ms, stampAtMs - 120, cardAtMs - stampAtMs)
  return opacity > 0 ? [wash('#080a0c', opacity)] : []
}

// STAMP

const stampShapes = (
  kind: EndKind,
  ms: number,
  layout: Layout,
): ReadonlyArray<Canvas.Shape> => {
  const t = progressOf(ms, TIMELINES[kind].stampAtMs, STAMP_MS)
  if (ms < TIMELINES[kind].stampAtMs) {
    return []
  }
  const scale = TITLE_SCALE * (3 - 2 * easeOutBack(t))
  const height = GLYPH_HEIGHT * TITLE_SCALE
  return [
    placeBaked(TITLES[kind], {
      x: CENTER_X,
      y: layout.titleY + height / 2 - (GLYPH_HEIGHT * scale) / 2,
      align: 'Center',
      scale,
      opacity: Math.min(1, 0.4 + t),
    }),
  ]
}

// TROPHY AND SKULLS

const trophyShapes = (
  kind: EndKind,
  ms: number,
  layout: Layout,
): ReadonlyArray<Canvas.Shape> => {
  const atMs = TIMELINES[kind].trophyAtMs
  if (ms < atMs) {
    return []
  }
  const t = easeOutBack(progressOf(ms, atMs, TROPHY_DROP_MS))
  const size = TROPHY_PIXELS.length * TROPHY_SCALE
  const y = -size + (layout.trophyY + size) * t
  return [
    group({
      translate: { x: CENTER_X + layout.trophyX, y: Math.round(y + size / 2) },
      scale: { x: TROPHY_SCALE, y: TROPHY_SCALE },
      shapes: TROPHY,
    }),
  ]
}

// NOTE: the difficulty as the home menu's skull meter: its skulls lit in
// its own look, the rest dark. On a win they pop in one by one.
const skullShapes = (
  model: Model,
  kind: EndKind,
  ms: number,
  layout: Layout,
): ReadonlyArray<Canvas.Shape> => {
  const lit = skullCountOf(model.difficulty.chosen)
  const left = CENTER_X - ((SKULL_SLOTS - 1) * SKULL_STRIDE) / 2
  return Array.filterMap(Array.range(0, SKULL_SLOTS - 1), index => {
    const atMs = kind === 'Won' ? skullAtMs(index) : TIMELINES[kind].stampAtMs
    if (ms < atMs) {
      return Result.failVoid
    }
    const pop = 1 + 0.6 * (1 - easeOut(progressOf(ms, atMs, 160)))
    return Result.succeed(
      group({
        translate: {
          x: Math.round(left + index * SKULL_STRIDE),
          y: layout.skullsY + 5,
        },
        scale: pop === 1 ? undefined : { x: pop, y: pop },
        shapes: index < lit ? SKULLS[model.difficulty.chosen] : SKULL_OFF,
      }),
    )
  })
}

// TALLY

const ROW_SLIDE_PX = 8
const BLINK_MS = 600

const bestShapes = (
  row: TallyRow,
  kind: EndKind,
  index: number,
  ms: number,
  right: number,
  y: number,
): ReadonlyArray<Canvas.Shape> => {
  const landMs = rowLandMs(kind, index)
  if (!row.isBest || ms < landMs) {
    return []
  }
  const pop = 1 + 1.2 * (1 - easeOutBack(progressOf(ms, landMs, BEST_POP_MS)))
  const x = right - Math.round((NEW_BEST.width * pop) / 2)
  return [
    placeBaked(Math.floor(ms / BLINK_MS) % 2 === 0 ? NEW_BEST : NEW_BEST_LIT, {
      x,
      y: Math.round(y + GLYPH_HEIGHT / 2 - (GLYPH_HEIGHT * pop) / 2),
      align: 'Center',
      scale: pop,
    }),
    ...sparkShapes(x, y + 3, ms - landMs),
  ]
}

const VALUE_TONES: Readonly<Record<TallyIcon, TextTone>> = {
  Wave: 'Plain',
  Time: 'Plain',
  Kills: 'Plain',
  Streak: 'Streak',
  Aim: 'Plain',
  Cash: 'Coin',
}

const rowShapes =
  (kind: EndKind, ms: number, top: number, rowPx: number) =>
  (row: TallyRow, index: number): ReadonlyArray<Canvas.Shape> => {
    const startMs = rowStartMs(kind, index)
    if (ms < startMs) {
      return []
    }
    const slide = Math.round(
      ROW_SLIDE_PX * (1 - easeOut(progressOf(ms, startMs, 120))),
    )
    const y = top + PANEL_PAD + index * rowPx
    const value = row.format(shownValue(row, kind, index, ms))
    const valueRight = PANEL_RIGHT - PANEL_PAD
    return [
      placeAt(
        PANEL_LEFT + PANEL_PAD + 3 - slide - ICON_SHIFT[row.icon],
        y + 3 - ICON_SHIFT[row.icon],
        TALLY_ICONS[row.icon],
      ),
      placeBaked(LABELS[row.label] ?? bakeText(row.label, 'Hint'), {
        x: PANEL_LEFT + PANEL_PAD + 11 - slide,
        y,
        align: 'Left',
      }),
      ...textShapes(
        value,
        row.isBest && ms >= rowLandMs(kind, index)
          ? 'Victory'
          : VALUE_TONES[row.icon],
        valueRight,
        y,
        'Right',
      ),
      ...bestShapes(
        row,
        kind,
        index,
        ms,
        valueRight - textWidth(value) - 4 - Math.round(NEW_BEST.width / 2),
        y,
      ),
    ]
  }

const KILL_SLOT_PX = 26
const KILL_ICON_PX = 7
const KILL_ICON_GAP = 2

const kindShapes = (model: Model, y: number): ReadonlyArray<Canvas.Shape> => {
  const left = Math.round(
    CENTER_X - (ZOMBIE_KIND_ORDER.length * KILL_SLOT_PX) / 2,
  )
  return Array.flatMap(ZOMBIE_KIND_ORDER, (kind, index) => {
    const count = `x${model.stats.kills[kind]}`
    const slotCenter = left + index * KILL_SLOT_PX + KILL_SLOT_PX / 2
    const x = Math.round(
      slotCenter - (KILL_ICON_PX + KILL_ICON_GAP + textWidth(count)) / 2,
    )
    return [
      placeAt(
        x + Math.floor(KILL_ICON_PX / 2),
        y + 3,
        ZOMBIE_SPRITES[kind].icon,
      ),
      ...textShapes(count, 'Kill', x + KILL_ICON_PX + KILL_ICON_GAP, y, 'Left'),
    ]
  })
}

// THE CARD

const quipOf = (model: Model, kind: EndKind): string =>
  String.toUpperCase(
    kind === 'Won'
      ? victoryVerdict(model.stats)
      : defeatQuip(roundWave(model.phase), model.stats),
  )

// NOTE: the bar a crew's rank strip sits in, under the board.
const crewStripTop = CREW_BOARD_TOP_PX + CREW_BOARD_PX + STRIP_GAP_PX + 1

// NOTE: where a crew's card ends in the 180 high frame: the board, and the
// strip's bar under it when there is one. A phone on its side puts the
// buttons' tops at about 133 (END_BUTTONS_TOP_PX), so this stays above.
export const crewCardBottomPx = (hasStrip: boolean): number =>
  hasStrip ? crewStripTop + STRIP_PX + 4 : CREW_BOARD_TOP_PX + CREW_BOARD_PX + 2

export const END_BUTTONS_TOP_PX = 133

const crewStripPanel = (top: number): ReadonlyArray<Canvas.Shape> => [
  rect(
    PANEL_LEFT - 1,
    top - 1,
    PANEL_RIGHT - PANEL_LEFT + 2,
    STRIP_PX + 4,
    PANEL_EDGE,
  ),
  rect(PANEL_LEFT, top, PANEL_RIGHT - PANEL_LEFT, STRIP_PX + 2, PANEL_FILL),
]

const CARD_FADE_MS = 160
const CARD_RISE_PX = 6

const cardShapes = (
  model: Model,
  kind: EndKind,
  ms: number,
  layout: Layout,
): ReadonlyArray<Canvas.Shape> => {
  const cardAtMs = TIMELINES[kind].cardAtMs
  if (ms < cardAtMs) {
    return []
  }
  const t = easeOut(progressOf(ms, cardAtMs, CARD_FADE_MS))
  const rise = (shapes: ReadonlyArray<Canvas.Shape>): Canvas.Shape =>
    group({
      translate: { x: 0, y: Math.round(CARD_RISE_PX * (1 - t)) },
      opacity: t >= 1 ? undefined : t,
      shapes,
    })
  if (isCoop(model)) {
    // NOTE: a crew's board takes the quip's line too, so it fits above the
    // buttons on a phone on its side.
    const hasStrip = hasRankStrip(model)
    // NOTE: the strip sits in its own bar under the board.
    const boardTop = CREW_BOARD_TOP_PX
    const board = crewBoardShapes(model, kind, ms, boardTop, CENTER_X)
    const stripTop = crewStripTop
    return [
      rise([...board.panel, ...(hasStrip ? crewStripPanel(stripTop) : [])]),
      ...board.rows,
      ...rankStripShapes(
        model,
        kind,
        ms,
        PANEL_LEFT + PANEL_PAD,
        stripTop + Math.floor(STRIP_PX / 2) + 1,
        PANEL_RIGHT - PANEL_LEFT - PANEL_PAD * 2,
      ),
    ]
  }
  const rows = tallyRowsOf(model)
  const hasStrip = hasRankStrip(model)
  const rowPx = hasStrip ? STRIPPED_ROW_PX : ROW_PX
  const top = layout.panelTop
  const footerTop = top + PANEL_PAD + rows.length * rowPx + 2
  const stripTop = footerTop + KINDS_PX
  const bottom =
    footerTop + KINDS_PX + PANEL_PAD - 2 + (hasStrip ? STRIP_PX + 2 : 0)
  return [
    rise([
      ...lineShapes(model, kind, ms, layout.quipY),
      rect(
        PANEL_LEFT - 1,
        top - 1,
        PANEL_RIGHT - PANEL_LEFT + 2,
        bottom - top + 2,
        PANEL_EDGE,
      ),
      rect(PANEL_LEFT, top, PANEL_RIGHT - PANEL_LEFT, bottom - top, PANEL_FILL),
      rect(
        PANEL_LEFT + PANEL_PAD,
        footerTop - 2,
        PANEL_RIGHT - PANEL_LEFT - PANEL_PAD * 2,
        1,
        PANEL_EDGE,
      ),
      ...(hasStrip
        ? [
            rect(
              PANEL_LEFT + PANEL_PAD,
              stripTop,
              PANEL_RIGHT - PANEL_LEFT - PANEL_PAD * 2,
              1,
              PANEL_EDGE,
            ),
          ]
        : []),
      ...kindShapes(model, footerTop + 1),
    ]),
    ...Array.flatMap(rows, rowShapes(kind, ms, top, rowPx)),
    ...rankStripShapes(
      model,
      kind,
      ms,
      PANEL_LEFT + PANEL_PAD,
      stripTop + 2 + Math.floor(STRIP_PX / 2),
      PANEL_RIGHT - PANEL_LEFT - PANEL_PAD * 2,
    ),
  ]
}

const UNLOCK_BLINK_MS = 400

// NOTE: the line over the tally is the quip, or, when there is news (Nightmare
// unlocked, or the first runs' ask for feedback), the news in its place. Under
// the card there is no room: on a phone on its side the buttons start there.
const lineShapes = (
  model: Model,
  kind: EndKind,
  ms: number,
  y: number,
): ReadonlyArray<Canvas.Shape> => {
  const note = noteShapes(model, ms, y)
  return Array.isReadonlyArrayNonEmpty(note)
    ? note
    : textShapes(quipOf(model, kind), 'Prompt', CENTER_X, y, 'Center')
}

const noteShapes = (
  model: Model,
  ms: number,
  y: number,
): ReadonlyArray<Canvas.Shape> => {
  if (model.difficulty.nightmare === 'JustUnlocked') {
    return [
      placeBaked(
        Math.floor(ms / UNLOCK_BLINK_MS) % 2 === 0
          ? NIGHTMARE_UNLOCKED
          : NIGHTMARE_UNLOCKED_DIM,
        { x: CENTER_X, y, align: 'Center' },
      ),
    ]
  } else if (isAskingForFeedback(model)) {
    return [placeBaked(FEEDBACK, { x: CENTER_X, y, align: 'Center' })]
  } else {
    return []
  }
}

// CONFETTI

const CONFETTI = 40
const CONFETTI_MS = 6000
const CONFETTI_FADE_MS = 900
const CONFETTI_COLORS: ReadonlyArray<string> = [
  '#ffd23f',
  '#ff6fb5',
  '#3fd2ff',
  '#8cff5a',
  '#ff4a4f',
  '#9be36a',
  '#7a1020',
  '#f4f1de',
]

// NOTE: a fixed scatter from each piece's index, so confetti needs no state.
const scatter = (index: number, salt: number): number => {
  const wave = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453
  return wave - Math.floor(wave)
}

const confettiShapes = (ms: number): ReadonlyArray<Canvas.Shape> => {
  if (ms >= CONFETTI_MS) {
    return []
  }
  const seconds = ms / 1000
  const fade =
    1 - progressOf(ms, CONFETTI_MS - CONFETTI_FADE_MS, CONFETTI_FADE_MS)
  return [
    group({
      opacity: fade >= 1 ? undefined : fade,
      shapes: Array.filterMap(Array.range(0, CONFETTI - 1), index => {
        const speed = 28 + scatter(index, 1) * 40
        const delay = scatter(index, 2) * 1.2
        const fall = (seconds - delay) * speed
        if (fall < 0) {
          return Result.failVoid
        }
        const y = -6 + (fall % (VIEW_HEIGHT + 12))
        const sway =
          Math.sin(seconds * (2 + scatter(index, 3) * 3) + index) *
          (2 + scatter(index, 4) * 5)
        const x = scatter(index, 5) * VIEW_WIDTH + sway
        const isFlat = Math.floor(seconds * 8 + index) % 2 === 0
        return Result.succeed(
          rect(
            Math.round(x),
            Math.round(y),
            isFlat ? 3 : 1,
            isFlat ? 1 : 3,
            CONFETTI_COLORS[index % CONFETTI_COLORS.length] ?? '#ffd23f',
          ),
        )
      }),
    }),
  ]
}

// IN THE WORLD

// NOTE: on a loss the player topples onto their back, pivoting on their
// feet with a little bounce, the way they face.
export const toppleShapes = (
  model: Model,
  shapes: ReadonlyArray<Canvas.Shape>,
): ReadonlyArray<Canvas.Shape> => {
  if (!Phase.isAnyOf(['GameOver'])(model.phase)) {
    return shapes
  }
  const t = easeOutBack(progressOf(model.screenMs, FALL_START_MS, FALL_MS))
  if (t <= 0) {
    return shapes
  }
  const foot = { x: model.player.x, y: playerFootY(model.player) }
  const side = model.player.facing.x < 0 ? 1 : -1
  return [
    group({
      translate: foot,
      rotate: side * QUARTER_TURN * t,
      shapes: [group({ translate: { x: -foot.x, y: -foot.y }, shapes })],
    }),
  ]
}

// NOTE: the fallen player is drawn in their own colors once the flash of
// the last bite is over, not frozen white mid blink.
export const fallenOf = (model: Model): Model =>
  Phase.isAnyOf(['GameOver'])(model.phase) && model.screenMs >= FLASH_MS
    ? modifyFields(model, {
        player: player =>
          modifyFields(player, {
            invulnerability: () => Invulnerability.Vulnerable(),
          }),
      })
    : model

const CHOMP_REACH_PX = 30
const CHOMP_LEAN_PX = 3
const CHOMP_MS = 180

// NOTE: on a loss the zombies close by lunge at the fallen player in turn,
// chomp, chomp, a few pixels each, as a picture only.
export const chompShapes = (
  model: Model,
  zombie: Zombie,
  shapes: ReadonlyArray<Canvas.Shape>,
): ReadonlyArray<Canvas.Shape> => {
  const dx = model.player.x - zombie.x
  const dy = model.player.y - zombie.y
  const distance = Math.hypot(dx, dy)
  if (distance > CHOMP_REACH_PX || distance < 1) {
    return shapes
  }
  const phase = (model.screenMs + zombie.id * 97) / CHOMP_MS
  const lean = CHOMP_LEAN_PX * Math.max(0, Math.sin(phase * Math.PI))
  return [
    group({
      translate: {
        x: Math.round((dx / distance) * lean),
        y: Math.round((dy / distance) * lean),
      },
      shapes,
    }),
  ]
}

export const isChomping = Phase.isAnyOf(['GameOver'])

// THE END

export const endOverlayShapes = (model: Model): ReadonlyArray<Canvas.Shape> =>
  Option.match(endKindOf(model), {
    onNone: () => [],
    onSome: kind => {
      const ms = model.screenMs
      const layout = layoutOf(model, kind)
      return [
        ...dimShapes(kind, ms),
        ...(kind === 'Won' ? confettiShapes(ms) : []),
        ...flashShapes(kind, ms),
        ...trophyShapes(kind, ms, layout),
        ...stampShapes(kind, ms, layout),
        ...(isCoop(model) ? [] : skullShapes(model, kind, ms, layout)),
        ...cardShapes(model, kind, ms, layout),
      ]
    },
  })
