import { Effect, Option } from 'effect'

import { Component } from '@effect/ui'
import { Story } from '@effect/ui/testing'
import { describe, expect, it } from '@effect/vitest'

import { FocusShelfSlot, ProofShelf } from '#features/proof/block.ts'
import { Message } from '#features/proof/message.ts'
import type { ProofShelfProps } from '#features/proof/model.ts'
import {
  FIRST_SPOT,
  type ShelfSpot,
  type ShelfThing,
  shelfThingsFor,
} from '#features/proof/proof.ts'
import { home } from '#test/model.fixture.ts'

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

const KEYS = '@effect/ui/html/document:"keydown"'

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
