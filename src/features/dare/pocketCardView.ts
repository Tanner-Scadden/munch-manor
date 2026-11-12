import { Array, Function, Option, Record } from 'effect'
import type { Canvas } from 'foldkit'

import type { Model } from '../../app/model'
import {
  DARE_FOUND_SLOTS,
  DARE_ICONS,
  DARE_ICON_SIZE,
  DARE_SLOT_SIZE,
  PLAIN_SIGHT,
  SATCHEL_BACK,
  SATCHEL_BACK_HEIGHT,
  SATCHEL_FRONT,
  SATCHEL_FRONT_HEIGHT,
  SATCHEL_SCALE,
  SATCHEL_WIDTH,
} from '../../art/dareArt'
import { type BakedText, bakeText, placeBaked } from '../../art/font'
import { maybeRoomIcon } from '../../art/roomIcons'
import { type Sprite, TOP_LEFT, group, spriteShapes } from '../../art/sprite'
import { PocketCard } from '../../domain/clientSchema'
import { placeSprite, rect } from '../../render/drawing'
import { hudLayoutFor } from '../../render/hudLayout'
import type { Screen } from '../../render/screen'
import { dareCardOf } from '../../world/dare/dare'
import type { DareKind } from '../../world/dare/dareSchema'
import { DARE_LINES } from '../../world/names'
import type { Vector } from '../../world/schema/worldSchema'
import { clamp, easeOut, lerp } from '../../world/step/geometry'
import { type DarePocket, pocketSlotSpotsOf } from './dareCard'
import {
  FIND_AT_MS,
  FOLD_MS,
  UNFOLD_MS,
  cardThingsOf,
  isPocketCardWaiting,
  maybeClueRoom,
  outAtMs,
  promptAtMs,
  thingAtMs,
} from './pocketCard'

// The dare card in your pocket on screen (src/features/dare/pocketCard.ts):
// a napkin card rises out of your pocket and opens in your friends' pencil
// scrawl: I DARE YOU TO FIND:, this run's room things popping on one at a
// time, each in a pencil box with a ? for still to find, then THEN GET OUT!
// by a doodle of the front door. Then it
// folds itself up into the HUD's dare pocket, which opens, and each picture
// flies into its own slot there. Show, don't explain: pictures, and a few
// scrawled words. Only art moves; the card has no buttons, and a key or a
// tap folds it. While it waits (the first time alone), a key cap or TAP
// pulses under it.

const CARD_HEIGHT = 80
const CARD_MAX_WIDTH = 180
const CARD_SIDE_GAP = 10
const ICON_SCALE = 2
const BIG_ICON = DARE_ICON_SIZE * ICON_SCALE
const BOX_PAD = 2
const BOX = BIG_ICON + BOX_PAD * 2
const BOX_STRIDE = BOX + 6
const POP_MS = 160
const POP_SCALE = 1.7

const NAPKIN = '#f2e8d0'
const NAPKIN_EDGE = '#c9b994'
const NAPKIN_CREASE = '#e2d6b8'
const PENCIL = '#4a4038'
const PENCIL_LIGHT = '#9a8e7e'
const CARD_SHADOW = 'rgba(0, 0, 0, 0.35)'
const BACKDROP = 'rgba(10, 6, 14, 0.55)'
const PROMPT_FILL = 'rgba(18, 13, 22, 0.94)'
const PROMPT_RIM = '#ffe066'

// THE SCRAWL

type Word = Readonly<{ text: BakedText; lift: number }>

const BIG = 2
const WORD_GAP = 6

// NOTE: each word a pixel off the last, as a hand writes.
const wordsOf = (words: ReadonlyArray<string>): ReadonlyArray<Word> =>
  Array.map(words, (word, index) => ({
    text: bakeText(word, 'Ink'),
    lift: [0, -1, 1, 0][index] ?? 0,
  }))

const DARE_WORDS = wordsOf(['I', 'DARE', 'YOU'])
const FIND_WORDS = wordsOf(['TO', 'FIND:'])
const OUT_WORDS = wordsOf(['THEN', 'GET', 'OUT!'])

const wordsWidth = (words: ReadonlyArray<Word>): number =>
  Array.reduce(words, 0, (sum, { text }) => sum + text.width * BIG) +
  WORD_GAP * (words.length - 1)

const QUESTION: BakedText = bakeText('?', 'Ink')

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

// NOTE: the manor's front door in pencil, arched, with its knob, and a
// pencil arrow running out of it: the way out once the list is done.
const DOOR: Sprite = spriteShapes(
  [
    '...PPPP.......',
    '..PDDDDP......',
    '.PDDDDDDP.....',
    '.PDPDDPDP.....',
    '.PDPDDPDP...P.',
    '.PDDDDDDP...PP',
    '.PDDDDYDPPPPPP',
    '.PDDDDDDP...PP',
    '.PDPDDPDP...P.',
    '.PDPDDPDP.....',
    '.PDDDDDDP.....',
    'PPPPPPPPPP....',
  ],
  { P: PENCIL, D: '#a86f45', Y: '#e0a020' },
  TOP_LEFT,
)
const DOOR_WIDTH = 14

// LAYOUT

type CardBox = Readonly<{ x: number; y: number; width: number }>

const middleOf = (screen: Screen): number =>
  screen.layout === 'Landscape'
    ? screen.height / 2
    : screen.world.y + screen.world.height / 2

const cardBoxOf = (screen: Screen): CardBox => {
  const width = Math.min(CARD_MAX_WIDTH, screen.width - CARD_SIDE_GAP * 2)
  return {
    x: Math.round((screen.width - width) / 2),
    y: Math.round(middleOf(screen) - CARD_HEIGHT / 2),
    width,
  }
}

const DARE_Y = 5
const FIND_Y = 19
const THINGS_Y = 35
const OUT_Y = 63

// NOTE: where each thing's box sits on the card, card-local: this run's
// things in a row, in the HUD card's order.
const boxSpotsOf = (count: number, width: number): ReadonlyArray<Vector> => {
  const rowWidth = count * BOX_STRIDE - (BOX_STRIDE - BOX)
  const rowLeft = Math.round((width - rowWidth) / 2)
  return Array.makeBy(count, index => ({
    x: rowLeft + index * BOX_STRIDE,
    y: THINGS_Y,
  }))
}

// THE CARD

const paperShapes = (
  width: number,
  height: number = CARD_HEIGHT,
): ReadonlyArray<Canvas.Shape> => [
  rect(2, 2, width, height, CARD_SHADOW),
  rect(0, 0, width, height, NAPKIN_EDGE),
  rect(1, 1, width - 2, height - 2, NAPKIN),
  rect(Math.floor(width / 2), 1, 1, height - 2, NAPKIN_CREASE),
  rect(1, Math.floor(height / 2), width - 2, 1, NAPKIN_CREASE),
]

const wordShapes = (
  words: ReadonlyArray<Word>,
  left: number,
  y: number,
): ReadonlyArray<Canvas.Shape> =>
  Array.map(words, ({ text, lift }, index) =>
    placeBaked(text, {
      x:
        left +
        Array.reduce(
          Array.take(words, index),
          0,
          (sum, word) => sum + word.text.width * BIG + WORD_GAP,
        ),
      y: y + lift,
      align: 'Left',
      scale: BIG,
    }),
  )

const centeredWords = (
  words: ReadonlyArray<Word>,
  width: number,
  y: number,
): ReadonlyArray<Canvas.Shape> =>
  wordShapes(words, Math.round((width - wordsWidth(words)) / 2), y)

const OUT_GAP = 5

// NOTE: THEN GET OUT! with the door doodle after it, centered as one line.
const outShapes = (
  width: number,
  y: number = OUT_Y,
): ReadonlyArray<Canvas.Shape> => {
  const lineWidth = wordsWidth(OUT_WORDS) + OUT_GAP + DOOR_WIDTH
  const left = Math.round((width - lineWidth) / 2)
  return [
    ...wordShapes(OUT_WORDS, left, y),
    group({
      translate: {
        x: left + wordsWidth(OUT_WORDS) + OUT_GAP,
        y: y - 1,
      },
      shapes: DOOR,
    }),
  ]
}

// NOTE: a pencil box with its corners cut, drawn twice a pixel apart at a
// corner as a hand goes round, and a ? on its top right: still to find.
const thingBoxShapes = (): ReadonlyArray<Canvas.Shape> => [
  rect(1, 0, BOX - 2, 1, PENCIL),
  rect(1, BOX - 1, BOX - 2, 1, PENCIL),
  rect(0, 1, 1, BOX - 2, PENCIL),
  rect(BOX - 1, 1, 1, BOX - 2, PENCIL),
  rect(BOX - 3, BOX, 3, 1, PENCIL_LIGHT),
  placeBaked(QUESTION, { x: BOX - 2, y: -5, align: 'Left' }),
]

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

// NOTE: a thing in its box, popping on from big as the pencil scratches.
const boxedThingShapes = (
  kind: DareKind,
  spot: Vector,
  sinceMs: number,
): Canvas.Shape => {
  const pop = lerp(POP_SCALE, 1, easeOut(clamp(sinceMs / POP_MS, 0, 1)))
  const grow = (BOX * (pop - 1)) / 2
  return group({
    translate: { x: Math.round(spot.x - grow), y: Math.round(spot.y - grow) },
    scale: pop === 1 ? undefined : { x: pop, y: pop },
    shapes: [
      ...thingBoxShapes(),
      iconShapes(kind, { x: BOX_PAD, y: BOX_PAD }, ICON_SCALE),
    ],
  })
}

// NOTE: the card's words and its paper, card-local, written on by `ageMs`.
const scrawlShapes = (
  width: number,
  count: number,
  ageMs: number,
): ReadonlyArray<Canvas.Shape> => [
  ...paperShapes(width),
  group({ translate: { x: 6, y: 4 }, shapes: CHICKEN }),
  ...(ageMs >= UNFOLD_MS ? centeredWords(DARE_WORDS, width, DARE_Y) : []),
  ...(ageMs >= FIND_AT_MS ? centeredWords(FIND_WORDS, width, FIND_Y) : []),
  ...(ageMs >= outAtMs(count) ? outShapes(width) : []),
]

// NOTE: the card rising out of your pocket, from below the screen.
const riseOf = (screen: Screen, box: CardBox, ageMs: number): number =>
  Math.round(
    lerp(screen.height - box.y, 0, easeOut(clamp(ageMs / UNFOLD_MS, 0, 1))),
  )

// NOTE: under a waiting card once it takes a key: a key cap on a keyboard,
// TAP on touch, pulsing.
const PROMPT_BLINK_MS = 450
const PROMPT_PAD = 2
const PROMPT_GAP = 3
const KEY_PROMPT = bakeText('ANY KEY', 'Prompt')
const TAP_PROMPT = bakeText('TAP', 'Prompt')

const promptShapes = (
  model: Model,
  box: CardBox,
  ageMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const text = model.lastDevice === 'Touch' ? TAP_PROMPT : KEY_PROMPT
  const width = text.width * BIG + PROMPT_PAD * 2 + 2
  const height = 12 + PROMPT_PAD * 2
  const left = box.x + Math.round((box.width - width) / 2)
  const top = box.y + CARD_HEIGHT + PROMPT_GAP
  const isLit = Math.floor(ageMs / PROMPT_BLINK_MS) % 2 === 0
  return [
    group({
      opacity: isLit ? 1 : 0.45,
      shapes: [
        rect(left + 1, top, width - 2, height, PROMPT_RIM),
        rect(left, top + 1, width, height - 2, PROMPT_RIM),
        rect(left + 1, top + 1, width - 2, height - 3, PROMPT_FILL),
        placeBaked(text, {
          x: left + PROMPT_PAD + 1,
          y: top + PROMPT_PAD,
          align: 'Left',
          scale: BIG,
        }),
      ],
    }),
  ]
}

const readingShapes = (
  model: Model,
  screen: Screen,
  ageMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const kinds = cardThingsOf(model)
  const count = kinds.length
  const box = cardBoxOf(screen)
  const spots = boxSpotsOf(count, box.width)
  return [
    rect(0, 0, screen.width, screen.height, BACKDROP),
    group({
      translate: { x: box.x, y: box.y + riseOf(screen, box, ageMs) },
      shapes: [
        ...scrawlShapes(box.width, count, ageMs),
        ...Array.flatMap(
          Array.zip(kinds, spots),
          ([kind, spot]: readonly [DareKind, Vector], index: number) =>
            ageMs >= thingAtMs(index)
              ? [boxedThingShapes(kind, spot, ageMs - thingAtMs(index))]
              : [],
        ),
      ],
    }),
    ...(isPocketCardWaiting(model) && ageMs >= promptAtMs(model)
      ? promptShapes(model, box, ageMs)
      : []),
  ]
}

// NOTE: the card shrinks toward the HUD's pocket and fades in the first
// part of the fold, and each picture flies on into its own slot, one a
// little after another, landing at the slot's size, then fades to the
// slot's outline beneath: the card is now the list.
const PAPER_SHARE = 0.5
const FLIGHT_STAGGER_MS = 90
const LAND_FADE_SHARE = 0.25

const foldingShapes = (
  model: Model,
  screen: Screen,
  pocket: DarePocket,
  ageMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const kinds = cardThingsOf(model)
  const count = kinds.length
  const box = cardBoxOf(screen)
  const spots = boxSpotsOf(count, box.width)
  const targets = pocketSlotSpotsOf(model, hudLayoutFor(screen), pocket)
  const landScale = pocket === 'Open' ? ICON_SCALE : 1
  const paperShare = easeOut(clamp(ageMs / (FOLD_MS * PAPER_SHARE), 0, 1))
  const first = targets[0] ?? { x: box.x, y: box.y }
  const paperScale = lerp(1, 0.2, paperShare)
  const flightMs = FOLD_MS - FLIGHT_STAGGER_MS * count
  return [
    group({
      opacity: 1 - paperShare,
      shapes: [
        rect(0, 0, screen.width, screen.height, BACKDROP),
        group({
          translate: {
            x: Math.round(lerp(box.x, first.x, paperShare)),
            y: Math.round(lerp(box.y, first.y, paperShare)),
          },
          scale: { x: paperScale, y: paperScale },
          shapes: scrawlShapes(box.width, count, Number.POSITIVE_INFINITY),
        }),
      ],
    }),
    ...Array.flatMap(
      Array.zip(kinds, spots),
      ([kind, spot]: readonly [DareKind, Vector], index: number) => {
        const target = targets[index] ?? first
        const share = clamp(
          (ageMs - index * FLIGHT_STAGGER_MS) / flightMs,
          0,
          1,
        )
        const eased = easeOut(share)
        const fade = clamp((1 - share) / LAND_FADE_SHARE, 0, 1)
        return [
          group({
            opacity: fade,
            shapes: [
              iconShapes(
                kind,
                {
                  x: lerp(box.x + spot.x + BOX_PAD, target.x, eased),
                  y: lerp(box.y + spot.y + BOX_PAD, target.y, eased),
                },
                lerp(ICON_SCALE, landScale, eased),
              ),
            ],
          }),
        ]
      },
    ),
  ]
}

// THE CARD OPENED AGAIN, WITH ITS SATCHEL

// NOTE: the card opened from the HUD's list (Demi and the owner,
// 2026-11-11), the same napkin with I DARE YOU: the things still missing
// in their pencil boxes, dim, each with where it lies under it once that
// is known (`maybeClueRoom`: its room's icon and an eye for plain sight);
// THEN GET OUT! once none is missing; a satchel at the foot holding every
// thing found, each poking out of its top on its gold rim; and under it a
// line of the Munches' story for each thing found. A thing found since the
// card was last looked at drops into the satchel with a bounce. Only art
// moves, and the card has no buttons.
const OPENED_MAX_WIDTH = 184
const OPENED_SIDE_GAP = 6
const OPENED_PAD = 5
const MISSING_Y = 22
const MISSING_OUT_Y = MISSING_Y + 5
const CLUE_Y = MISSING_Y + BOX + 3
const CLUE_ROOM_HALF = 4
const CLUE_EYE_GAP = 1
const ITEMS_Y = 56
const ITEM_STRIDE = DARE_SLOT_SIZE + 2
const ITEM_LIFTS: ReadonlyArray<number> = [1, 0, 2, 0]
const SATCHEL_PX_WIDTH = SATCHEL_WIDTH * SATCHEL_SCALE
const SATCHEL_BACK_Y = ITEMS_Y + 6
const SATCHEL_FRONT_Y = SATCHEL_BACK_Y + SATCHEL_BACK_HEIGHT * SATCHEL_SCALE - 2
const SATCHEL_BOTTOM = SATCHEL_FRONT_Y + SATCHEL_FRONT_HEIGHT * SATCHEL_SCALE
const LINES_Y = SATCHEL_BOTTOM + 5
const LINE_STRIDE = 10
const LINE_ICON_GAP = 3
const MISSING_OPACITY = 0.35
const DROP_MS = 520
const DROP_STAGGER_MS = 160
const DROP_FALL_SHARE = 0.65
const DROP_HEIGHT = 34
const DROP_BOUNCE_PX = 4

const LINE_TEXTS: Readonly<Record<DareKind, BakedText>> = Record.map(
  DARE_LINES,
  line => bakeText(line, 'Ink'),
)

type Opened = Readonly<{
  missing: ReadonlyArray<DareKind>
  found: ReadonlyArray<DareKind>
}>

const openedOf = (model: Model): Opened => {
  const card = dareCardOf(model)
  const kindsOf = (isFound: boolean): ReadonlyArray<DareKind> =>
    Array.map(
      Array.filter(card, thing => thing.isFound === isFound),
      ({ kind }) => kind,
    )
  return { missing: kindsOf(false), found: kindsOf(true) }
}

const openedHeightOf = (foundCount: number): number =>
  foundCount === 0 ? SATCHEL_BOTTOM + 5 : LINES_Y + foundCount * LINE_STRIDE

const openedBoxOf = (screen: Screen, foundCount: number): CardBox => {
  const width = Math.min(OPENED_MAX_WIDTH, screen.width - OPENED_SIDE_GAP * 2)
  return {
    x: Math.round((screen.width - width) / 2),
    y: Math.max(
      0,
      Math.round(middleOf(screen) - openedHeightOf(foundCount) / 2),
    ),
    width,
  }
}

// NOTE: where a thing lies, under its box: its room's icon, then the eye.
const clueShapes = (
  model: Model,
  kind: DareKind,
  spot: Vector,
): ReadonlyArray<Canvas.Shape> =>
  Option.match(Option.flatMap(maybeClueRoom(model, kind), maybeRoomIcon), {
    onNone: () => [],
    onSome: icon => {
      const center = spot.x + Math.round(BOX / 2)
      return [
        placeSprite(center - CLUE_ROOM_HALF, CLUE_Y + CLUE_ROOM_HALF, icon),
        placeSprite(center + CLUE_EYE_GAP, CLUE_Y + 2, PLAIN_SIGHT),
      ]
    },
  })

const missingShapes = (
  model: Model,
  missing: ReadonlyArray<DareKind>,
  width: number,
): ReadonlyArray<Canvas.Shape> =>
  Array.isReadonlyArrayEmpty(missing)
    ? outShapes(width, MISSING_OUT_Y)
    : Array.flatMap(
        Array.zip(
          missing,
          Array.map(boxSpotsOf(missing.length, width), spot => ({
            x: spot.x,
            y: MISSING_Y,
          })),
        ),
        ([kind, spot]: readonly [DareKind, Vector]) => [
          group({
            translate: spot,
            shapes: [
              ...thingBoxShapes(),
              group({
                opacity: MISSING_OPACITY,
                shapes: [
                  iconShapes(kind, { x: BOX_PAD, y: BOX_PAD }, ICON_SCALE),
                ],
              }),
            ],
          }),
          ...clueShapes(model, kind, spot),
        ],
      )

// NOTE: how far a thing dropping in is still above its spot, by the share
// of its drop: it falls, then bounces once.
const dropLiftAt = (share: number): number =>
  share < DROP_FALL_SHARE
    ? -DROP_HEIGHT * (1 - (share / DROP_FALL_SHARE) ** 2)
    : -DROP_BOUNCE_PX *
      Math.sin((Math.PI * (share - DROP_FALL_SHARE)) / (1 - DROP_FALL_SHARE))

// NOTE: the share of a thing's drop, or 1 for a thing already in the
// satchel; below 0 before its drop starts.
const dropShareOf = (
  fresh: ReadonlyArray<DareKind>,
  kind: DareKind,
  ageMs: number,
): number =>
  Option.match(
    Array.findFirstIndex(fresh, each => each === kind),
    {
      onNone: () => 1,
      onSome: index =>
        Math.min(1, (ageMs - UNFOLD_MS - index * DROP_STAGGER_MS) / DROP_MS),
    },
  )

const satchelShapes = (
  found: ReadonlyArray<DareKind>,
  fresh: ReadonlyArray<DareKind>,
  width: number,
  ageMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const left = Math.round((width - SATCHEL_PX_WIDTH) / 2)
  const rowWidth = found.length * ITEM_STRIDE - (ITEM_STRIDE - DARE_SLOT_SIZE)
  const itemsLeft = left + Math.round((SATCHEL_PX_WIDTH - rowWidth) / 2)
  const scale = { x: SATCHEL_SCALE, y: SATCHEL_SCALE }
  return [
    group({
      translate: { x: left, y: SATCHEL_BACK_Y },
      scale,
      shapes: SATCHEL_BACK,
    }),
    ...Array.flatMap(found, (kind, index) => {
      const share = dropShareOf(fresh, kind, ageMs)
      return share < 0
        ? []
        : [
            placeSprite(
              itemsLeft + index * ITEM_STRIDE,
              ITEMS_Y +
                (ITEM_LIFTS[index % ITEM_LIFTS.length] ?? 0) +
                Math.round(share >= 1 ? 0 : dropLiftAt(share)),
              DARE_FOUND_SLOTS[kind],
            ),
          ]
    }),
    group({
      translate: { x: left, y: SATCHEL_FRONT_Y },
      scale,
      shapes: SATCHEL_FRONT,
    }),
  ]
}

// NOTE: a line for each thing found, its picture before it; a thing still
// dropping in gets its line once it lands.
const linesShapes = (
  found: ReadonlyArray<DareKind>,
  fresh: ReadonlyArray<DareKind>,
  ageMs: number,
): ReadonlyArray<Canvas.Shape> =>
  Array.flatMap(found, (kind, index) => {
    const y = LINES_Y + index * LINE_STRIDE
    return dropShareOf(fresh, kind, ageMs) < DROP_FALL_SHARE
      ? []
      : [
          iconShapes(kind, { x: OPENED_PAD, y }, 1),
          placeBaked(LINE_TEXTS[kind], {
            x: OPENED_PAD + DARE_ICON_SIZE + LINE_ICON_GAP,
            y: y + 1,
            align: 'Left',
          }),
        ]
  })

const openedShapes = (
  model: Model,
  screen: Screen,
  ageMs: number,
  fresh: ReadonlyArray<DareKind>,
): ReadonlyArray<Canvas.Shape> => {
  const { missing, found } = openedOf(model)
  const box = openedBoxOf(screen, found.length)
  const rise = Math.round(
    lerp(screen.height - box.y, 0, easeOut(clamp(ageMs / UNFOLD_MS, 0, 1))),
  )
  return [
    rect(0, 0, screen.width, screen.height, BACKDROP),
    group({
      translate: { x: box.x, y: box.y + rise },
      shapes: [
        ...paperShapes(box.width, openedHeightOf(found.length)),
        group({ translate: { x: 6, y: 4 }, shapes: CHICKEN }),
        ...centeredWords(DARE_WORDS, box.width, DARE_Y),
        ...missingShapes(model, missing, box.width),
        ...satchelShapes(found, fresh, box.width, ageMs),
        ...linesShapes(found, fresh, ageMs),
      ],
    }),
  ]
}

// NOTE: over everything else on the overlay while the card is out.
// `pocket` is how the HUD's pocket is drawn, so the pictures land there.
export const pocketCardShapes: {
  (
    screen: Screen,
    pocket: DarePocket,
  ): (model: Model) => ReadonlyArray<Canvas.Shape>
  (
    model: Model,
    screen: Screen,
    pocket: DarePocket,
  ): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  3,
  (
    model: Model,
    screen: Screen,
    pocket: DarePocket,
  ): ReadonlyArray<Canvas.Shape> =>
    PocketCard.match(model.pocketCard, {
      Pocketed: () => [],
      Reading: ({ ageMs }) => readingShapes(model, screen, ageMs),
      Folding: ({ ageMs }) => foldingShapes(model, screen, pocket, ageMs),
      Opened: ({ ageMs, fresh }) => openedShapes(model, screen, ageMs, fresh),
    }),
)
