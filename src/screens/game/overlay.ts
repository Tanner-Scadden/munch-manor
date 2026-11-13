import { Array, Function, Option, Record, String, pipe } from 'effect'
import { Canvas } from 'foldkit'

import type { Model } from '../../app/model'
import { playerSprites } from '../../art/appearance'
import {
  type BakedText,
  GLYPH_HEIGHT,
  type Glyph,
  type TextTone,
  bakeText,
  glyphPixels,
  placeBaked,
  textShapes,
  toGlyph,
} from '../../art/font'
import {
  HINT_ICON_SPRITES,
  type HintIconSprites,
  hintIconFrame,
} from '../../art/hintIcons'
import {
  type Palette,
  type Sprite,
  TOP_LEFT,
  frameAt,
  group,
  placeAt,
  spriteShapes,
} from '../../art/sprite'
import { gunSprite } from '../../art/sprites/guns'
import { ZOMBIE_SPRITES, showcaseWalk } from '../../art/sprites/zombies'
import type { HintBand } from '../../domain/clientSchema'
import { endOverlayShapes } from '../../features/end/endView'
import {
  DEBUT_CARD_MS,
  HINT_PARTS,
  type HintId,
  type HintPart,
  isDebutCardUp,
  msIntoPhase,
  shownHints,
} from '../../features/onboarding/onboarding'
import type { InputDevice } from '../../input/inputSchema'
import {
  type FrameSpan,
  type Screen,
  frameSpanOf,
  landscapeFrameOffset,
} from '../../render/screen'
import {
  GAME_TITLE,
  MS_PER_SECOND,
  PLAYER_FOOT_OFFSET,
  PLAYER_WALK_FRAME_MS,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  WAVE_BANNER_MS,
  WAVE_CLEARED_BANNER_MS,
} from '../../shared/constants'
import type { Appearance, Calling } from '../../shared/playerData'
import { heldGun } from '../../world/gear/weapons'
import { KEY_RULES } from '../../world/keys/keys'
import { focusOf, isCoop } from '../../world/party/party'
import type { ZombieKind } from '../../world/schema/entitySchema'
import {
  Alarm,
  DebutCard,
  Phase,
  RunMode,
  type WeaponKind,
} from '../../world/schema/worldSchema'
import { clamp } from '../../world/step/geometry'
import { endlessDepth, hpScaleFor } from '../../world/waves/endlessWaves'
import { FINAL_WAVE, debutKinds } from '../../world/waves/wavePlans'
import { ZOMBIE_KINDS } from '../../world/zombies/zombies'
import { endMissionShapes } from './endMissions'

// SHARED

const CENTER_X = VIEW_WIDTH / 2
const TITLE_SCALE = 2

// NOTE: a backdrop reaches well past the landscape screen, so in portrait,
// where these screens are drawn over the world window, it still dims the
// HUD band and the thumb area. The canvas clips what is past its edges.
const backdrop = (fill: string): Canvas.Shape =>
  Canvas.Rect({
    x: -VIEW_WIDTH,
    y: -VIEW_HEIGHT * 2,
    width: VIEW_WIDTH * 3,
    height: VIEW_HEIGHT * 5,
    fill,
  })

const DIM_BACKDROP = backdrop('rgba(8, 10, 12, 0.72)')
const TITLE_BACKDROP = backdrop('rgba(14, 8, 20, 0.6)')

const centered = (
  baked: BakedText,
  y: number,
  scale = 1,
  opacity?: number,
): Canvas.Shape =>
  placeBaked(baked, { x: CENTER_X, y, align: 'Center', scale, opacity })

export const waveLabel: {
  (wave: number): (mode: RunMode) => string
  (mode: RunMode, wave: number): string
} = Function.dual(2, (mode: RunMode, wave: number): string =>
  RunMode.match(mode, {
    Campaign: () => `WAVE ${wave}`,
    Endless: () => `WAVE ${wave}`,
  }),
)

const isBlinkOn = (ms: number): boolean => ms % 1000 < 700

// DEVICE PROMPTS

type DeviceText = Readonly<Record<InputDevice, BakedText>>

const deviceText = (
  texts: Readonly<Record<InputDevice, string>>,
  tone: TextTone,
): DeviceText => Record.map(texts, text => bakeText(text, tone))

const RESUME_PROMPT = deviceText(
  {
    KeyboardMouse: 'CLICK OR PRESS ESC TO RESUME',
    Touch: 'TAP TO RESUME',
    Gamepad: 'START TO RESUME, SELECT TO LEAVE',
  },
  'Prompt',
)

// BANDS

const BAND_TOP: Readonly<Record<HintBand, number>> = { Top: 21, Bottom: 84 }
const SUBTITLE_OFFSET = 15
const HINT_OFFSET = 24
const HINT_FADE_MS = 500
const HINT_DELAY_MS = 250
const HINT_BACK_COLOR = 'rgba(8, 10, 12, 0.55)'
const HINT_PAD_X = 4
const HINT_PAD_Y = 2
const HINT_ROW_GAP = 1
const HINT_WORD_GAP = 3
const HINT_PART_GAP = 5

type BakedHintPart = Readonly<{
  icon: HintIconSprites
  maybeWords: Option.Option<BakedText>
  x: number
}>

type BakedHintRow = Readonly<{
  width: number
  height: number
  parts: ReadonlyArray<BakedHintPart>
}>

const partWidth = (
  icon: HintIconSprites,
  maybeWords: Option.Option<BakedText>,
): number =>
  icon.width +
  Option.match(maybeWords, {
    onNone: () => 0,
    onSome: words => HINT_WORD_GAP + words.width,
  })

type HintLayout = Readonly<{ x: number; parts: ReadonlyArray<BakedHintPart> }>

const layOutHintParts = (parts: ReadonlyArray<HintPart>): HintLayout => {
  const baked: Array<BakedHintPart> = []
  let right = 0
  for (const { icon, words } of parts) {
    const sprites = HINT_ICON_SPRITES[icon]
    const maybeWords = String.isNonEmpty(words)
      ? Option.some(bakeText(words, 'Plain'))
      : Option.none()
    const x = Array.isReadonlyArrayEmpty(baked) ? right : right + HINT_PART_GAP
    right = x + partWidth(sprites, maybeWords)
    baked.push({ icon: sprites, maybeWords, x })
  }
  return { x: right, parts: baked }
}

const bakeHintRow = (parts: ReadonlyArray<HintPart>): BakedHintRow => {
  const laidOut = layOutHintParts(parts)
  const iconHeight = Array.reduce(
    laidOut.parts,
    GLYPH_HEIGHT,
    (tallest, { icon }) => Math.max(tallest, icon.height),
  )
  return {
    width: laidOut.x,
    height: iconHeight + HINT_PAD_Y * 2,
    parts: laidOut.parts,
  }
}

const HINT_ROWS: Readonly<
  Record<HintId, Readonly<Record<InputDevice, BakedHintRow>>>
> = Record.map(HINT_PARTS, byDevice => Record.map(byDevice, bakeHintRow))

const hintOpacity = (ageMs: number): number =>
  clamp((ageMs - HINT_DELAY_MS) / HINT_FADE_MS, 0, 1)

const hintPartShapes =
  (left: number, top: number, height: number, ageMs: number) =>
  ({ icon, maybeWords, x }: BakedHintPart): ReadonlyArray<Canvas.Shape> => [
    placeAt(
      left + x,
      top + Math.floor((height - icon.height) / 2),
      hintIconFrame(icon, ageMs),
    ),
    ...Option.match(maybeWords, {
      onNone: () => [],
      onSome: words => [
        placeBaked(words, {
          x: left + x + icon.width + HINT_WORD_GAP,
          y: top + Math.floor((height - GLYPH_HEIGHT) / 2) + 1,
          align: 'Left',
        }),
      ],
    }),
  ]

const hintRowShapes = (
  row: BakedHintRow,
  top: number,
  ageMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const opacity = hintOpacity(ageMs)
  if (opacity <= 0) {
    return []
  }

  const left = Math.round(CENTER_X - row.width / 2)
  return [
    group({
      opacity,
      shapes: [
        Canvas.Rect({
          x: left - HINT_PAD_X,
          y: top,
          width: row.width + HINT_PAD_X * 2,
          height: row.height,
          fill: HINT_BACK_COLOR,
        }),
        ...Array.flatMap(
          row.parts,
          hintPartShapes(left, top, row.height, ageMs),
        ),
      ],
    }),
  ]
}

// NOTE: where each shown hint's row sits, top down under the banner's rows.
type HintPlacement = Readonly<{
  row: BakedHintRow
  top: number
  ageMs: number
}>

const hintPlacementsOf = (model: Model): ReadonlyArray<HintPlacement> => {
  const placements: Array<HintPlacement> = []
  let top = BAND_TOP[model.hintBand] + HINT_OFFSET - HINT_PAD_Y
  for (const { id, ageMs } of shownHints(model)) {
    const row = HINT_ROWS[id][model.lastDevice]
    placements.push({ row, top, ageMs })
    top += row.height + HINT_ROW_GAP
  }
  return placements
}

const hintShapes = (model: Model): ReadonlyArray<Canvas.Shape> =>
  Array.flatMap(hintPlacementsOf(model), ({ row, top, ageMs }) =>
    hintRowShapes(row, top, ageMs),
  )

// NOTE: each shown hint's row with its backing, in the landscape frame (the
// tours' BLOCK DOOR and the like). A bubble keeps out of them
// (src/screens/game/stallBubble.ts).
export type HintBox = Readonly<{
  left: number
  top: number
  right: number
  bottom: number
}>

export const hintBoxesOf = (model: Model): ReadonlyArray<HintBox> =>
  Array.map(hintPlacementsOf(model), ({ row, top }) => {
    const left = Math.round(CENTER_X - row.width / 2) - HINT_PAD_X
    return {
      left,
      top,
      right: left + row.width + HINT_PAD_X * 2,
      bottom: top + row.height,
    }
  })

// BANNERS

const GET_READY = bakeText('GET READY', 'Title')
const WAVE_CLEARED = bakeText('WAVE CLEARED', 'Victory')
const HERE_THEY_COME = bakeText('HERE THEY COME', 'Prompt')
const DINNER_BELL = bakeText('DINNER BELL!', 'Fresh')

const BAKED_WAVES = FINAL_WAVE * 4

const WAVE_TITLES: ReadonlyArray<BakedText> = Array.makeBy(
  BAKED_WAVES + 1,
  wave => bakeText(`WAVE ${wave}`, 'Defeat'),
)

// NOTE: a cleared wave adds a key to the ring (src/world/keys/keys.ts),
// the `$` drawn as a skeleton key.
const CLEARED_SUBTITLE: BakedText = bakeText(
  `+$${KEY_RULES.perWaveCleared}`,
  'Prompt',
)

const BEEFIER = bakeText('THEY GOT BEEFIER', 'Fresh')

const healthBoostText = (wave: number): string =>
  `ZOMBIES HAVE +${Math.round((hpScaleFor(wave) - 1) * 100)}% HEALTH`

const FIRST_ENDLESS_HEALTH = bakeText(healthBoostText(FINAL_WAVE + 1), 'Prompt')

type KindBanner = Readonly<{ title: BakedText; tagline: BakedText }>

const KIND_BANNERS: Readonly<Record<ZombieKind, KindBanner>> = Record.map(
  ZOMBIE_KINDS,
  stats => ({
    title: bakeText(`NEW: ${String.toUpperCase(stats.name)}`, 'Fresh'),
    tagline: bakeText(stats.tagline, 'Prompt'),
  }),
)

const NEW_KIND_BANNER_MS = 3600
const NEW_KIND_ICON_SCALE = 2
const NEW_KIND_ICON_GAP = 10
const NEW_KIND_HOP_MS = 260
const NEW_KIND_ICON_PX = 7
const NEW_KIND_SHIFT = Math.round(
  (NEW_KIND_ICON_GAP + (NEW_KIND_ICON_SCALE * NEW_KIND_ICON_PX) / 2) / 2,
)

const bannerAt = (
  band: HintBand,
  title: BakedText,
  maybeSubtitle: Option.Option<BakedText>,
): ReadonlyArray<Canvas.Shape> => [
  centered(title, BAND_TOP[band], TITLE_SCALE),
  ...Option.match(maybeSubtitle, {
    onNone: () => [],
    onSome: subtitle => [centered(subtitle, BAND_TOP[band] + SUBTITLE_OFFSET)],
  }),
]

const bakedFor = (
  list: ReadonlyArray<BakedText>,
  index: number,
  fallback: () => BakedText,
): BakedText => Option.getOrElse(Array.get(list, index), fallback)

const iconBanner = (
  band: HintBand,
  icon: Sprite,
  title: BakedText,
  maybeTagline: Option.Option<BakedText>,
  shownMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const hop =
    shownMs < NEW_KIND_HOP_MS
      ? 1 + 0.5 * Math.sin((Math.PI * shownMs) / NEW_KIND_HOP_MS)
      : 1
  const scale = NEW_KIND_ICON_SCALE * hop
  const titleX = CENTER_X + NEW_KIND_SHIFT
  const titleLeft = Math.round(titleX - (title.width * TITLE_SCALE) / 2)
  return [
    group({
      translate: {
        x: titleLeft - NEW_KIND_ICON_GAP,
        y: BAND_TOP[band] + 5,
      },
      scale: { x: scale, y: scale },
      shapes: icon,
    }),
    placeBaked(title, {
      x: titleX,
      y: BAND_TOP[band],
      align: 'Center',
      scale: TITLE_SCALE,
    }),
    ...Option.match(maybeTagline, {
      onNone: () => [],
      onSome: tagline => [centered(tagline, BAND_TOP[band] + SUBTITLE_OFFSET)],
    }),
  ]
}

const newKindBanner = (
  band: HintBand,
  kind: ZombieKind,
  shownMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const { title, tagline } = KIND_BANNERS[kind]
  return iconBanner(
    band,
    ZOMBIE_SPRITES[kind].icon,
    title,
    Option.some(tagline),
    shownMs,
  )
}

// NOTE: the first endless wave of a run says the zombies got tougher. Every
// later one shows only its number beside the beefy heart.
export type EndlessBanner = 'None' | 'Explained' | 'Pip'

export const endlessBannerOf = (wave: number): EndlessBanner => {
  const depth = endlessDepth(wave)
  if (depth === 0) {
    return 'None'
  } else if (depth === 1) {
    return 'Explained'
  } else {
    return 'Pip'
  }
}

const BEEFY_HEART: Sprite = spriteShapes(
  ['.GG.GG.', 'GWGGGGG', 'GGGYGGG', 'GGYYYGG', '.GGYGG.', '..GGG..', '...G...'],
  { G: '#6fae3f', W: '#c4ef9a', Y: '#ffe066' },
)

const beefierBanner = (
  band: HintBand,
  wave: number,
  shownMs: number,
): ReadonlyArray<Canvas.Shape> => {
  if (shownMs >= NEW_KIND_BANNER_MS) {
    return []
  }

  const banner = endlessBannerOf(wave)
  if (banner === 'Explained') {
    return bannerAt(band, BEEFIER, Option.some(FIRST_ENDLESS_HEALTH))
  } else if (banner === 'Pip') {
    return iconBanner(
      band,
      BEEFY_HEART,
      bakedFor(WAVE_TITLES, wave, () => bakeText(`WAVE ${wave}`, 'Defeat')),
      Option.none(),
      shownMs,
    )
  } else {
    return []
  }
}

// NOTE: a crew never reads about a new zombie (owner, 2026-11-01: "don't show
// new zombie info in multiplayer"), so its break shows no NEW banner.
const debutBanner = (
  band: HintBand,
  wave: number,
  shownMs: number,
  isCrew: boolean,
): ReadonlyArray<Canvas.Shape> =>
  Option.match(Array.head(debutKinds(wave)), {
    onNone: () => beefierBanner(band, wave, shownMs),
    onSome: kind =>
      shownMs < NEW_KIND_BANNER_MS && !isCrew
        ? newKindBanner(band, kind, shownMs)
        : [],
  })

const preparationBanner = (
  model: Model,
  wave: number,
  msIntoPreparation: number,
): ReadonlyArray<Canvas.Shape> => {
  if (wave === 1) {
    return bannerAt(model.hintBand, GET_READY, Option.none())
  } else if (msIntoPreparation < WAVE_CLEARED_BANNER_MS) {
    return bannerAt(model.hintBand, WAVE_CLEARED, Option.some(CLEARED_SUBTITLE))
  } else {
    return debutBanner(
      model.hintBand,
      wave,
      msIntoPreparation - WAVE_CLEARED_BANNER_MS,
      isCoop(model),
    )
  }
}

const alarmBanner = (model: Model): ReadonlyArray<Canvas.Shape> =>
  Alarm.match(model.pacing.alarm, {
    Quiet: () => [],
    Ringing: () => bannerAt(model.hintBand, DINNER_BELL, Option.none()),
  })

const waveBanner = (
  model: Model,
  wave: number,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> =>
  elapsedMs < WAVE_BANNER_MS
    ? bannerAt(
        model.hintBand,
        bakedFor(WAVE_TITLES, wave, () => bakeText(`WAVE ${wave}`, 'Defeat')),
        Option.some(HERE_THEY_COME),
      )
    : alarmBanner(model)

// NOTE: the rows a banner takes while one shows, in the landscape frame:
// its title and its subtitle's line. A bubble keeps out of them
// (src/screens/game/stallBubble.ts).
const BANNER_BAND_PAD = 2

export type BannerBand = Readonly<{ top: number; bottom: number }>

export const maybeBannerBand = (model: Model): Option.Option<BannerBand> => {
  const shapes = Phase.matchOrElse(
    model.phase,
    {
      Preparation: ({ wave }): ReadonlyArray<Canvas.Shape> =>
        preparationBanner(model, wave, msIntoPhase(model.phase)),
      Wave: ({ wave, elapsedMs }): ReadonlyArray<Canvas.Shape> =>
        isDebutCardUp(model) ? [] : waveBanner(model, wave, elapsedMs),
    },
    (): ReadonlyArray<Canvas.Shape> => [],
  )
  const top = BAND_TOP[model.hintBand]
  return Array.isReadonlyArrayEmpty(shapes)
    ? Option.none()
    : Option.some({
        top: top - BANNER_BAND_PAD,
        bottom: top + SUBTITLE_OFFSET + GLYPH_HEIGHT + BANNER_BAND_PAD,
      })
}

// DEBUT CARD

const CARD_TOP = 40
const CARD_BOTTOM = 136
const CARD_FILL = 'rgba(24, 14, 22, 0.94)'
const CARD_EDGE = '#ff8a3d'
const CARD_BACKDROP = backdrop('rgba(8, 10, 12, 0.4)')
const CARD_HEADING_Y = CARD_TOP + 6
const CARD_FEET_Y = 94
const CARD_SPRITE_HEIGHT = 40
const CARD_STRIDE_MS = 170
const CARD_HOP_MS = 320
const CARD_HOP_PX = 8
const CARD_SHADOW = 'rgba(0, 0, 0, 0.45)'
const CARD_NAME_Y = 100
const CARD_PITCH_Y = 117
const CARD_TIMER_Y = 128
const CARD_TIMER_WIDTH = 96
const CARD_TIMER_BACK = 'rgba(255, 138, 61, 0.25)'
const CARD_SLIDE_IN_MS = 160
const CARD_SLIDE_OUT_MS = 200

const NEW_ZOMBIE = bakeText('NEW ZOMBIE!', 'Fresh')

type CardText = Readonly<{ name: BakedText; pitch: BakedText }>

const CARD_TEXTS: Readonly<Record<ZombieKind, CardText>> = Record.map(
  ZOMBIE_KINDS,
  stats => ({
    name: bakeText(String.toUpperCase(stats.name), 'Title'),
    pitch: bakeText(stats.pitch, 'Plain'),
  }),
)

const cardSpriteScale = (kind: ZombieKind): number =>
  Math.max(2, Math.floor(CARD_SPRITE_HEIGHT / ZOMBIE_SPRITES[kind].height))

const cardHop = (ageMs: number): number =>
  ageMs < CARD_HOP_MS
    ? Math.round(CARD_HOP_PX * Math.sin((Math.PI * ageMs) / CARD_HOP_MS))
    : 0

const easeOut = (progress: number): number => 1 - (1 - progress) ** 3

const cardSlideX = (span: FrameSpan, ageMs: number): number => {
  const leftMs = DEBUT_CARD_MS - ageMs
  if (ageMs < CARD_SLIDE_IN_MS) {
    return Math.round(-span.width * (1 - easeOut(ageMs / CARD_SLIDE_IN_MS)))
  } else if (leftMs < CARD_SLIDE_OUT_MS) {
    return Math.round(span.width * easeOut(1 - leftMs / CARD_SLIDE_OUT_MS) ** 2)
  } else {
    return 0
  }
}

const cardTimerShapes = (ageMs: number): ReadonlyArray<Canvas.Shape> => {
  const left = CENTER_X - CARD_TIMER_WIDTH / 2
  const remaining = Math.round(
    CARD_TIMER_WIDTH * clamp(1 - ageMs / DEBUT_CARD_MS, 0, 1),
  )
  return [
    Canvas.Rect({
      x: left,
      y: CARD_TIMER_Y,
      width: CARD_TIMER_WIDTH,
      height: 2,
      fill: CARD_TIMER_BACK,
    }),
    Canvas.Rect({
      x: left,
      y: CARD_TIMER_Y,
      width: remaining,
      height: 2,
      fill: CARD_EDGE,
    }),
  ]
}

const debutCardShapes = (
  span: FrameSpan,
  kind: ZombieKind,
  ageMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const { name, pitch } = CARD_TEXTS[kind]
  const scale = cardSpriteScale(kind)
  const stride = Math.floor(ageMs / CARD_STRIDE_MS)
  return [
    CARD_BACKDROP,
    group({
      translate: { x: cardSlideX(span, ageMs), y: 0 },
      shapes: [
        Canvas.Rect({
          x: span.left,
          y: CARD_TOP - 1,
          width: span.width,
          height: CARD_BOTTOM - CARD_TOP + 2,
          fill: CARD_EDGE,
        }),
        Canvas.Rect({
          x: span.left,
          y: CARD_TOP,
          width: span.width,
          height: CARD_BOTTOM - CARD_TOP,
          fill: CARD_FILL,
        }),
        centered(NEW_ZOMBIE, CARD_HEADING_Y, 1, isBlinkOn(ageMs) ? 1 : 0.6),
        Canvas.Rect({
          x: CENTER_X - 4 * scale,
          y: CARD_FEET_Y - scale,
          width: 8 * scale,
          height: 2 * scale,
          fill: CARD_SHADOW,
        }),
        group({
          translate: { x: CENTER_X, y: CARD_FEET_Y - cardHop(ageMs) },
          scale: { x: scale, y: scale },
          shapes: showcaseWalk(kind, stride, 'Right'),
        }),
        centered(name, CARD_NAME_Y, TITLE_SCALE),
        centered(pitch, CARD_PITCH_Y),
        ...cardTimerShapes(ageMs),
      ],
    }),
  ]
}

const debutCardOverlay = (
  model: Model,
  span: FrameSpan,
): ReadonlyArray<Canvas.Shape> =>
  DebutCard.match(model.debutCard, {
    Hidden: () => [],
    Showing: ({ kind, ageMs }) => debutCardShapes(span, kind, ageMs),
  })

// LOGO

const LOGO_PIXEL = 4
const LOGO_GAP = 1

type LogoLook = Readonly<{ palette: Palette }>

const LOGO_OUTLINE = 'O'
const LOGO_FILL = 'F'
const LOGO_LIGHT = 'L'
const LOGO_DARK = 'D'
const LOGO_DRIP = 'R'

const MUNCH_LOOK: LogoLook = {
  palette: {
    [LOGO_OUTLINE]: '#140c10',
    [LOGO_FILL]: '#8fdc5a',
    [LOGO_LIGHT]: '#d8f7b0',
    [LOGO_DARK]: '#3f7f2a',
    [LOGO_DRIP]: '#c4232b',
  },
}

const MANOR_LOOK: LogoLook = {
  palette: {
    [LOGO_OUTLINE]: '#140c10',
    [LOGO_FILL]: '#c39be8',
    [LOGO_LIGHT]: '#f0e2ff',
    [LOGO_DARK]: '#6d4a9a',
    [LOGO_DRIP]: '#c4232b',
  },
}

type Grid = ReadonlyArray<ReadonlyArray<boolean>>

const cellAt = (grid: Grid, x: number, y: number): boolean =>
  pipe(
    Array.get(grid, y),
    Option.flatMap(row => Array.get(row, x)),
    Option.getOrElse(() => false),
  )

const gridOf = (pixels: ReadonlyArray<string>): Grid =>
  Array.map(pixels, row =>
    Array.map(String.split(row, ''), symbol => symbol === '#'),
  )

const gridWidth = (grid: Grid): number =>
  Math.max(0, ...Array.map(grid, row => row.length))

const scale2xCell = (grid: Grid, bigX: number, bigY: number): boolean => {
  const x = Math.floor(bigX / 2)
  const y = Math.floor(bigY / 2)
  const center = cellAt(grid, x, y)
  const up = cellAt(grid, x, y - 1)
  const down = cellAt(grid, x, y + 1)
  const left = cellAt(grid, x - 1, y)
  const right = cellAt(grid, x + 1, y)
  const isTop = bigY % 2 === 0
  const isLeft = bigX % 2 === 0
  if (isTop && isLeft) {
    return left === up && up !== right && left !== down ? left : center
  } else if (isTop) {
    return up === right && up !== left && right !== down ? right : center
  } else if (isLeft) {
    return left === down && left !== up && down !== right ? left : center
  } else {
    return down === right && left !== down && up !== right ? right : center
  }
}

const scale2x = (grid: Grid): Grid =>
  Array.makeBy(grid.length * 2, bigY =>
    Array.makeBy(gridWidth(grid) * 2, bigX => scale2xCell(grid, bigX, bigY)),
  )

const dripLength = (seed: number, column: number): number => {
  const roll = (seed * 7 + column * 13) % 11
  return roll < 3 ? 3 + roll * 2 : 0
}

const LOGO_BORDER = 1
const DRIP_ROOM = 9

const logoLetterPixels = (
  glyph: Glyph,
  seed: number,
): ReadonlyArray<string> => {
  const source = gridOf(glyphPixels(glyph))
  const body = scale2x(scale2x(source))
  const bodyWidth = gridWidth(body)
  const bodyHeight = body.length
  const width = bodyWidth + LOGO_BORDER * 2
  const height = bodyHeight + LOGO_BORDER * 2 + DRIP_ROOM
  const isBody = (x: number, y: number): boolean =>
    cellAt(body, x - LOGO_BORDER, y - LOGO_BORDER)
  const isDrip = (x: number, y: number): boolean => {
    const bodyX = x - LOGO_BORDER
    const column = Math.floor(bodyX / LOGO_PIXEL)
    const inset = bodyX - column * LOGO_PIXEL
    const below = y - LOGO_BORDER - bodyHeight
    return (
      bodyX >= 0 &&
      (inset === 1 || inset === 2) &&
      below >= 0 &&
      cellAt(source, column, source.length - 1) &&
      below < dripLength(seed, column)
    )
  }
  const isSolid = (x: number, y: number): boolean =>
    isBody(x, y) || isDrip(x, y)
  const symbolAt = (x: number, y: number): string => {
    if (isBody(x, y)) {
      if (!isBody(x, y - 1)) {
        return LOGO_LIGHT
      } else if (!isBody(x, y + 1) || !isBody(x + 1, y)) {
        return LOGO_DARK
      } else {
        return LOGO_FILL
      }
    } else if (isDrip(x, y)) {
      return LOGO_DRIP
    } else if (
      Array.some([-1, 0, 1], dy =>
        Array.some([-1, 0, 1], dx => isSolid(x + dx, y + dy)),
      )
    ) {
      return LOGO_OUTLINE
    } else {
      return '.'
    }
  }
  return Array.makeBy(height, y =>
    pipe(
      Array.makeBy(width, x => symbolAt(x, y)),
      Array.join(''),
    ),
  )
}

type LogoLetter = Readonly<{ sprite: Sprite; width: number }>

const logoLine = (
  word: string,
  look: LogoLook,
  seed: number,
): ReadonlyArray<LogoLetter> =>
  pipe(
    String.split(word, ''),
    Array.map(toGlyph),
    Array.getSomes,
    Array.map((glyph, index) => {
      const pixels = logoLetterPixels(glyph, seed + index)
      return {
        sprite: spriteShapes(pixels, look.palette, TOP_LEFT),
        width: Math.max(...Array.map(pixels, row => row.length)),
      }
    }),
  )

const TITLE_WORDS: ReadonlyArray<string> = String.split(
  String.toUpperCase(GAME_TITLE),
  ' ',
)

const LOGO_LINES: ReadonlyArray<ReadonlyArray<LogoLetter>> = Array.map(
  TITLE_WORDS,
  (word, index) =>
    logoLine(word, index % 2 === 0 ? MUNCH_LOOK : MANOR_LOOK, index * 5),
)

const LOGO_TOP = 10
const LOGO_LINE_PX = 25
const LOGO_BOB_MS = 260
const LOGO_BOB_PX = 1.6

const lineWidth = (letters: ReadonlyArray<LogoLetter>): number =>
  Array.reduce(letters, 0, (sum, { width }) => sum + width + LOGO_GAP) -
  LOGO_GAP

const logoLineShapes =
  (screenMs: number) =>
  (
    letters: ReadonlyArray<LogoLetter>,
    lineIndex: number,
  ): ReadonlyArray<Canvas.Shape> => {
    const left = Math.round(CENTER_X - lineWidth(letters) / 2)
    const top = LOGO_TOP + lineIndex * LOGO_LINE_PX
    const shapes: Array<Canvas.Shape> = []
    let x = left
    for (const [index, letter] of letters.entries()) {
      const phase = screenMs / LOGO_BOB_MS + (index + lineIndex * 2) * 0.9
      const bob = Math.round(Math.sin(phase) * LOGO_BOB_PX)
      shapes.push(
        group({ translate: { x, y: top + bob }, shapes: letter.sprite }),
      )
      x += letter.width + LOGO_GAP
    }
    return shapes
  }

export const logoShapes = (screenMs: number): ReadonlyArray<Canvas.Shape> =>
  Array.flatMap(LOGO_LINES, logoLineShapes(screenMs))

// ALPHA CHIP

const ALPHA = bakeText('ALPHA', 'Plain')
const ALPHA_PAD_X = 3
const ALPHA_PAD_Y = 2
const ALPHA_GAP = 4
const ALPHA_DROP = 9
const ALPHA_FILL = '#c4232b'
const ALPHA_EDGE = '#140c10'

const alphaChipShapes = (): ReadonlyArray<Canvas.Shape> => {
  const lastLine = Option.getOrElse(Array.last(LOGO_LINES), () => [])
  const width = ALPHA.width + ALPHA_PAD_X * 2
  const height = GLYPH_HEIGHT + ALPHA_PAD_Y * 2
  const left = Math.round(CENTER_X + lineWidth(lastLine) / 2 + ALPHA_GAP)
  const top = LOGO_TOP + (LOGO_LINES.length - 1) * LOGO_LINE_PX + ALPHA_DROP
  return [
    Canvas.Rect({
      x: left - 1,
      y: top - 1,
      width: width + 2,
      height: height + 2,
      fill: ALPHA_EDGE,
    }),
    Canvas.Rect({ x: left, y: top, width, height, fill: ALPHA_FILL }),
    placeBaked(ALPHA, {
      x: left + ALPHA_PAD_X,
      y: top + ALPHA_PAD_Y,
      align: 'Left',
    }),
  ]
}

const ALPHA_CHIP: ReadonlyArray<Canvas.Shape> = alphaChipShapes()

// PARADE

type Marcher = Readonly<{
  kind: ZombieKind
  y: number
  speed: number
  offset: number
  direction: 1 | -1
}>

const PARADE: ReadonlyArray<Marcher> = [
  { kind: 'Shambler', y: 166, speed: 16, offset: 0, direction: 1 },
  { kind: 'Shambler', y: 168, speed: 16, offset: 22, direction: 1 },
  { kind: 'Runner', y: 167, speed: 30, offset: 90, direction: 1 },
  { kind: 'Tank', y: 157, speed: 9, offset: 40, direction: -1 },
  { kind: 'Exploder', y: 160, speed: 18, offset: 200, direction: -1 },
  { kind: 'Shambler', y: 158, speed: 14, offset: 150, direction: -1 },
]

const PARADE_MARGIN = 24
const PARADE_SHADOW = 'rgba(0, 0, 0, 0.35)'

const marcherShapes =
  (span: FrameSpan, screenMs: number) =>
  (marcher: Marcher): ReadonlyArray<Canvas.Shape> => {
    const travelled =
      marcher.offset + (marcher.speed * screenMs) / MS_PER_SECOND
    const along = (travelled % (span.width + PARADE_MARGIN * 2)) - PARADE_MARGIN
    const x = Math.round(
      marcher.direction === 1
        ? span.left + along
        : span.left + span.width - along,
    )
    const stats = ZOMBIE_KINDS[marcher.kind]
    const stride = Math.floor(travelled / stats.stridePx)
    const facing = marcher.direction === 1 ? 'Right' : 'Left'
    return [
      Canvas.Rect({
        x: x - 4,
        y: marcher.y,
        width: 8,
        height: 2,
        fill: PARADE_SHADOW,
      }),
      group({
        translate: { x, y: marcher.y + 1 },
        shapes: showcaseWalk(marcher.kind, stride, facing),
      }),
    ]
  }

const paradeShapes = (
  span: FrameSpan,
  screenMs: number,
): ReadonlyArray<Canvas.Shape> =>
  Array.flatMap(PARADE, marcherShapes(span, screenMs))

// READY

// NOTE: the player walks on the spot at center stage, twice the room's size,
// facing the Groaners that come in from the left with the pistol up. The home
// menu puts a button over them that opens the character picker.
const HERO_X = 160
const HERO_FEET_Y = 150
const HERO_SCALE = 2
const HERO_GUN_PX = 2

const runnerShapes = (
  appearance: Appearance,
  calling: Calling,
  gun: WeaponKind,
  screenMs: number,
): ReadonlyArray<Canvas.Shape> => [
  Canvas.Rect({
    x: HERO_X - 3 * HERO_SCALE,
    y: HERO_FEET_Y - HERO_SCALE,
    width: 7 * HERO_SCALE,
    height: 2 * HERO_SCALE,
    fill: PARADE_SHADOW,
  }),
  group({
    translate: { x: HERO_X, y: HERO_FEET_Y },
    scale: { x: HERO_SCALE, y: HERO_SCALE },
    shapes: [
      ...frameAt(
        playerSprites(appearance, calling).walk,
        Math.floor(screenMs / PLAYER_WALK_FRAME_MS),
      ).Normal.Left,
      group({
        translate: { x: -HERO_GUN_PX, y: -PLAYER_FOOT_OFFSET },
        shapes: gunSprite(gun, 0, Math.PI, appearance.gunSkin),
      }),
    ],
  }),
]

// NOTE: the logo and the room speak for themselves, so there is no tagline.
const readyShapes = (
  model: Model,
  span: FrameSpan,
): ReadonlyArray<Canvas.Shape> => [
  TITLE_BACKDROP,
  ...paradeShapes(span, model.screenMs),
  ...runnerShapes(
    model.appearance,
    focusOf(model).player.calling,
    heldGun(focusOf(model).player.arsenal).kind,
    model.screenMs,
  ),
  ...logoShapes(model.screenMs),
  ...ALPHA_CHIP,
]

// PAUSED

const PAUSED = bakeText('PAUSED', 'Title')
const PAUSED_Y = 9
const PAUSED_WAVE_Y = 28
const RESUME_Y = 164

const pausedShapes = (
  model: Model,
  wave: number,
  resumeY: number,
): ReadonlyArray<Canvas.Shape> => [
  DIM_BACKDROP,
  centered(PAUSED, PAUSED_Y, TITLE_SCALE),
  ...textShapes(
    waveLabel(model.mode, wave),
    'Plain',
    CENTER_X,
    PAUSED_WAVE_Y,
    'Center',
  ),
  centered(RESUME_PROMPT[model.lastDevice], resumeY),
]

// OVERLAY

const PORTRAIT_RESUME_LIFT = 34

// NOTE: in portrait the pause panel fills the world window, so the resume
// prompt drops to the thumb area, just above the gun slots.
const resumeYFor = (screen: Screen): number =>
  screen.layout === 'Landscape'
    ? RESUME_Y
    : screen.height - landscapeFrameOffset(screen).y - PORTRAIT_RESUME_LIFT

export const overlayShapes: {
  (screen: Screen): (model: Model) => ReadonlyArray<Canvas.Shape>
  (model: Model, screen: Screen): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  2,
  (model: Model, screen: Screen): ReadonlyArray<Canvas.Shape> =>
    Phase.match(model.phase, {
      Ready: () => readyShapes(model, frameSpanOf(screen)),
      Arriving: () => readyShapes(model, frameSpanOf(screen)),
      Preparation: ({ wave }) => [
        ...preparationBanner(model, wave, msIntoPhase(model.phase)),
        ...hintShapes(model),
      ],
      Wave: ({ wave, elapsedMs }) =>
        isDebutCardUp(model)
          ? debutCardOverlay(model, frameSpanOf(screen))
          : [...waveBanner(model, wave, elapsedMs), ...hintShapes(model)],
      Paused: ({ round }) =>
        pausedShapes(model, round.wave, resumeYFor(screen)),
      Escaped: () => [
        ...endOverlayShapes(model, screen),
        ...endMissionShapes(model, screen),
      ],
      GameOver: () => [
        ...endOverlayShapes(model, screen),
        ...endMissionShapes(model, screen),
      ],
    }),
)
