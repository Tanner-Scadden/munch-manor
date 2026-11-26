import { Effect } from 'effect'

import { HtmlLocator, HtmlScene } from '@effect/ui/html/testing'
import { Story } from '@effect/ui/testing'
import { describe, expect, it } from '@effect/vitest'

import { defaultAppearance } from '../../../domain/clientSchema'
import { HeroPicker, type HeroPickerProps } from '../block'
import { Events, Message } from '../message'

// The hero picker on its own: it holds no state, and each tap asks its
// parent, which owns whether it is drawn, the hero tried on, and every rule.
// The parents' sides are the solo lobby's
// (src/features/lobby/__tests__/story.test.ts, heroBuy.story.test.ts) and
// co-op's (src/features/coop/__tests__/lobbyEdits.story.test.ts).

const PROPS: HeroPickerProps = {
  look: defaultAppearance,
  chosen: 'You',
  trying: null,
  rank: 10,
  bought: [],
  bones: 500,
  fresh: [],
  layout: 'Panel',
}

const TRYING: HeroPickerProps = { ...PROPS, trying: 'TrackStar' }

const buyButton = HtmlLocator.role('button', { name: /^Buy/ })

describe('the hero picker', () => {
  it.effect('a card asks the parent, and changes nothing by itself', () =>
    Effect.gen(function* () {
      const s = yield* Story.make(HeroPicker, PROPS)
      s.send(Message.ClickedCard({ calling: 'TrackStar' })).emitted(
        Events.Picked({ calling: 'TrackStar' }),
      )
      expect(s.model).toEqual({})
    }),
  )

  it.effect('BUY shows only on a hero tried on, and asks for that hero', () =>
    Effect.gen(function* () {
      const closed = yield* HtmlScene.make(HeroPicker, PROPS)
      closed.expect(buyButton).toBeAbsent()
      const s = yield* HtmlScene.make(HeroPicker, TRYING)
      s.click(buyButton).emitted(Events.RequestedBuy({ calling: 'TrackStar' }))
    }),
  )

  it.effect('the close button asks to close', () =>
    Effect.gen(function* () {
      const s = yield* HtmlScene.make(HeroPicker, PROPS)
      s.click(HtmlLocator.role('button', { name: 'Close' })).emitted(
        Events.RequestedClose(),
      )
    }),
  )

  it.effect('Escape and Y ask to close; other keys wait', () =>
    Effect.gen(function* () {
      const s = yield* HtmlScene.make(HeroPicker, PROPS)
      s.fireDocument('keydown', { key: 'Enter' })
        .expectIgnored()
        .fireDocument('keydown', { key: 'Escape' })
        .emitted(Events.RequestedClose())
        .fireDocument('keydown', { key: 'y' })
        .emitted(Events.RequestedClose())
    }),
  )
})
