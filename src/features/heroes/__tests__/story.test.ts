import { Option } from 'effect'
import { Story } from 'foldkit'

import { describe, expect, it } from '@effect/vitest'

import { HeroPickerBlock } from '../block'
import { InMessage, PickOutcome } from '../inMessage'
import { HeroPickerLayer } from '../layer'
import { Message, OutMessage } from '../message'

// The hero picker Block on its own: it opens and closes when asked, asks its
// parent about a card or BUY, and plays the parent's answer. The parents'
// sides are the solo lobby's (src/features/lobby/__tests__/story.test.ts)
// and co-op's (src/features/coop/__tests__/lobbyEdits.story.test.ts).

const PICKER = { block: HeroPickerBlock, layer: HeroPickerLayer }

const opened = Story.inMessage(InMessage.RequestedOpen())

const answered = (outcome: PickOutcome) =>
  Story.inMessage(InMessage.InformedOfOutcome({ outcome }))

describe('the hero picker Block', () => {
  it.effect('starts closed, and a tap while closed asks nothing', () =>
    Story.story(
      PICKER,
      Story.init(),
      Story.model(model => {
        expect(model.status).toBe('Closed')
      }),
      Story.message(Message.ClickedCard({ calling: 'Handyman' })),
      Story.expectNoOutMessage(),
    ),
  )

  it.effect('a card asks the parent, and changes nothing by itself', () =>
    Story.story(
      PICKER,
      Story.init(),
      opened,
      Story.message(Message.ClickedCard({ calling: 'TrackStar' })),
      Story.expectOutMessage(OutMessage.PickedCard({ calling: 'TrackStar' })),
      Story.model(model => {
        expect(model.status).toBe('Open')
        expect(model.maybeTrying).toEqual(Option.none())
      }),
    ),
  )

  it.effect('a hero tried on waits for BUY, which asks for that hero', () =>
    Story.story(
      PICKER,
      Story.init(),
      opened,
      Story.message(Message.ClickedBuyButton()),
      Story.expectNoOutMessage(),
      answered(PickOutcome.TriedOn({ calling: 'TrackStar' })),
      Story.model(model => {
        expect(model.maybeTrying).toEqual(Option.some('TrackStar'))
      }),
      Story.message(Message.ClickedBuyButton()),
      Story.expectOutMessage(OutMessage.ClickedBuy({ calling: 'TrackStar' })),
    ),
  )

  it.effect('too few Bones keeps the try-on; a refusal ends it', () =>
    Story.story(
      PICKER,
      Story.init(),
      opened,
      answered(PickOutcome.TriedOn({ calling: 'TrackStar' })),
      answered(PickOutcome.Unchanged()),
      Story.model(model => {
        expect(model.maybeTrying).toEqual(Option.some('TrackStar'))
      }),
      answered(PickOutcome.TryOnEnded()),
      Story.model(model => {
        expect(model.maybeTrying).toEqual(Option.none())
        expect(model.status).toBe('Open')
      }),
    ),
  )

  it.effect('a hero worn closes it and ends the try-on', () =>
    Story.story(
      PICKER,
      Story.init(),
      opened,
      answered(PickOutcome.TriedOn({ calling: 'TrackStar' })),
      answered(PickOutcome.Worn({ calling: 'TrackStar' })),
      Story.expectNoOutMessage(),
      Story.model(model => {
        expect(model.status).toBe('Closed')
        expect(model.maybeTrying).toEqual(Option.none())
      }),
    ),
  )

  it.effect('the close button closes it and says so', () =>
    Story.story(
      PICKER,
      Story.init(),
      opened,
      Story.message(Message.ClickedCloseButton()),
      Story.expectOutMessage(OutMessage.Closed()),
      Story.model(model => {
        expect(model.status).toBe('Closed')
      }),
    ),
  )

  it.effect('Escape and Y close it and say so; other keys wait', () =>
    Story.story(
      PICKER,
      Story.init(),
      opened,
      Story.inMessage(InMessage.RequestedPressKey({ code: 'Enter' })),
      Story.expectNoOutMessage(),
      Story.model(model => {
        expect(model.status).toBe('Open')
      }),
      Story.inMessage(InMessage.RequestedPressKey({ code: 'Escape' })),
      Story.expectOutMessage(OutMessage.Closed()),
      opened,
      Story.inMessage(InMessage.RequestedPressKey({ code: 'KeyY' })),
      Story.expectOutMessage(OutMessage.Closed()),
      Story.model(model => {
        expect(model.status).toBe('Closed')
      }),
    ),
  )

  it.effect('an answer that comes after it closed changes nothing', () =>
    Story.story(
      PICKER,
      Story.init(),
      answered(PickOutcome.TriedOn({ calling: 'Handyman' })),
      Story.model(model => {
        expect(model.maybeTrying).toEqual(Option.none())
      }),
    ),
  )
})
