import { Story } from 'foldkit'

import { describe, expect, it } from '@effect/vitest'

import { GuideBlock } from '../block'
import { InMessage } from '../inMessage'
import { GuideLayer } from '../layer'
import { Message } from '../message'
import { GuideStatus } from '../model'
import { FocusGuideControl } from '../steps'

// The shop guide Block on its own: it opens and closes when asked, turns
// its sections, goes back, and moves focus between BACK and the button
// that opened it, in each place it stands. The parents' sides are the
// shop's and the Munchopedia's (shopGuide.story.test.ts beside this, and
// src/features/munchopedia/__tests__/story.test.ts).

const GUIDE = { block: GuideBlock, layer: GuideLayer }

const focused = Story.Command.resolve(
  FocusGuideControl,
  Message.CompletedFocusControl(),
)

describe('the shop guide Block', () => {
  it.effect(
    'starts shut where it is placed, and a section tap while shut does nothing',
    () =>
      Story.story(
        GUIDE,
        Story.init('Shop'),
        Story.model(model => {
          expect(model.placement).toBe('Shop')
          expect(model.status).toEqual(GuideStatus.Closed())
        }),
        Story.message(Message.ClickedSectionButton({ section: 'Fridge' })),
        Story.message(Message.ClickedBackButton()),
        Story.Command.expectNone(),
        Story.model(model => {
          expect(model.status).toEqual(GuideStatus.Closed())
        }),
      ),
  )

  it.effect(
    'opens on the section asked for and focuses BACK; a section button turns it',
    () =>
      Story.story(
        GUIDE,
        Story.init('Shop'),
        Story.inMessage(InMessage.RequestedOpen({ section: 'Traps' })),
        Story.Command.expectExact(
          FocusGuideControl({ placement: 'Shop', target: 'Back' }),
        ),
        focused,
        Story.message(Message.ClickedSectionButton({ section: 'House' })),
        Story.Command.expectNone(),
        Story.model(model => {
          expect(model.status).toEqual(GuideStatus.Open({ section: 'House' }))
        }),
      ),
  )

  it.effect('BACK shuts it and gives focus back to what opened it', () =>
    Story.story(
      GUIDE,
      Story.init('Munchopedia'),
      Story.inMessage(InMessage.RequestedOpen({ section: 'Guns' })),
      Story.Command.expectExact(
        FocusGuideControl({ placement: 'Munchopedia', target: 'Back' }),
      ),
      focused,
      Story.message(Message.ClickedBackButton()),
      Story.Command.expectExact(
        FocusGuideControl({ placement: 'Munchopedia', target: 'Opener' }),
      ),
      focused,
      Story.model(model => {
        expect(model.status).toEqual(GuideStatus.Closed())
      }),
    ),
  )

  it.effect('the ? key toggles it, opening on the section asked for', () =>
    Story.story(
      GUIDE,
      Story.init('Shop'),
      Story.inMessage(InMessage.RequestedToggle({ section: 'Health' })),
      Story.Command.expectExact(
        FocusGuideControl({ placement: 'Shop', target: 'Back' }),
      ),
      focused,
      Story.model(model => {
        expect(model.status).toEqual(GuideStatus.Open({ section: 'Health' }))
      }),
      Story.inMessage(InMessage.RequestedToggle({ section: 'Guns' })),
      Story.Command.expectExact(
        FocusGuideControl({ placement: 'Shop', target: 'Opener' }),
      ),
      focused,
      Story.model(model => {
        expect(model.status).toEqual(GuideStatus.Closed())
      }),
    ),
  )

  it.effect(
    'a plain close is quiet, so its parent can focus what comes next',
    () =>
      Story.story(
        GUIDE,
        Story.init('Shop'),
        Story.inMessage(InMessage.RequestedOpen({ section: 'Fridge' })),
        focused,
        Story.inMessage(InMessage.RequestedClose()),
        Story.Command.expectNone(),
        Story.model(model => {
          expect(model.status).toEqual(GuideStatus.Closed())
        }),
      ),
  )
})
