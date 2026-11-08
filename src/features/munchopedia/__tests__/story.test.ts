import { Story } from 'foldkit'

import { describe, expect, it } from '@effect/vitest'

import { resolveGuideFocus } from '../../../test/testing'
import { Message as GuideMessage } from '../../guide/message'
import { GuideStatus } from '../../guide/model'
import { FocusGuideControl } from '../../guide/steps'
import { GuideBinding } from '../bindings'
import { MunchopediaBlock } from '../block'
import { InMessage } from '../inMessage'
import { MunchopediaLayer } from '../layer'
import { Message, OutMessage } from '../message'
import { MunchopediaPage } from '../model'

// The Munchopedia Block on its own: its pages, the shop guide it holds for
// its Shop page, and the entry it reports opened. The root's side, which
// saves the entry and clears its NEW ENTRY, is in
// src/features/home/__tests__/home.story.test.ts.

const MUNCHOPEDIA = { block: MunchopediaBlock, layer: MunchopediaLayer }

const openShop = Story.steps(
  Story.message(Message.ClickedShopButton()),
  Story.Command.expectExact(
    FocusGuideControl({ placement: 'Munchopedia', target: 'Back' }),
  ),
  resolveGuideFocus,
)

describe('the Munchopedia Block', () => {
  it.effect('starts on the list with its guide shut and placed in it', () =>
    Story.story(
      MUNCHOPEDIA,
      Story.init(),
      Story.model(model => {
        expect(model.page).toEqual(MunchopediaPage.List())
        expect(model.guide.placement).toBe('Munchopedia')
        expect(model.guide.status).toEqual(GuideStatus.Closed())
      }),
    ),
  )

  it.effect(
    'a tile opens its entry and says so; BACK returns to the list',
    () =>
      Story.story(
        MUNCHOPEDIA,
        Story.init(),
        Story.message(Message.ClickedEntryButton({ kind: 'Tank' })),
        Story.expectOutMessage(OutMessage.OpenedEntry({ kind: 'Tank' })),
        Story.model(model => {
          expect(model.page).toEqual(MunchopediaPage.Entry({ kind: 'Tank' }))
        }),
        Story.message(Message.ClickedListButton()),
        Story.expectNoOutMessage(),
        Story.model(model => {
          expect(model.page).toEqual(MunchopediaPage.List())
        }),
      ),
  )

  it.effect(
    'the Shop tile opens its guide on Guns, which turns and goes back on its own',
    () =>
      Story.story(
        MUNCHOPEDIA,
        Story.init(),
        openShop,
        Story.expectNoOutMessage(),
        Story.messageIn(
          GuideBinding,
          GuideMessage.ClickedSectionButton({ section: 'Fridge' }),
        ),
        Story.model(model => {
          expect(model.guide.status).toEqual(
            GuideStatus.Open({ section: 'Fridge' }),
          )
        }),
        Story.messageIn(GuideBinding, GuideMessage.ClickedBackButton()),
        Story.Command.expectExact(
          FocusGuideControl({ placement: 'Munchopedia', target: 'Opener' }),
        ),
        resolveGuideFocus,
        Story.model(model => {
          expect(model.guide.status).toEqual(GuideStatus.Closed())
          expect(model.page).toEqual(MunchopediaPage.List())
        }),
      ),
  )

  it.effect('opening afresh on an entry says so and puts the guide away', () =>
    Story.story(
      MUNCHOPEDIA,
      Story.init(),
      openShop,
      Story.inMessage(
        InMessage.RequestedOpen({
          page: MunchopediaPage.Entry({ kind: 'Runner' }),
        }),
      ),
      Story.expectOutMessage(OutMessage.OpenedEntry({ kind: 'Runner' })),
      Story.Command.expectNone(),
      Story.model(model => {
        expect(model.page).toEqual(MunchopediaPage.Entry({ kind: 'Runner' }))
        expect(model.guide.status).toEqual(GuideStatus.Closed())
      }),
    ),
  )

  it.effect('opening afresh on the list says nothing', () =>
    Story.story(
      MUNCHOPEDIA,
      Story.init(),
      Story.message(Message.ClickedEntryButton({ kind: 'Shambler' })),
      Story.inMessage(
        InMessage.RequestedOpen({ page: MunchopediaPage.List() }),
      ),
      Story.expectNoOutMessage(),
      Story.model(model => {
        expect(model.page).toEqual(MunchopediaPage.List())
      }),
    ),
  )
})
