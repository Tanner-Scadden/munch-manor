import { Array, Match, Option, String, pipe } from 'effect'
import type { Html } from 'foldkit/html'

import type { Dialog, Tabs } from '@foldkit/ui'
import { Button } from '@foldkit/ui'

import { levelOf } from './arena'
import { ShopDialogBinding, ShopTabsBinding } from './bindings'
import { maxHpOf } from './calling'
import type { ApplicationViewBuilder } from './composition'
import { TILE_SIZE } from './constants'
import { closeButtonView, dialogShell } from './dialogs'
import { COIN_SYMBOL } from './font'
import { ROUNDS_ICON } from './icons'
import { Message } from './message'
import {
  type Model,
  type ShopCategory,
  ShopChatter,
  type ShopItemId,
  ShopState,
  Trap,
  TrapHint,
  type WeaponKind,
} from './model'
import {
  BAR_SEGMENTS,
  type GunBars,
  GunShelf,
  SHOP_CATEGORIES,
  SHOP_CATEGORY_ORDER,
  ShopGood,
  StockTag,
  type TrapShelf,
  Verdict,
  affordableCount,
  ammoGauge,
  gunBars,
  gunShelves,
  isHolding,
  itemAriaLabel,
  itemBlurb,
  itemName,
  itemsIn,
  maybeRepairTrap,
  nextGunName,
  ownedNote,
  shopItem,
  shopItemElementId,
  stockTag,
  totalAffordable,
  trapShelves,
  verdictFor,
} from './shop'
import {
  HEART_EMPTY,
  HEART_FULL,
  HIT_ICON,
  LOAD_ICON,
  RATE_ICON,
  RATTLES_ART,
  SWAP_ICON,
  type ShopArt,
  TAB_ART,
  TRAP_ART,
  UPGRADE_ART,
  gunArt,
  itemArt,
} from './shopArt'
import { type Mood, chatterLine, moodOf } from './shopkeeper'
import { TRAPS, healthShare, ownedCount } from './traps'
import {
  hasEndlessRounds,
  maxTier,
  maybeCarried,
  maybeNextTier,
  maybeReplacedGun,
  startingRounds,
  tierName,
  tierOf,
} from './weapons'

// FOCUS

const neighborItem = (
  items: Array.NonEmptyReadonlyArray<ShopItemId>,
  item: ShopItemId,
  step: number,
): ShopItemId => {
  const index = Option.getOrElse(
    Array.findFirstIndex(items, candidate => candidate === item),
    () => 0,
  )
  const nextIndex = (index + step + items.length) % items.length
  return Option.getOrElse(Array.get(items, nextIndex), () => item)
}

const keyMessage = (
  items: Array.NonEmptyReadonlyArray<ShopItemId>,
  item: ShopItemId,
  key: string,
): Option.Option<Message> => {
  if (key === 'ArrowDown') {
    return Option.some(
      Message.MovedShopFocus({ item: neighborItem(items, item, 1) }),
    )
  } else if (key === 'ArrowUp') {
    return Option.some(
      Message.MovedShopFocus({ item: neighborItem(items, item, -1) }),
    )
  } else if (key === 'Home') {
    return Option.some(
      Message.MovedShopFocus({ item: Array.headNonEmpty(items) }),
    )
  } else if (key === 'End') {
    return Option.some(
      Message.MovedShopFocus({ item: Array.lastNonEmpty(items) }),
    )
  } else if (key === 'Enter') {
    return Option.some(Message.PressedBuyKey({ item }))
  } else {
    return Option.none()
  }
}

// MONEY

const coinIconView = (h: ApplicationViewBuilder): Html =>
  h.span([h.Class('coin-icon'), h.AriaHidden(true)])

const NOT_DIGIT = /\D/

const moneyView = (amount: string, h: ApplicationViewBuilder): Html =>
  h.span(
    [h.Class('money')],
    [coinIconView(h), h.span([h.Class('sr-only')], [COIN_SYMBOL]), amount],
  )

const afterCoin = (
  part: string,
  h: ApplicationViewBuilder,
): ReadonlyArray<Html | string> => {
  const amountLength = Option.getOrElse(
    String.search(part, NOT_DIGIT),
    () => part.length,
  )
  return [
    moneyView(String.slice(0, amountLength)(part), h),
    String.slice(amountLength)(part),
  ]
}

const withCoins = (
  text: string,
  h: ApplicationViewBuilder,
): ReadonlyArray<Html | string> =>
  pipe(
    String.split(text, COIN_SYMBOL),
    Array.flatMap((part, index) => (index === 0 ? [part] : afterCoin(part, h))),
    Array.filter(child => child !== ''),
  )

// PICTURES

const artView = (
  art: ShopArt,
  className: string,
  h: ApplicationViewBuilder,
): Html =>
  h.span([
    h.Class(`shop-art ${className}`),
    h.AriaHidden(true),
    h.Style({
      backgroundImage: art.url,
      '--art-w': `${art.width}`,
      '--art-h': `${art.height}`,
    }),
  ])

const segmentsView = (
  filled: number,
  ghost: number,
  total: number,
  h: ApplicationViewBuilder,
): ReadonlyArray<Html> =>
  Array.makeBy(total, index =>
    h.span([
      h.Class(
        index < filled
          ? 'shop-seg is-on'
          : index < ghost
            ? 'shop-seg is-next'
            : 'shop-seg',
      ),
    ]),
  )

const barView = (
  icon: ShopArt,
  label: string,
  now: number,
  next: number,
  h: ApplicationViewBuilder,
): Html =>
  h.span(
    [h.Class('shop-bar'), h.Title(label)],
    [
      artView(icon, 'shop-bar-icon', h),
      h.span(
        [h.Class('shop-bar-segs')],
        segmentsView(now, Math.max(now, next), BAR_SEGMENTS, h),
      ),
    ],
  )

const barsLabel = (bars: GunBars): string =>
  `Power ${bars.hit}, speed ${bars.rate}, magazine ${bars.load}, out of ${BAR_SEGMENTS}`

const barsView = (
  now: GunBars,
  next: GunBars,
  h: ApplicationViewBuilder,
): Html =>
  h.span(
    [h.Class('shop-bars'), h.Role('img'), h.AriaLabel(barsLabel(now))],
    [
      barView(HIT_ICON, 'Power', now.hit, next.hit, h),
      barView(RATE_ICON, 'Speed', now.rate, next.rate, h),
      barView(LOAD_ICON, 'Magazine', now.load, next.load, h),
    ],
  )

const heartsView = (model: Model, h: ApplicationViewBuilder): Html =>
  h.span(
    [h.Class('shop-hearts'), h.AriaHidden(true)],
    Array.makeBy(maxHpOf(model.player), index =>
      artView(
        index < model.player.hp ? HEART_FULL : HEART_EMPTY,
        index === model.player.hp ? 'shop-heart is-next' : 'shop-heart',
        h,
      ),
    ),
  )

const countDotsView = (
  have: number,
  most: number,
  h: ApplicationViewBuilder,
): Html =>
  h.span(
    [h.Class('shop-dots'), h.AriaHidden(true)],
    Array.makeBy(most, index =>
      h.span([h.Class(index < have ? 'shop-dot is-on' : 'shop-dot')]),
    ),
  )

const healthBarView = (share: number, h: ApplicationViewBuilder): Html =>
  h.span(
    [h.Class('shop-gauge'), h.AriaHidden(true)],
    [
      h.span(
        [h.Class('shop-gauge-track shop-health-track')],
        [
          h.span([
            h.Class(share < 0.5 ? 'shop-health is-low' : 'shop-health'),
            h.Style({ width: `${Math.round(share * 100)}%` }),
          ]),
        ],
      ),
    ],
  )

const percentOf = (value: number, total: number): string =>
  `${Math.round((Math.min(Math.max(value, 0), total) / total) * 100)}%`

// NOTE: a tiny map of the room with a dot where the trap stands, so two
// planks at two doors tell apart without words.
const mapPipView = (
  model: Model,
  trap: Trap,
  h: ApplicationViewBuilder,
): Html => {
  const level = levelOf(model)
  const spot = Trap.match(trap, {
    Barricade: ({ door }) => level.doors[door].center,
    Turret: ({ column, row }) => ({
      x: (column + 0.5) * TILE_SIZE,
      y: (row + 0.5) * TILE_SIZE,
    }),
  })
  return h.span(
    [h.Class('shop-map'), h.AriaHidden(true)],
    [
      h.span([
        h.Class('shop-map-dot'),
        h.Style({
          left: percentOf(spot.x, level.width),
          top: percentOf(spot.y, level.height),
        }),
      ]),
    ],
  )
}

const gaugeView = (
  model: Model,
  weapon: WeaponKind,
  rounds: number,
  h: ApplicationViewBuilder,
): Html => {
  const { have, gain, most } = ammoGauge(model, weapon, rounds)
  const percent = (value: number): string =>
    `${Math.round((value / most) * 100)}%`
  return h.span(
    [h.Class('shop-gauge'), h.AriaHidden(true)],
    [
      h.span(
        [h.Class('shop-gauge-track')],
        [
          h.span([
            h.Class('shop-gauge-have'),
            h.Style({ width: percent(have) }),
          ]),
          h.span([
            h.Class('shop-gauge-gain'),
            h.Style({ width: percent(gain) }),
          ]),
        ],
      ),
      h.span([h.Class('shop-gauge-text')], [`${have}/${most}`]),
    ],
  )
}

const swapBadgeView = (model: Model, h: ApplicationViewBuilder): Html =>
  Option.match(maybeReplacedGun(model.player.arsenal), {
    onNone: () => h.empty,
    onSome: spare =>
      h.span(
        [h.Class('shop-swap'), h.AriaHidden(true)],
        [
          artView(SWAP_ICON, 'shop-swap-icon', h),
          artView(gunArt(spare.kind, spare.tier), 'shop-swap-gun', h),
        ],
      ),
  })

// NOTE: how many rounds a gun has, beside its bars: the Pop Pistol's
// endless ammo as an infinity sign, any other gun as a count that runs down,
// from a playtester who traded up and never knew the new gun could run dry.
const roundsView = (
  maybeRounds: Option.Option<number>,
  h: ApplicationViewBuilder,
): Html =>
  h.span(
    [
      h.Class(
        Option.isNone(maybeRounds) ? 'shop-rounds is-endless' : 'shop-rounds',
      ),
      h.AriaHidden(true),
    ],
    [
      h.span([
        h.Class('shop-rounds-icon'),
        h.Style({ backgroundImage: ROUNDS_ICON }),
      ]),
      Option.match(maybeRounds, {
        onNone: () => '\u221e',
        onSome: rounds => `${rounds}`,
      }),
    ],
  )

const carriedRounds = (
  model: Model,
  weapon: WeaponKind,
): Option.Option<number> =>
  hasEndlessRounds(weapon)
    ? Option.none()
    : Option.map(maybeCarried(model.player, weapon), gun => gun.rounds)

const metaView = (
  model: Model,
  item: ShopItemId,
  h: ApplicationViewBuilder,
): Html =>
  ShopGood.match(shopItem(item).good, {
    Gun: ({ weapon }) =>
      h.span(
        [h.Class('shop-meta')],
        [
          barsView(gunBars(weapon, 0), gunBars(weapon, 0), h),
          roundsView(
            hasEndlessRounds(weapon)
              ? Option.none()
              : Option.some(startingRounds(weapon)),
            h,
          ),
          swapBadgeView(model, h),
        ],
      ),
    Ammo: ({ weapon, rounds }) => gaugeView(model, weapon, rounds, h),
    Upgrade: () => h.empty,
    Heart: () => heartsView(model, h),
    Trap: ({ kind }) =>
      countDotsView(ownedCount(model, kind), TRAPS[kind].limit, h),
    Repair: () =>
      Option.match(maybeRepairTrap(model, item), {
        onNone: () => h.empty,
        onSome: trap => healthBarView(healthShare(trap), h),
      }),
    Sight: () => h.empty,
  })

// TAGS

const tagView = (
  model: Model,
  item: ShopItemId,
  h: ApplicationViewBuilder,
): Html =>
  StockTag.match(stockTag(model, item), {
    Price: ({ price }) =>
      price === 0 && ShopGood.isAnyOf(['Trap'])(shopItem(item).good)
        ? h.span([h.Class('shop-tag is-free shop-item-price')], ['FREE'])
        : h.span(
            [h.Class('shop-tag shop-item-price')],
            withCoins(`$${price}`, h),
          ),
    Short: ({ price }) =>
      h.span(
        [h.Class('shop-tag is-short shop-item-price')],
        withCoins(`$${price}`, h),
      ),
    Done: ({ label }) =>
      h.span([h.Class('shop-tag is-done shop-item-price')], [label]),
  })

// JUST BOUGHT

const COIN_BURST = 6

const burstView = (h: ApplicationViewBuilder): Html =>
  h.span(
    [h.Class('shop-burst'), h.AriaHidden(true)],
    Array.makeBy(COIN_BURST, () =>
      h.span([h.Class('shop-burst-coin coin-icon')]),
    ),
  )

const stampChildren = (h: ApplicationViewBuilder): ReadonlyArray<Html> => [
  h.span([h.Class('shop-stamp-word')], ['MINE!']),
  burstView(h),
]

const evenStampView = (h: ApplicationViewBuilder): Html =>
  h.span([h.Class('shop-stamp'), h.AriaHidden(true)], stampChildren(h))

const oddStampView = (h: ApplicationViewBuilder): Html =>
  h.span([h.Class('shop-stamp'), h.AriaHidden(true)], stampChildren(h))

// NOTE: two view functions, so two buys of the same row in a row each get a
// fresh stamp element and its animation plays again.
const stampView = (model: Model, h: ApplicationViewBuilder): Html =>
  model.stats.purchases % 2 === 0 ? evenStampView(h) : oddStampView(h)

const isJustBought = (model: Model, item: ShopItemId): boolean =>
  ShopChatter.match(model.shopChatter, {
    Greeting: () => false,
    Bought: ({ item: bought }) => bought === item,
    TooPricey: () => false,
    Refused: () => false,
  })

const evenNopeView = (h: ApplicationViewBuilder): Html =>
  h.span([h.Class('shop-nope'), h.AriaHidden(true)])

const oddNopeView = (h: ApplicationViewBuilder): Html =>
  h.span([h.Class('shop-nope'), h.AriaHidden(true)])

const isJustRefused = (model: Model, item: ShopItemId): boolean =>
  ShopChatter.match(model.shopChatter, {
    Greeting: () => false,
    Bought: () => false,
    TooPricey: ({ item: refused }) => refused === item,
    Refused: ({ item: refused }) => refused === item,
  })

// ITEMS

const detailsId = (item: ShopItemId): string =>
  `${shopItemElementId(item)}-details`

const noteId = (item: ShopItemId): string => `${shopItemElementId(item)}-note`

const reasonId = (item: ShopItemId): string =>
  `${shopItemElementId(item)}-reason`

const focusedItem = (model: Model): ShopItemId =>
  ShopState.match(model.shop, {
    Away: () => Array.headNonEmpty(itemsIn(model, model.shopCategory)),
    Browsing: browsing => browsing.focusedItem,
    Dismissed: () => Array.headNonEmpty(itemsIn(model, model.shopCategory)),
  })

const reasonView = (
  model: Model,
  item: ShopItemId,
  h: ApplicationViewBuilder,
): Html =>
  Verdict.match(verdictFor(model, item), {
    Available: () => h.empty,
    Refused: ({ reason }) =>
      h.span(
        [
          h.Id(reasonId(item)),
          h.Class(
            StockTag.isAnyOf(['Short'])(stockTag(model, item))
              ? 'shop-item-reason shop-need'
              : 'shop-item-reason sr-only',
          ),
        ],
        withCoins(reason, h),
      ),
  })

const shortName = (model: Model, item: ShopItemId): string =>
  ShopGood.match(shopItem(item).good, {
    Gun: () => itemName(model, item),
    Ammo: () => itemName(model, item),
    Upgrade: ({ weapon }) =>
      Option.match(maybeNextTier(weapon, tierOf(model.player, weapon)), {
        onNone: () => tierName(weapon, maxTier(weapon)),
        onSome: () => nextGunName(model, weapon),
      }),
    Heart: () => itemName(model, item),
    Trap: () => itemName(model, item),
    Repair: () => '',
    Sight: () => itemName(model, item),
  })

type RowShape = Readonly<{
  rowClass: string
  itemClass: string
}>

const itemArtView = (
  model: Model,
  item: ShopItemId,
  h: ApplicationViewBuilder,
): Html =>
  ShopGood.match(shopItem(item).good, {
    Gun: () => artView(itemArt(item), 'shop-card-art', h),
    Ammo: () => artView(itemArt(item), 'shop-card-art', h),
    Upgrade: ({ weapon }) =>
      h.span(
        [h.Class('shop-card-art shop-upgrade-art'), h.AriaHidden(true)],
        [
          artView(
            gunArt(
              weapon,
              Math.min(tierOf(model.player, weapon) + 1, maxTier(weapon)),
            ),
            'shop-upgrade-gun',
            h,
          ),
          artView(UPGRADE_ART, 'shop-upgrade-arrow', h),
        ],
      ),
    Heart: () => artView(itemArt(item), 'shop-card-art', h),
    Trap: () => artView(itemArt(item), 'shop-card-art', h),
    Repair: () =>
      Option.match(maybeRepairTrap(model, item), {
        onNone: () => artView(itemArt(item), 'shop-card-art', h),
        onSome: trap =>
          h.span(
            [h.Class('shop-card-art shop-repair-art'), h.AriaHidden(true)],
            [
              artView(TRAP_ART[trap._tag], 'shop-repair-trap', h),
              mapPipView(model, trap, h),
            ],
          ),
      }),
    Sight: () => artView(itemArt(item), 'shop-card-art', h),
  })

const rowView = (
  model: Model,
  item: ShopItemId,
  shape: RowShape,
  initialFocus: Dialog.RenderInfo['initialFocus'],
  h: ApplicationViewBuilder,
): Html => {
  const verdict = verdictFor(model, item)
  const isRefused = Verdict.isAnyOf(['Refused'])(verdict)
  const isFocused = focusedItem(model) === item
  const describedBy = Array.join(
    isRefused
      ? [detailsId(item), noteId(item), reasonId(item)]
      : [detailsId(item), noteId(item)],
    ' ',
  )
  const tag = stockTag(model, item)

  return h.keyed('li')(
    item,
    [
      h.Class(shape.rowClass),
      h.DataAttribute('verdict', isRefused ? 'refused' : 'available'),
      h.DataAttribute('stock', tag._tag),
      h.DataAttribute('fresh', isFreshTrap(model, item) ? 'true' : 'false'),
    ],
    [
      Button.view(
        {
          onClick: Message.ClickedBuyButton({ item }),
          isDisabled: isRefused,
          toView: attributes =>
            h.button(
              [
                ...attributes.button,
                ...(isRefused
                  ? [h.OnClick(Message.ClickedBuyButton({ item }))]
                  : []),
                ...(isFocused ? initialFocus : []),
                h.Id(shopItemElementId(item)),
                h.Class(shape.itemClass),
                h.AriaLabel(itemAriaLabel(model, item)),
                h.AriaDescribedBy(describedBy),
                h.OnFocus(Message.FocusedShopItem({ item })),
                h.OnKeyDownPreventDefault(key =>
                  keyMessage(itemsIn(model, model.shopCategory), item, key),
                ),
              ],
              [
                itemArtView(model, item, h),
                h.span(
                  [h.Class('shop-card-name shop-item-name')],
                  [shortName(model, item)],
                ),
                metaView(model, item, h),
                tagView(model, item, h),
                reasonView(model, item, h),
                h.span(
                  [h.Id(detailsId(item)), h.Class('sr-only')],
                  [itemBlurb(model, item)],
                ),
                h.span(
                  [h.Id(noteId(item)), h.Class('sr-only')],
                  [ownedNote(model, item)],
                ),
                isJustBought(model, item) ? stampView(model, h) : h.empty,
                isJustRefused(model, item)
                  ? model.stats.purchases % 2 === 0
                    ? evenNopeView(h)
                    : oddNopeView(h)
                  : h.empty,
              ],
            ),
        },
        h,
      ),
    ],
  )
}

const itemView = (
  model: Model,
  item: ShopItemId,
  initialFocus: Dialog.RenderInfo['initialFocus'],
  h: ApplicationViewBuilder,
): Html =>
  rowView(
    model,
    item,
    {
      rowClass: 'shop-row',
      itemClass: 'shop-item shop-card',
    },
    initialFocus,
    h,
  )

// NOTE: a row that spans the whole tab in one slim line, so an extra good
// under the gun cards never pushes the shop past a short phone's screen.
const wideItemView = (
  model: Model,
  item: ShopItemId,
  initialFocus: Dialog.RenderInfo['initialFocus'],
  h: ApplicationViewBuilder,
): Html =>
  rowView(
    model,
    item,
    {
      rowClass: 'shop-row shop-row-wide',
      itemClass: 'shop-item shop-card is-wide',
    },
    initialFocus,
    h,
  )

const subItemView = (
  model: Model,
  item: ShopItemId,
  initialFocus: Dialog.RenderInfo['initialFocus'],
  h: ApplicationViewBuilder,
): Html =>
  rowView(
    model,
    item,
    {
      rowClass: 'shop-row shop-subrow',
      itemClass: 'shop-item shop-subitem',
    },
    initialFocus,
    h,
  )

// GUNS

const tierPipsView = (
  weapon: WeaponKind,
  tier: number,
  h: ApplicationViewBuilder,
): Html =>
  h.span(
    [
      h.Class('shop-pips'),
      h.Role('img'),
      h.AriaLabel(`Tier ${tier} of ${maxTier(weapon)}`),
    ],
    Array.makeBy(maxTier(weapon), index =>
      h.span([
        h.Class(
          index < tier
            ? 'shop-pip is-filled'
            : index === tier
              ? 'shop-pip is-next'
              : 'shop-pip',
        ),
      ]),
    ),
  )

const ownedBadge = (model: Model, weapon: WeaponKind): string =>
  isHolding(model.player, weapon) ? 'IN HAND' : 'OWNED'

const nextBars = (weapon: WeaponKind, tier: number): GunBars =>
  Option.match(maybeNextTier(weapon, tier), {
    onNone: () => gunBars(weapon, tier),
    onSome: () => gunBars(weapon, tier + 1),
  })

const isGunJustBought = (model: Model, weapon: WeaponKind): boolean =>
  ShopChatter.match(model.shopChatter, {
    Greeting: () => false,
    Bought: ({ item }) =>
      ShopGood.match(shopItem(item).good, {
        Gun: ({ weapon: bought }) => bought === weapon,
        Ammo: () => false,
        Upgrade: () => false,
        Heart: () => false,
        Trap: () => false,
        Repair: () => false,
        Sight: () => false,
      }),
    TooPricey: () => false,
    Refused: () => false,
  })

const ownedGunView = (
  model: Model,
  weapon: WeaponKind,
  tier: number,
  status: string,
  items: Array.NonEmptyReadonlyArray<ShopItemId>,
  initialFocus: Dialog.RenderInfo['initialFocus'],
  h: ApplicationViewBuilder,
): Html => {
  const name = tierName(weapon, tier)
  return h.keyed('li')(
    `owned-${weapon}`,
    [
      h.Class('shop-gun'),
      h.DataAttribute(
        'held',
        isHolding(model.player, weapon) ? 'true' : 'false',
      ),
    ],
    [
      h.div(
        [h.Class('shop-gun-heading')],
        [
          artView(gunArt(weapon, tier), 'shop-gun-art', h),
          h.span(
            [h.Class('shop-gun-title')],
            [
              h.h3([h.Class('shop-gun-name')], [name]),
              tierPipsView(weapon, tier, h),
            ],
          ),
          h.span([h.Class('shop-gun-owned')], [ownedBadge(model, weapon)]),
        ],
      ),
      h.div(
        [h.Class('shop-gun-stats')],
        [
          barsView(gunBars(weapon, tier), nextBars(weapon, tier), h),
          weapon === 'Pan'
            ? h.empty
            : roundsView(carriedRounds(model, weapon), h),
        ],
      ),
      h.span([h.Class('sr-only')], [status]),
      h.ul(
        [h.Class('shop-subrows'), h.AriaLabel(`For your ${name}`)],
        Array.map(items, item => subItemView(model, item, initialFocus, h)),
      ),
      isGunJustBought(model, weapon) ? stampView(model, h) : h.empty,
    ],
  )
}

const gunShelfView = (
  model: Model,
  shelf: GunShelf,
  initialFocus: Dialog.RenderInfo['initialFocus'],
  h: ApplicationViewBuilder,
): Html =>
  GunShelf.match(shelf, {
    ForSale: ({ item }) => itemView(model, item, initialFocus, h),
    Owned: ({ weapon, tier, status, items }) =>
      ownedGunView(model, weapon, tier, status, items, initialFocus, h),
  })

const categoryRowsView = (
  model: Model,
  category: ShopCategory,
  initialFocus: Dialog.RenderInfo['initialFocus'],
  h: ApplicationViewBuilder,
): ReadonlyArray<Html> =>
  Match.value(category).pipe(
    Match.when('Guns', () => [
      ...Array.map(gunShelves(model), shelf =>
        gunShelfView(model, shelf, initialFocus, h),
      ),
      wideItemView(model, 'LaserSight', initialFocus, h),
    ]),
    Match.when('Traps', () =>
      Array.map(trapShelves(model), shelf =>
        trapShelfView(model, shelf, initialFocus, h),
      ),
    ),
    Match.orElse(() =>
      Array.map(itemsIn(model, category), item =>
        itemView(model, item, initialFocus, h),
      ),
    ),
  )

const trapShelfView = (
  model: Model,
  shelf: TrapShelf,
  initialFocus: Dialog.RenderInfo['initialFocus'],
  h: ApplicationViewBuilder,
): Html =>
  Array.match(shelf.repairs, {
    onEmpty: () => itemView(model, shelf.item, initialFocus, h),
    onNonEmpty: repairs =>
      h.keyed('li')(
        `shelf-${shelf.kind}`,
        [h.Class('shop-gun shop-trap-shelf')],
        [
          h.ul(
            [
              h.Class('shop-subrows'),
              h.AriaLabel(`${TRAPS[shelf.kind].name} and repairs`),
            ],
            [
              subItemView(model, shelf.item, initialFocus, h),
              ...Array.map(repairs, item =>
                subItemView(model, item, initialFocus, h),
              ),
            ],
          ),
        ],
      ),
  })

// DIALOG

const SHOP_TITLE = "Rattles' Bone Bazaar"

const thingsLabel = (count: number): string =>
  count === 1 ? '1 thing' : `${count} things`

const affordSummary = (model: Model): string => {
  const count = totalAffordable(model)
  return count === 0
    ? 'Nothing you can buy right now'
    : `${thingsLabel(count)} you can buy now`
}

const tabLabel = (model: Model, category: ShopCategory): string => {
  const count = affordableCount(model, category)
  return count === 0
    ? `${SHOP_CATEGORIES[category].label}, nothing you can buy`
    : `${SHOP_CATEGORIES[category].label}, ${count} you can buy`
}

// NOTE: until the first trap is bought, the TRAPS tab wears a NEW tag and
// its traps pulse, so a player sees traps are bought here, from Rattles.
const isTrapNew = (model: Model): boolean =>
  TrapHint.isAnyOf(['Unseen'])(model.trapHint)

const isFreshTraps = (model: Model, category: ShopCategory): boolean =>
  category === 'Traps' && isTrapNew(model)

const isFreshTrap = (model: Model, item: ShopItemId): boolean =>
  isTrapNew(model) && ShopGood.isAnyOf(['Trap'])(shopItem(item).good)

const tabButtonView = (
  model: Model,
  tab: Tabs.TabInfo<ShopCategory>,
  h: ApplicationViewBuilder,
): Html => {
  const count = affordableCount(model, tab.value)
  return h.button(
    [...tab.tab, h.Class('shop-tab'), h.AriaLabel(tabLabel(model, tab.value))],
    [
      artView(TAB_ART[tab.value], 'shop-tab-icon', h),
      h.span([h.Class('shop-tab-label')], [SHOP_CATEGORIES[tab.value].label]),
      isFreshTraps(model, tab.value)
        ? h.span([h.Class('shop-tab-new')], ['NEW'])
        : h.empty,
      h.span(
        [
          h.Class(count === 0 ? 'shop-tab-count is-empty' : 'shop-tab-count'),
          h.AriaHidden(true),
        ],
        [`${count}`],
      ),
    ],
  )
}

const categoryPanelView = (
  model: Model,
  tab: Tabs.TabInfo<ShopCategory>,
  initialFocus: Dialog.RenderInfo['initialFocus'],
  h: ApplicationViewBuilder,
): Html =>
  h.div(
    [...tab.panel, h.Class('shop-tabpanel')],
    [
      h.p(
        [h.Class('shop-rule sr-only')],
        [SHOP_CATEGORIES[tab.value].blurb(model)],
      ),
      h.ul(
        [
          h.Class(`shop-items shop-items-${String.toLowerCase(tab.value)}`),
          h.AriaLabel(`${SHOP_CATEGORIES[tab.value].label} for sale`),
        ],
        categoryRowsView(model, tab.value, initialFocus, h),
      ),
    ],
  )

const categoriesView = (
  model: Model,
  initialFocus: Dialog.RenderInfo['initialFocus'],
  h: ApplicationViewBuilder,
): Html =>
  h.block(
    ShopTabsBinding.embedView({
      slotId: model.shopTabs.id,
      model: model.shopTabs,
      viewInputs: {
        tabs: SHOP_CATEGORY_ORDER,
        selectedValue: model.shopCategory,
        ariaLabel: 'Shop sections',
        toView: ({ tablist, tabs, activeIndex }) =>
          h.div(
            [h.Class('shop-categories')],
            [
              h.div(
                [...tablist, h.Class('shop-tabs')],
                Array.map(tabs, tab => tabButtonView(model, tab, h)),
              ),
              ...pipe(
                tabs,
                Array.filter(tab => tab.index === activeIndex),
                Array.map(tab =>
                  categoryPanelView(model, tab, initialFocus, h),
                ),
              ),
            ],
          ),
      },
    }),
  )

const MOOD_LABELS: Readonly<Record<Mood, string>> = {
  Grinning: 'grinning',
  Delighted: 'delighted, with coins in his eyes',
  Sad: 'sad',
  Shrugging: 'shrugging',
}

const keeperView = (model: Model, h: ApplicationViewBuilder): Html => {
  const mood = moodOf(model)
  return h.span(
    [
      h.Class('shop-keeper'),
      h.DataAttribute('mood', mood),
      h.Role('img'),
      h.AriaLabel(`Rattles the skeleton, ${MOOD_LABELS[mood]}`),
    ],
    [artView(RATTLES_ART[mood], 'shop-keeper-face', h)],
  )
}

const evenBalanceView = (model: Model, h: ApplicationViewBuilder): Html =>
  h.span(
    [h.Class('shop-balance')],
    [
      h.span([h.Class('sr-only')], ['You have ']),
      ...withCoins(`$${model.wallet.balance}`, h),
    ],
  )

const oddBalanceView = (model: Model, h: ApplicationViewBuilder): Html =>
  h.span(
    [h.Class('shop-balance')],
    [
      h.span([h.Class('sr-only')], ['You have ']),
      ...withCoins(`$${model.wallet.balance}`, h),
    ],
  )

const balanceView = (model: Model, h: ApplicationViewBuilder): Html =>
  model.stats.purchases % 2 === 0
    ? evenBalanceView(model, h)
    : oddBalanceView(model, h)

const panelView = (
  model: Model,
  { title, description, closeButton, initialFocus }: Dialog.RenderInfo,
  h: ApplicationViewBuilder,
): ReadonlyArray<Html> => [
  h.header(
    [h.Class('shop-header')],
    [
      keeperView(model, h),
      h.div(
        [h.Class('shop-speech')],
        [
          h.h2([...title, h.Class('shop-title')], [SHOP_TITLE]),
          h.p(
            [...description, h.Class('shop-greeting'), h.AriaLive('polite')],
            withCoins(chatterLine(model), h),
          ),
        ],
      ),
      h.p(
        [h.Class('shop-wallet'), h.Role('status')],
        [
          balanceView(model, h),
          h.span([h.Class('shop-summary sr-only')], [affordSummary(model)]),
        ],
      ),
      closeButtonView(
        {
          attributes: closeButton,
          className: 'shop-close',
          label: 'Leave shop',
        },
        h,
      ),
    ],
  ),
  categoriesView(model, initialFocus, h),
]

export const shopDialogView = (model: Model, h: ApplicationViewBuilder): Html =>
  dialogShell(
    {
      dialog: model.shopDialog,
      dialogClass: 'shop-dialog',
      backdropClass: 'shop-backdrop',
      panelClass: 'shop-panel',
      panelView: renderInfo => panelView(model, renderInfo, h),
      binding: ShopDialogBinding,
    },
    h,
  )
