import { Array, Function, Option, pipe } from 'effect'

import type {
  ApplicationHtml,
  ApplicationViewBuilder,
} from '../../app/definition'
import type { Model } from '../../app/model'
import { DARE_ICON_URLS, DARE_SILHOUETTE_URLS } from '../../art/dareArt'
import { FOUND_CHECK_ICON, ROOMS_ICON } from '../../art/icons'
import { QUEST_KEY_ICON } from '../../art/questIcons'
import { gunArt } from '../../art/shopArt'
import { roomsOf } from '../../domain/run'
import { iconView } from '../../ui/menuParts'
import { dareCardOf } from '../../world/dare/dare'
import type { DareKind } from '../../world/dare/dareSchema'
import { maybeNextLevelKills } from '../../world/gear/gunLevels'
import { carriedOf, maxTier, tierName } from '../../world/gear/weapons'
import { heldKeys } from '../../world/keys/keys'
import { levelOf } from '../../world/level/arena'
import { DARE_NAMES } from '../../world/names'
import { focusOf } from '../../world/party/party'
import type { CarriedGun } from '../../world/schema/entitySchema'

// The pause screen's progress (owner, 2026-11-10: "The pause menu should
// show my progress as well!"): the dare's things, each in color with a
// check once found and a silhouette until then; then the
// crew's skeleton keys and the rooms opened of the rooms on the map. The
// wave is the canvas's line under PAUSED. Never where a thing is. Its own
// view, apart from the HUD's dare card, with the same pixel art drawn big.
// Endless has no list, so only the keys and rooms show.
// Then each gun carried (owner, 2026-11-10: "I am also very confused on how
// I do the upgrades for the weapon now."): its picture at its tier, its
// name, its tier pips, and its kills toward its next level on a bar, MAX at
// its top.

type Thing = Readonly<{ kind: DareKind; isFound: boolean }>

const thingLabel = ({ kind, isFound }: Thing): string =>
  `${DARE_NAMES[kind]}: ${isFound ? 'found' : 'not found'}`

const thingView = (thing: Thing, h: ApplicationViewBuilder): ApplicationHtml =>
  h.li
    .key(thing.kind)
    .class('pause-thing')
    .attr('data-found', thing.isFound ? 'true' : 'false')
    .attr('aria-label', thingLabel(thing))
    .children(
      iconView(
        'pause-thing-icon',
        thing.isFound
          ? DARE_ICON_URLS[thing.kind]
          : DARE_SILHOUETTE_URLS[thing.kind],
        h,
      ),
      ...(thing.isFound
        ? [iconView('pause-thing-check', FOUND_CHECK_ICON, h)]
        : []),
    )

const listView = (
  things: ReadonlyArray<Thing>,
  h: ApplicationViewBuilder,
): ReadonlyArray<ApplicationHtml> =>
  Array.isReadonlyArrayNonEmpty(things)
    ? [
        h.ul
          .class('pause-things')
          .attr('aria-label', 'The dare')
          .children(Array.map(things, thing => thingView(thing, h))),
      ]
    : []

const tallyView = (
  icon: string,
  text: string,
  label: string,
  h: ApplicationViewBuilder,
): ApplicationHtml =>
  h.li
    .class('pause-tally')
    .attr('aria-label', label)
    .children(
      iconView('pause-tally-icon', icon, h),
      h.span
        .class('pause-tally-text')
        .attr('aria-hidden', 'true')
        .children(text),
    )

// GUNS

const MAX_LABEL = 'MAX'

type GunStanding = Readonly<{
  kills: string
  share: number
  isMaxed: boolean
  label: string
}>

const standingOf = (gun: CarriedGun): GunStanding =>
  Option.match(maybeNextLevelKills(gun), {
    onNone: () => ({
      kills: MAX_LABEL,
      share: 1,
      isMaxed: true,
      label: `${gun.kills} kills, top level`,
    }),
    onSome: next => ({
      kills: `${gun.kills}/${next}`,
      share: Math.min(1, gun.kills / Math.max(1, next)),
      isMaxed: false,
      label: `${gun.kills} of ${next} kills to the next level`,
    }),
  })

const pipsView = (
  gun: CarriedGun,
  h: ApplicationViewBuilder,
): ApplicationHtml =>
  h.span
    .class('pause-gun-pips')
    .attr('aria-hidden', 'true')
    .children(
      Array.makeBy(maxTier(gun.kind), index =>
        h.span
          .class('pause-gun-pip')
          .attr('data-on', index < gun.tier ? 'true' : 'false'),
      ),
    )

const gunView = (
  gun: CarriedGun,
  index: number,
  h: ApplicationViewBuilder,
): ApplicationHtml => {
  const art = gunArt(gun.kind, gun.tier)
  const name = tierName(gun.kind, gun.tier)
  const standing = standingOf(gun)
  return h.li
    .key(`${index}-${gun.kind}`)
    .class('pause-gun')
    .attr('data-maxed', standing.isMaxed ? 'true' : 'false')
    .attr('aria-label', `${name}: ${standing.label}`)
    .children(
      h.span
        .class('pause-gun-art')
        .attr('aria-hidden', 'true')
        .style({
          backgroundImage: art.url,
          '--art-w': `${art.width}`,
          '--art-h': `${art.height}`,
        }),
      h.span
        .class('pause-gun-body')
        .attr('aria-hidden', 'true')
        .children(
          h.span.class('pause-gun-name').children(name),
          pipsView(gun, h),
          h.span
            .class('pause-gun-bar')
            .children(
              h.span
                .class('pause-gun-fill')
                .style({ width: `${Math.round(standing.share * 100)}%` }),
            ),
          h.span.class('pause-gun-kills').children(standing.kills),
        ),
    )
}

// NOTE: a gun with no levels (Brain Freeze) is not listed: it has nothing
// to climb.
const gunsView = (model: Model, h: ApplicationViewBuilder): ApplicationHtml =>
  h.ul
    .class('pause-guns')
    .attr('aria-label', 'Your guns')
    .children(
      pipe(
        carriedOf(focusOf(model).player),
        Array.filter(gun => maxTier(gun.kind) > 0),
        Array.map((gun, index) => gunView(gun, index, h)),
      ),
    )

export const pauseProgressView: {
  (h: ApplicationViewBuilder): (model: Model) => ApplicationHtml
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml
} = Function.dual(
  2,
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml => {
    const keys = heldKeys(model)
    const { found, total } = roomsOf(levelOf(model))
    return h.div
      .class('pause-progress')
      .attr('role', 'group')
      .attr('aria-label', 'Progress')
      .children(
        ...listView(dareCardOf(model), h),
        h.ul
          .class('pause-tallies')
          .children(
            tallyView(
              QUEST_KEY_ICON,
              `${keys}`,
              `${keys} skeleton ${keys === 1 ? 'key' : 'keys'}`,
              h,
            ),
            tallyView(
              ROOMS_ICON,
              `${found}/${total}`,
              `${found} of ${total} rooms open`,
              h,
            ),
          ),
        gunsView(model, h),
      )
  },
)
