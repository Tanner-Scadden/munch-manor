import { Array, Function, String } from 'effect'
import type { Canvas } from 'foldkit'

import type { Model } from '../../app/model'
import { DARE_ICONS, DARE_ICON_SIZE } from '../../art/dareArt'
import { type BakedText, bakeText, placeBaked } from '../../art/font'
import { type Sprite, TOP_LEFT, group, spriteShapes } from '../../art/sprite'
import { PocketCard } from '../../domain/clientSchema'
import { rect } from '../../render/drawing'
import { hudLayoutFor } from '../../render/hudLayout'
import type { Screen } from '../../render/screen'
import { dareCardOf } from '../../world/dare/dare'
import type { DareKind } from '../../world/dare/dareSchema'
import { ZOMBIE_NAMES } from '../../world/names'
import type { Vector } from '../../world/schema/worldSchema'
import { clamp, easeOut, lerp } from '../../world/step/geometry'
import { pocketCardSpotOf } from './dareCard'
import { FOLD_MS, UNFOLD_MS } from './pocketCard'

// The dare card in your pocket on screen (src/features/dare/pocketCard.ts):
// a napkin card rises out of your pocket and opens in your friends' pencil
// scrawl, I DARE YOU over this run's things as pictures, AND Uncle Chunk's
// HAT!! with his hat, and a doodled chicken. Then it folds itself up into
// the HUD's dare card, and each picture flies into its own outline there.
// Show, don't explain: pictures, and a few scrawled words. Only art moves;
// the card has no buttons, and any key or tap folds it.

const CARD_HEIGHT = 88
const CARD_MAX_WIDTH = 180
const CARD_SIDE_GAP = 10
const ICON_SCALE = 2
const BIG_ICON = DARE_ICON_SIZE * ICON_SCALE
const ICON_STRIDE = BIG_ICON + 6

const NAPKIN = '#f2e8d0'
const NAPKIN_EDGE = '#c9b994'
const NAPKIN_CREASE = '#e2d6b8'
const PENCIL = '#4a4038'
const CARD_SHADOW = 'rgba(0, 0, 0, 0.35)'
const BACKDROP = 'rgba(10, 6, 14, 0.55)'

// NOTE: the scrawl writes itself on while you read: the dare, then each
// picture, then the hat, then the chicken.
const DARE_AT_MS = UNFOLD_MS
const FIRST_THING_AT_MS = UNFOLD_MS + 250
const THING_GAP_MS = 220
const HAT_AFTER_MS = 200
const CHICKEN_AFTER_MS = 350

// THE SCRAWL

type Word = Readonly<{ text: BakedText; lift: number }>

// NOTE: each word a pixel off the last, as a hand writes.
const DARE_WORDS: ReadonlyArray<Word> = Array.map(
  ['I', 'DARE', 'YOU'],
  (word, index) => ({
    text: bakeText(word, 'Ink'),
    lift: [0, -1, 1][index] ?? 0,
  }),
)
const DARE_SCALE = 2
const DARE_WORD_GAP = 6

const HAT_LINE: BakedText = bakeText(
  `AND ${String.toUpperCase(ZOMBIE_NAMES.Boss)}'S HAT!!`,
  'Ink',
)

// NOTE: a chicken in pencil, for no chickening out.
const CHICKEN: Sprite = spriteShapes(
  [
    '....PP.......',
    '...PRRP......',
    '..PPPPPP.....',
    '.YP.P..P.....',
    '..PP...PPPP..',
    '...P......PP.',
    '...P.......P.',
    '...P......P..',
    '....PP...PP..',
    '......PPP....',
    '......P.P....',
    '.....PP.PP...',
  ],
  { P: PENCIL, R: '#c0392b', Y: '#e0a020' },
  TOP_LEFT,
)

// NOTE: a pencil squiggle under the dare.
const SQUIGGLE: Sprite = spriteShapes(
  ['.PP...PP...PP...PP...PP...PP..', 'P..PPP..PPP..PPP..PPP..PPP..PP'],
  { P: PENCIL },
  TOP_LEFT,
)

// LAYOUT

type CardBox = Readonly<{ x: number; y: number; width: number }>

const cardBoxOf = (screen: Screen): CardBox => {
  const width = Math.min(CARD_MAX_WIDTH, screen.width - CARD_SIDE_GAP * 2)
  const middle =
    screen.layout === 'Landscape'
      ? screen.height / 2
      : screen.world.y + screen.world.height / 2
  return {
    x: Math.round((screen.width - width) / 2),
    y: Math.round(middle - CARD_HEIGHT / 2),
    width,
  }
}

const THINGS_Y = 30
const HAT_LINE_Y = 56
const CHICKEN_Y = CARD_HEIGHT - 16

// NOTE: where each picture sits on the card, card-local: this run's things
// in a row, then the hat at the end of its line, in the HUD card's order.
const pictureSpotsOf = (
  count: number,
  width: number,
): ReadonlyArray<Vector> => {
  const rowWidth = count * ICON_STRIDE - (ICON_STRIDE - BIG_ICON)
  const rowLeft = Math.round((width - rowWidth) / 2)
  const hatLineWidth = HAT_LINE.width + 4 + BIG_ICON
  const hatLineLeft = Math.round((width - hatLineWidth) / 2)
  return [
    ...Array.makeBy(count, index => ({
      x: rowLeft + index * ICON_STRIDE,
      y: THINGS_Y,
    })),
    { x: hatLineLeft + HAT_LINE.width + 4, y: HAT_LINE_Y - 4 },
  ]
}

const shownAtMs = (index: number, count: number): number =>
  index < count
    ? FIRST_THING_AT_MS + index * THING_GAP_MS
    : FIRST_THING_AT_MS + count * THING_GAP_MS + HAT_AFTER_MS

// THE CARD

const paperShapes = (width: number): ReadonlyArray<Canvas.Shape> => [
  rect(2, 2, width, CARD_HEIGHT, CARD_SHADOW),
  rect(0, 0, width, CARD_HEIGHT, NAPKIN_EDGE),
  rect(1, 1, width - 2, CARD_HEIGHT - 2, NAPKIN),
  rect(Math.floor(width / 2), 1, 1, CARD_HEIGHT - 2, NAPKIN_CREASE),
  rect(1, Math.floor(CARD_HEIGHT / 2), width - 2, 1, NAPKIN_CREASE),
]

const dareShapes = (width: number): ReadonlyArray<Canvas.Shape> => {
  const total =
    Array.reduce(DARE_WORDS, 0, (sum, { text }) => sum + text.width) *
      DARE_SCALE +
    DARE_WORD_GAP * (DARE_WORDS.length - 1)
  const left = Math.round((width - total) / 2)
  return [
    ...Array.map(DARE_WORDS, ({ text, lift }, index) =>
      placeBaked(text, {
        x:
          left +
          Array.reduce(
            Array.take(DARE_WORDS, index),
            0,
            (sum, word) => sum + word.text.width * DARE_SCALE + DARE_WORD_GAP,
          ),
        y: 8 + lift,
        align: 'Left',
        scale: DARE_SCALE,
      }),
    ),
    group({
      translate: { x: Math.round((width - 30) / 2), y: 24 },
      shapes: SQUIGGLE,
    }),
  ]
}

const iconShapes = (
  kind: DareKind,
  { x, y }: Vector,
  scale: number,
): Canvas.Shape =>
  group({
    translate: { x: Math.round(x), y: Math.round(y) },
    scale: scale === 1 ? undefined : { x: scale, y: scale },
    shapes: DARE_ICONS[kind],
  })

// NOTE: the card's words and its paper, card-local, written on by `ageMs`.
const scrawlShapes = (
  width: number,
  count: number,
  ageMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const hatAtMs = shownAtMs(count, count)
  const hatLineLeft = Math.round((width - (HAT_LINE.width + 4 + BIG_ICON)) / 2)
  return [
    ...paperShapes(width),
    ...(ageMs >= DARE_AT_MS ? dareShapes(width) : []),
    ...(ageMs >= hatAtMs
      ? [placeBaked(HAT_LINE, { x: hatLineLeft, y: HAT_LINE_Y, align: 'Left' })]
      : []),
    ...(ageMs >= hatAtMs + CHICKEN_AFTER_MS
      ? [group({ translate: { x: 10, y: CHICKEN_Y }, shapes: CHICKEN })]
      : []),
  ]
}

// NOTE: the card rising out of your pocket, from below the screen.
const riseOf = (screen: Screen, box: CardBox, ageMs: number): number =>
  Math.round(
    lerp(screen.height - box.y, 0, easeOut(clamp(ageMs / UNFOLD_MS, 0, 1))),
  )

const readingShapes = (
  model: Model,
  screen: Screen,
  ageMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const kinds = Array.map(dareCardOf(model), ({ kind }) => kind)
  const count = kinds.length - 1
  const box = cardBoxOf(screen)
  const spots = pictureSpotsOf(count, box.width)
  return [
    rect(0, 0, screen.width, screen.height, BACKDROP),
    group({
      translate: { x: box.x, y: box.y + riseOf(screen, box, ageMs) },
      shapes: [
        ...scrawlShapes(box.width, count, ageMs),
        ...Array.flatMap(
          Array.zip(kinds, spots),
          ([kind, spot]: readonly [DareKind, Vector], index: number) =>
            ageMs >= shownAtMs(index, count)
              ? [iconShapes(kind, spot, ICON_SCALE)]
              : [],
        ),
      ],
    }),
  ]
}

// NOTE: the card folds up toward the HUD's dare pocket and fades, and each
// picture flies into the pocket's card and fades as it lands.
const foldingShapes = (
  model: Model,
  screen: Screen,
  ageMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const kinds = Array.map(dareCardOf(model), ({ kind }) => kind)
  const count = kinds.length - 1
  const box = cardBoxOf(screen)
  const spots = pictureSpotsOf(count, box.width)
  const target = pocketCardSpotOf(model, hudLayoutFor(screen))
  const share = easeOut(clamp(ageMs / FOLD_MS, 0, 1))
  const paperScale = lerp(1, 0.1, share)
  return [
    group({
      opacity: 1 - share,
      shapes: [
        rect(0, 0, screen.width, screen.height, BACKDROP),
        group({
          translate: {
            x: Math.round(lerp(box.x, target.x, share)),
            y: Math.round(lerp(box.y, target.y, share)),
          },
          scale: { x: paperScale, y: paperScale },
          shapes: scrawlShapes(box.width, count, Number.POSITIVE_INFINITY),
        }),
        ...Array.map(Array.zip(kinds, spots), ([kind, spot]) =>
          iconShapes(
            kind,
            {
              x: lerp(box.x + spot.x, target.x, share),
              y: lerp(box.y + spot.y, target.y, share),
            },
            lerp(ICON_SCALE, 1, share),
          ),
        ),
      ],
    }),
  ]
}

// NOTE: over everything else on the overlay while the card is out.
export const pocketCardShapes: {
  (screen: Screen): (model: Model) => ReadonlyArray<Canvas.Shape>
  (model: Model, screen: Screen): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  2,
  (model: Model, screen: Screen): ReadonlyArray<Canvas.Shape> =>
    PocketCard.match(model.pocketCard, {
      Pocketed: () => [],
      Reading: ({ ageMs }) => readingShapes(model, screen, ageMs),
      Folding: ({ ageMs }) => foldingShapes(model, screen, ageMs),
    }),
)
