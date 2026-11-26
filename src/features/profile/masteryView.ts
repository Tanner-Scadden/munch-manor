import { Array, Function, Option } from 'effect'

import type { View } from '@effect/ui'
import type { Html } from '@effect/ui/html'

import { pixelArtStyle } from '../../art/artSize'
import { portraitOf } from '../../art/coopIcons'
import { pixelIconUrl } from '../../art/icons'
import { gunPictureOf } from '../../art/sprites/guns'
import { PROP_STYLE_RAMPS } from '../../art/sprites/propStyles'
import {
  type HeroReward,
  MASTERY_GUNS,
  MAX_HERO_LEVEL,
  PROP_STYLES,
  type TrackProgress,
  gunProgressOf,
  heroProgressOf,
  isStyleOpen,
  masterySkinIn,
  styleLevelOf,
} from '../../domain/mastery'
import type { MasterySkin, SavedMastery } from '../../shared/masteryData'
import type { Appearance, Calling, PropStyle } from '../../shared/playerData'
import { CALLINGS } from '../../world/heroes/calling'
import {
  CALLING_NAMES,
  GUN_NAMES,
  HERO_STORY_NAME,
  MASTERY_SKIN_NAMES,
  PROP_STYLE_NAMES,
  PROP_WORD,
} from '../../world/names'
import type { WeaponKind } from '../../world/schema/worldSchema'
import { Message } from './message'

// The Profile's MASTERY tab (docs/PROGRESSION_PLAN.md, pillar D): a row
// per hero, its figure in the best prop style its track has opened, a bar
// to the next level and what that level opens, and the hero picked's
// style swatches to wear one; then a row per gun, its picture in the best
// skin its kills have opened, a kills bar, and the next skin. The rules
// are src/domain/mastery.ts's; the styles are in
// src/features/profile/mastery.css.

type ProfileViewBuilder = Html.H<Message>
type ProfileContent = View.Content<Message>

export type MasteryInputs = Readonly<{
  mastery: SavedMastery
  picked: Calling
  look: Appearance
}>

const percentOf = (share: number): string => `${Math.round(share * 100)}%`

const barView = <Reward>(
  progress: TrackProgress<Reward>,
  label: string,
  h: ProfileViewBuilder,
): ProfileContent =>
  h.span
    .class('mastery-bar')
    .attr('role', 'img')
    .attr(
      'aria-label',
      `${label}: ${percentOf(progress.share)} to the next level`,
    )
    .children(
      h.span.class('mastery-fill').style({ width: percentOf(progress.share) }),
    )

// NOTE: the next step's reward and the count it asks, or a gold MAX.
const nextView = <Reward>(
  progress: TrackProgress<Reward>,
  nameOf: (reward: Reward) => string,
  h: ProfileViewBuilder,
): ProfileContent =>
  Option.match(progress.maybeNext, {
    onNone: () => h.span.class('mastery-next mastery-max').children('MAX'),
    onSome: ({ at, reward }) =>
      h.span
        .class('mastery-next')
        .children(
          h.span.class('mastery-reward').children(nameOf(reward)),
          h.span.class('mastery-count').children(`${progress.count}/${at}`),
        ),
  })

// HEROES

const heroRewardName = (reward: HeroReward): string =>
  reward === 'Story'
    ? HERO_STORY_NAME
    : `${PROP_STYLE_NAMES[reward]} ${PROP_WORD}`

// NOTE: the best style a hero's track has opened, for its figure.
const bestStyleOf = (mastery: SavedMastery, calling: Calling): PropStyle =>
  Option.getOrElse(
    Array.findLast(PROP_STYLES, style => isStyleOpen(mastery, calling, style)),
    (): PropStyle => 'Stock',
  )

const swatchColor = (style: PropStyle): string =>
  style === 'Stock' ? 'var(--menu-line)' : PROP_STYLE_RAMPS[style].mid

// NOTE: the hero picked's styles are buttons: an open one is worn, a shut
// one shakes its padlock. Another hero's are dots, lit when open.
const swatchView = (
  inputs: MasteryInputs,
  calling: Calling,
  style: PropStyle,
  h: ProfileViewBuilder,
): ProfileContent => {
  const isOpen = isStyleOpen(inputs.mastery, calling, style)
  const isWorn = calling === inputs.picked && inputs.look.propStyle === style
  const label = isOpen
    ? `${PROP_STYLE_NAMES[style]} ${PROP_WORD}`
    : `${PROP_STYLE_NAMES[style]} ${PROP_WORD}, locked until level ${styleLevelOf(style)}`
  const data = {
    'data-style': style,
    'data-open': isOpen ? 'true' : 'false',
    'data-worn': isWorn ? 'true' : undefined,
  }
  const swatch = { '--swatch': swatchColor(style) }
  return calling === inputs.picked
    ? h.button
        .class('mastery-swatch')
        .attrs({
          ...data,
          type: 'button',
          'aria-pressed': isWorn ? 'true' : 'false',
          'aria-label': label,
          'aria-disabled': isOpen ? undefined : 'true',
        })
        .style(swatch)
        .on('click', Message.ClickedPropStyle({ style }))
    : h.span
        .class('mastery-swatch')
        .attrs({ ...data, 'aria-hidden': 'true' })
        .style(swatch)
}

const heroRowView = (
  inputs: MasteryInputs,
  calling: Calling,
  h: ProfileViewBuilder,
): ProfileContent => {
  const progress = heroProgressOf(inputs.mastery, calling)
  const look: Appearance = {
    ...inputs.look,
    hat: 'None',
    propStyle:
      calling === inputs.picked
        ? inputs.look.propStyle
        : bestStyleOf(inputs.mastery, calling),
  }
  return h.li
    .class('mastery-row')
    .attr('data-calling', calling)
    .attr('data-picked', calling === inputs.picked ? 'true' : undefined)
    .children(
      h.span
        .class('mastery-figure')
        .attr('aria-hidden', 'true')
        .style(pixelArtStyle(portraitOf(look, calling))),
      h.span
        .class('mastery-body')
        .children(
          h.span
            .class('mastery-head')
            .children(
              h.span.class('mastery-name').children(CALLING_NAMES[calling]),
              h.span
                .class('mastery-level')
                .children(`LV ${progress.level}/${MAX_HERO_LEVEL}`),
            ),
          barView(progress, `${CALLING_NAMES[calling]} mastery`, h),
          nextView(progress, heroRewardName, h),
          h.span
            .class('mastery-swatches')
            .children(
              Array.map(PROP_STYLES, style =>
                swatchView(inputs, calling, style, h),
              ),
            ),
        ),
    )
}

// GUNS

const gunPictureUrl = (
  kind: WeaponKind,
  maybeSkin: Option.Option<MasterySkin>,
): string => {
  const { rows, palette } = gunPictureOf(
    kind,
    Option.getOrElse(maybeSkin, (): MasterySkin | 'Stock' => 'Stock'),
  )
  return pixelIconUrl(rows, palette)
}

const gunRowView = (
  mastery: SavedMastery,
  kind: WeaponKind,
  h: ProfileViewBuilder,
): ProfileContent => {
  const progress = gunProgressOf(mastery, kind)
  const maybeSkin = masterySkinIn(mastery, kind)
  return h.li
    .class('mastery-row mastery-gun')
    .attr('data-gun', kind)
    .attr('data-skin', Option.getOrUndefined(maybeSkin))
    .children(
      h.span
        .class('mastery-gun-img')
        .attr('aria-hidden', 'true')
        .style(pixelArtStyle(gunPictureUrl(kind, maybeSkin))),
      h.span.class('mastery-body').children(
        h.span
          .class('mastery-head')
          .children(
            h.span.class('mastery-name').children(GUN_NAMES[kind]),
            h.span.class('mastery-level').children(`${progress.count}`),
          ),
        barView(progress, `${GUN_NAMES[kind]} kills`, h),
        nextView(progress, skin => MASTERY_SKIN_NAMES[skin], h),
      ),
    )
}

export const masteryTabView: {
  (h: ProfileViewBuilder): (inputs: MasteryInputs) => ProfileContent
  (inputs: MasteryInputs, h: ProfileViewBuilder): ProfileContent
} = Function.dual(
  2,
  (inputs: MasteryInputs, h: ProfileViewBuilder): ProfileContent =>
    h.div.class('mastery-tab').children(
      h.ul
        .class('mastery-rows')
        .attr('aria-label', 'Heroes')
        .children(
          Array.map(CALLINGS, calling => heroRowView(inputs, calling, h)),
        ),
      h.ul
        .class('mastery-rows')
        .attr('aria-label', 'Guns')
        .children(
          Array.map(MASTERY_GUNS, kind => gunRowView(inputs.mastery, kind, h)),
        ),
    ),
)
