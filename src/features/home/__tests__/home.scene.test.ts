import { Array, Effect, Option, type Scope, Struct } from 'effect'

import { UiStruct } from '@effect/ui'
import { HtmlLocator, HtmlScene } from '@effect/ui/html/testing'
import { Locator } from '@effect/ui/testing'
import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../../app/message'
import { type Model, Phase, type ZombieKind } from '../../../app/model'
import { HAND_DIALOG_ID, PANEL_DIALOG_ID } from '../../../domain/clientSchema'
import { RESTART_GRACE_MS } from '../../../shared/constants'
import { home } from '../../../test/model.fixture'
import {
  button,
  byClass,
  expectAttr,
  manorButton,
  measureSurface,
  munchopediaDialog,
  openHandInScene,
  pickCardInScene,
  shareMountSettles,
  showDialog,
  withAttrs,
} from '../../../test/sceneTesting'
import {
  type AppScene,
  type SceneStep,
  modelAfter,
  sceneOf,
  send,
  steps,
} from '../../../test/testing'
import { Munchopedia } from '../../munchopedia/block'
import { MunchopediaEvents } from '../../munchopedia/message'
import { MunchopediaPage } from '../../munchopedia/model'
import { NEWS_DAYS } from '../../whatsNew/changelog'

// The home menu's What's New and Dare Journal (src/screens/home/homeView.ts,
// src/features/munchopedia/): the hand, its cards, and the panel they open.
// The Dare Journal is a child component, a leaf in the root's Scene: its
// pages are drawn here on their own from the props the root hands it.

const withKills = (
  base: Model,
  kills: Partial<Record<ZombieKind, number>>,
): Model =>
  UiStruct.evolve(base, {
    bests: bests =>
      UiStruct.evolve(bests, {
        killsByKind: byKind => ({ ...byKind, ...kills }),
        totalKills: () =>
          Array.reduce(
            Struct.keys(kills),
            0,
            (sum, kind) => sum + (kills[kind] ?? 0),
          ),
      }),
  })

const newestDay = Option.getOrThrow(Array.head(NEWS_DAYS))

const WHATS_NEW_NEWS = "What's new: the latest changes. Something new"
const MUNCHOPEDIA =
  'Dare Journal: the zombies, things, rooms, story, and heroes'
const MUNCHOPEDIA_NEWS = `${MUNCHOPEDIA}. Something new`
const whatsNewWithDot = button(WHATS_NEW_NEWS)
const munchopediaButton = button(MUNCHOPEDIA)
const munchopediaWithDot = button(MUNCHOPEDIA_NEWS)
const newsPip = withAttrs({ 'data-card': 'WhatsNew' })(byClass('manor-pip'))
const munchopediaPip = withAttrs({ 'data-card': 'Munchopedia' })(
  byClass('manor-pip'),
)
const whatsNewDialog = HtmlLocator.role('dialog', { name: "What's new" })
const olderArrow = button('Older news')
const newerArrow = button('Newer news')
const inNews = (locator: Locator.Locator) =>
  Locator.inside(whatsNewDialog, locator)

// NOTE: the MANOR hand dealt, and its dialog shown.
const openHand: SceneStep = steps(openHandInScene, showDialog(HAND_DIALOG_ID))

// NOTE: a card of the hand picked, and the menu panel it opens shown.
const pickCard = (name: string): SceneStep =>
  steps(pickCardInScene(name), showDialog(PANEL_DIALOG_ID))

const homeScene = (model: Model): Effect.Effect<AppScene, never, Scope.Scope> =>
  Effect.map(sceneOf(model), s => measureSurface(s))

describe("What's New", () => {
  it.effect(
    "the closed MANOR button shows a What's New pip and its card a NEW tag until the newest day is seen, and the panel shows that day",
    () =>
      Effect.gen(function* () {
        const s = yield* homeScene(home)
        s.expect(newsPip)
          .toExist()
          .pipe(
            expectAttr(
              manorButton,
              'aria-label',
              "More: character, journal, what is new, how to play, and proof. Something new in What's new",
            ),
            openHand,
          )
          .expect(whatsNewWithDot)
          .toExist()
          .expect(Locator.inside(whatsNewWithDot, byClass('hand-card-new')))
          .toHaveText('NEW')
          .pipe(pickCard(WHATS_NEW_NEWS))
          .expect(inNews(byClass('news-date')))
          .toHaveText(newestDay.date)
          .expect(inNews(byClass('news-title')))
          .toHaveText(newestDay.title)
          .expect(inNews(byClass('news-bullet')))
          .toHaveCount(newestDay.bullets.length)
          .pipe(
            expectAttr(inNews(olderArrow), 'aria-disabled', undefined),
            expectAttr(inNews(newerArrow), 'aria-disabled', 'true'),
          )
          .expect(newsPip)
          .toBeAbsent()
          .expect(munchopediaPip)
          .toBeAbsent()
      }),
  )

  it.effect(
    'Older shows the day before, with its intro line, and wakes Newer',
    () =>
      Effect.gen(function* () {
        const before = Option.getOrThrow(Array.get(NEWS_DAYS, 1))
        const s = yield* homeScene(home)
        s.pipe(openHand, pickCard(WHATS_NEW_NEWS))
          .click(olderArrow)
          .expect(inNews(byClass('news-date')))
          .toHaveText(before.date)
          .expect(inNews(byClass('news-title')))
          .toHaveText(before.title)
        Option.match(before.maybeIntro, {
          onNone: () => s,
          onSome: intro => s.expect(inNews(Locator.text(intro))).toExist(),
        })
        s.pipe(
          expectAttr(inNews(newerArrow), 'aria-disabled', undefined),
          expectAttr(inNews(byClass('news-day-title')), 'aria-live', 'polite'),
        )
      }),
  )

  it.effect(
    'the arrows sit by the title above the bullets, with no page buttons left at the foot',
    () =>
      Effect.gen(function* () {
        const s = yield* homeScene(home)
        s.pipe(openHand, pickCard(WHATS_NEW_NEWS))
          .expect(
            inNews(
              Locator.inside(byClass('news-header'), byClass('news-arrow')),
            ),
          )
          .toHaveCount(2)
          .expect(inNews(byClass('panel-actions')))
          .toBeAbsent()
          .expect(inNews(button('Close')))
          .toExist()
      }),
  )
})

// NOTE: the Dare Journal as the root draws it from `model`, on `page`.
// Mounted on an entry, it says so first (its init), acknowledged here.
const journalOf = (
  model: Model,
  page: MunchopediaPage,
): Effect.Effect<HtmlScene.Steps<typeof Munchopedia>, never, Scope.Scope> =>
  Effect.map(
    HtmlScene.make(
      Munchopedia,
      {
        page,
        journal: model.journal,
        mastery: model.mastery,
        proof: model.proof,
        fresh: model.freshUnlocks,
        killsByKind: model.bests.killsByKind,
        openedEntries: model.home.openedEntries,
        seenUnlocks: model.seenUnlocks,
        screenMs: model.screenMs,
      },
      { slots: h => ({ done: h.button('Done') }) },
    ),
    s =>
      MunchopediaPage.matchOrElse(
        page,
        {
          Entry: ({ kind }) =>
            s.emitted(MunchopediaEvents.OpenedEntry({ kind })),
        },
        () => s,
      ),
  )

const LIST = MunchopediaPage.List()

const entryOf = (kind: ZombieKind) => MunchopediaPage.Entry({ kind })

const opensEntry = (kind: ZombieKind) => [
  MunchopediaEvents.ChangedPage({ page: entryOf(kind) }),
  MunchopediaEvents.OpenedEntry({ kind }),
]

const badges = HtmlLocator.role('list', { name: 'Badges' })

describe('the Munchopedia', () => {
  it.effect(
    'every zombie starts as a silhouette marked ???, and the header tallies the finds',
    () =>
      Effect.gen(function* () {
        const s = yield* homeScene(home)
        s.pipe(openHand)
          .expect(munchopediaButton)
          .toExist()
          .pipe(pickCard(MUNCHOPEDIA))
          .expect(munchopediaDialog)
          .toExist()
          .expect(Locator.text('0 of 7 discovered, 0 zombies splatted'))
          .toExist()
        const list = yield* journalOf(home, LIST)
        const unknown = HtmlLocator.role('button', {
          name: 'Unknown zombie, not found yet',
        })
        list
          .expect(
            Locator.inside(HtmlLocator.role('list', { name: 'Zombies' }), {
              description: 'every unknown zombie',
              all: root => unknown.all(root),
            }),
          )
          .toHaveCount(7)
        const entry = yield* journalOf(home, entryOf('Shambler'))
        entry
          .expect(HtmlLocator.role('heading', { name: '???' }))
          .toExist()
          .expect(
            HtmlLocator.role('img', {
              name: 'A dark silhouette of a zombie you have not met yet',
            }),
          )
          .toExist()
          .expect(Locator.text('Splat one to fill in this page.'))
          .toExist()
      }),
  )

  it.effect(
    'a found zombie shows its name, bio, tips, kills, and badges, and the Munchopedia pip stays until every new entry is opened',
    () =>
      Effect.gen(function* () {
        const found = withKills(home, { Shambler: 1203, Runner: 7 })
        const s = yield* homeScene(found)
        s.expect(munchopediaPip)
          .toExist()
          .pipe(openHand)
          .expect(munchopediaWithDot)
          .toExist()
          .pipe(pickCard(MUNCHOPEDIA_NEWS))
          .expect(Locator.text('2 of 7 discovered, 1,210 zombies splatted'))
          .toExist()
        const list = yield* journalOf(found, LIST)
        list.click(button('Groaner, 1,203 splatted, new entry'))
        Array.forEach(opensEntry('Shambler'), event => list.emitted(event))
        const opened = yield* modelAfter(
          found,
          steps(
            send(Message.ChangedMunchopediaPage({ page: entryOf('Shambler') })),
            send(Message.OpenedMunchopediaEntry({ kind: 'Shambler' })),
          ),
        )
        const entry = yield* journalOf(opened, entryOf('Shambler'))
        entry
          .expect(HtmlLocator.role('heading', { name: 'Groaner' }))
          .toExist()
          .expect(
            HtmlLocator.role('img', {
              name: 'Groaner shuffling along and falling apart',
            }),
          )
          .toExist()
          // NOTE: a found zombie stands carved on its plinth, not a picture.
          .expect(byClass('munch-plinth'))
          .toExist()
          .expect(Locator.inside(byClass('munch-entry'), Locator.tag('img')))
          .toBeAbsent()
          .expect(HtmlLocator.role('heading', { name: 'What it does' }))
          .toExist()
          .expect(HtmlLocator.role('heading', { name: 'How to beat it' }))
          .toExist()
          .expect(Locator.text('1,203 splatted'))
          .toExist()
          .expect(Locator.inside(badges, Locator.attr('data-earned', 'Earned')))
          .toHaveCount(3)
          .click(button('Back to every zombie'))
          .emitted(MunchopediaEvents.ChangedPage({ page: LIST }))
        const back = yield* journalOf(opened, LIST)
        back
          .expect(button('Hotfoot, 7 splatted, new entry'))
          .toExist()
          .expect(button('Groaner, 1,203 splatted'))
          .toExist()
        const after = yield* homeScene(opened)
        after.expect(munchopediaPip).toExist()
      }),
  )

  it.effect('badges light up only past their counts', () =>
    Effect.gen(function* () {
      const s = yield* journalOf(withKills(home, { Tank: 12 }), entryOf('Tank'))
      s.expect(
        Locator.inside(badges, Locator.attr('data-earned', 'Earned')),
      ).toHaveCount(1)
      expect(
        s.get(Locator.inside(badges, Locator.attr('data-badge', 'Bronze')))
          .attrs?.['data-earned'],
      ).toBe('Earned')
      expect(
        s.get(Locator.inside(badges, Locator.attr('data-badge', 'Silver')))
          .attrs?.['data-earned'],
      ).toBe('Unearned')
    }),
  )

  it.effect('Uncle Chunk is locked until beaten, then counts the wins', () =>
    Effect.gen(function* () {
      const beaten = withKills(home, { Boss: 2 })
      const list = yield* journalOf(beaten, LIST)
      list.click(button('Uncle Chunk, Beaten 2 times, new entry'))
      Array.forEach(opensEntry('Boss'), event => list.emitted(event))
      const s = yield* journalOf(beaten, entryOf('Boss'))
      s.expect(HtmlLocator.role('heading', { name: 'Uncle Chunk' }))
        .toExist()
        .expect(Locator.text('Beaten 2 times'))
        .toExist()
    }),
  )

  it.effect('a NEW ENTRY pop on the menu opens that entry', () =>
    Effect.gen(function* () {
      const fresh = UiStruct.evolve(withKills(home, { Runner: 1 }), {
        home: menu => UiStruct.evolve(menu, { newEntries: () => ['Runner'] }),
      })
      const s = yield* homeScene(fresh)
      s.click(button('New Munchopedia entry: Hotfoot. Open it'))
        .pipe(showDialog(PANEL_DIALOG_ID))
        .expect(munchopediaDialog)
        .toExist()
        // NOTE: the journal, mounted on the entry, says it is opened.
        .childEmit(
          Munchopedia,
          'munchopedia',
          MunchopediaEvents.OpenedEntry({ kind: 'Runner' }),
        )
        .expect(munchopediaPip)
        .toBeAbsent()
      const opened = yield* modelAfter(
        fresh,
        steps(
          send(Message.ClickedNewEntryButton({ kind: 'Runner' })),
          // NOTE: the journal mounted on the entry says it is opened.
          send(Message.OpenedMunchopediaEntry({ kind: 'Runner' })),
        ),
      )
      expect(opened.munchopediaPage).toEqual(entryOf('Runner'))
      const entry = yield* journalOf(opened, opened.munchopediaPage)
      entry.expect(HtmlLocator.role('heading', { name: 'Hotfoot' })).toExist()
    }),
  )

  it.effect('Game Over tells about a NEW ENTRY waiting on the menu', () =>
    Effect.gen(function* () {
      const s = yield* homeScene(
        UiStruct.evolve(withKills(home, { Runner: 1, Crawler: 1 }), {
          phase: () => Phase.GameOver({ wave: 7 }),
          screenMs: () => RESTART_GRACE_MS,
          home: menu =>
            UiStruct.evolve(menu, { newEntries: () => ['Runner', 'Crawler'] }),
        }),
      )
      const notice = (text: string) =>
        Locator.inside(byClass('new-entry-notice'), Locator.text(text))
      s.pipe(shareMountSettles('Cancelled'))
        .expect(notice('NEW ENTRY!'))
        .toExist()
        .expect(notice('Hotfoot and 1 more'))
        .toExist()
    }),
  )
})
