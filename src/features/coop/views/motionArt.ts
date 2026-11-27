import { Array, Function, String } from 'effect'

import { MAX_PLAYERS } from '@munch/netcode'

import type { ApplicationHtml, ApplicationViewBuilder } from '#app/component.ts'
import { DOOR_ICON, POOF_ICON, portraitOf } from '#art/icons/coopIcons.ts'
import { seatLook } from '#art/seatLooks.ts'
import { RoomRequest } from '#domain/coopRoom.ts'
import { iconView } from '#ui/menuParts.ts'

const headView = (
  className: string,
  seat: number,
  h: ApplicationViewBuilder,
): ApplicationHtml =>
  iconView(`coop-portrait ${className}`, portraitOf(seatLook(seat)), h)

const WALKERS = 3

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

export const poofView: {
  (h: ApplicationViewBuilder): (kind: Poof) => ApplicationHtml
  (kind: Poof, h: ApplicationViewBuilder): ApplicationHtml
} = Function.dual(2, (kind: Poof, h: ApplicationViewBuilder): ApplicationHtml =>
  h.span
    .class('coop-poof')
    .attrs({ 'data-poof': kind, 'aria-hidden': 'true' })
    .children(iconView('coop-poof-cloud', POOF_ICON, h)),
)
