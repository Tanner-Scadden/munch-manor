import { Function, Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import type { ApplicationViewBuilder } from '../app/composition'
import type { Model } from '../app/model'
import { PROP_ICONS } from '../art/callingArt'
import { pixelIconUrl } from '../art/icons'
import {
  BONE_IMAGE,
  GIFT_BOX_PALETTE,
  GIFT_BOX_PIXELS,
  PURSE_PALETTE,
  PURSE_PIXELS,
} from '../art/rankArt'
import { type RankGift, giftAtRank } from '../domain/unlocks'
import {
  badgeTierOf,
  bonesBalanceOf,
  rankProgressOf,
  totalPointsOf,
} from '../world/heroes/rank'
import { CALLING_NAMES, PURSE_NAME, giftName } from '../world/names'
import { rankBadgeImgView } from './menuParts'

// The rank in the menus, in HTML: the badge with its number on the home
// menu's player (a tap on them opens the Profile), and in the Profile the
// badge, the rank, the bar to the next rank, and the Bones; both with the
// next rank's gift. Pictures and
// numbers only. The end card's strip is the canvas one,
// src/features/end/rankStripView.ts.

const ART_SCALE = 2

const badgeView = <Message>(rank: number, h: HtmlBuilder<Message>): Html =>
  rankBadgeImgView(rank, ART_SCALE, h)

// NOTE: the badge a rank wears and its number, for a card that says which
// rank it needs (src/features/heroes/callingCards.ts).
export const rankMarkView: {
  <Message>(h: HtmlBuilder<Message>): (rank: number) => Html
  <Message>(rank: number, h: HtmlBuilder<Message>): Html
} = Function.dual(2, <Message>(rank: number, h: HtmlBuilder<Message>): Html =>
  h.span(
    [
      h.Class('rank-chip'),
      h.DataAttribute('tier', badgeTierOf(rank)),
      h.AriaHidden(true),
    ],
    [badgeView(rank, h), h.span([h.Class('rank-number')], [`${rank}`])],
  ),
)

// WHAT'S NEXT

const PURSE_ICON = pixelIconUrl(PURSE_PIXELS, PURSE_PALETTE)
const GIFT_BOX_ICON = pixelIconUrl(GIFT_BOX_PIXELS, GIFT_BOX_PALETTE)

type NextGift = Readonly<{ icon: string; label: string }>

// NOTE: the next rank's gift as a picture and words for a screen reader:
// a hero's prop, a gift box for a look, or the bag of bones and its count.
const nextGiftOf = (gift: RankGift): Option.Option<NextGift> => {
  switch (gift.kind) {
    case 'Hero':
      return Option.some({
        icon: PROP_ICONS[gift.calling],
        label: CALLING_NAMES[gift.calling],
      })
    case 'Look':
      return Option.some({
        icon: GIFT_BOX_ICON,
        label: giftName(gift.gift.kind, gift.gift.name),
      })
    case 'Purse':
      return Option.some({
        icon: PURSE_ICON,
        label: `${PURSE_NAME}, ${gift.bones} Bones`,
      })
    case 'Nothing':
      return Option.none()
  }
}

// NOTE: what the next rank gives, a small icon by the rank (the home menu's
// chip, the Profile's bar), with a purse's Bones beside it. Hidden from
// screen readers: the caller's label says it in words.
const nextGiftView = <Message>(rank: number, h: HtmlBuilder<Message>): Html => {
  const gift = giftAtRank(rank + 1)
  return Option.match(nextGiftOf(gift), {
    onNone: () => h.empty,
    onSome: ({ icon }) =>
      h.span(
        [
          h.Class('rank-next'),
          h.DataAttribute('gift', gift.kind),
          h.AriaHidden(true),
        ],
        [
          h.span([
            h.Class('rank-next-icon'),
            h.Style({ backgroundImage: icon }),
          ]),
          ...(gift.kind === 'Purse'
            ? [h.span([h.Class('rank-next-count')], [`+${gift.bones}`])]
            : []),
        ],
      ),
  })
}

// NOTE: the next rank's gift in words, for the plate's and the chip's label.
const nextGiftLabelOf = (rank: number): string =>
  Option.match(nextGiftOf(giftAtRank(rank + 1)), {
    onNone: () => '',
    onSome: ({ label }) => ` Rank ${rank + 1} gives ${label}.`,
  })

// NOTE: the badge and its number, a small chip under the player on the
// home menu, with the next rank's gift.
export const rankChipView: {
  (h: ApplicationViewBuilder): (model: Model) => Html
  (model: Model, h: ApplicationViewBuilder): Html
} = Function.dual(2, (model: Model, h: ApplicationViewBuilder): Html => {
  const { rank } = rankProgressOf(totalPointsOf(model.rank))
  return h.span(
    [
      h.Class('rank-chip'),
      h.DataAttribute('tier', badgeTierOf(rank)),
      h.AriaHidden(true),
    ],
    [
      badgeView(rank, h),
      h.span([h.Class('rank-number')], [`${rank}`]),
      nextGiftView(rank, h),
    ],
  )
})

// NOTE: a pixel bone and a count, `scale` times its pixels, for the Bones
// the plate holds and the closet spends.
export const boneCountView: {
  <Message>(className: string, h: HtmlBuilder<Message>): (count: number) => Html
  <Message>(count: number, className: string, h: HtmlBuilder<Message>): Html
} = Function.dual(
  3,
  <Message>(count: number, className: string, h: HtmlBuilder<Message>): Html =>
    h.span(
      [h.Class(className), h.AriaHidden(true)],
      [
        ...Option.match(BONE_IMAGE, {
          onNone: () => [],
          onSome: image => [
            h.img([
              h.Class('rank-bone-img'),
              h.Src(image.src),
              h.Alt(''),
              h.Style({
                width: `${image.width * ART_SCALE}px`,
                height: `${image.height * ART_SCALE}px`,
              }),
            ]),
          ],
        }),
        h.span([h.Class('rank-bones-count')], [`${count}`]),
      ],
    ),
)

// NOTE: the Profile's plate: the badge and rank, the bar filled by how far
// into the rank the points are, and the Bones balance by a pixel bone.
export const rankPlateView: {
  (h: ApplicationViewBuilder): (model: Model) => Html
  (model: Model, h: ApplicationViewBuilder): Html
} = Function.dual(2, (model: Model, h: ApplicationViewBuilder): Html => {
  const progress = rankProgressOf(totalPointsOf(model.rank))
  const bones = bonesBalanceOf(model.rank)
  return h.div(
    [
      h.Class('profile-rank'),
      h.DataAttribute('tier', badgeTierOf(progress.rank)),
      h.Role('group'),
      h.AriaLabel(
        `Rank ${progress.rank}, ${progress.into} of ${progress.cost} points to the next.${nextGiftLabelOf(progress.rank)} ${bones} Bones.`,
      ),
    ],
    [
      h.span(
        [h.Class('rank-head'), h.AriaHidden(true)],
        [
          badgeView(progress.rank, h),
          h.span([h.Class('rank-number')], [`${progress.rank}`]),
        ],
      ),
      h.span(
        [h.Class('rank-track'), h.AriaHidden(true)],
        [
          h.span(
            [h.Class('rank-bar')],
            [
              h.span([
                h.Class('rank-bar-fill'),
                h.Style({ width: `${Math.round(progress.fraction * 100)}%` }),
              ]),
            ],
          ),
          nextGiftView(progress.rank, h),
        ],
      ),
      boneCountView(bones, 'rank-bones', h),
    ],
  )
})
