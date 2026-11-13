import { Array, Function, Option } from 'effect'
import type { Html } from 'foldkit/html'

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
import type { ProfileViewBuilder } from './composition'
import { Message } from './message'

// The Profile's MASTERY tab (docs/PROGRESSION_PLAN.md, pillar D): a row
// per hero, its figure in the best prop style its track has opened, a bar
// to the next level and what that level opens, and the hero picked's
// style swatches to wear one; then a row per gun, its picture in the best
// skin its kills have opened, a kills bar, and the next skin. The rules
// are src/domain/mastery.ts's; the styles are in
// src/features/profile/mastery.css.

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
): Html =>
  h.span(
    [
      h.Class('mastery-bar'),
      h.Role('img'),
      h.AriaLabel(`${label}: ${percentOf(progress.share)} to the next level`),
    ],
    [
      h.span([
        h.Class('mastery-fill'),
        h.Style({ width: percentOf(progress.share) }),
      ]),
    ],
  )

// NOTE: the next step's reward and the count it asks, or a gold MAX.
const nextView = <Reward>(
  progress: TrackProgress<Reward>,
  nameOf: (reward: Reward) => string,
  h: ProfileViewBuilder,
): Html =>
  Option.match(progress.maybeNext, {
    onNone: () => h.span([h.Class('mastery-next mastery-max')], ['MAX']),
    onSome: ({ at, reward }) =>
      h.span(
        [h.Class('mastery-next')],
        [
          h.span([h.Class('mastery-reward')], [nameOf(reward)]),
          h.span([h.Class('mastery-count')], [`${progress.count}/${at}`]),
        ],
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
): Html => {
  const isOpen = isStyleOpen(inputs.mastery, calling, style)
  const isWorn = calling === inputs.picked && inputs.look.propStyle === style
  const attributes = [
    h.Class('mastery-swatch'),
    h.DataAttribute('style', style),
    h.DataAttribute('open', isOpen ? 'true' : 'false'),
    ...(isWorn ? [h.DataAttribute('worn', 'true')] : []),
    h.Style({ '--swatch': swatchColor(style) }),
  ]
  return calling === inputs.picked
    ? h.button([
        ...attributes,
        h.Type('button'),
        h.AriaPressed(isWorn ? 'true' : 'false'),
        h.AriaLabel(
          isOpen
            ? `${PROP_STYLE_NAMES[style]} ${PROP_WORD}`
            : `${PROP_STYLE_NAMES[style]} ${PROP_WORD}, locked until level ${styleLevelOf(style)}`,
        ),
        ...(isOpen ? [] : [h.AriaDisabled(true)]),
        h.OnClick(Message.ClickedPropStyle({ style })),
      ])
    : h.span([...attributes, h.AriaHidden(true)])
}

const heroRowView = (
  inputs: MasteryInputs,
  calling: Calling,
  h: ProfileViewBuilder,
): Html => {
  const progress = heroProgressOf(inputs.mastery, calling)
  const look: Appearance = {
    ...inputs.look,
    hat: 'None',
    propStyle:
      calling === inputs.picked
        ? inputs.look.propStyle
        : bestStyleOf(inputs.mastery, calling),
  }
  return h.li(
    [
      h.Class('mastery-row'),
      h.DataAttribute('calling', calling),
      ...(calling === inputs.picked ? [h.DataAttribute('picked', 'true')] : []),
    ],
    [
      h.span([
        h.Class('mastery-figure'),
        h.AriaHidden(true),
        h.Style({ backgroundImage: portraitOf(look, calling) }),
      ]),
      h.span(
        [h.Class('mastery-body')],
        [
          h.span(
            [h.Class('mastery-head')],
            [
              h.span([h.Class('mastery-name')], [CALLING_NAMES[calling]]),
              h.span(
                [h.Class('mastery-level')],
                [`LV ${progress.level}/${MAX_HERO_LEVEL}`],
              ),
            ],
          ),
          barView(progress, `${CALLING_NAMES[calling]} mastery`, h),
          nextView(progress, heroRewardName, h),
          h.span(
            [h.Class('mastery-swatches')],
            Array.map(PROP_STYLES, style =>
              swatchView(inputs, calling, style, h),
            ),
          ),
        ],
      ),
    ],
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
): Html => {
  const progress = gunProgressOf(mastery, kind)
  const maybeSkin = masterySkinIn(mastery, kind)
  return h.li(
    [
      h.Class('mastery-row mastery-gun'),
      h.DataAttribute('gun', kind),
      ...(Option.isSome(maybeSkin)
        ? [h.DataAttribute('skin', maybeSkin.value)]
        : []),
    ],
    [
      h.span([
        h.Class('mastery-gun-img'),
        h.AriaHidden(true),
        h.Style({ backgroundImage: gunPictureUrl(kind, maybeSkin) }),
      ]),
      h.span(
        [h.Class('mastery-body')],
        [
          h.span(
            [h.Class('mastery-head')],
            [
              h.span([h.Class('mastery-name')], [GUN_NAMES[kind]]),
              h.span([h.Class('mastery-level')], [`${progress.count}`]),
            ],
          ),
          barView(progress, `${GUN_NAMES[kind]} kills`, h),
          nextView(progress, skin => MASTERY_SKIN_NAMES[skin], h),
        ],
      ),
    ],
  )
}

export const masteryTabView: {
  (h: ProfileViewBuilder): (inputs: MasteryInputs) => Html
  (inputs: MasteryInputs, h: ProfileViewBuilder): Html
} = Function.dual(2, (inputs: MasteryInputs, h: ProfileViewBuilder): Html =>
  h.div(
    [h.Class('mastery-tab')],
    [
      h.ul(
        [h.Class('mastery-rows'), h.AriaLabel('Heroes')],
        Array.map(CALLINGS, calling => heroRowView(inputs, calling, h)),
      ),
      h.ul(
        [h.Class('mastery-rows'), h.AriaLabel('Guns')],
        Array.map(MASTERY_GUNS, kind => gunRowView(inputs.mastery, kind, h)),
      ),
    ],
  ),
)
