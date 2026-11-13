import { Array, Option, pipe } from 'effect'
import type { Html } from 'foldkit/html'

import { PROP_ICONS } from '../../art/callingArt'
import { TIN_BOT_ICON } from '../../art/coopIcons'
import { DARE_ICON_URLS, DARE_SILHOUETTE_URLS } from '../../art/dareArt'
import { SKULL_ICONS, TROPHY_ICON } from '../../art/icons'
import {
  BIG_KEY_URL,
  BRACKET_URL,
  DAY_STAR_URL,
  HOOK_URL,
  PLANK_URL,
  STAMP_URLS,
} from '../../art/proofArt'
import type { DayStamp } from '../../shared/dayStamp'
import { type Difficulty, callingOfCode } from '../../shared/playerData'
import type { CrewMate, ProofStamp } from '../../shared/proofData'
import { dareMarkBadgeView } from '../../ui/dareMarkView'
import { iconView } from '../../ui/menuParts'
import {
  BIG_KEY_LINE,
  BIG_KEY_NAME,
  CALLING_NAMES,
  DARE_LINES,
  DARE_NAMES,
  PROOF_ENDING_NAMES,
} from '../../world/names'
import { DIFFICULTIES } from '../../world/run/difficulty'
import type { ViewInputs } from './block'
import {
  ProofShelfComposition,
  type ProofShelfViewBuilder,
} from './composition'
import { Message } from './message'
import type { Model } from './model'
import {
  SHELF_ROWS,
  type ShelfSpot,
  type ShelfThing,
  dayLabel,
  dayOfMonth,
  daysInMonth,
  filledCount,
  firstWeekdayOf,
  isBigKey,
  maybeCalendarDay,
  maybeStampAt,
  monthLabel,
  slotCountOf,
  slotId,
  spotUnlockId,
} from './proof'

// The Proof Shelf in the menu panel: your friends' treehouse shelf, a row
// per difficulty (its skull at the end), the house's things along it and
// Uncle Chunk's hook last; under it the picked slot's stamp, and the
// calendar of mission days. Show, don't explain: a filled slot is the thing
// in color with its ending's stamp, an empty one a dim outline.

// TEXT

const thingName = (thing: ShelfThing): string =>
  isBigKey(thing) ? BIG_KEY_NAME : DARE_NAMES[thing]

const thingLine = (thing: ShelfThing): string =>
  isBigKey(thing) ? BIG_KEY_LINE : DARE_LINES[thing]

const crewText = (crew: ReadonlyArray<CrewMate>): string =>
  Array.match(crew, {
    onEmpty: () => 'alone',
    onNonEmpty: mates =>
      `with ${Array.join(
        Array.map(mates, mate =>
          mate.isBot ? `${mate.name} (bot)` : mate.name,
        ),
        ', ',
      )}`,
  })

const heroName = (hero: string): string =>
  Option.match(callingOfCode(hero), {
    onNone: () => hero,
    onSome: calling => CALLING_NAMES[calling],
  })

const stampText = (stamp: ProofStamp): string =>
  `${PROOF_ENDING_NAMES[stamp.ending]}, wave ${stamp.wave}, as ${heroName(stamp.hero)}, ${crewText(stamp.crew)}${stamp.day === null ? '' : `, ${dayLabel(stamp.day)}`}`

const slotLabel = (
  spot: ShelfSpot,
  maybeStamp: Option.Option<ProofStamp>,
): string =>
  `${thingName(spot.thing)}, ${DIFFICULTIES[spot.difficulty].name}: ${Option.match(
    maybeStamp,
    { onNone: () => 'not yet', onSome: stampText },
  )}`

// PICTURES

const thingIcon = (thing: ShelfThing, isFilled: boolean): string => {
  if (isBigKey(thing)) {
    return isFilled ? BIG_KEY_URL : HOOK_URL
  }
  return isFilled ? DARE_ICON_URLS[thing] : DARE_SILHOUETTE_URLS[thing]
}

// THE SHELF

const isPicked = (model: Model, spot: ShelfSpot): boolean =>
  Option.exists(
    model.maybePicked,
    picked =>
      picked.thing === spot.thing && picked.difficulty === spot.difficulty,
  )

const slotView = (
  model: Model,
  inputs: ViewInputs,
  spot: ShelfSpot,
  h: ProofShelfViewBuilder,
): Html => {
  const maybeStamp = maybeStampAt(inputs.proof, spot)
  const isFilled = Option.isSome(maybeStamp)
  return h.button(
    [
      h.Type('button'),
      h.Id(slotId(spot)),
      h.Class(isBigKey(spot.thing) ? 'proof-slot proof-hook' : 'proof-slot'),
      h.DataAttribute('filled', isFilled ? 'true' : 'false'),
      h.AriaPressed(isPicked(model, spot) ? 'true' : 'false'),
      h.AriaLabel(slotLabel(spot, maybeStamp)),
      h.OnClick(Message.ClickedSlot({ spot })),
    ],
    [
      iconView('proof-thing', thingIcon(spot.thing, isFilled), h),
      ...Option.match(maybeStamp, {
        onNone: () => [],
        onSome: stamp => [iconView('proof-stamp', STAMP_URLS[stamp.ending], h)],
      }),
      ...(Array.contains(inputs.fresh, spotUnlockId(spot))
        ? [h.span([h.Class('proof-new'), h.AriaHidden(true)], ['NEW'])]
        : []),
    ],
  )
}

const rowView = (
  model: Model,
  inputs: ViewInputs,
  difficulty: Difficulty,
  h: ProofShelfViewBuilder,
): Html =>
  h.li(
    [h.Class('proof-row'), h.DataAttribute('difficulty', difficulty)],
    [
      h.span(
        [h.Class('proof-row-mark')],
        [
          iconView('proof-skull', SKULL_ICONS[difficulty], h),
          h.span([h.Class('sr-only')], [DIFFICULTIES[difficulty].name]),
          ...dareMarkBadgeView(
            inputs.dareMarks[difficulty],
            'proof-row-dare-mark',
            h,
          ),
        ],
      ),
      h.div(
        [
          h.Class('proof-slots'),
          h.Style({ '--shelf-things': `${inputs.things.length}` }),
        ],
        Array.map(inputs.things, thing =>
          slotView(model, inputs, { thing, difficulty }, h),
        ),
      ),
      h.span(
        [h.Class('proof-plank'), h.AriaHidden(true)],
        [
          iconView('proof-board', PLANK_URL, h),
          iconView('proof-bracket proof-bracket-left', BRACKET_URL, h),
          iconView('proof-bracket proof-bracket-right', BRACKET_URL, h),
        ],
      ),
    ],
  )

const shelfView = (
  model: Model,
  inputs: ViewInputs,
  h: ProofShelfViewBuilder,
): Html =>
  h.ul(
    [h.Class('proof-shelf')],
    Array.map(SHELF_ROWS, difficulty => rowView(model, inputs, difficulty, h)),
  )

// THE STAMP

const crewView = (
  crew: ReadonlyArray<CrewMate>,
  h: ProofShelfViewBuilder,
): ReadonlyArray<Html> =>
  Array.map(crew, mate =>
    h.span(
      [h.Class('proof-mate')],
      [
        ...(mate.isBot ? [iconView('proof-bot', TIN_BOT_ICON, h)] : []),
        mate.name,
      ],
    ),
  )

const stampDetailView = (
  stamp: ProofStamp,
  h: ProofShelfViewBuilder,
): ReadonlyArray<Html> => [
  h.span(
    [h.Class('proof-ending'), h.DataAttribute('ending', stamp.ending)],
    [
      iconView('proof-ending-icon', STAMP_URLS[stamp.ending], h),
      PROOF_ENDING_NAMES[stamp.ending],
    ],
  ),
  h.span([h.Class('proof-wave')], [`WAVE ${stamp.wave}`]),
  h.span(
    [h.Class('proof-hero')],
    Option.match(callingOfCode(stamp.hero), {
      onNone: () => [],
      onSome: calling => [
        iconView('proof-hero-icon', PROP_ICONS[calling], h),
        h.span([h.Class('sr-only')], [CALLING_NAMES[calling]]),
      ],
    }),
  ),
  ...crewView(stamp.crew, h),
  ...(stamp.day === null
    ? []
    : [h.span([h.Class('proof-day')], [dayLabel(stamp.day)])]),
]

const pickedView = (
  inputs: ViewInputs,
  spot: ShelfSpot,
  h: ProofShelfViewBuilder,
): ReadonlyArray<Html> => {
  const maybeStamp = maybeStampAt(inputs.proof, spot)
  return [
    iconView(
      'proof-card-thing',
      thingIcon(spot.thing, Option.isSome(maybeStamp)),
      h,
    ),
    h.div(
      [h.Class('proof-card-text')],
      [
        h.p([h.Class('proof-card-name')], [thingName(spot.thing)]),
        h.p(
          [h.Class('proof-card-stamp')],
          Option.match(maybeStamp, {
            onNone: () => [h.span([h.Class('proof-not-yet')], ['NOT YET'])],
            onSome: stamp => stampDetailView(stamp, h),
          }),
        ),
        ...(Option.isSome(maybeStamp)
          ? [h.p([h.Class('proof-card-line')], [thingLine(spot.thing)])]
          : []),
      ],
    ),
  ]
}

// NOTE: nothing picked: the trophy and how full the shelf is.
const tallyView = (
  inputs: ViewInputs,
  h: ProofShelfViewBuilder,
): ReadonlyArray<Html> => [
  iconView('proof-card-thing', TROPHY_ICON, h),
  h.p(
    [h.Class('proof-card-tally')],
    [
      `${filledCount(inputs.proof, inputs.things)}/${slotCountOf(inputs.things)}`,
    ],
  ),
]

const cardView = (
  model: Model,
  inputs: ViewInputs,
  h: ProofShelfViewBuilder,
): Html =>
  h.div(
    [
      h.Class('proof-card'),
      h.AriaLive('polite'),
      h.DataAttribute(
        'picked',
        Option.isSome(model.maybePicked) ? 'true' : 'false',
      ),
    ],
    Option.match(model.maybePicked, {
      onNone: () => tallyView(inputs, h),
      onSome: spot => pickedView(inputs, spot, h),
    }),
  )

// THE CALENDAR

const calendarDayView = (
  month: DayStamp,
  day: number,
  inputs: ViewInputs,
  h: ProofShelfViewBuilder,
): Html => {
  const stamp = dayOfMonth(month, day)
  const isStamped = Array.contains(inputs.stampedDays, stamp)
  const isToday = Option.exists(inputs.maybeToday, today => today === stamp)
  return h.span(
    [
      h.Class('proof-day-cell'),
      h.DataAttribute('stamped', isStamped ? 'true' : 'false'),
      h.DataAttribute('today', isToday ? 'true' : 'false'),
    ],
    isStamped ? [iconView('proof-day-star', DAY_STAR_URL, h)] : [`${day}`],
  )
}

const calendarView = (
  inputs: ViewInputs,
  h: ProofShelfViewBuilder,
): ReadonlyArray<Html> =>
  Option.match(maybeCalendarDay(inputs.maybeToday, inputs.stampedDays), {
    onNone: () => [],
    onSome: month => {
      const stampedThisMonth = Array.filter(
        inputs.stampedDays,
        day => monthLabel(day) === monthLabel(month),
      ).length
      return [
        h.div(
          [
            h.Class('proof-calendar'),
            h.AriaLabel(
              `${monthLabel(month)}: ${stampedThisMonth} mission ${stampedThisMonth === 1 ? 'day' : 'days'} done`,
            ),
          ],
          [
            h.p(
              [h.Class('proof-month'), h.AriaHidden(true)],
              [monthLabel(month)],
            ),
            h.div(
              [
                h.Class('proof-days'),
                h.AriaHidden(true),
                h.Style({ '--first': `${firstWeekdayOf(month) + 1}` }),
              ],
              pipe(
                Array.range(1, daysInMonth(month)),
                Array.map(day => calendarDayView(month, day, inputs, h)),
              ),
            ),
          ],
        ),
      ]
    },
  })

// NOTE: the panel's body under the title the root's menu panel draws.
const view = ProofShelfComposition.makeView.withInputs<ViewInputs>(
  (model, inputs, h) =>
    h.div(
      [h.Class('proof-body')],
      [
        h.div(
          [h.Class('proof-house')],
          [
            shelfView(model, inputs, h),
            h.div(
              [h.Class('proof-side')],
              [cardView(model, inputs, h), ...calendarView(inputs, h)],
            ),
          ],
        ),
        h.div([h.Class('panel-actions')], [inputs.doneButton()]),
      ],
    ),
)

// NOTE: the shelf's view, gathered here so it is not exported alone: a
// view is a function of three arguments with no pipeable form, and Foldkit
// knows a view by its identity. src/features/proof/layer.ts completes it.
export const proofShelfImplementation = { view }
