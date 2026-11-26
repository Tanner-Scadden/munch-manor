import { Effect } from 'effect'

import { UiStruct } from '@effect/ui'
import { HtmlLocator, HtmlScene } from '@effect/ui/html/testing'
import { Locator } from '@effect/ui/testing'
import { describe, expect, it } from '@effect/vitest'

import { Message } from '#app/message.ts'
import type { Model } from '#app/model.ts'
import { milestoneUnlockId } from '#domain/journal.ts'
import { Munchopedia } from '#features/munchopedia/block.ts'
import {
  JOURNAL_ROOMS,
  STORY_PAGES,
} from '#features/munchopedia/journalPages.ts'
import { MunchopediaEvents } from '#features/munchopedia/message.ts'
import { MunchopediaPage } from '#features/munchopedia/model.ts'
import { noJournal } from '#shared/records/journalData.ts'
import { home } from '#test/model.fixture.ts'
import { modelAfter, send, steps } from '#test/testing.ts'
import { DARE_LINES, DARE_NAMES, STORY_TITLES } from '#world/names.ts'

import { munchopediaPropsOf } from './munchopedia.fixture.ts'

const tab = (name: string) =>
  HtmlLocator.role('button', { name: new RegExp(`^${name}`) })

const listNamed = (name: string) => HtmlLocator.role('list', { name })

const veteran: Model = UiStruct.evolve(home, {
  journal: () => ({
    ...noJournal,
    milestones: ['FirstFind', 'FirstEscape'],
    roomsOpened: ['Kitchen'],
    heroesPlayed: ['You'],
    thingsFound: 1,
  }),
  proof: () => [
    {
      thing: 'SilverSpoon',
      difficulty: 'Normal',
      stamp: { wave: 6, hero: 'You', crew: [], day: null, ending: 'Munched' },
    },
  ],
  seenUnlocks: seen => [...seen, milestoneUnlockId('FirstFind')],
})

const openedJournal: Effect.Effect<Model> = modelAfter(
  veteran,
  steps(
    send(Message.ClickedManorButton()),
    send(Message.ClickedMunchopediaButton()),
  ),
)

const propsOn = (model: Model, page: MunchopediaPage) => ({
  ...munchopediaPropsOf(model),
  page,
})

const journalScene = Effect.gen(function* () {
  const model = yield* openedJournal
  const s = yield* HtmlScene.make(Munchopedia, munchopediaPropsOf(model))
  return { model, s }
})

const turnTo = (
  s: HtmlScene.Steps<typeof Munchopedia>,
  model: Model,
  name: string,
  page: MunchopediaPage,
) =>
  s
    .click(tab(name))
    .emitted(MunchopediaEvents.ChangedPage({ page }))
    .props(propsOn(model, page))

describe('the Dare Journal', () => {
  it.effect(
    'Things shows a find by name, an open thing as ???, and a locked one with its milestone',
    () =>
      Effect.gen(function* () {
        const { model, s } = yield* journalScene
        expect(model.munchopediaPage).toEqual(MunchopediaPage.List())
        const things = listNamed('Things')
        const inThings = (locator: Locator.Locator) =>
          Locator.inside(things, locator)
        turnTo(s, model, 'Things', MunchopediaPage.Things())
          .expect(inThings(Locator.text(DARE_NAMES.SilverSpoon)))
          .toExist()
          .expect(inThings(Locator.text(DARE_LINES.SilverSpoon)))
          .toExist()
          .expect(inThings(Locator.text(DARE_NAMES.NapkinRing)))
          .toBeAbsent()
          .expect(inThings(Locator.text('Find 10 things')))
          .toExist()
          .expect(inThings(Locator.text('Escape on Triple Dog Dare')))
          .toBeAbsent()
          .expect(inThings(HtmlLocator.role('listitem')))
          .toHaveCount(10)
      }),
  )

  it.effect(
    'Rooms names the dining room and the rooms opened, ??? the rest',
    () =>
      Effect.gen(function* () {
        const { model, s } = yield* journalScene
        const inRooms = (locator: Locator.Locator) =>
          Locator.inside(listNamed('Rooms'), locator)
        turnTo(s, model, 'Rooms', MunchopediaPage.Rooms())
          .expect(inRooms(Locator.text('Dining Room')))
          .toExist()
          .expect(inRooms(Locator.text('Kitchen')))
          .toExist()
          .expect(inRooms(Locator.text('Cellar')))
          .toBeAbsent()
          .expect(inRooms(HtmlLocator.role('listitem')))
          .toHaveCount(JOURNAL_ROOMS.length)
      }),
  )

  it.effect(
    'Story opens on the new page, reads it, and a locked page shows its milestone',
    () =>
      Effect.gen(function* () {
        const { model, s } = yield* journalScene
        const storyPage = (page: 'FirstFind' | 'FirstEscape') =>
          MunchopediaPage.Story({ page })
        s.expect(tab('Story')).toHaveText(/NEW/)
        turnTo(s, model, 'Story', storyPage('FirstEscape'))
          .expect(
            HtmlLocator.role('heading', { name: STORY_TITLES.FirstEscape }),
          )
          .toExist()
          .expect(Locator.text(STORY_PAGES.FirstEscape.lines[0]))
          .toExist()
          .click(HtmlLocator.role('button', { name: 'Page 1, The Party' }))
          .emitted(
            MunchopediaEvents.ChangedPage({ page: storyPage('FirstFind') }),
          )
          .props(propsOn(model, storyPage('FirstFind')))
          .expect(HtmlLocator.role('heading', { name: STORY_TITLES.FirstFind }))
          .toExist()
          .click(HtmlLocator.role('button', { name: 'Page 8, locked' }))
          .emitted(
            MunchopediaEvents.ChangedPage({
              page: MunchopediaPage.Story({ page: 'EscapeTripleDogDare' }),
            }),
          )
          .props(
            propsOn(
              model,
              MunchopediaPage.Story({ page: 'EscapeTripleDogDare' }),
            ),
          )
          .expect(HtmlLocator.role('heading', { name: 'Page 8' }))
          .toExist()
          .expect(Locator.text('Escape on Triple Dog Dare'))
          .toExist()
      }),
  )

  it.effect('Heroes gives the reason of a hero played, ??? for the rest', () =>
    Effect.gen(function* () {
      const { model, s } = yield* journalScene
      const inHeroes = (locator: Locator.Locator) =>
        Locator.inside(listNamed('Heroes'), locator)
      turnTo(s, model, 'Heroes', MunchopediaPage.Heroes())
        .expect(
          inHeroes(
            Locator.text('Your friends dared you. That is the whole reason.'),
          ),
        )
        .toExist()
        .expect(inHeroes(Locator.text('???', { exact: true })))
        .toHaveCount(4)
    }),
  )
})
