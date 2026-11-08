import { Array, Function, String } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { MAX_PLAYERS } from '@munch/netcode'

import { iconView } from '../menuParts'
import { DOOR_ICON, POOF_ICON, portraitOf } from './icons'
import { seatLook } from './looks'
import type { Message } from './message'
import { RoomRequest } from './model'

// NOTE: co-op's moving art, all of it aria-hidden pictures that move inside
// boxes that stay put (src/motion.test.ts): the request in flight, the
// QUICK PLAY queue's rolling heads, and the dust where a player lands in a
// seat or leaves it. The motion is the stylesheet's (src/coop/coop.css).

const headView = (
  className: string,
  seat: number,
  h: HtmlBuilder<Message>,
): Html => iconView(`coop-portrait ${className}`, portraitOf(seatLook(seat)), h)

const WALKERS = 3

// NOTE: a new room: a door swings open and three heads hop to it and
// through, one after another, and again until the room answers.
const doorwayView = (h: HtmlBuilder<Message>): Html =>
  h.span(
    [h.Class('coop-doorway'), h.AriaHidden(true)],
    [
      ...Array.map(Array.range(0, WALKERS - 1), seat =>
        headView('coop-walker', seat, h),
      ),
      h.span(
        [h.Class('coop-door')],
        [
          h.span([h.Class('coop-door-light')]),
          iconView('coop-door-leaf', DOOR_ICON, h),
        ],
      ),
    ],
  )

// NOTE: joining by code: the typed code's tiles light one after another as
// if being checked, over the heads hopping in turn.
const checkingView = (code: string, h: HtmlBuilder<Message>): Html =>
  h.span(
    [h.Class('coop-checking'), h.AriaHidden(true)],
    [
      h.span(
        [h.Class('coop-check-tiles')],
        Array.map(String.split('')(code), symbol =>
          h.span([h.Class('coop-check-tile')], [symbol]),
        ),
      ),
      h.span(
        [h.Class('coop-bounce')],
        Array.map(Array.range(0, WALKERS - 1), seat =>
          headView('coop-bounce-head', seat, h),
        ),
      ),
    ],
  )

export const askingView: {
  (h: HtmlBuilder<Message>): (request: RoomRequest) => Html
  (request: RoomRequest, h: HtmlBuilder<Message>): Html
} = Function.dual(2, (request: RoomRequest, h: HtmlBuilder<Message>): Html =>
  RoomRequest.match(request, {
    Create: () =>
      h.keyed('div')(
        'asking-create',
        [
          h.Class('coop-asking'),
          h.DataAttribute('request', 'Create'),
          h.Role('status'),
          h.AriaLabel('Finding the room'),
        ],
        [doorwayView(h)],
      ),
    Join: ({ code }) =>
      h.keyed('div')(
        'asking-join',
        [
          h.Class('coop-asking'),
          h.DataAttribute('request', 'Join'),
          h.Role('status'),
          h.AriaLabel('Finding the room'),
        ],
        [checkingView(code, h)],
      ),
  }),
)

// NOTE: an empty QUICK PLAY seat rolls through the four seat looks like a
// slot machine, dimmed, while the queue looks for someone to fill it. The
// strip ends on the look it starts with, so the loop has no seam.
export const queueRollView = (h: HtmlBuilder<Message>): Html =>
  h.span(
    [h.Class('coop-roll'), h.AriaHidden(true)],
    [
      h.span(
        [h.Class('coop-roll-strip')],
        Array.map(Array.range(0, MAX_PLAYERS), seat =>
          headView('coop-roll-head', seat % MAX_PLAYERS, h),
        ),
      ),
    ],
  )

type Poof = 'Arrive' | 'Leave'

// NOTE: a puff of dust as a head lands in a seat (`Arrive`) or a seat empties
// (`Leave`). A seat that is empty when the lobby first shows never puffs:
// the seats' `--coop-settled` is 0 for their first moment (src/coop/coop.css).
export const poofView: {
  (h: HtmlBuilder<Message>): (kind: Poof) => Html
  (kind: Poof, h: HtmlBuilder<Message>): Html
} = Function.dual(2, (kind: Poof, h: HtmlBuilder<Message>): Html =>
  h.span(
    [h.Class('coop-poof'), h.DataAttribute('poof', kind), h.AriaHidden(true)],
    [iconView('coop-poof-cloud', POOF_ICON, h)],
  ),
)
