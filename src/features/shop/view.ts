import { Array, Match, Option, String, pipe } from 'effect'
import type { Html } from 'foldkit/html'

import { Button, type Dialog, type DialogBlock, type Tabs } from '@foldkit/ui'

import { COIN_SYMBOL } from '../../art/font'
import type { Mood } from '../../art/rattlesArt'
import {
  BAR_SEGMENTS,
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
  gunArt,
  itemArt,
} from '../../art/shopArt'
import { TILE_SIZE } from '../../shared/constants'
import { closeButtonView } from '../../ui/cornerButtons'
import { maybeLevelProgress } from '../../world/gear/gunLevels'
import { TRAPS, healthShare, ownedCount } from '../../world/gear/traps'
import {
  maxTier,
  maybeCarried,
  maybeReplacedGun,
  tierName,
} from '../../world/gear/weapons'
import { maxHpOf } from '../../world/heroes/calling'
import { levelOf } from '../../world/level/arena'
import { focusOf, focusSlotOf } from '../../world/party/party'
import {
  type ShopCategory,
  ShopChatter,
  type ShopItemId,
  ShopState,
  Trap,
  TrapHint,
  type WeaponKind,
} from '../../world/schema/worldSchema'
import {
  GunShelf,
  SHOP_CATEGORIES,
  SHOP_CATEGORY_ORDER,
  ShopGood,
  StockTag,
  type TrapShelf,
  Verdict,
  affordableCount,
  gunShelves,
  isHolding,
  itemAriaLabel,
  itemBlurb,
  itemName,
  itemsIn,
  maybeRepairTrap,
  shopItem,
  shopItemElementId,
  stockTag,
  totalAffordable,
  trapShelves,
  verdictFor,
} from '../../world/shop/shop'
import { GUIDE_FOCUS_IDS } from '../guide/model'
import { DialogBinding, GuideBinding, TabsBinding } from './bindings'
import type { ShopScene, ViewInputs } from './block'
import { ShopComposition, type ShopViewBuilder } from './composition'
import { Message } from './message'
import { type Model, isShopGuideOpen } from './model'
import { type GunBars, gunBars, ownedNote } from './shopStats'
import type { ShopTabsBlock } from './shopTabs'
import { chatterLine, moodOf } from './shopkeeper'

type TabsModel = typeof ShopTabsBlock.Model.Type

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
      Message.MovedFocus({ item: neighborItem(items, item, 1) }),
    )
  } else if (key === 'ArrowUp') {
    return Option.some(
      Message.MovedFocus({ item: neighborItem(items, item, -1) }),
    )
  } else if (key === 'Home') {
    return Option.some(Message.MovedFocus({ item: Array.headNonEmpty(items) }))
  } else if (key === 'End') {
    return Option.some(Message.MovedFocus({ item: Array.lastNonEmpty(items) }))
  } else if (key === 'Enter') {
    return Option.some(Message.PressedBuyKey({ item }))
  } else {
    return Option.none()
  }
}

// MONEY

const coinIconView = (h: ShopViewBuilder): Html =>
  h.span([h.Class('coin-icon'), h.AriaHidden(true)])

const NOT_DIGIT = /\D/

const moneyView = (amount: string, h: ShopViewBuilder): Html =>
  h.span(
    [h.Class('money')],
    [coinIconView(h), h.span([h.Class('sr-only')], [COIN_SYMBOL]), amount],
  )

const afterCoin = (
  part: string,
  h: ShopViewBuilder,
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
  h: ShopViewBuilder,
): ReadonlyArray<Html | string> =>
  pipe(
    String.split(text, COIN_SYMBOL),
    Array.flatMap((part, index) => (index === 0 ? [part] : afterCoin(part, h))),
    Array.filter(child => child !== ''),
  )

// PICTURES

const artView = (art: ShopArt, className: string, h: ShopViewBuilder): Html =>
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
  h: ShopViewBuilder,
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
  h: ShopViewBuilder,
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

const barsView = (now: GunBars, next: GunBars, h: ShopViewBuilder): Html =>
  h.span(
    [h.Class('shop-bars'), h.Role('img'), h.AriaLabel(barsLabel(now))],
    [
      barView(HIT_ICON, 'Power', now.hit, next.hit, h),
      barView(RATE_ICON, 'Speed', now.rate, next.rate, h),
      barView(LOAD_ICON, 'Magazine', now.load, next.load, h),
    ],
  )

const heartsView = (scene: ShopScene, h: ShopViewBuilder): Html =>
  h.span(
    [h.Class('shop-hearts'), h.AriaHidden(true)],
    Array.makeBy(maxHpOf(focusOf(scene).player), index =>
      artView(
        index < focusOf(scene).player.hp ? HEART_FULL : HEART_EMPTY,
        index === focusOf(scene).player.hp
          ? 'shop-heart is-next'
          : 'shop-heart',
        h,
      ),
    ),
  )

const countDotsView = (have: number, most: number, h: ShopViewBuilder): Html =>
  h.span(
    [h.Class('shop-dots'), h.AriaHidden(true)],
    Array.makeBy(most, index =>
      h.span([h.Class(index < have ? 'shop-dot is-on' : 'shop-dot')]),
    ),
  )

const healthBarView = (share: number, h: ShopViewBuilder): Html =>
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
const mapPipView = (scene: ShopScene, trap: Trap, h: ShopViewBuilder): Html => {
  const level = levelOf(scene)
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

const swapBadgeView = (scene: ShopScene, h: ShopViewBuilder): Html =>
  Option.match(maybeReplacedGun(focusOf(scene).player.arsenal), {
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

const metaView = (
  scene: ShopScene,
  item: ShopItemId,
  h: ShopViewBuilder,
): Html =>
  ShopGood.match(shopItem(item).good, {
    Gun: ({ weapon }) =>
      h.span(
        [h.Class('shop-meta')],
        [
          barsView(gunBars(weapon, 0), gunBars(weapon, 0), h),
          swapBadgeView(scene, h),
        ],
      ),
    Heart: () => heartsView(scene, h),
    Trap: ({ kind }) =>
      countDotsView(
        ownedCount(scene, focusSlotOf(scene), kind),
        TRAPS[kind].limit,
        h,
      ),
    Repair: () =>
      Option.match(maybeRepairTrap(scene, item), {
        onNone: () => h.empty,
        onSome: trap => healthBarView(healthShare(trap), h),
      }),
    Sight: () => h.empty,
  })

// TAGS

const tagView = (
  scene: ShopScene,
  item: ShopItemId,
  h: ShopViewBuilder,
): Html =>
  StockTag.match(stockTag(scene, focusSlotOf(scene), item), {
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

const burstView = (h: ShopViewBuilder): Html =>
  h.span(
    [h.Class('shop-burst'), h.AriaHidden(true)],
    Array.makeBy(COIN_BURST, () =>
      h.span([h.Class('shop-burst-coin coin-icon')]),
    ),
  )

const stampChildren = (h: ShopViewBuilder): ReadonlyArray<Html> => [
  h.span([h.Class('shop-stamp-word')], ['MINE!']),
  burstView(h),
]

const evenStampView = (h: ShopViewBuilder): Html =>
  h.span([h.Class('shop-stamp'), h.AriaHidden(true)], stampChildren(h))

const oddStampView = (h: ShopViewBuilder): Html =>
  h.span([h.Class('shop-stamp'), h.AriaHidden(true)], stampChildren(h))

// NOTE: two view functions, so two buys of the same row in a row each get a
// fresh stamp element and its animation plays again.
const stampView = (scene: ShopScene, h: ShopViewBuilder): Html =>
  scene.stats.purchases % 2 === 0 ? evenStampView(h) : oddStampView(h)

const isJustBought = (scene: ShopScene, item: ShopItemId): boolean =>
  ShopChatter.match(scene.shopChatter, {
    Greeting: () => false,
    Bought: ({ item: bought }) => bought === item,
    TooPricey: () => false,
    Refused: () => false,
  })

const evenNopeView = (h: ShopViewBuilder): Html =>
  h.span([h.Class('shop-nope'), h.AriaHidden(true)])

const oddNopeView = (h: ShopViewBuilder): Html =>
  h.span([h.Class('shop-nope'), h.AriaHidden(true)])

const isJustRefused = (scene: ShopScene, item: ShopItemId): boolean =>
  ShopChatter.match(scene.shopChatter, {
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

const focusedItem = (scene: ShopScene): ShopItemId =>
  ShopState.match(focusOf(scene).shop, {
    Away: () =>
      Array.headNonEmpty(
        itemsIn(scene, focusSlotOf(scene), focusOf(scene).shopCategory),
      ),
    Browsing: browsing => browsing.focusedItem,
    Dismissed: () =>
      Array.headNonEmpty(
        itemsIn(scene, focusSlotOf(scene), focusOf(scene).shopCategory),
      ),
  })

const reasonView = (
  scene: ShopScene,
  item: ShopItemId,
  h: ShopViewBuilder,
): Html =>
  Verdict.match(verdictFor(scene, focusSlotOf(scene), item), {
    Available: () => h.empty,
    Refused: ({ reason }) =>
      h.span(
        [
          h.Id(reasonId(item)),
          h.Class(
            StockTag.isAnyOf(['Short'])(
              stockTag(scene, focusSlotOf(scene), item),
            )
              ? 'shop-item-reason shop-need'
              : 'shop-item-reason sr-only',
          ),
        ],
        withCoins(reason, h),
      ),
  })

const shortName = (scene: ShopScene, item: ShopItemId): string =>
  ShopGood.match(shopItem(item).good, {
    Gun: () => itemName(scene, focusSlotOf(scene), item),
    Heart: () => itemName(scene, focusSlotOf(scene), item),
    Trap: () => itemName(scene, focusSlotOf(scene), item),
    Repair: () => '',
    Sight: () => itemName(scene, focusSlotOf(scene), item),
  })

type RowShape = Readonly<{
  rowClass: string
  itemClass: string
}>

const itemArtView = (
  scene: ShopScene,
  item: ShopItemId,
  h: ShopViewBuilder,
): Html =>
  ShopGood.match(shopItem(item).good, {
    Gun: () => artView(itemArt(item), 'shop-card-art', h),
    Heart: () => artView(itemArt(item), 'shop-card-art', h),
    Trap: () => artView(itemArt(item), 'shop-card-art', h),
    Repair: () =>
      Option.match(maybeRepairTrap(scene, item), {
        onNone: () => artView(itemArt(item), 'shop-card-art', h),
        onSome: trap =>
          h.span(
            [h.Class('shop-card-art shop-repair-art'), h.AriaHidden(true)],
            [
              artView(TRAP_ART[trap._tag], 'shop-repair-trap', h),
              mapPipView(scene, trap, h),
            ],
          ),
      }),
    Sight: () => artView(itemArt(item), 'shop-card-art', h),
  })

const rowView = (
  scene: ShopScene,
  item: ShopItemId,
  shape: RowShape,
  initialFocus: Dialog.RenderInfo['initialFocus'],
  h: ShopViewBuilder,
): Html => {
  const verdict = verdictFor(scene, focusSlotOf(scene), item)
  const isRefused = Verdict.isAnyOf(['Refused'])(verdict)
  const isFocused = focusedItem(scene) === item
  const describedBy = Array.join(
    isRefused
      ? [detailsId(item), noteId(item), reasonId(item)]
      : [detailsId(item), noteId(item)],
    ' ',
  )
  const tag = stockTag(scene, focusSlotOf(scene), item)

  return h.keyed('li')(
    item,
    [
      h.Class(shape.rowClass),
      h.DataAttribute('verdict', isRefused ? 'refused' : 'available'),
      h.DataAttribute('stock', tag._tag),
      h.DataAttribute('fresh', isFreshTrap(scene, item) ? 'true' : 'false'),
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
                h.AriaLabel(itemAriaLabel(scene, focusSlotOf(scene), item)),
                h.AriaDescribedBy(describedBy),
                h.OnFocus(Message.FocusedItem({ item })),
                h.OnKeyDownPreventDefault(key =>
                  keyMessage(
                    itemsIn(
                      scene,
                      focusSlotOf(scene),
                      focusOf(scene).shopCategory,
                    ),
                    item,
                    key,
                  ),
                ),
              ],
              [
                itemArtView(scene, item, h),
                h.span(
                  [h.Class('shop-card-name shop-item-name')],
                  [shortName(scene, item)],
                ),
                metaView(scene, item, h),
                tagView(scene, item, h),
                reasonView(scene, item, h),
                h.span(
                  [h.Id(detailsId(item)), h.Class('sr-only')],
                  [itemBlurb(scene, focusSlotOf(scene), item)],
                ),
                h.span(
                  [h.Id(noteId(item)), h.Class('sr-only')],
                  [ownedNote(scene, focusSlotOf(scene), item)],
                ),
                isJustBought(scene, item) ? stampView(scene, h) : h.empty,
                isJustRefused(scene, item)
                  ? scene.stats.purchases % 2 === 0
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
  scene: ShopScene,
  item: ShopItemId,
  initialFocus: Dialog.RenderInfo['initialFocus'],
  h: ShopViewBuilder,
): Html =>
  rowView(
    scene,
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
  scene: ShopScene,
  item: ShopItemId,
  initialFocus: Dialog.RenderInfo['initialFocus'],
  h: ShopViewBuilder,
): Html =>
  rowView(
    scene,
    item,
    {
      rowClass: 'shop-row shop-row-wide',
      itemClass: 'shop-item shop-card is-wide',
    },
    initialFocus,
    h,
  )

const subItemView = (
  scene: ShopScene,
  item: ShopItemId,
  initialFocus: Dialog.RenderInfo['initialFocus'],
  h: ShopViewBuilder,
): Html =>
  rowView(
    scene,
    item,
    {
      rowClass: 'shop-row shop-subrow',
      itemClass: 'shop-item shop-subitem',
    },
    initialFocus,
    h,
  )

// GUNS

// NOTE: tiers are earned by kills, not bought, so no pip blinks as the
// next buy. The next tier's pip fills as a bar with the gun's kills toward it.
const tierPipsView = (
  scene: ShopScene,
  weapon: WeaponKind,
  tier: number,
  h: ShopViewBuilder,
): Html =>
  h.span(
    [
      h.Class('shop-pips'),
      h.Role('img'),
      h.AriaLabel(`Tier ${tier} of ${maxTier(weapon)}`),
    ],
    Array.makeBy(maxTier(weapon), index =>
      index === tier
        ? h.span(
            [h.Class('shop-pip')],
            [
              h.span([
                h.Class('shop-pip-fill'),
                h.Style({ width: `${progressPercent(scene, weapon)}%` }),
              ]),
            ],
          )
        : h.span([h.Class(index < tier ? 'shop-pip is-filled' : 'shop-pip')]),
    ),
  )

const progressPercent = (scene: ShopScene, weapon: WeaponKind): number =>
  Math.round(
    100 *
      Option.getOrElse(
        Option.flatMap(
          maybeCarried(focusOf(scene).player, weapon),
          maybeLevelProgress,
        ),
        () => 0,
      ),
  )

const ownedBadge = (scene: ShopScene, weapon: WeaponKind): string =>
  isHolding(focusOf(scene).player, weapon) ? 'IN HAND' : 'OWNED'

const isGunJustBought = (scene: ShopScene, weapon: WeaponKind): boolean =>
  ShopChatter.match(scene.shopChatter, {
    Greeting: () => false,
    Bought: ({ item }) =>
      ShopGood.match(shopItem(item).good, {
        Gun: ({ weapon: bought }) => bought === weapon,
        Heart: () => false,
        Trap: () => false,
        Repair: () => false,
        Sight: () => false,
      }),
    TooPricey: () => false,
    Refused: () => false,
  })

const ownedGunView = (
  scene: ShopScene,
  weapon: WeaponKind,
  tier: number,
  status: string,
  h: ShopViewBuilder,
): Html => {
  const name = tierName(weapon, tier)
  return h.keyed('li')(
    `owned-${weapon}`,
    [
      h.Class('shop-gun'),
      h.DataAttribute(
        'held',
        isHolding(focusOf(scene).player, weapon) ? 'true' : 'false',
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
              tierPipsView(scene, weapon, tier, h),
            ],
          ),
          h.span([h.Class('shop-gun-owned')], [ownedBadge(scene, weapon)]),
        ],
      ),
      h.div(
        [h.Class('shop-gun-stats')],
        [barsView(gunBars(weapon, tier), gunBars(weapon, tier), h)],
      ),
      h.span([h.Class('sr-only')], [status]),
      isGunJustBought(scene, weapon) ? stampView(scene, h) : h.empty,
    ],
  )
}

const gunShelfView = (
  scene: ShopScene,
  shelf: GunShelf,
  initialFocus: Dialog.RenderInfo['initialFocus'],
  h: ShopViewBuilder,
): Html =>
  GunShelf.match(shelf, {
    ForSale: ({ item }) => itemView(scene, item, initialFocus, h),
    Owned: ({ weapon, tier, status }) =>
      ownedGunView(scene, weapon, tier, status, h),
  })

const categoryRowsView = (
  scene: ShopScene,
  category: ShopCategory,
  initialFocus: Dialog.RenderInfo['initialFocus'],
  h: ShopViewBuilder,
): ReadonlyArray<Html> =>
  Match.value(category).pipe(
    Match.when('Guns', () => [
      ...Array.map(gunShelves(scene, focusSlotOf(scene)), shelf =>
        gunShelfView(scene, shelf, initialFocus, h),
      ),
      wideItemView(scene, 'LaserSight', initialFocus, h),
    ]),
    Match.when('Traps', () =>
      Array.map(trapShelves(scene), shelf =>
        trapShelfView(scene, shelf, initialFocus, h),
      ),
    ),
    Match.orElse(() =>
      Array.map(itemsIn(scene, focusSlotOf(scene), category), item =>
        itemView(scene, item, initialFocus, h),
      ),
    ),
  )

const trapShelfView = (
  scene: ShopScene,
  shelf: TrapShelf,
  initialFocus: Dialog.RenderInfo['initialFocus'],
  h: ShopViewBuilder,
): Html =>
  Array.match(shelf.repairs, {
    onEmpty: () => itemView(scene, shelf.item, initialFocus, h),
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
              subItemView(scene, shelf.item, initialFocus, h),
              ...Array.map(repairs, item =>
                subItemView(scene, item, initialFocus, h),
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

const affordSummary = (scene: ShopScene): string => {
  const count = totalAffordable(scene, focusSlotOf(scene))
  return count === 0
    ? 'Nothing you can buy right now'
    : `${thingsLabel(count)} you can buy now`
}

const tabLabel = (scene: ShopScene, category: ShopCategory): string => {
  const count = affordableCount(scene, focusSlotOf(scene), category)
  return count === 0
    ? `${SHOP_CATEGORIES[category].label}, nothing you can buy`
    : `${SHOP_CATEGORIES[category].label}, ${count} you can buy`
}

// NOTE: until the first trap is bought, the TRAPS tab wears a NEW tag and
// its traps pulse, so a player sees traps are bought here, from Rattles.
const isTrapNew = (scene: ShopScene): boolean =>
  TrapHint.isAnyOf(['Unseen'])(scene.trapHint)

const isFreshTraps = (scene: ShopScene, category: ShopCategory): boolean =>
  category === 'Traps' && isTrapNew(scene)

const isFreshTrap = (scene: ShopScene, item: ShopItemId): boolean =>
  isTrapNew(scene) && ShopGood.isAnyOf(['Trap'])(shopItem(item).good)

const tabButtonView = (
  scene: ShopScene,
  tab: Tabs.TabInfo<ShopCategory>,
  h: ShopViewBuilder,
): Html => {
  const count = affordableCount(scene, focusSlotOf(scene), tab.value)
  return h.button(
    [...tab.tab, h.Class('shop-tab'), h.AriaLabel(tabLabel(scene, tab.value))],
    [
      artView(TAB_ART[tab.value], 'shop-tab-icon', h),
      h.span([h.Class('shop-tab-label')], [SHOP_CATEGORIES[tab.value].label]),
      isFreshTraps(scene, tab.value)
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
  scene: ShopScene,
  tab: Tabs.TabInfo<ShopCategory>,
  initialFocus: Dialog.RenderInfo['initialFocus'],
  h: ShopViewBuilder,
): Html =>
  h.div(
    [...tab.panel, h.Class('shop-tabpanel')],
    [
      h.p(
        [h.Class('shop-rule sr-only')],
        [SHOP_CATEGORIES[tab.value].blurb(scene)],
      ),
      h.ul(
        [
          h.Class(`shop-items shop-items-${String.toLowerCase(tab.value)}`),
          h.AriaLabel(`${SHOP_CATEGORIES[tab.value].label} for sale`),
        ],
        categoryRowsView(scene, tab.value, initialFocus, h),
      ),
    ],
  )

const categoriesView = (
  scene: ShopScene,
  tabsModel: TabsModel,
  initialFocus: Dialog.RenderInfo['initialFocus'],
  h: ShopViewBuilder,
): Html =>
  h.block(
    TabsBinding.embedView({
      slotId: tabsModel.id,
      model: tabsModel,
      viewInputs: {
        tabs: SHOP_CATEGORY_ORDER,
        selectedValue: focusOf(scene).shopCategory,
        ariaLabel: 'Shop sections',
        toView: ({ tablist, tabs, activeIndex }) =>
          h.div(
            [h.Class('shop-categories')],
            [
              h.div(
                [...tablist, h.Class('shop-tabs')],
                Array.map(tabs, tab => tabButtonView(scene, tab, h)),
              ),
              ...pipe(
                tabs,
                Array.filter(tab => tab.index === activeIndex),
                Array.map(tab =>
                  categoryPanelView(scene, tab, initialFocus, h),
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

const keeperView = (scene: ShopScene, h: ShopViewBuilder): Html => {
  const mood = moodOf(scene)
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

const evenBalanceView = (scene: ShopScene, h: ShopViewBuilder): Html =>
  h.span(
    [h.Class('shop-balance')],
    [
      h.span([h.Class('sr-only')], ['You have ']),
      ...withCoins(`$${focusOf(scene).wallet.balance}`, h),
    ],
  )

const oddBalanceView = (scene: ShopScene, h: ShopViewBuilder): Html =>
  h.span(
    [h.Class('shop-balance')],
    [
      h.span([h.Class('sr-only')], ['You have ']),
      ...withCoins(`$${focusOf(scene).wallet.balance}`, h),
    ],
  )

const balanceView = (scene: ShopScene, h: ShopViewBuilder): Html =>
  scene.stats.purchases % 2 === 0
    ? evenBalanceView(scene, h)
    : oddBalanceView(scene, h)

// NOTE: the ? beside the shop's close button opens the guide
// (src/features/guide/) on the tab the player was looking at. A real
// button, so Tab and Enter reach it, and the guide gives it focus back.
const shopHelpButtonView = (scene: ShopScene, h: ShopViewBuilder): Html =>
  h.button(
    [
      h.Type('button'),
      h.Id(GUIDE_FOCUS_IDS.Shop.opener),
      h.Class('shop-help'),
      h.AriaLabel('Shop guide'),
      h.AriaKeyshortcuts('?'),
      h.OnClick(
        Message.ClickedGuideButton({ section: focusOf(scene).shopCategory }),
        { propagation: 'Stop' },
      ),
    ],
    ['?'],
  )

const panelView = (
  model: Model,
  scene: ShopScene,
  { title, description, closeButton, initialFocus }: Dialog.RenderInfo,
  h: ShopViewBuilder,
): ReadonlyArray<Html> => [
  h.header(
    [h.Class('shop-header')],
    [
      keeperView(scene, h),
      h.div(
        [h.Class('shop-speech')],
        [
          h.h2([...title, h.Class('shop-title')], [SHOP_TITLE]),
          h.p(
            [...description, h.Class('shop-greeting'), h.AriaLive('polite')],
            withCoins(chatterLine(scene), h),
          ),
        ],
      ),
      h.p(
        [h.Class('shop-wallet'), h.Role('status')],
        [
          balanceView(scene, h),
          h.span([h.Class('shop-summary sr-only')], [affordSummary(scene)]),
        ],
      ),
      ...(isShopGuideOpen(model) ? [] : [shopHelpButtonView(scene, h)]),
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
  isShopGuideOpen(model)
    ? h.block(
        GuideBinding.embedView({
          slotId: 'shop-guide',
          model: model.guide,
          viewInputs: {
            seenUnlocks: scene.seenUnlocks,
            trailingActions: () => [],
          },
        }),
      )
    : categoriesView(scene, model.tabs, initialFocus, h),
]

// THE DIALOG

type DialogModel = typeof DialogBlock.Model.Type

const dialogView = (
  dialog: DialogModel,
  toPanel: (renderInfo: Dialog.RenderInfo) => ReadonlyArray<Html>,
  h: ShopViewBuilder,
): Html =>
  h.block(
    DialogBinding.embedView({
      slotId: dialog.id,
      model: dialog,
      viewInputs: {
        hasDescription: true,
        toView: renderInfo =>
          h.dialog(
            [h.Key(dialog.id), ...renderInfo.dialog, h.Class('shop-dialog')],
            renderInfo.isVisible
              ? [
                  h.div([...renderInfo.backdrop, h.Class('shop-backdrop')]),
                  h.div(
                    [...renderInfo.panel, h.Class('shop-panel')],
                    toPanel(renderInfo),
                  ),
                ]
              : [],
          ),
      },
    }),
  )

// NOTE: the `<dialog>` is keyed on its id, open or shut, as the root's menu
// dialogs are (`dialogShell` in src/app/dialogs.ts tells why). With no
// scene, while the shop is shut, it shows nothing.
const view = ShopComposition.makeView.withInputs<ViewInputs>(
  (model, inputs, h) =>
    dialogView(
      model.dialog,
      renderInfo =>
        Option.match(inputs.scene(), {
          onNone: () => [],
          onSome: scene => panelView(model, scene, renderInfo, h),
        }),
      h,
    ),
)

export const shopImplementation = { view }
