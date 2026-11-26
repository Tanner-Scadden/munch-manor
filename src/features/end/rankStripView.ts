import { Array, Function, Option, String } from 'effect'

import type { Model } from '../../app/model'
import { playerSprites } from '../../art/appearance'
import {
  DARE_BIG_ICONS,
  DARE_BIG_ICON_SIZE,
  JOURNAL_BIG_ICON,
} from '../../art/dareArt'
import { GLYPH_HEIGHT, textShapes, textWidth } from '../../art/font'
import {
  BONE,
  BONE_SIZE,
  PURSE,
  PURSE_SIZE,
  badgeSprite,
  shineSprite,
} from '../../art/rankArt'
import { frameAt, group, placeAt } from '../../art/sprite'
import { gunIcon, gunSprite } from '../../art/sprites/guns'
import { PART_OF_KIND, chooseLook } from '../../domain/looks'
import { heroRewardAt } from '../../domain/mastery'
import type * as Draw from '../../render/draw'
import { rect } from '../../render/drawing'
import { GUN_HOLD_PX } from '../../render/playerView'
import { PLAYER_FOOT_OFFSET } from '../../shared/constants'
import { milestoneOf } from '../../world/dare/milestones'
import { callingPriceOf } from '../../world/heroes/calling'
import {
  badgeTierOf,
  rankProgressOf,
  shownPointsOf,
} from '../../world/heroes/rank'
import {
  BONE_BONUS_TAGS,
  CALLING_NAMES,
  DARE_NAMES,
  MASTERY_SKIN_NAMES,
  PROP_STYLE_NAMES,
  PROP_WORD,
  PURSE_NAME,
  STORY_TITLES,
  giftName,
} from '../../world/names'
import { sparkShapes } from './crewBoardView'
import {
  CALLING_FLIP_MS,
  type EndKind,
  EndUnlock,
  RANK_FILL_MS,
  RANK_POP_MS,
  UNLOCK_FADE_MS,
  UNLOCK_LINGER_MS,
  easeOut,
  easeOutBack,
  hasRankStrip,
  isRankedUp,
  progressOf,
  rankDoneMs,
  rankStripAtMs,
  unlockFlipAtMs,
  unlockGoneMs,
  unlockStartMs,
  unlocksOf,
} from './endBeat'

export const STRIP_PX = 11

const BAR_EDGE = '#5a3a4a'
const BAR_BACK = '#140c10'
const BAR_FILL = '#ffd23f'
const BAR_SHINE = '#fff2a8'
const BADGE_X = 6
const NUMBER_X = 15
const BAR_X = 34
const BAR_WIDTH = 68
const BONUS_BAR_WIDTH = 48
const BONUS_GAP_PX = 4
const BONES_GAP_PX = 4
const BONE_TEXT_GAP_PX = 3
const TAG_GAP_PX = 2
const TAG_PAD_PX = 1
const TAG_FILL = '#ffd23f'
const MIN_BAR_WIDTH = 24
const POP_SCALE = 1.2
const FADE_MS = 120
const SHINE_FRAME_MS = 45

const tagWidth = (text: string): number => textWidth(text) + TAG_PAD_PX * 2

const tagShapes = (
  text: string,
  left: number,
  centerY: number,
): ReadonlyArray<Draw.Shape> => {
  const top = centerY - Math.floor(GLYPH_HEIGHT / 2)
  return [
    rect(left, top - 1, tagWidth(text), GLYPH_HEIGHT + 1, TAG_FILL),
    ...textShapes(text, 'Ink', left + TAG_PAD_PX, top, 'Left'),
  ]
}

const tagsShapes = (
  tags: ReadonlyArray<string>,
  right: number,
  centerY: number,
): ReadonlyArray<Draw.Shape> => {
  const [, shapes] = Array.mapAccum(
    tags,
    right - tagsWidth(tags),
    (left, text): readonly [number, ReadonlyArray<Draw.Shape>] => [
      left + tagWidth(text) + TAG_GAP_PX,
      tagShapes(text, left, centerY),
    ],
  )
  return Array.flatten(shapes)
}

const tagsWidth = (tags: ReadonlyArray<string>): number =>
  Array.reduce(tags, 0, (sum, text) => sum + tagWidth(text) + TAG_GAP_PX)

const barShapes = (
  x: number,
  y: number,
  fraction: number,
  barWidth: number,
): ReadonlyArray<Draw.Shape> => {
  const filled = Math.round(barWidth * fraction)
  return [
    rect(x - 1, y - 3, barWidth + 2, 6, BAR_EDGE),
    rect(x, y - 2, barWidth, 4, BAR_BACK),
    ...(filled > 0
      ? [
          rect(x, y - 2, filled, 4, BAR_FILL),
          rect(x, y - 2, filled, 1, BAR_SHINE),
        ]
      : []),
  ]
}

const CARD_WIDTH = 62
const CARD_EDGE = '#ffd23f'
const CARD_FILL = '#2a1a2e'

export type UnlockCardSize = 'Full' | 'Compact'

const CARD_SIZES: Readonly<
  Record<
    UnlockCardSize,
    Readonly<{ height: number; footY: number; figureScale: number }>
  >
> = {
  Full: { height: 50, footY: 37, figureScale: 2 },
  Compact: { height: 40, footY: 29, figureScale: 1 },
}

export type UnlockSpot = Readonly<{
  x: number
  top: number
  size: UnlockCardSize
}>

const unlockFigureOf = (
  model: Model,
  unlock: EndUnlock,
): Readonly<{
  figure: ReadonlyArray<Draw.Shape>
  name: string
  maybeBoneTag: Option.Option<string>
  tab: string
}> =>
  EndUnlock.match(unlock, {
    Calling: ({ calling }) => ({
      figure: frameAt(playerSprites(model.appearance, calling).idle, 0).Normal
        .Right,
      name: CALLING_NAMES[calling],
      maybeBoneTag: Option.map(callingPriceOf(calling), price => `${price}`),
      tab: FOR_SALE_TAB,
    }),
    Gift: ({ kind, name }) => {
      const look = chooseLook(model.appearance, PART_OF_KIND[kind], name)
      return {
        figure: [
          ...frameAt(playerSprites(look).idle, 0).Normal.Right,
          ...(kind === 'Skin'
            ? [
                group({
                  translate: { x: GUN_HOLD_PX, y: -PLAYER_FOOT_OFFSET },
                  shapes: gunSprite('Pistol', 0, 0, look.gunSkin),
                }),
              ]
            : []),
        ],
        name: giftName(kind, name),
        maybeBoneTag: Option.none(),
        tab: GIFT_TAB,
      }
    },
    Purse: ({ bones }) => ({
      figure: [standingSprite(PURSE, PURSE_SIZE)],
      name: PURSE_NAME,
      maybeBoneTag: Option.some(`+${bones}`),
      tab: PURSE_TAB,
    }),
    HeroLevel: ({ calling, level }) =>
      Option.match(
        Option.filter(heroRewardAt(level), reward => reward !== 'Story'),
        {
          onNone: () => ({
            figure: [standingIcon(JOURNAL_BIG_ICON)],
            name: CALLING_NAMES[calling],
            maybeBoneTag: Option.none(),
            tab: STORY_TAB,
          }),
          onSome: style => ({
            figure: frameAt(
              playerSprites(
                { ...model.appearance, hat: 'None', propStyle: style },
                calling,
              ).idle,
              0,
            ).Normal.Right,
            name: `${PROP_STYLE_NAMES[style]} ${PROP_WORD}`,
            maybeBoneTag: Option.none(),
            tab: MASTERY_TAB,
          }),
        },
      ),
    GunMastery: ({ kind, skin }) => ({
      figure: [
        group({
          translate: { x: 0, y: -3 },
          shapes: gunIcon(kind, 0, skin),
        }),
      ],
      name: MASTERY_SKIN_NAMES[skin],
      maybeBoneTag: Option.none(),
      tab: MASTERY_TAB,
    }),
    Milestone: ({ milestone }) =>
      Option.match(milestoneOf(milestone).maybeThing, {
        onNone: () => ({
          figure: [standingIcon(JOURNAL_BIG_ICON)],
          name: STORY_TITLES[milestone],
          maybeBoneTag: Option.none(),
          tab: STORY_TAB,
        }),
        onSome: thing => ({
          figure: [standingIcon(DARE_BIG_ICONS[thing])],
          name: DARE_NAMES[thing],
          maybeBoneTag: Option.none(),
          tab: THING_TAB,
        }),
      }),
  })

const standingIcon = (icon: ReadonlyArray<Draw.Shape>): Draw.Shape =>
  group({
    translate: {
      x: -Math.floor(DARE_BIG_ICON_SIZE / 2),
      y: -DARE_BIG_ICON_SIZE - 1,
    },
    shapes: icon,
  })

const standingSprite = (
  sprite: ReadonlyArray<Draw.Shape>,
  size: Readonly<{ width: number; height: number }>,
): Draw.Shape =>
  group({
    translate: { x: 0, y: -Math.ceil(size.height / 2) - 1 },
    shapes: sprite,
  })

const PRICE_TAG_Y = 6
const PRICE_TAG_GAP_PX = 2

const boneTagShapes = (text: string): ReadonlyArray<Draw.Shape> => {
  const width = BONE_SIZE.width + PRICE_TAG_GAP_PX + textWidth(text)
  const left = -Math.floor(width / 2)
  return [
    placeAt(left + Math.floor(BONE_SIZE.width / 2), PRICE_TAG_Y, BONE),
    ...textShapes(
      text,
      'Victory',
      left + BONE_SIZE.width + PRICE_TAG_GAP_PX,
      PRICE_TAG_Y - Math.floor(GLYPH_HEIGHT / 2),
      'Left',
    ),
  ]
}

const FOR_SALE_TAB = 'NOW PURCHASABLE'
const GIFT_TAB = 'NOW AVAILABLE'
const PURSE_TAB = 'BONUS BONES'
const THING_TAB = 'NEW ON THE LIST'
const STORY_TAB = 'NEW STORY PAGE'
const MASTERY_TAB = 'MASTERY UP'
const TAB_HEIGHT = GLYPH_HEIGHT + 4
const TAB_PAD_PX = 3
const TAB_WIDTH_PX = Math.max(
  CARD_WIDTH + 2,
  ...Array.map(
    [FOR_SALE_TAB, GIFT_TAB, PURSE_TAB, THING_TAB, STORY_TAB, MASTERY_TAB],
    text => textWidth(text) + TAB_PAD_PX * 2,
  ),
)

export const unlockCardBox = (
  size: UnlockCardSize,
): Readonly<{ width: number; height: number }> => ({
  width: TAB_WIDTH_PX,
  height: TAB_HEIGHT + 2 + CARD_SIZES[size].height,
})
const TIMER_HEIGHT = 1
const TIMER_COLOR = '#ffd23f'
const TIMER_BACK = '#140c10'

const tabShapes = (text: string): ReadonlyArray<Draw.Shape> => {
  const width = TAB_WIDTH_PX
  return [
    rect(-width / 2, -TAB_HEIGHT - 1, width, TAB_HEIGHT, CARD_EDGE),
    ...textShapes(text, 'Ink', 0, -TAB_HEIGHT + 1, 'Center'),
  ]
}

const timerShapes = (
  left: number,
  cardHeight: number,
): ReadonlyArray<Draw.Shape> => {
  const filled = Math.round(CARD_WIDTH * Math.max(0, Math.min(1, left)))
  return [
    rect(
      -CARD_WIDTH / 2,
      cardHeight - TIMER_HEIGHT,
      CARD_WIDTH,
      TIMER_HEIGHT,
      TIMER_BACK,
    ),
    ...(filled > 0
      ? [
          rect(
            -CARD_WIDTH / 2,
            cardHeight - TIMER_HEIGHT,
            filled,
            TIMER_HEIGHT,
            TIMER_COLOR,
          ),
        ]
      : []),
  ]
}

export const unlockCardShapes: {
  (
    kind: EndKind,
    ms: number,
    spot: UnlockSpot,
  ): (model: Model) => ReadonlyArray<Draw.Shape>
  (
    model: Model,
    kind: EndKind,
    ms: number,
    spot: UnlockSpot,
  ): ReadonlyArray<Draw.Shape>
} = Function.dual(
  4,
  (
    model: Model,
    kind: EndKind,
    ms: number,
    spot: UnlockSpot,
  ): ReadonlyArray<Draw.Shape> => {
    if (!hasRankStrip(model)) {
      return []
    }
    const flipAtMs = unlockFlipAtMs(model, kind)
    const unlocks = unlocksOf(model)
    const goneMs = unlockGoneMs(model, kind)
    if (ms >= goneMs) {
      return []
    }
    const doneMs = rankDoneMs(model, kind)
    const fade = 1 - progressOf(ms, goneMs - UNLOCK_FADE_MS, UNLOCK_FADE_MS)
    const timerLeft =
      ms < doneMs ? 1 : 1 - progressOf(ms, doneMs, UNLOCK_LINGER_MS)
    const shown = Array.findLastIndex(
      unlocks,
      (_, index) => ms >= flipAtMs + unlockStartMs(index),
    )
    return Option.match(
      Option.flatMap(shown, index => Array.get(unlocks, index)),
      {
        onNone: () => [],
        onSome: unlock => {
          const startMs =
            flipAtMs + unlockStartMs(Option.getOrElse(shown, () => 0))
          const turn = easeOutBack(progressOf(ms, startMs, CALLING_FLIP_MS))
          const scaleX = Math.max(0.04, Math.min(1, turn))
          const { height, footY, figureScale } = CARD_SIZES[spot.size]
          const top = spot.top + TAB_HEIGHT + 1
          const { figure, name, maybeBoneTag, tab } = unlockFigureOf(
            model,
            unlock,
          )
          return [
            group({
              translate: { x: spot.x, y: top },
              scale: { x: scaleX, y: 1 },
              opacity: fade >= 1 ? undefined : fade,
              shapes: [
                ...tabShapes(tab),
                rect(
                  -CARD_WIDTH / 2 - 1,
                  -1,
                  CARD_WIDTH + 2,
                  height + 2,
                  CARD_EDGE,
                ),
                rect(-CARD_WIDTH / 2, 0, CARD_WIDTH, height, CARD_FILL),
                group({
                  translate: { x: 0, y: footY },
                  scale:
                    figureScale === 1
                      ? undefined
                      : { x: figureScale, y: figureScale },
                  shapes: figure,
                }),
                ...Option.match(maybeBoneTag, {
                  onNone: () => [],
                  onSome: boneTagShapes,
                }),
                ...textShapes(
                  String.toUpperCase(name),
                  'Plain',
                  0,
                  height - GLYPH_HEIGHT - 2,
                  'Center',
                ),
                ...timerShapes(timerLeft, height),
              ],
            }),
          ]
        },
      },
    )
  },
)

export const rankStripShapes: {
  (
    kind: EndKind,
    ms: number,
    left: number,
    centerY: number,
    width: number,
  ): (model: Model) => ReadonlyArray<Draw.Shape>
  (
    model: Model,
    kind: EndKind,
    ms: number,
    left: number,
    centerY: number,
    width: number,
  ): ReadonlyArray<Draw.Shape>
} = Function.dual(
  6,
  (
    model: Model,
    kind: EndKind,
    ms: number,
    left: number,
    centerY: number,
    width: number,
  ): ReadonlyArray<Draw.Shape> =>
    Option.match(model.runGains.maybeRankGain, {
      onNone: () => [],
      onSome: ({
        pointsBefore,
        gained,
        bonesGained,
        bonusPercent,
        bonuses,
      }) => {
        const startMs = rankStripAtMs(model, kind)
        if (ms < startMs) {
          return []
        }
        const fillT = easeOut(progressOf(ms, startMs, RANK_FILL_MS))
        const progress = rankProgressOf(
          shownPointsOf(pointsBefore, gained, fillT),
        )
        const popAtMs = startMs + RANK_FILL_MS
        const isPopping = isRankedUp(model) && ms >= popAtMs
        const pop = isPopping
          ? 1 +
            (POP_SCALE - 1) *
              2 *
              (1 - easeOutBack(progressOf(ms, popAtMs, RANK_POP_MS)))
          : 1
        const number = `${progress.rank}`
        const barX = left + BAR_X
        const tags = Array.map(bonuses, bonus => BONE_BONUS_TAGS[bonus])
        const tagsRoom = tagsWidth(tags)
        const barWidth = Math.max(
          MIN_BAR_WIDTH,
          (bonusPercent > 0 ? BONUS_BAR_WIDTH : BAR_WIDTH) - tagsRoom,
        )
        const bonusText = `+${bonusPercent}%`
        const bonusRoom =
          bonusPercent > 0 ? BONUS_GAP_PX + textWidth(bonusText) : 0
        const bones = Math.round(bonesGained * fillT)
        const bonesText = `+${bones}`
        const bonesRight = left + width
        const boneX =
          bonesRight -
          textWidth(bonesText) -
          BONE_TEXT_GAP_PX -
          BONE_SIZE.width / 2
        const fade = easeOut(progressOf(ms, startMs, FADE_MS))
        return [
          group({
            opacity: fade >= 1 ? undefined : fade,
            shapes: [
              group({
                translate: { x: left + BADGE_X, y: centerY },
                scale: pop === 1 ? undefined : { x: pop, y: pop },
                shapes: isPopping
                  ? shineSprite(
                      badgeTierOf(progress.rank),
                      Math.floor((ms - popAtMs) / SHINE_FRAME_MS),
                    )
                  : badgeSprite(badgeTierOf(progress.rank)),
              }),
              ...textShapes(
                number,
                isPopping ? 'Victory' : 'Plain',
                left + NUMBER_X,
                centerY - Math.floor(GLYPH_HEIGHT / 2),
                'Left',
              ),
              ...barShapes(barX, centerY, progress.fraction, barWidth),
              ...(bonusPercent > 0
                ? textShapes(
                    bonusText,
                    'Victory',
                    barX + barWidth + BONUS_GAP_PX,
                    centerY - Math.floor(GLYPH_HEIGHT / 2),
                    'Left',
                  )
                : []),
              ...(bonesGained > 0 &&
              barX + barWidth + bonusRoom + tagsRoom + BONES_GAP_PX < boneX
                ? [
                    ...tagsShapes(
                      tags,
                      Math.round(boneX - BONE_SIZE.width / 2) - 1,
                      centerY,
                    ),
                    placeAt(Math.round(boneX), centerY, BONE),
                    ...textShapes(
                      bonesText,
                      'Victory',
                      bonesRight,
                      centerY - Math.floor(GLYPH_HEIGHT / 2),
                      'Right',
                    ),
                  ]
                : []),
              ...(isPopping
                ? sparkShapes(left + BADGE_X, centerY, ms - popAtMs)
                : []),
            ],
          }),
        ]
      },
    }),
)
