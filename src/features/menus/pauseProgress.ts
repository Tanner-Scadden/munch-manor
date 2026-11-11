import { Array, Function } from 'effect'
import type { Html } from 'foldkit/html'

import type { ApplicationViewBuilder } from '../../app/composition'
import type { Model } from '../../app/model'
import { DARE_ICON_URLS, DARE_SILHOUETTE_URLS } from '../../art/dareArt'
import { FOUND_CHECK_ICON, QUEST_KEY_ICON, ROOMS_ICON } from '../../art/icons'
import { roomsOf } from '../../domain/run'
import { iconView } from '../../ui/menuParts'
import { dareCardOf } from '../../world/dare/dare'
import type { DareKind } from '../../world/dare/dareSchema'
import { heldKeys } from '../../world/keys/keys'
import { levelOf } from '../../world/level/arena'
import { DARE_NAMES } from '../../world/names'

// The pause screen's progress (owner, 2026-11-10: "The pause menu should
// show my progress as well!"): the dare's things, each in color with a
// check once found and a silhouette until then, the hat last; then the
// crew's skeleton keys and the rooms opened of the rooms on the map. The
// wave is the canvas's line under PAUSED. Never where a thing is. Its own
// view, apart from the HUD's dare card, with the same pixel art drawn big.
// Endless has no list, so only the keys and rooms show.

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
    ],
  )
})
