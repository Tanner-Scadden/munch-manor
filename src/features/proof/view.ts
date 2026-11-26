import { Array, Option, pipe } from 'effect'

import type { View } from '@effect/ui'
import type { Html } from '@effect/ui/html'

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
import { Message } from './message'
import type { Model, ProofShelfProps } from './model'
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

type H = Html.H<Message>
type Content = View.Content<Message>

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
  props: ProofShelfProps,
  spot: ShelfSpot,
  h: H,
): Content => {
  const maybeStamp = maybeStampAt(props.proof, spot)
  const isFilled = Option.isSome(maybeStamp)
  return h.button
    .attr('type', 'button')
    .id(slotId(spot))
    .class(isBigKey(spot.thing) ? 'proof-slot proof-hook' : 'proof-slot')
    .attr('data-filled', isFilled ? 'true' : 'false')
    .attr('aria-pressed', String(isPicked(model, spot) ? 'true' : 'false'))
    .attr('aria-label', slotLabel(spot, maybeStamp))
    .on('click', Message.ClickedSlot({ spot }))
    .children(
      iconView('proof-thing', thingIcon(spot.thing, isFilled), h),
      ...Option.match(maybeStamp, {
        onNone: () => [],
        onSome: stamp => [iconView('proof-stamp', STAMP_URLS[stamp.ending], h)],
      }),
      ...(Array.contains(props.fresh, spotUnlockId(spot))
        ? [
            h.span
              .class('proof-new')
              .attr('aria-hidden', 'true')
              .children('NEW'),
          ]
        : []),
    )
}

const rowView = (
  model: Model,
  props: ProofShelfProps,
  difficulty: Difficulty,
  h: H,
): Content =>
  h.li
    .class('proof-row')
    .attr('data-difficulty', difficulty)
    .children(
      h.span
        .class('proof-row-mark')
        .children(
          iconView('proof-skull', SKULL_ICONS[difficulty], h),
          h.span.class('sr-only').children(DIFFICULTIES[difficulty].name),
          ...dareMarkBadgeView(
            props.dareMarks[difficulty],
            'proof-row-dare-mark',
            h,
          ),
        ),
      h.div
        .class('proof-slots')
        .style({ '--shelf-things': `${props.things.length}` })
        .children(
          Array.map(props.things, thing =>
            slotView(model, props, { thing, difficulty }, h),
          ),
        ),
      h.span
        .class('proof-plank')
        .attr('aria-hidden', 'true')
        .children(
          iconView('proof-board', PLANK_URL, h),
          iconView('proof-bracket proof-bracket-left', BRACKET_URL, h),
          iconView('proof-bracket proof-bracket-right', BRACKET_URL, h),
        ),
    )

const shelfView = (model: Model, props: ProofShelfProps, h: H): Content =>
  h.ul
    .class('proof-shelf')
    .children(
      Array.map(SHELF_ROWS, difficulty => rowView(model, props, difficulty, h)),
    )

// THE STAMP

const crewView = (
  crew: ReadonlyArray<CrewMate>,
  h: H,
): ReadonlyArray<Content> =>
  Array.map(crew, mate =>
    h.span
      .class('proof-mate')
      .children(
        ...(mate.isBot ? [iconView('proof-bot', TIN_BOT_ICON, h)] : []),
        mate.name,
      ),
  )

const stampDetailView = (stamp: ProofStamp, h: H): ReadonlyArray<Content> => [
  h.span
    .class('proof-ending')
    .attr('data-ending', stamp.ending)
    .children(
      iconView('proof-ending-icon', STAMP_URLS[stamp.ending], h),
      PROOF_ENDING_NAMES[stamp.ending],
    ),
  h.span.class('proof-wave').children(`WAVE ${stamp.wave}`),
  h.span.class('proof-hero').children(
    Option.match(callingOfCode(stamp.hero), {
      onNone: () => [],
      onSome: calling => [
        iconView('proof-hero-icon', PROP_ICONS[calling], h),
        h.span.class('sr-only').children(CALLING_NAMES[calling]),
      ],
    }),
  ),
  ...crewView(stamp.crew, h),
  ...(stamp.day === null
    ? []
    : [h.span.class('proof-day').children(dayLabel(stamp.day))]),
]

const pickedView = (
  props: ProofShelfProps,
  spot: ShelfSpot,
  h: H,
): ReadonlyArray<Content> => {
  const maybeStamp = maybeStampAt(props.proof, spot)
  return [
    iconView(
      'proof-card-thing',
      thingIcon(spot.thing, Option.isSome(maybeStamp)),
      h,
    ),
    h.div.class('proof-card-text').children(
      h.p.class('proof-card-name').children(thingName(spot.thing)),
      h.p.class('proof-card-stamp').children(
        Option.match(maybeStamp, {
          onNone: () => [h.span.class('proof-not-yet').children('NOT YET')],
          onSome: stamp => stampDetailView(stamp, h),
        }),
      ),
      ...(Option.isSome(maybeStamp)
        ? [h.p.class('proof-card-line').children(thingLine(spot.thing))]
        : []),
    ),
  ]
}

// NOTE: nothing picked: the trophy and how full the shelf is.
const tallyView = (props: ProofShelfProps, h: H): ReadonlyArray<Content> => [
  iconView('proof-card-thing', TROPHY_ICON, h),
  h.p
    .class('proof-card-tally')
    .children(
      `${filledCount(props.proof, props.things)}/${slotCountOf(props.things)}`,
    ),
]

const cardView = (model: Model, props: ProofShelfProps, h: H): Content =>
  h.div
    .class('proof-card')
    .attr('aria-live', 'polite')
    .attr('data-picked', Option.isSome(model.maybePicked) ? 'true' : 'false')
    .children(
      Option.match(model.maybePicked, {
        onNone: () => tallyView(props, h),
        onSome: spot => pickedView(props, spot, h),
      }),
    )

// THE CALENDAR

const calendarDayView = (
  month: DayStamp,
  day: number,
  props: ProofShelfProps,
  h: H,
): Content => {
  const stamp = dayOfMonth(month, day)
  const isStamped = Array.contains(props.stampedDays, stamp)
  const isToday = Option.exists(props.maybeToday, today => today === stamp)
  return h.span
    .class('proof-day-cell')
    .attr('data-stamped', isStamped ? 'true' : 'false')
    .attr('data-today', isToday ? 'true' : 'false')
    .children(
      isStamped ? [iconView('proof-day-star', DAY_STAR_URL, h)] : [`${day}`],
    )
}

const calendarView = (props: ProofShelfProps, h: H): ReadonlyArray<Content> =>
  Option.match(maybeCalendarDay(props.maybeToday, props.stampedDays), {
    onNone: () => [],
    onSome: month => {
      const stampedThisMonth = Array.filter(
        props.stampedDays,
        day => monthLabel(day) === monthLabel(month),
      ).length
      return [
        h.div
          .class('proof-calendar')
          .attr(
            'aria-label',
            `${monthLabel(month)}: ${stampedThisMonth} mission ${stampedThisMonth === 1 ? 'day' : 'days'} done`,
          )
          .children(
            h.p
              .class('proof-month')
              .attr('aria-hidden', 'true')
              .children(monthLabel(month)),
            h.div
              .class('proof-days')
              .attr('aria-hidden', 'true')
              .style({ '--first': `${firstWeekdayOf(month) + 1}` })
              .children(
                pipe(
                  Array.range(1, daysInMonth(month)),
                  Array.map(day => calendarDayView(month, day, props, h)),
                ),
              ),
          ),
      ]
    },
  })

// NOTE: the panel's body under the title the root's menu panel draws, the
// panel's Done (the `done` slot) in its actions row.
export const proofShelfView = ({
  h,
  model,
  props,
  done,
}: Readonly<{
  h: H
  model: Model
  props: ProofShelfProps
  done: View.Outlet
}>): Content =>
  h.div
    .class('proof-body')
    .children(
      h.div
        .class('proof-house')
        .children(
          shelfView(model, props, h),
          h.div
            .class('proof-side')
            .children(cardView(model, props, h), calendarView(props, h)),
        ),
      h.div.class('panel-actions').children(done),
    )
