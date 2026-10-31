import { Array, Option } from 'effect'
import type { Canvas } from 'foldkit'

import { type AmmoItemId, maybeAmmoItemOf } from './ammoCounter'
import { type Camera, worldToView } from './camera'
import { type RingPixel, rect, ringPixels } from './drawing'
import { EXIT_RULES } from './exits'
import {
  type BakedText,
  GLYPH_HEIGHT,
  bakeText,
  placeBaked,
  textShapes,
} from './font'
import { ZERO_VECTOR } from './geometry'
import { FRIDGE_RULES } from './leftovers'
import { type Model, Purchasable, Purchase } from './model'
import {
  type Offer,
  PURCHASE_RULES,
  holdProgress,
  isSamePurchasable,
  maybeOfferInReach,
  offersOf,
} from './purchase'
import { SHOP_ITEMS } from './shop'
import {
  type Sprite,
  TOP_LEFT,
  bakeShapes,
  group,
  placeAt,
  spriteShapes,
} from './sprite'
import { gunIcon } from './sprites/guns'
import { AMMO_BOX, AMMO_BOX_WIDTH } from './stallBubble'
import { hasPan, heldGun, maybeReplacedGun } from './weapons'
import { FridgeDoor } from './worldSchema'

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
// ammo window's box of rounds.
type TagIcon = Readonly<{ sprite: Sprite; width: number }>

const ICON_GAP = 2

const tagSprite = (
  text: BakedText,
  maybeIcon: Option.Option<TagIcon>,
  width: number,
  height: number,
  look: TagLook,
): Sprite => {
  const textLeft = Option.match(maybeIcon, {
    onNone: () => TAG_PAD,
    onSome: icon => TAG_PAD + icon.width + ICON_GAP,
  })
  return [
    ...bakeShapes([
      rect(Math.floor(width / 2), -4, 1, 4, '#c9c3b0'),
      rect(Math.floor(width / 2) - 1, -5, 3, 1, '#8a8a96'),
      rect(-1, -1, width + 2, height + 2, look.edge),
      rect(0, 0, width, height, look.face),
      rect(0, 0, width, 1, look.trim),
    ]),
    ...Option.match(maybeIcon, {
      onNone: () => [],
      onSome: icon => [placeAt(TAG_PAD, TAG_PAD - 1, icon.sprite)],
    }),
    placeBaked(text, { x: textLeft, y: TAG_PAD, align: 'Left' }),
  ]
}

const ringSprite = (pixels: ReadonlyArray<RingPixel>, filled: number): Sprite =>
  bakeShapes(
    Array.map(pixels, ({ x, y, turn }) =>
      rect(x, y, 1, 1, turn < filled ? '#ffd23f' : '#2a1a10'),
    ),
  )

// NOTE: built once per price, as the module loads, so every tag is an
// image from the atlas.
const bakePriceTag = (price: number): PriceTag =>
  bakeTag(bakeText(`$${price}`, 'Coin'))

// NOTE: a weapon the fridge offers is already paid for, so its tag says
// TAKE in place of a price.
const bakeTag = (
  text: BakedText,
  maybeIcon: Option.Option<TagIcon> = Option.none(),
): PriceTag => {
  const iconWidth = Option.match(maybeIcon, {
    onNone: () => 0,
    onSome: icon => icon.width + ICON_GAP,
  })
  const width = text.width + iconWidth + TAG_PAD * 2 + 1
  const height = GLYPH_HEIGHT + TAG_PAD * 2
  const pixels = ringPixels(Math.ceil(width / 2) + RING_GAP)
  return {
    width,
    height,
    plain: tagSprite(text, maybeIcon, width, height, PLAIN_LOOK),
    lit: tagSprite(text, maybeIcon, width, height, LIT_LOOK),
    short: tagSprite(text, maybeIcon, width, height, SHORT_LOOK),
    rings: [
      ringSprite(pixels, 0),
      ...Array.makeBy(RING_STEPS, step =>
        ringSprite(pixels, (step + 1) / RING_STEPS),
      ),
    ],
  }
}

const EXIT_TAG = bakePriceTag(EXIT_RULES.price)

const FRIDGE_TAG = bakePriceTag(FRIDGE_RULES.price)

const TAKE_TAG = bakeTag(bakeText('TAKE', 'Prompt'))

// NOTE: the kitchen tour gives the boards and the first pull away
// (src/tutorialRules.ts), so their tags say FREE.
const FREE_TAG = bakeTag(bakeText('FREE', 'Title'))

// NOTE: the ammo window's tags: the box of rounds with the price of the
// held gun's ammo, or FULL when there is no room for more.
const AMMO_ICON: TagIcon = { sprite: AMMO_BOX, width: AMMO_BOX_WIDTH }

const AMMO_TAGS: Readonly<Record<AmmoItemId, PriceTag>> = {
  ShotgunShells: bakeTag(
    bakeText(`$${SHOP_ITEMS.ShotgunShells.price}`, 'Coin'),
    Option.some(AMMO_ICON),
  ),
  SmgRounds: bakeTag(
    bakeText(`$${SHOP_ITEMS.SmgRounds.price}`, 'Coin'),
    Option.some(AMMO_ICON),
  ),
  LidStack: bakeTag(
    bakeText(`$${SHOP_ITEMS.LidStack.price}`, 'Coin'),
    Option.some(AMMO_ICON),
  ),
}

const FULL_TAG = bakeTag(bakeText('FULL', 'Hint'), Option.some(AMMO_ICON))

const ammoTagOf = (model: Model, offer: Offer): PriceTag =>
  offer.isFull
    ? FULL_TAG
    : Option.match(maybeAmmoItemOf(heldGun(model.player.arsenal).kind), {
        onNone: () => FULL_TAG,
        onSome: item => AMMO_TAGS[item],
      })

const tagOf = (model: Model, offer: Offer): PriceTag =>
  Purchasable.match(offer.target, {
    Exit: () => (offer.price === 0 ? FREE_TAG : EXIT_TAG),
    Fridge: () => (offer.price === 0 ? FREE_TAG : FRIDGE_TAG),
    Prize: () => TAKE_TAG,
    Ammo: () => ammoTagOf(model, offer),
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

// NOTE: a weapon on offer fills the fridge's door (src/fridgeRevealView.ts),
// so its TAKE tag hangs beside the fridge instead of over it.
const PRIZE_TAG_GAP = 4

const placedOffer = (offer: Offer, tag: PriceTag): Offer =>
  Purchasable.match(offer.target, {
    Exit: () => offer,
    Fridge: () => offer,
    Ammo: () => offer,
    Prize: () => ({
      ...offer,
      spot: {
        x: offer.box.right + PRIZE_TAG_GAP + Math.ceil(tag.width / 2),
        y: offer.spot.y,
      },
    }),
  })

// NOTE: what taking a prize gives up hangs under the TAKE tag, crossed
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
    return hasPan(model.player) ? Option.none() : Option.some(REPLACED_KNIFE)
  }
  return Option.map(maybeReplacedGun(model.player.arsenal), gun =>
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

const offerShapes =
  (model: Model, maybeInReach: Option.Option<Offer>) =>
  (unplaced: Offer): ReadonlyArray<Canvas.Shape> => {
    const tag = tagOf(model, unplaced)
    const offer = placedOffer(unplaced, tag)
    const replaced = replacedShapes(model, offer, tag)
    const isMine = (target: Purchasable) =>
      isSamePurchasable(target, offer.target)
    const isInReach = Option.exists(maybeInReach, ({ target }) =>
      isMine(target),
    )
    const tagShape = placeAt(
      tagLeft(offer, tag),
      offer.spot.y,
      isInReach ? tag.lit : tag.plain,
    )
    const prompt = isInReach ? promptShapes(model, offer, tag) : []
    const shapes = Purchase.match(model.purchase, {
      Idle: () => [tagShape, ...prompt],
      Holding: ({ target }) =>
        isMine(target)
          ? [...ringShapes(offer, tag, holdProgress(model.purchase)), tagShape]
          : [tagShape, ...prompt],
      Refused: ({ target, shortBy, sinceMs }) =>
        isMine(target)
          ? refusedShapes(offer, tag, shortBy, sinceMs)
          : [tagShape, ...prompt],
      Done: () => [tagShape],
      Spent: () => [tagShape, ...prompt],
    })
    return [...shapes, ...replaced]
  }

// NOTE: a zoomed phone window can stop short of the boards or the fridge,
// and the overlay has no edge of its own there: a tag wholly above or
// below the window would hang over the portrait HUD band or the thumbs.
const isTagInView =
  (model: Model, camera: Camera) =>
  (offer: Offer): boolean => {
    const { height } = tagOf(model, offer)
    return (
      offer.spot.y + height >= camera.y &&
      offer.spot.y <= camera.y + camera.height
    )
  }

const purchaseShapes = (
  model: Model,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> =>
  Array.flatMap(
    Array.filter(offersOf(model), isTagInView(model, camera)),
    offerShapes(model, maybeOfferInReach(model)),
  )

// NOTE: drawn on the overlay, over the actors and the HUD strip, placed
// in the world by the screen camera, so a tag is never lost behind a
// zombie at the boards or dimmed by the strip it hangs under.
export const purchaseOverlayShapes = (
  model: Model,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> =>
  Array.match(purchaseShapes(model, camera), {
    onEmpty: () => [],
    onNonEmpty: shapes => [
      group({
        translate: worldToView(camera, ZERO_VECTOR),
        scale:
          camera.scale === 1 ? undefined : { x: camera.scale, y: camera.scale },
        shapes,
      }),
    ],
  })
