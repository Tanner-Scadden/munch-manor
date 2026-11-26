import { Array, Function, String } from 'effect'

import { MAX_PLAYERS } from '@munch/netcode'

import type {
  ApplicationHtml,
  ApplicationViewBuilder,
} from '../../app/definition'
import { DOOR_ICON, POOF_ICON, portraitOf } from '../../art/coopIcons'
import { seatLook } from '../../art/seatLooks'
import { RoomRequest } from '../../domain/coopRoom'
import { iconView } from '../../ui/menuParts'

// NOTE: co-op's moving art, all of it aria-hidden pictures that move inside
// boxes that stay put (src/app/__tests__/motion.test.ts): the request in flight, the
// QUICK PLAY queue's rolling heads, and the dust where a player lands in a
// seat or leaves it. The motion is the stylesheet's (src/features/coop/coop.css).

const headView = (
  className: string,
  seat: number,
  h: ApplicationViewBuilder,
): ApplicationHtml =>
  iconView(`coop-portrait ${className}`, portraitOf(seatLook(seat)), h)

const WALKERS = 3

// NOTE: a new room: a door swings open and three heads hop to it and
// through, one after another, and again until the room answers.
const doorwayView = (h: ApplicationViewBuilder): ApplicationHtml =>
  h.span
    .class('coop-doorway')
    .attr('aria-hidden', 'true')
    .children(
      Array.map(Array.range(0, WALKERS - 1), seat =>
        headView('coop-walker', seat, h),
      ),
      h.span
        .class('coop-door')
        .children(
          h.span.class('coop-door-light'),
          iconView('coop-door-leaf', DOOR_ICON, h),
        ),
    )

// NOTE: joining by code: the typed code's tiles light one after another as
// if being checked, over the heads hopping in turn.
const checkingView = (
  code: string,
  h: ApplicationViewBuilder,
): ApplicationHtml =>
  h.span
    .class('coop-checking')
    .attr('aria-hidden', 'true')
    .children(
      h.span
        .class('coop-check-tiles')
        .children(
          Array.map(String.split('')(code), symbol =>
            h.span.class('coop-check-tile').children(symbol),
          ),
        ),
      h.span
        .class('coop-bounce')
        .children(
          Array.map(Array.range(0, WALKERS - 1), seat =>
            headView('coop-bounce-head', seat, h),
          ),
        ),
    )

export const askingView: {
  (h: ApplicationViewBuilder): (request: RoomRequest) => ApplicationHtml
  (request: RoomRequest, h: ApplicationViewBuilder): ApplicationHtml
} = Function.dual(
  2,
  (request: RoomRequest, h: ApplicationViewBuilder): ApplicationHtml =>
    RoomRequest.match(request, {
      Create: () =>
        h.div
          .key('asking-create')
          .class('coop-asking')
          .attrs({
            'data-request': 'Create',
            role: 'status',
            'aria-label': 'Finding the room',
          })
          .children(doorwayView(h)),
      Join: ({ code }) =>
        h.div
          .key('asking-join')
          .class('coop-asking')
          .attrs({
            'data-request': 'Join',
            role: 'status',
            'aria-label': 'Finding the room',
          })
          .children(checkingView(code, h)),
    }),
)

// NOTE: an empty QUICK PLAY seat rolls through the four seat looks like a
// slot machine, dimmed, while the queue looks for someone to fill it. The
// strip ends on the look it starts with, so the loop has no seam.
export const queueRollView = (h: ApplicationViewBuilder): ApplicationHtml =>
  h.span
    .class('coop-roll')
    .attr('aria-hidden', 'true')
    .children(
      h.span
        .class('coop-roll-strip')
        .children(
          Array.map(Array.range(0, MAX_PLAYERS), seat =>
            headView('coop-roll-head', seat % MAX_PLAYERS, h),
          ),
        ),
    )

type Poof = 'Arrive' | 'Leave'

// NOTE: a puff of dust as a head lands in a seat (`Arrive`) or a seat empties
// (`Leave`). A seat that is empty when the lobby first shows never puffs:
// the seats' `--coop-settled` is 0 for their first moment (src/features/coop/coop.css).
export const poofView: {
  (h: ApplicationViewBuilder): (kind: Poof) => ApplicationHtml
  (kind: Poof, h: ApplicationViewBuilder): ApplicationHtml
} = Function.dual(2, (kind: Poof, h: ApplicationViewBuilder): ApplicationHtml =>
  h.span
    .class('coop-poof')
    .attrs({ 'data-poof': kind, 'aria-hidden': 'true' })
    .children(iconView('coop-poof-cloud', POOF_ICON, h)),
)
