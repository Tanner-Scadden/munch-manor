import { Array, Function, Option, Record } from 'effect'
import type { Canvas } from 'foldkit'

import type { Model } from '../../app/model'
import { CASE_HEIGHT, PRIZE_SPRITES } from '../../art/caseArt'
import { CHICKEN_ICON, CHICKEN_ICON_SIZE } from '../../art/chickenArt'
import {
  type BakedText,
  GLYPH_HEIGHT,
  bakeText,
  placeBaked,
  textShapes,
} from '../../art/font'
import { GRAB_HAND, prizeSprite } from '../../art/prizeArt'
import {
  type Sprite,
  TOP_LEFT,
  bakeShapes,
  boundsOf,
  group,
  placeAt,
  spriteShapes,
} from '../../art/sprite'
import { gunIcon } from '../../art/sprites/guns'
import { type Camera, anchoredAt, placedAt } from '../../render/camera'
import { type RingPixel, rect, ringPixels } from '../../render/drawing'
import { featLockShapes, lockSpotIn } from '../../render/featLockView'
import { clearWindowOf } from '../../render/hudLayout'
import { type Keepout, clearOfKeepouts } from '../../render/keepout'
import {
  COOKED_GUN_ICONS,
  COOKED_GUN_ICON_WIDTH,
  FLAME_ICON,
  PERK_ICON_SIZE,
} from '../../render/kitchenGearView'
import { PADLOCK_SPRITE } from '../../render/room/kitchenView'
import { screenOf } from '../../render/screen'
import { FRIDGE_RULES } from '../../world/fridge/leftovers'
import { hasPan, maybeReplacedGun } from '../../world/gear/weapons'
import { crewAtBackDoorOf } from '../../world/kitchen/backDoor'
import { maybeValveLock } from '../../world/kitchen/gasValve'
import { maybeStoveLock, maybeStovePerk } from '../../world/kitchen/stove'
import { levelOf } from '../../world/level/arena'
import { EXIT_RULES } from '../../world/level/exits'
import { focusOf, focusSlotOf } from '../../world/party/party'
import type { FridgePrize } from '../../world/schema/entitySchema'
import {
  type CasePrize,
  FridgeDoor,
  type GunPerk,
  Purchasable,
  Purchase,
} from '../../world/schema/worldSchema'
import {
  type Offer,
  PURCHASE_RULES,
  holdProgress,
  isSamePurchasable,
  maybeOfferInReach,
  offersOf,
} from '../../world/shop/purchase'
import { clamp } from '../../world/step/geometry'

// NOTE: a purchasable says what it costs without a word: a dark tag with
// the coin and the price hangs off a nail. Walk up and it brightens, with a
// keycap (or a pointing finger on touch) beside it; hold and a gold ring
// fills around it; a press the wallet cannot cover shakes it red with the
// shortfall under it. Nothing covers the fight and the camera stays put.

// THE TAG

const TAG_PAD = 2
const RING_STEPS = 24
const RING_GAP = 2

type TagLook = Readonly<{ edge: string; face: string; trim: string }>

const PLAIN_LOOK: TagLook = {
  edge: '#140c10',
  face: '#3a2408',
  trim: '#c98a1a',
}
const LIT_LOOK: TagLook = { edge: '#ffe066', face: '#6a4410', trim: '#ffd23f' }
const SHORT_LOOK: TagLook = {
  edge: '#ff4a4f',
  face: '#5a1418',
  trim: '#ff8a7a',
}

type PriceTag = Readonly<{
  width: number
  height: number
  plain: Sprite
  lit: Sprite
  short: Sprite
  rings: Array.NonEmptyReadonlyArray<Sprite>
}>

// NOTE: a tag can lead with a small picture of what it sells, such as the
// stove's perk.
type TagIcon = Readonly<{ sprite: Sprite; width: number }>

const ICON_GAP = 2

const tagSprite = (
  content: Sprite,
  width: number,
  height: number,
  look: TagLook,
): Sprite => [
  ...bakeShapes([
    rect(Math.floor(width / 2), -4, 1, 4, '#c9c3b0'),
    rect(Math.floor(width / 2) - 1, -5, 3, 1, '#8a8a96'),
    rect(-1, -1, width + 2, height + 2, look.edge),
    rect(0, 0, width, height, look.face),
    rect(0, 0, width, 1, look.trim),
  ]),
  ...content,
]

const ringSprite = (pixels: ReadonlyArray<RingPixel>, filled: number): Sprite =>
  bakeShapes(
    Array.map(pixels, ({ x, y, turn }) =>
      rect(x, y, 1, 1, turn < filled ? '#ffd23f' : '#2a1a10'),
    ),
  )

// NOTE: built once per tag, as the module loads, so every tag is an image
// from the atlas.
const makeTag = (content: Sprite, width: number, height: number): PriceTag => {
  const pixels = ringPixels(Math.ceil(width / 2) + RING_GAP)
  return {
    width,
    height,
    plain: tagSprite(content, width, height, PLAIN_LOOK),
    lit: tagSprite(content, width, height, LIT_LOOK),
    short: tagSprite(content, width, height, SHORT_LOOK),
    rings: [
      ringSprite(pixels, 0),
      ...Array.makeBy(RING_STEPS, step =>
        ringSprite(pixels, (step + 1) / RING_STEPS),
      ),
    ],
  }
}

const bakePriceTag = (price: number): PriceTag =>
  bakeTag(bakeText(`$${price}`, 'Coin'))

const bakeTag = (
  text: BakedText,
  maybeIcon: Option.Option<TagIcon> = Option.none(),
): PriceTag => {
  const iconWidth = Option.match(maybeIcon, {
    onNone: () => 0,
    onSome: icon => icon.width + ICON_GAP,
  })
  return makeTag(
    [
      ...Option.match(maybeIcon, {
        onNone: () => [],
        onSome: icon => [placeAt(TAG_PAD, TAG_PAD - 1, icon.sprite)],
      }),
      placeBaked(text, { x: TAG_PAD + iconWidth, y: TAG_PAD, align: 'Left' }),
    ],
    text.width + iconWidth + TAG_PAD * 2 + 1,
    GLYPH_HEIGHT + TAG_PAD * 2,
  )
}

// NOTE: a prize already paid for (the fridge's weapon on offer, or a
// display case opened for the player) says what it gives with no word: an
// open hand beside the prize's own icon, small, so the tag never hides the
// prize itself (the owner, 2026-11-10: "I can't even tell what item I am
// getting").
const TAKE_PAD = 2

const takeTag = (item: Sprite): PriceTag => {
  const parts: ReadonlyArray<Sprite> = [GRAB_HAND, item]
  const boxes = Array.map(parts, sprite => boundsOf(sprite))
  const inner = Array.reduce(boxes, 0, (tallest, box) =>
    Math.max(tallest, box.bottom - box.top),
  )
  const placed = Array.reduce(
    Array.zip(parts, boxes),
    { left: TAKE_PAD, shapes: Array.empty<Canvas.Shape>() },
    ({ left, shapes }, [sprite, box]) => ({
      left: left + box.right - box.left + ICON_GAP,
      shapes: [
        ...shapes,
        placeAt(
          left - box.left,
          TAKE_PAD + Math.floor((inner - (box.bottom - box.top)) / 2) - box.top,
          sprite,
        ),
      ],
    }),
  )
  return makeTag(
    placed.shapes,
    placed.left - ICON_GAP + TAKE_PAD,
    inner + TAKE_PAD * 2,
  )
}

const FRIDGE_TAKE_TAGS: Readonly<Record<FridgePrize, PriceTag>> = {
  Cooker: takeTag(prizeSprite('Cooker')),
  Pan: takeTag(prizeSprite('Pan')),
  Freeze: takeTag(prizeSprite('Freeze')),
  Sandwich: takeTag(prizeSprite('Sandwich')),
  Dud: takeTag(prizeSprite('Dud')),
}

const CASE_TAKE_TAGS: Readonly<Record<CasePrize, PriceTag>> = Record.map(
  PRIZE_SPRITES,
  item => takeTag(item),
)

// NOTE: what a take gives: the fridge's weapon on offer, or the prize in
// the opened case. The tag here and the touch hold button both show it.
type TakenPrize =
  | Readonly<{ _tag: 'FromFridge'; prize: FridgePrize }>
  | Readonly<{ _tag: 'FromCase'; prize: CasePrize }>

const noTake = (): Option.Option<TakenPrize> => Option.none()

const maybeTakenPrize = (
  model: Model,
  target: Purchasable,
): Option.Option<TakenPrize> =>
  Purchasable.match(target, {
    Exit: noTake,
    Fridge: noTake,
    Stove: noTake,
    Valve: noTake,
    BackDoor: noTake,
    Prize: () => {
      const { door } = model.fridge
      return FridgeDoor.isAnyOf(['Offering'])(door)
        ? Option.some<TakenPrize>({ _tag: 'FromFridge', prize: door.prize })
        : Option.none()
    },
    Case: ({ id }) =>
      Option.map(
        Array.findFirst(model.cases, displayCase => displayCase.id === id),
        ({ prize }): TakenPrize => ({ _tag: 'FromCase', prize }),
      ),
  })

// NOTE: the icon of what a take at `target` gives, if it is one.
export const maybeTakenIcon: {
  (target: Purchasable): (model: Model) => Option.Option<Sprite>
  (model: Model, target: Purchasable): Option.Option<Sprite>
} = Function.dual(
  2,
  (model: Model, target: Purchasable): Option.Option<Sprite> =>
    Option.map(maybeTakenPrize(model, target), taken =>
      taken._tag === 'FromFridge'
        ? prizeSprite(taken.prize)
        : PRIZE_SPRITES[taken.prize],
    ),
)

const takeTagAt = (model: Model, target: Purchasable): PriceTag =>
  Option.match(maybeTakenPrize(model, target), {
    onNone: () => FRIDGE_TAKE_TAGS.Cooker,
    onSome: taken =>
      taken._tag === 'FromFridge'
        ? FRIDGE_TAKE_TAGS[taken.prize]
        : CASE_TAKE_TAGS[taken.prize],
  })

// NOTE: a boarded exit wears a padlock with the keys it asks
// (src/world/level/exits.ts): one price each for the kitchen, a room off
// the dining room, and the far room, each baked once here.
const PADLOCK_WIDTH = 7

const padlockTag = (keys: number): PriceTag =>
  bakeTag(
    bakeText(`$${keys}`, 'Coin'),
    Option.some({ sprite: PADLOCK_SPRITE, width: PADLOCK_WIDTH }),
  )

const EXIT_PRICES: Array.NonEmptyReadonlyArray<number> = [
  EXIT_RULES.kitchenKeys,
  ...EXIT_RULES.roomKeys,
  EXIT_RULES.farKeys,
]

const EXIT_TAGS = Array.map(EXIT_PRICES, keys => ({
  keys,
  tag: padlockTag(keys),
}))

const exitTagOf = (keys: number): PriceTag =>
  Option.getOrElse(
    Option.map(
      Array.findFirst(EXIT_TAGS, entry => entry.keys === keys),
      ({ tag }) => tag,
    ),
    () => Array.lastNonEmpty(EXIT_TAGS).tag,
  )

const FRIDGE_TAG = bakePriceTag(FRIDGE_RULES.keys)

// NOTE: the kitchen tour gives the boards and the first pull away
// (src/world/run/tutorialRules.ts), so their tags say FREE.
const FREE_TAG = bakeTag(bakeText('FREE', 'Title'))

// NOTE: the stove and the valve are earned by feats, not bought
// (src/world/feats/feats.ts), so their tags say GO beside what they give:
// the stove's perk this break, or the valve's flame.
const goTag = (icon: Sprite): PriceTag =>
  bakeTag(
    bakeText('GO', 'Prompt'),
    Option.some({ sprite: icon, width: PERK_ICON_SIZE }),
  )

// NOTE: the stove's tag shows the gun in hand wearing this break's perk,
// so GO reads as "cook your gun".
const cookTag = (perk: GunPerk): PriceTag =>
  bakeTag(
    bakeText('GO', 'Prompt'),
    Option.some({
      sprite: COOKED_GUN_ICONS[perk],
      width: COOKED_GUN_ICON_WIDTH,
    }),
  )

const STOVE_TAGS: Readonly<Record<GunPerk, PriceTag>> = {
  Spicy: cookTag('Spicy'),
  Crispy: cookTag('Crispy'),
  Hearty: cookTag('Hearty'),
}

const stoveTagOf = (model: Model): PriceTag =>
  STOVE_TAGS[Option.getOrElse(maybeStovePerk(model), (): GunPerk => 'Spicy')]

const VALVE_TAG = goTag(FLAME_ICON)

// NOTE: the back door's tag is a chicken and OUT: what leaving makes you.
const BACK_DOOR_TAG = bakeTag(
  bakeText('OUT', 'Prompt'),
  Option.some({ sprite: CHICKEN_ICON, width: CHICKEN_ICON_SIZE }),
)

const tagOf = (model: Model, offer: Offer): PriceTag =>
  Purchasable.match(offer.target, {
    Exit: () => (offer.price === 0 ? FREE_TAG : exitTagOf(offer.price)),
    Fridge: () => (offer.price === 0 ? FREE_TAG : FRIDGE_TAG),
    Prize: () => takeTagAt(model, offer.target),
    Stove: () => stoveTagOf(model),
    Valve: () => VALVE_TAG,
    Case: () => takeTagAt(model, offer.target),
    BackDoor: () => BACK_DOOR_TAG,
  })

// THE PROMPT

const KEYCAP: Sprite = spriteShapes(
  [
    '.kkkkkkkk.',
    'kWWWWWWWWk',
    'kWWWWWWkWk',
    'kWWkWWWkWk',
    'kWkkkkkkWk',
    'kWWkWWWWWk',
    'kWWWWWWWWk',
    'kGGGGGGGGk',
    '.kkkkkkkk.',
  ],
  { k: '#140c10', W: '#f4f1de', G: '#9a9488' },
  TOP_LEFT,
)

const FINGER: Sprite = spriteShapes(
  [
    '...kk.....',
    '..kWWk....',
    '..kWWk....',
    '..kWWkkk..',
    '..kWWWWWkk',
    'kkkWWWWWWk',
    'kWkWWWWWWk',
    'kWWWWWWWWk',
    '.kWWWWWWk.',
    '..kkkkkk..',
  ],
  { k: '#140c10', W: '#f4f1de' },
  TOP_LEFT,
)

const PROMPT_GAP = 4
const PROMPT_BOB_MS = 400

const promptShapes = (
  model: Model,
  offer: Offer,
  tag: PriceTag,
): ReadonlyArray<Canvas.Shape> => {
  const bob = Math.floor(model.elapsedMs / PROMPT_BOB_MS) % 2
  return [
    placeAt(
      offer.spot.x + Math.ceil(tag.width / 2) + PROMPT_GAP,
      offer.spot.y + Math.floor(tag.height / 2) - 5 - bob,
      model.lastDevice === 'Touch' ? FINGER : KEYCAP,
    ),
  ]
}

// THE HOLD

const SHAKE_PX = 2
const SHAKE_PERIOD_MS = 40

const shakeOffset = (sinceMs: number): number =>
  sinceMs >= PURCHASE_RULES.refusedMs
    ? 0
    : Math.round(
        Math.sin((sinceMs / SHAKE_PERIOD_MS) * Math.PI) *
          SHAKE_PX *
          (1 - sinceMs / PURCHASE_RULES.refusedMs),
      )

const tagLeft = (offer: Offer, tag: PriceTag): number =>
  offer.spot.x - Math.floor(tag.width / 2)

const ringShapes = (
  offer: Offer,
  tag: PriceTag,
  progress: number,
): ReadonlyArray<Canvas.Shape> => {
  const step = Math.min(RING_STEPS, Math.floor(progress * RING_STEPS))
  return [
    placeAt(
      offer.spot.x,
      offer.spot.y + Math.floor(tag.height / 2),
      Option.getOrElse(Array.get(tag.rings, step), () => tag.rings[0]),
    ),
  ]
}

const refusedShapes = (
  offer: Offer,
  tag: PriceTag,
  shortBy: number,
  sinceMs: number,
): ReadonlyArray<Canvas.Shape> =>
  sinceMs >= PURCHASE_RULES.refusedMs
    ? [placeAt(tagLeft(offer, tag), offer.spot.y, tag.plain)]
    : [
        placeAt(
          tagLeft(offer, tag) + shakeOffset(sinceMs),
          offer.spot.y,
          tag.short,
        ),
        ...textShapes(
          `$${shortBy}`,
          'Defeat',
          offer.spot.x + Math.ceil(tag.width / 2) + PROMPT_GAP,
          offer.spot.y + TAG_PAD,
          'Left',
        ),
      ]

// NOTE: the stove cooks only a gun Rattles sells, so a press there with
// the knife, the Pan, or a fridge weapon in hand shakes the tag with a red
// cross beside it, and no price.
// The back door with nothing on the list found shakes the same way.
const isUncooked = (offer: Offer, sinceMs: number): boolean =>
  Purchasable.isAnyOf(['Stove', 'BackDoor'])(offer.target) &&
  offer.isFull &&
  sinceMs < PURCHASE_RULES.refusedMs

const uncookedShapes = (
  offer: Offer,
  tag: PriceTag,
  sinceMs: number,
): ReadonlyArray<Canvas.Shape> => [
  placeAt(tagLeft(offer, tag) + shakeOffset(sinceMs), offer.spot.y, tag.short),
  placeAt(
    offer.spot.x + Math.ceil(tag.width / 2) + PROMPT_GAP + CROSS_HALF,
    offer.spot.y + Math.floor(tag.height / 2),
    CROSS,
  ),
]

// NOTE: a weapon on offer fills the fridge's door (src/features/fridge/fridgeRevealView.ts),
// so its take tag hangs beside the fridge instead of over it.
const PRIZE_TAG_GAP = 4

// NOTE: a display case's prize floats up out of the case once it opens
// (src/features/cases/caseView.ts), so its tag hangs over the case's top,
// clear of the prize.
const CASE_TAG_GAP = 3

// NOTE: boards in a side wall stand in a narrow doorway with a display
// case's feat lock close by (the dining room's west case, 2026-11-10
// playtest), so their tag hangs just above the boards, tucked in from the
// wall so it stays on the screen, and never over the lock.
const SIDE_TAG_GAP = 1

const isSideBoards = ({ box }: Offer): boolean =>
  box.right - box.left < box.bottom - box.top

const sideBoardsSpot = (
  offer: Offer,
  tag: PriceTag,
  bounds: Readonly<{ left: number; right: number }>,
): Offer => {
  const half = Math.ceil(tag.width / 2)
  return {
    ...offer,
    spot: {
      x: clamp(offer.spot.x, bounds.left + half, bounds.right - half),
      y: offer.box.top - tag.height - SIDE_TAG_GAP,
    },
  }
}

const placedOffer = (model: Model, offer: Offer, tag: PriceTag): Offer =>
  Purchasable.match(offer.target, {
    Exit: () =>
      isSideBoards(offer)
        ? sideBoardsSpot(offer, tag, levelOf(model).bounds)
        : offer,
    Fridge: () => offer,
    Stove: () => offer,
    Valve: () => offer,
    BackDoor: () => offer,
    Case: () => ({
      ...offer,
      spot: {
        x: offer.spot.x,
        y: offer.box.bottom - CASE_HEIGHT - CASE_TAG_GAP - tag.height,
      },
    }),
    Prize: () => ({
      ...offer,
      spot: {
        x: offer.box.right + PRIZE_TAG_GAP + Math.ceil(tag.width / 2),
        y: offer.spot.y,
      },
    }),
  })

// NOTE: what taking a prize gives up hangs under the take tag, crossed
// out: for the Clang Pan the knife, whose slot it takes; for a gun-slot
// prize with both gun slots full, the gun in the player's hands.
const CROSS: Sprite = spriteShapes(
  [
    'r.......r',
    '.r.....r.',
    '..r...r..',
    '...r.r...',
    '....r....',
    '...r.r...',
    '..r...r..',
    '.r.....r.',
    'r.......r',
  ],
  { r: '#ff4a4f' },
)

const CROSS_HALF = 4

const REPLACED_DROP_PX = 7

// NOTE: the knife lying flat on the plate, dark steel so it reads on the
// pale plate, for a Clang Pan that would take its slot.
export const REPLACED_KNIFE: Sprite = spriteShapes(
  ['....XXXXX..', 'RRRoXXXXXXX', '....XXXX...'],
  { X: '#5d6672', R: '#a8302a', o: '#140c10' },
)

const REPLACED_PLATE: Sprite = bakeShapes([
  rect(-7, -6, 14, 12, '#140c10'),
  rect(-6, -5, 12, 10, '#c9c3b0'),
])

export const maybeReplacedIcon = (model: Model): Option.Option<Sprite> => {
  const { door } = model.fridge
  const isPanOffered =
    FridgeDoor.isAnyOf(['Offering'])(door) && door.prize === 'Pan'
  if (isPanOffered) {
    return hasPan(focusOf(model).player)
      ? Option.none()
      : Option.some(REPLACED_KNIFE)
  }
  return Option.map(maybeReplacedGun(focusOf(model).player.arsenal), gun =>
    gunIcon(gun.kind, gun.tier),
  )
}

const replacedShapes = (
  model: Model,
  offer: Offer,
  tag: PriceTag,
): ReadonlyArray<Canvas.Shape> =>
  Purchasable.isAnyOf(['Prize'])(offer.target)
    ? Option.match(maybeReplacedIcon(model), {
        onNone: () => [],
        onSome: icon => {
          const y = offer.spot.y + tag.height + REPLACED_DROP_PX
          return [
            placeAt(offer.spot.x, y, REPLACED_PLATE),
            placeAt(offer.spot.x, y, icon),
            placeAt(offer.spot.x, y, CROSS),
          ]
        },
      })
    : []

// NOTE: in a crew the back door counts who stands at it under its tag,
// 1/3, gold once everyone is there: the hold fills only then.
const crewCountShapes = (
  model: Model,
  offer: Offer,
  tag: PriceTag,
): ReadonlyArray<Canvas.Shape> => {
  if (!Purchasable.isAnyOf(['BackDoor'])(offer.target) || offer.isFull) {
    return []
  }
  const { at, of } = crewAtBackDoorOf(model)
  return of > 1
    ? textShapes(
        `${at}/${of}`,
        at === of ? 'Victory' : 'Hint',
        offer.spot.x,
        offer.spot.y + tag.height + 2,
        'Center',
      )
    : []
}

type TagDrawing = Readonly<{
  model: Model
  maybeInReach: Option.Option<Offer>
  offer: Offer
  tag: PriceTag
}>

const offerShapes = ({
  model,
  maybeInReach,
  offer,
  tag,
}: TagDrawing): ReadonlyArray<Canvas.Shape> => {
  const replaced = replacedShapes(model, offer, tag)
  const isMine = (target: Purchasable) =>
    isSamePurchasable(target, offer.target)
  const isInReach = Option.exists(maybeInReach, ({ target }) => isMine(target))
  const tagShape = placeAt(
    tagLeft(offer, tag),
    offer.spot.y,
    isInReach ? tag.lit : tag.plain,
  )
  const prompt = [
    ...(isInReach ? promptShapes(model, offer, tag) : []),
    ...crewCountShapes(model, offer, tag),
  ]
  const shapes = Purchase.match(focusOf(model).purchase, {
    Idle: () => [tagShape, ...prompt],
    Holding: ({ target }) =>
      isMine(target)
        ? [
            ...ringShapes(offer, tag, holdProgress(focusOf(model).purchase)),
            tagShape,
          ]
        : [tagShape, ...prompt],
    Refused: ({ target, shortBy, sinceMs }) =>
      isMine(target)
        ? isUncooked(offer, sinceMs)
          ? uncookedShapes(offer, tag, sinceMs)
          : refusedShapes(offer, tag, shortBy, sinceMs)
        : [tagShape, ...prompt],
    Done: () => [tagShape],
    Spent: () => [tagShape, ...prompt],
  })
  return [...shapes, ...replaced]
}

// NOTE: what a tag covers in the game's pixels round its placed spot: the
// tag with its edge and nail, and room on its right for the keycap (or the
// finger) that comes as the player walks up, so a tag pinned to an edge
// never jumps when it lights.
const NAIL_RISE = 5
const PROMPT_WIDTH = 10

const tagBoxOf = (offer: Offer, tag: PriceTag): Keepout => ({
  left: tagLeft(offer, tag) - 1,
  top: offer.spot.y - NAIL_RISE,
  right: offer.spot.x + Math.ceil(tag.width / 2) + PROMPT_GAP + PROMPT_WIDTH,
  bottom: offer.spot.y + tag.height + 1,
})

// NOTE: a tag pinned to the window's edge stays whole inside the window,
// clear of the HUD strip's rows in landscape and of the gun slots, and
// moves up or down off the HUD's buttons and panels (`keepouts`, as
// Rattles' bubbles do). A tag wholly out of the window is not drawn: a
// zoomed phone window can stop short of the boards or the fridge, and the
// overlay has no edge of its own over the portrait HUD band or the thumbs.
const EDGE_GAP = 2

// NOTE: a tag as it is drawn: its offer placed, its tag, how far it moves
// to stay whole and clear, and what it then covers on the screen.
type PinnedTag = Readonly<{
  unplaced: Offer
  offer: Offer
  tag: PriceTag
  shift: Readonly<{ x: number; y: number }>
  covers: Keepout
}>

// NOTE: the window and its clear part are read once a frame, not per tag.
const maybePinnedTag = (
  model: Model,
  camera: Camera,
  keepouts: ReadonlyArray<Keepout>,
) => {
  const window = screenOf(model).world
  const clear = clearWindowOf(screenOf(model), EDGE_GAP)
  return (unplaced: Offer): Option.Option<PinnedTag> => {
    const tag = tagOf(model, unplaced)
    const offer = placedOffer(model, unplaced, tag)
    const { translate, scale } = anchoredAt(camera, unplaced.spot)
    const box = tagBoxOf(offer, tag)
    const left = translate.x + box.left * scale
    const top = translate.y + box.top * scale
    const width = (box.right - box.left) * scale
    const height = (box.bottom - box.top) * scale
    const isOut =
      left + width <= window.x ||
      left >= window.x + window.width ||
      top + height <= window.y ||
      top >= window.y + window.height
    if (isOut) {
      return Option.none()
    }
    const x = clamp(left, clear.left, clear.right - width)
    const lowest = clear.bottom - height
    const y = clearOfKeepouts({
      keepouts,
      x,
      y: clamp(top, clear.top, lowest),
      width,
      height,
      top: clear.top,
      bottom: lowest,
    })
    const shift = { x: Math.round(x - left), y: Math.round(y - top) }
    return Option.some({
      unplaced,
      offer,
      tag,
      shift,
      covers: {
        left: left + shift.x,
        top: top + shift.y,
        right: left + shift.x + width,
        bottom: top + shift.y + height,
      },
    })
  }
}

const pinnedTagsOf = (
  model: Model,
  camera: Camera,
  keepouts: ReadonlyArray<Keepout>,
): ReadonlyArray<PinnedTag> =>
  Array.getSomes(
    Array.map(
      offersOf(model, focusSlotOf(model)),
      maybePinnedTag(model, camera, keepouts),
    ),
  )

const pinnedTagShapes = (model: Model, camera: Camera) => {
  const maybeInReach = maybeOfferInReach(model, focusSlotOf(model))
  return ({ unplaced, offer, tag, shift }: PinnedTag): Canvas.Shape => {
    const tagShapes = placedAt(
      camera,
      unplaced.spot,
      offerShapes({ model, maybeInReach, offer, tag }),
    )
    return shift.x === 0 && shift.y === 0
      ? tagShapes
      : group({ translate: shift, shapes: [tagShapes] })
  }
}

// NOTE: what the tags cover on the screen as they are drawn, for Rattles'
// bubbles to keep out of, so a hint never hides a price.
export const tagKeepoutsOf: {
  (
    camera: Camera,
    keepouts: ReadonlyArray<Keepout>,
  ): (model: Model) => ReadonlyArray<Keepout>
  (
    model: Model,
    camera: Camera,
    keepouts: ReadonlyArray<Keepout>,
  ): ReadonlyArray<Keepout>
} = Function.dual(
  3,
  (
    model: Model,
    camera: Camera,
    keepouts: ReadonlyArray<Keepout>,
  ): ReadonlyArray<Keepout> =>
    Array.map(pinnedTagsOf(model, camera, keepouts), ({ covers }) => covers),
)

// NOTE: the stove and the valve, until the player has done their feats,
// hang a feat's lock (src/render/featLockView.ts) where their tag will.
const LOCK_DROP_PX = 6

const lockShapes = (
  model: Model,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> =>
  Array.map(
    Array.getSomes([
      maybeStoveLock(model, focusSlotOf(model)),
      maybeValveLock(model, focusSlotOf(model)),
    ]),
    ({ feat, spot }) => {
      const at = lockSpotIn(levelOf(model), {
        x: spot.x,
        y: spot.y + LOCK_DROP_PX,
      })
      return placedAt(camera, at, featLockShapes(feat, focusOf(model), at))
    },
  )

// NOTE: drawn on the overlay, over the actors and the HUD strip, each tag
// placed on its spot through the lens by the screen camera, so a tag is
// never lost behind a zombie at the boards or dimmed by the strip it hangs
// under. `keepouts` are the HUD's buttons and panels it stays off
// (src/screens/game/pocket.ts).
export const purchaseOverlayShapes: {
  (
    camera: Camera,
    keepouts: ReadonlyArray<Keepout>,
  ): (model: Model) => ReadonlyArray<Canvas.Shape>
  (
    model: Model,
    camera: Camera,
    keepouts: ReadonlyArray<Keepout>,
  ): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  3,
  (
    model: Model,
    camera: Camera,
    keepouts: ReadonlyArray<Keepout>,
  ): ReadonlyArray<Canvas.Shape> => [
    ...lockShapes(model, camera),
    ...Array.map(
      pinnedTagsOf(model, camera, keepouts),
      pinnedTagShapes(model, camera),
    ),
  ],
)
