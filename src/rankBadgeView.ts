import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import type { ApplicationViewBuilder } from './composition'
import { rankBadgeImgView } from './menuParts'
import type { Model } from './model'
import {
  badgeTierOf,
  bonesBalanceOf,
  rankProgressOf,
  totalPointsOf,
} from './rank'
import { BONE_IMAGE } from './rankArt'

// The rank in the menus, in HTML: the badge with its number on the home
// menu's player (a tap on them opens the Profile), and in the Profile the
// badge, the rank, the bar to the next rank, and the Bones. Pictures and
// numbers only. The end card's strip is the canvas one,
// src/rankStripView.ts.

const ART_SCALE = 2

const badgeView = <Message>(rank: number, h: HtmlBuilder<Message>): Html =>
  rankBadgeImgView(rank, ART_SCALE, h)

// NOTE: the badge a rank wears and its number, for a card that says which
// rank it needs (src/callingView.ts).
export const rankMarkView = <Message>(
  rank: number,
  h: HtmlBuilder<Message>,
): Html =>
  h.span(
    [
      h.Class('rank-chip'),
      h.DataAttribute('tier', badgeTierOf(rank)),
      h.AriaHidden(true),
    ],
    [badgeView(rank, h), h.span([h.Class('rank-number')], [`${rank}`])],
  )

// NOTE: the badge and its number, a small chip under the player on the
// home menu.
export const rankChipView = (model: Model, h: ApplicationViewBuilder): Html => {
  const { rank } = rankProgressOf(totalPointsOf(model.rank))
  return h.span(
    [
      h.Class('rank-chip'),
      h.DataAttribute('tier', badgeTierOf(rank)),
      h.AriaHidden(true),
    ],
    [badgeView(rank, h), h.span([h.Class('rank-number')], [`${rank}`])],
  )
}

// NOTE: a pixel bone and a count, `scale` times its pixels, for the Bones
// the plate holds and the closet spends.
export const boneCountView = <Message>(
  count: number,
  className: string,
  h: HtmlBuilder<Message>,
): Html =>
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
  )

// NOTE: the Profile's plate: the badge and rank, the bar filled by how far
// into the rank the points are, and the Bones balance by a pixel bone.
export const rankPlateView = (
  model: Model,
  h: ApplicationViewBuilder,
): Html => {
  const progress = rankProgressOf(totalPointsOf(model.rank))
  const bones = bonesBalanceOf(model.rank)
  return h.div(
    [
      h.Class('profile-rank'),
      h.DataAttribute('tier', badgeTierOf(progress.rank)),
      h.Role('group'),
      h.AriaLabel(
        `Rank ${progress.rank}, ${progress.into} of ${progress.cost} points to the next. ${bones} Bones.`,
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
        [h.Class('rank-bar'), h.AriaHidden(true)],
        [
          h.span([
            h.Class('rank-bar-fill'),
            h.Style({ width: `${Math.round(progress.fraction * 100)}%` }),
          ]),
        ],
      ),
      boneCountView(bones, 'rank-bones', h),
    ],
  )
}
