import { Option } from 'effect'
import { Story } from 'foldkit'

import { describe, expect, it } from '@effect/vitest'

import { ProofShelfBlock } from '../block'
import { InMessage } from '../inMessage'
import { ProofShelfLayer } from '../layer'
import { Message } from '../message'
import { FIRST_SPOT, type ShelfSpot, shelfThingsFor } from '../proof'
import { FocusShelfSlot } from '../steps'

// The Proof Shelf Block on its own: a tapped slot is picked, the arrows
// walk the shelf with wrapping, and opening it again starts with nothing
// picked. What goes on the shelf is the root's (proof.story.test.ts).

const SHELF = { block: ProofShelfBlock, layer: ProofShelfLayer }

const HOUSE_SHELF = shelfThingsFor([])

const press = (code: string, spot: ShelfSpot, things = HOUSE_SHELF) =>
  Story.steps(
    Story.inMessage(InMessage.RequestedPressKey({ code, things })),
    Story.Command.expectExact(FocusShelfSlot({ spot })),
    Story.Command.resolve(FocusShelfSlot, Message.CompletedFocusSlot()),
  )

const MUSIC_BOX_HARD: ShelfSpot = { thing: 'MusicBox', difficulty: 'Hard' }

describe('the Proof Shelf Block', () => {
  it.effect('starts with nothing picked; a tap picks a slot', () =>
    Story.story(
      SHELF,
      Story.init(),
      Story.model(model => {
        expect(model.maybePicked).toEqual(Option.none())
      }),
      Story.message(Message.ClickedSlot({ spot: MUSIC_BOX_HARD })),
      Story.Command.expectNone(),
      Story.model(model => {
        expect(model.maybePicked).toEqual(Option.some(MUSIC_BOX_HARD))
      }),
    ),
  )

  it.effect('the arrows walk from the first slot and wrap at the ends', () =>
    Story.story(
      SHELF,
      Story.init(),
      press('ArrowLeft', {
        thing: 'BigKey',
        difficulty: FIRST_SPOT.difficulty,
      }),
      press('ArrowRight', FIRST_SPOT),
      press('ArrowUp', { thing: FIRST_SPOT.thing, difficulty: 'Nightmare' }),
      press('ArrowDown', FIRST_SPOT),
      Story.model(model => {
        expect(model.maybePicked).toEqual(Option.some(FIRST_SPOT))
      }),
    ),
  )

  it.effect('an opened thing grows a slot the arrows walk onto', () =>
    Story.story(
      SHELF,
      Story.init(),
      Story.message(
        Message.ClickedSlot({
          spot: { thing: 'ButlersBell', difficulty: 'Easy' },
        }),
      ),
      press(
        'ArrowRight',
        { thing: 'NapkinRing', difficulty: 'Easy' },
        shelfThingsFor(['NapkinRing']),
      ),
      press(
        'ArrowRight',
        { thing: 'BigKey', difficulty: 'Easy' },
        shelfThingsFor(['NapkinRing']),
      ),
    ),
  )

  it.effect('any other key is left to the root', () =>
    Story.story(
      SHELF,
      Story.init(),
      Story.inMessage(
        InMessage.RequestedPressKey({ code: 'KeyQ', things: HOUSE_SHELF }),
      ),
      Story.Command.expectNone(),
      Story.model(model => {
        expect(model.maybePicked).toEqual(Option.none())
      }),
    ),
  )

  it.effect('opening again puts the pick away', () =>
    Story.story(
      SHELF,
      Story.init(),
      Story.message(Message.ClickedSlot({ spot: MUSIC_BOX_HARD })),
      Story.inMessage(InMessage.RequestedOpen()),
      Story.model(model => {
        expect(model.maybePicked).toEqual(Option.none())
      }),
    ),
  )
})
