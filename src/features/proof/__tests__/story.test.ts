import { Effect, Option } from 'effect'

import { Component } from '@effect/ui'
import { Story } from '@effect/ui/testing'
import { describe, expect, it } from '@effect/vitest'

import { home } from '../../../test/model.fixture'
import { FocusShelfSlot, ProofShelf } from '../block'
import { Message } from '../message'
import type { ProofShelfProps } from '../model'
import {
  FIRST_SPOT,
  type ShelfSpot,
  type ShelfThing,
  shelfThingsFor,
} from '../proof'

// The Proof Shelf component on its own: a tapped slot is picked, the arrows
// (its own Subscription) walk the shelf with wrapping, and a fresh mount
// starts with nothing picked. What goes on the shelf is the root's
// (proof.story.test.ts).

type ShelfStory = Story.Steps<typeof ProofShelf>

const HOUSE_SHELF = shelfThingsFor([])

const propsWith = (
  things: readonly [ShelfThing, ...Array<ShelfThing>],
): ProofShelfProps => ({
  proof: home.proof,
  things,
  stampedDays: [],
  maybeToday: Option.none(),
  fresh: [],
  dareMarks: home.dareMarks,
})

const shelfOf = (things = HOUSE_SHELF) =>
  Story.make(ProofShelf, propsWith(things))

// NOTE: the key of the shelf's arrow keys, its one Subscription
// (`HtmlSubscription.shortcuts`, on the document's keydown).
const KEYS = '@effect/ui/html/document:"keydown"'

// NOTE: an arrow from the shelf's own key Subscription picks the slot it
// reaches, and focus moves onto it.
const press =
  (code: string, spot: ShelfSpot) =>
  (s: ShelfStory): ShelfStory =>
    s
      .subscription(KEYS, Message.PressedArrowKey({ code }))
      .expectExact(FocusShelfSlot.make({ spot }))
      .resolve(FocusShelfSlot, Component.noop)

const MUSIC_BOX_HARD: ShelfSpot = { thing: 'MusicBox', difficulty: 'Hard' }

describe('the Proof Shelf component', () => {
  it.effect('starts with nothing picked; a tap picks a slot', () =>
    Effect.gen(function* () {
      const s = yield* shelfOf()
      expect(s.model.maybePicked).toEqual(Option.none())
      s.send(Message.ClickedSlot({ spot: MUSIC_BOX_HARD })).expectNone()
      expect(s.model.maybePicked).toEqual(Option.some(MUSIC_BOX_HARD))
    }),
  )

  it.effect('the arrows walk from the first slot and wrap at the ends', () =>
    Effect.gen(function* () {
      const s = yield* shelfOf()
      s.pipe(
        press('ArrowLeft', {
          thing: 'BigKey',
          difficulty: FIRST_SPOT.difficulty,
        }),
        press('ArrowRight', FIRST_SPOT),
        press('ArrowUp', { thing: FIRST_SPOT.thing, difficulty: 'Nightmare' }),
        press('ArrowDown', FIRST_SPOT),
      )
      expect(s.model.maybePicked).toEqual(Option.some(FIRST_SPOT))
    }),
  )

  it.effect('an opened thing grows a slot the arrows walk onto', () =>
    Effect.gen(function* () {
      const s = yield* shelfOf(shelfThingsFor(['NapkinRing']))
      s.send(
        Message.ClickedSlot({
          spot: { thing: 'ButlersBell', difficulty: 'Easy' },
        }),
      ).pipe(
        press('ArrowRight', { thing: 'NapkinRing', difficulty: 'Easy' }),
        press('ArrowRight', { thing: 'BigKey', difficulty: 'Easy' }),
      )
    }),
  )

  it.effect('any other key is left to the root', () =>
    Effect.gen(function* () {
      const s = yield* shelfOf()
      s.send(Message.PressedArrowKey({ code: 'KeyQ' })).expectNone()
      expect(s.model.maybePicked).toEqual(Option.none())
    }),
  )

  // NOTE: the panel mounts the shelf afresh each time it opens on it
  // (src/app/dialogs.ts), so opening again is a new mount, its init.
  it.effect('opening again puts the pick away', () =>
    Effect.gen(function* () {
      const opened = yield* shelfOf()
      opened.send(Message.ClickedSlot({ spot: MUSIC_BOX_HARD }))
      expect(opened.model.maybePicked).toEqual(Option.some(MUSIC_BOX_HARD))
      const again = yield* shelfOf()
      expect(again.model.maybePicked).toEqual(Option.none())
    }),
  )

  it.effect('its arrow keys are its own Subscription while it is up', () =>
    Effect.gen(function* () {
      const s = yield* shelfOf()
      expect(s.subscriptions).toEqual([KEYS])
    }),
  )
})
