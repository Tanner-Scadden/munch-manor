import { Array, Function, Option, pipe } from 'effect'
import type { Html } from 'foldkit/html'

import type { ApplicationViewBuilder } from '../../app/composition'
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
// check once found and a silhouette until then, the hat last; then the
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

const thingView = (thing: Thing, h: ApplicationViewBuilder): Html =>
  h.keyed('li')(
    thing.kind,
    [
      h.Class('pause-thing'),
      h.DataAttribute('found', thing.isFound ? 'true' : 'false'),
      h.AriaLabel(thingLabel(thing)),
    ],
    [
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
    ],
  )

const listView = (
  things: ReadonlyArray<Thing>,
  h: ApplicationViewBuilder,
): ReadonlyArray<Html> =>
  Array.isReadonlyArrayNonEmpty(things)
    ? [
        h.ul(
          [h.Class('pause-things'), h.AriaLabel('The dare')],
          Array.map(things, thing => thingView(thing, h)),
        ),
      ]
    : []

const tallyView = (
  icon: string,
  text: string,
  label: string,
  h: ApplicationViewBuilder,
): Html =>
  h.li(
    [h.Class('pause-tally'), h.AriaLabel(label)],
    [
      iconView('pause-tally-icon', icon, h),
      h.span([h.Class('pause-tally-text'), h.AriaHidden(true)], [text]),
    ],
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

const pipsView = (gun: CarriedGun, h: ApplicationViewBuilder): Html =>
  h.span(
    [h.Class('pause-gun-pips'), h.AriaHidden(true)],
    Array.makeBy(maxTier(gun.kind), index =>
      h.span([
        h.Class('pause-gun-pip'),
        h.DataAttribute('on', index < gun.tier ? 'true' : 'false'),
      ]),
    ),
  )

const gunView = (
  gun: CarriedGun,
  index: number,
  h: ApplicationViewBuilder,
): Html => {
  const art = gunArt(gun.kind, gun.tier)
  const name = tierName(gun.kind, gun.tier)
  const standing = standingOf(gun)
  return h.keyed('li')(
    `${index}-${gun.kind}`,
    [
      h.Class('pause-gun'),
      h.DataAttribute('maxed', standing.isMaxed ? 'true' : 'false'),
      h.AriaLabel(`${name}: ${standing.label}`),
    ],
    [
      h.span([
        h.Class('pause-gun-art'),
        h.AriaHidden(true),
        h.Style({
          backgroundImage: art.url,
          '--art-w': `${art.width}`,
          '--art-h': `${art.height}`,
        }),
      ]),
      h.span(
        [h.Class('pause-gun-body'), h.AriaHidden(true)],
        [
          h.span([h.Class('pause-gun-name')], [name]),
          pipsView(gun, h),
          h.span(
            [h.Class('pause-gun-bar')],
            [
              h.span([
                h.Class('pause-gun-fill'),
                h.Style({ width: `${Math.round(standing.share * 100)}%` }),
              ]),
            ],
          ),
          h.span([h.Class('pause-gun-kills')], [standing.kills]),
        ],
      ),
    ],
  )
}

// NOTE: a gun with no levels (Brain Freeze) is not listed: it has nothing
// to climb.
const gunsView = (model: Model, h: ApplicationViewBuilder): Html =>
  h.ul(
    [h.Class('pause-guns'), h.AriaLabel('Your guns')],
    pipe(
      carriedOf(focusOf(model).player),
      Array.filter(gun => maxTier(gun.kind) > 0),
      Array.map((gun, index) => gunView(gun, index, h)),
    ),
  )

export const pauseProgressView: {
  (h: ApplicationViewBuilder): (model: Model) => Html
  (model: Model, h: ApplicationViewBuilder): Html
} = Function.dual(2, (model: Model, h: ApplicationViewBuilder): Html => {
  const keys = heldKeys(model)
  const { found, total } = roomsOf(levelOf(model))
  return h.div(
    [h.Class('pause-progress'), h.Role('group'), h.AriaLabel('Progress')],
    [
      ...listView(dareCardOf(model), h),
      h.ul(
        [h.Class('pause-tallies')],
        [
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
        ],
      ),
      gunsView(model, h),
    ],
  )
})
