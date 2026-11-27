import { Effect } from 'effect'

import { Component } from '@effect/ui'
import { Story } from '@effect/ui/testing'
import { describe, expect, it, test } from '@effect/vitest'

import { GuideStatus, openedGuide, withSection } from '#features/guide/model.ts'
import { HOME_PROPS } from '#features/munchopedia/__tests__/munchopedia.fixture.ts'
import { FocusGuideControl, Munchopedia } from '#features/munchopedia/block.ts'
import { Message } from '#features/munchopedia/message.ts'

describe('the shop guide', () => {
  it.effect(
    'starts shut, and a section tap or BACK while shut does nothing',
    () =>
      Effect.gen(function* () {
        const s = yield* Story.make(Munchopedia, HOME_PROPS)
        expect(s.model.guide).toEqual(GuideStatus.Closed())
        s.send(Message.ClickedGuideSectionButton({ section: 'Fridge' }))
          .send(Message.ClickedGuideBackButton())
          .expectNone()
        expect(s.model.guide).toEqual(GuideStatus.Closed())
        expect(s.current.emitted).toEqual([])
      }),
  )

  it.effect('opens on Guns and focuses BACK; a section button turns it', () =>
    Effect.gen(function* () {
      const s = yield* Story.make(Munchopedia, HOME_PROPS)
      s.send(Message.ClickedShopButton())
        .expectExact(FocusGuideControl.make({ target: 'Back' }))
        .resolve(FocusGuideControl, Component.noop)
        .send(Message.ClickedGuideSectionButton({ section: 'House' }))
        .expectNone()
      expect(s.model.guide).toEqual(GuideStatus.Open({ section: 'House' }))
    }),
  )

  it.effect('BACK shuts it and gives focus back to what opened it', () =>
    Effect.gen(function* () {
      const s = yield* Story.make(Munchopedia, HOME_PROPS)
      s.send(Message.ClickedShopButton())
        .expectExact(FocusGuideControl.make({ target: 'Back' }))
        .resolve(FocusGuideControl, Component.noop)
        .send(Message.ClickedGuideBackButton())
        .expectExact(FocusGuideControl.make({ target: 'Opener' }))
        .resolve(FocusGuideControl, Component.noop)
      expect(s.model.guide).toEqual(GuideStatus.Closed())
    }),
  )

  test('a section turns an open guide and leaves a shut one shut', () => {
    expect(withSection('Traps')(openedGuide)).toEqual(
      GuideStatus.Open({ section: 'Traps' }),
    )
    expect(withSection('Traps')(GuideStatus.Closed())).toEqual(
      GuideStatus.Closed(),
    )
  })
})
