import { Effect } from 'effect'

import { Component } from '@effect/ui'
import { Story } from '@effect/ui/testing'
import { describe, expect, it } from '@effect/vitest'

import { GuideStatus } from '../../guide/model'
import { FocusGuideControl, Munchopedia } from '../block'
import { Message, MunchopediaEvents } from '../message'
import { MunchopediaPage } from '../model'
import { HOME_PROPS } from './munchopedia.fixture'

// The Munchopedia component on its own: the pages it asks the root for,
// the shop guide it holds for its Shop page, and the entry it reports
// opened. The root owns the page and hands it down; the root's side, which
// saves the entry and clears its NEW ENTRY, is in
// src/features/home/__tests__/home.story.test.ts.

type MunchopediaStory = Story.Steps<typeof Munchopedia>

const openShop = (s: MunchopediaStory): MunchopediaStory =>
  s
    .send(Message.ClickedShopButton())
    .expectExact(FocusGuideControl.make({ target: 'Back' }))
    .resolve(FocusGuideControl, Component.noop)

const changedTo = (page: MunchopediaPage) =>
  MunchopediaEvents.ChangedPage({ page })

describe('the Munchopedia component', () => {
  it.effect('starts with its guide shut, saying nothing', () =>
    Effect.gen(function* () {
      const s = yield* Story.make(Munchopedia, HOME_PROPS)
      expect(s.current.props.page).toEqual(MunchopediaPage.List())
      expect(s.model.guide).toEqual(GuideStatus.Closed())
      expect(s.current.emitted).toEqual([])
    }),
  )

  it.effect(
    'a tile asks for its entry and says so; BACK asks for the list',
    () =>
      Effect.gen(function* () {
        const s = yield* Story.make(Munchopedia, HOME_PROPS)
        s.send(Message.ClickedEntryButton({ kind: 'Tank' })).emitted(
          changedTo(MunchopediaPage.Entry({ kind: 'Tank' })),
          MunchopediaEvents.OpenedEntry({ kind: 'Tank' }),
        )
        s.props(props => ({
          ...props,
          page: MunchopediaPage.Entry({ kind: 'Tank' }),
        }))
          .send(Message.ClickedListButton())
          .emitted(changedTo(MunchopediaPage.List()))
      }),
  )

  it.effect(
    'the Shop tile opens its guide on Guns, which turns and goes back on its own',
    () =>
      Effect.gen(function* () {
        const s = yield* Story.make(Munchopedia, HOME_PROPS)
        openShop(s)
        expect(s.model.guide).toEqual(GuideStatus.Open({ section: 'Guns' }))
        s.send(Message.ClickedGuideSectionButton({ section: 'Fridge' }))
        expect(s.model.guide).toEqual(GuideStatus.Open({ section: 'Fridge' }))
        s.send(Message.ClickedGuideBackButton())
          .expectExact(FocusGuideControl.make({ target: 'Opener' }))
          .resolve(FocusGuideControl, Component.noop)
        expect(s.model.guide).toEqual(GuideStatus.Closed())
        expect(s.current.emitted).toEqual([])
      }),
  )

  it.effect('mounted afresh on an entry says so, its guide shut', () =>
    Effect.gen(function* () {
      const s = yield* Story.make(Munchopedia, {
        ...HOME_PROPS,
        page: MunchopediaPage.Entry({ kind: 'Runner' }),
      })
      s.emitted(MunchopediaEvents.OpenedEntry({ kind: 'Runner' })).expectNone()
      expect(s.model.guide).toEqual(GuideStatus.Closed())
    }),
  )

  it.effect('mounted afresh on the list says nothing', () =>
    Effect.gen(function* () {
      const s = yield* Story.make(Munchopedia, HOME_PROPS)
      s.expectNone()
      expect(s.current.emitted).toEqual([])
    }),
  )
})

describe('the Dare Journal tabs', () => {
  it.effect('each tab asks for its page, and Zombies for the list', () =>
    Effect.gen(function* () {
      const s = yield* Story.make(Munchopedia, HOME_PROPS)
      s.send(Message.ClickedTabButton({ tab: 'Things' }))
        .emitted(changedTo(MunchopediaPage.Things()))
        .send(Message.ClickedTabButton({ tab: 'Rooms' }))
        .emitted(changedTo(MunchopediaPage.Rooms()))
        .send(Message.ClickedTabButton({ tab: 'Heroes' }))
        .emitted(changedTo(MunchopediaPage.Heroes()))
        .send(Message.ClickedTabButton({ tab: 'Zombies' }))
        .emitted(changedTo(MunchopediaPage.List()))
    }),
  )

  it.effect('a story page button asks for that page', () =>
    Effect.gen(function* () {
      const s = yield* Story.make(Munchopedia, HOME_PROPS)
      s.send(Message.ClickedStoryPageButton({ page: 'FirstEscape' }))
        .emitted(changedTo(MunchopediaPage.Story({ page: 'FirstEscape' })))
        .send(Message.ClickedStoryPageButton({ page: 'EscapeTripleDogDare' }))
        .emitted(
          changedTo(MunchopediaPage.Story({ page: 'EscapeTripleDogDare' })),
        )
    }),
  )
})
