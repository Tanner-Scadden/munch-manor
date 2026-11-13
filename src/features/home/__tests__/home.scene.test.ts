import { Array, Option, Struct } from 'effect'
import { Scene } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, it } from '@effect/vitest'

import { type Model, Phase, type ZombieKind } from '../../../app/model'
import { RESTART_GRACE_MS } from '../../../shared/constants'
import { home } from '../../../test/model.fixture'
import {
  APPLICATION,
  manorButton,
  measureSurface,
  munchopediaDialog,
  openHandInScene,
  pickCardInScene,
  shareMountSettles,
  showDialogInScene,
} from '../../../test/testing'
import { NEWS_DAYS } from '../../whatsNew/changelog'

const withKills = (
  base: Model,
  kills: Partial<Record<ZombieKind, number>>,
): Model =>
  modifyFields(base, {
    bests: bests =>
      modifyFields(bests, {
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

const whatsNewWithDot = Scene.role('button', {
  name: "What's new: the latest changes. Something new",
})
const munchopediaButton = Scene.role('button', {
  name: 'Dare Journal: the zombies, things, rooms, story, and heroes',
})
const munchopediaWithDot = Scene.role('button', {
  name: 'Dare Journal: the zombies, things, rooms, story, and heroes. Something new',
})
const WHATS_NEW_NEWS = "What's new: the latest changes. Something new"
const MUNCHOPEDIA =
  'Dare Journal: the zombies, things, rooms, story, and heroes'
const MUNCHOPEDIA_NEWS = `${MUNCHOPEDIA}. Something new`
const newsPip = Scene.selector(".manor-pip[data-card='WhatsNew']")
const munchopediaPip = Scene.selector(".manor-pip[data-card='Munchopedia']")
const whatsNewDialog = Scene.role('dialog', { name: "What's new" })
const olderArrow = Scene.role('button', { name: 'Older news' })
const newerArrow = Scene.role('button', { name: 'Newer news' })

describe("What's New", () => {
  it.effect(
    "the closed MANOR button shows a What's New pip and its card a NEW tag until the newest day is seen, and the panel shows that day",
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(home),
        measureSurface,
        Scene.expect(newsPip).toExist(),
        Scene.expect(manorButton).toHaveAttr(
          'aria-label',
          "More: character, journal, what is new, how to play, and proof. Something new in What's new",
        ),
        ...openHandInScene(),
        Scene.expect(whatsNewWithDot).toExist(),
        Scene.expect(
          Scene.within(whatsNewWithDot, Scene.selector('.hand-card-new')),
        ).toHaveText('NEW'),
        ...pickCardInScene(WHATS_NEW_NEWS),
        Scene.inside(
          whatsNewDialog,
          Scene.expect(Scene.selector('.news-date')).toHaveText(newestDay.date),
          Scene.expect(Scene.selector('.news-title')).toHaveText(
            newestDay.title,
          ),
          Scene.expectAll(Scene.all.selector('.news-bullet')).toHaveCount(
            newestDay.bullets.length,
          ),
          Scene.expect(olderArrow).not.toHaveAttr('aria-disabled'),
          Scene.expect(newerArrow).toHaveAttr('aria-disabled', 'true'),
        ),
        Scene.expect(newsPip).toBeAbsent(),
        Scene.expect(munchopediaPip).toBeAbsent(),
      ),
  )

  it.effect(
    'Older shows the day before, with its intro line, and wakes Newer',
    () => {
      const before = Option.getOrThrow(Array.get(NEWS_DAYS, 1))
      return Scene.scene(
        APPLICATION,
        Scene.given(home),
        measureSurface,
        ...openHandInScene(),
        ...pickCardInScene(WHATS_NEW_NEWS),
        Scene.click(olderArrow),
        Scene.inside(
          whatsNewDialog,
          Scene.expect(Scene.selector('.news-date')).toHaveText(before.date),
          Scene.expect(Scene.selector('.news-title')).toHaveText(before.title),
          ...Option.match(before.maybeIntro, {
            onNone: () => [],
            onSome: intro => [Scene.expect(Scene.text(intro)).toExist()],
          }),
          Scene.expect(newerArrow).not.toHaveAttr('aria-disabled'),
          Scene.expect(Scene.selector('.news-day-title')).toHaveAttr(
            'aria-live',
            'polite',
          ),
        ),
      )
    },
  )

  it.effect(
    'the arrows sit by the title above the bullets, with no page buttons left at the foot',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(home),
        measureSurface,
        ...openHandInScene(),
        ...pickCardInScene(WHATS_NEW_NEWS),
        Scene.inside(
          whatsNewDialog,
          Scene.expectAll(
            Scene.all.selector('.news-header .news-arrow'),
          ).toHaveCount(2),
          Scene.expect(Scene.selector('.panel-actions')).toBeAbsent(),
          Scene.expect(Scene.role('button', { name: 'Close' })).toExist(),
        ),
      ),
  )
})

describe('the Munchopedia', () => {
  it.effect(
    'every zombie starts as a silhouette marked ???, and the header tallies the finds',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(home),
        measureSurface,
        ...openHandInScene(),
        Scene.expect(munchopediaButton).toExist(),
        ...pickCardInScene(MUNCHOPEDIA),
        Scene.inside(
          munchopediaDialog,
          Scene.expect(
            Scene.text('0 of 7 discovered, 0 zombies splatted'),
          ).toExist(),
          Scene.inside(
            Scene.role('list', { name: 'Zombies' }),
            Scene.expectAll(
              Scene.all.role('button', {
                name: 'Unknown zombie, not found yet',
              }),
            ).toHaveCount(7),
          ),
          Scene.click(
            Scene.role('button', { name: 'Unknown zombie, not found yet' }),
          ),
          Scene.expect(Scene.role('heading', { name: '???' })).toExist(),
          Scene.expect(
            Scene.role('img', {
              name: 'A dark silhouette of a zombie you have not met yet',
            }),
          ).toExist(),
          Scene.expect(Scene.text('Splat one to fill in this page.')).toExist(),
        ),
      ),
  )

  it.effect(
    'a found zombie shows its name, bio, tips, kills, and badges, and the Munchopedia pip stays until every new entry is opened',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(withKills(home, { Shambler: 1203, Runner: 7 })),
        measureSurface,
        Scene.expect(munchopediaPip).toExist(),
        ...openHandInScene(),
        Scene.expect(munchopediaWithDot).toExist(),
        ...pickCardInScene(MUNCHOPEDIA_NEWS),
        Scene.inside(
          munchopediaDialog,
          Scene.expect(
            Scene.text('2 of 7 discovered, 1,210 zombies splatted'),
          ).toExist(),
          Scene.click(
            Scene.role('button', {
              name: 'Groaner, 1,203 splatted, new entry',
            }),
          ),
          Scene.expect(Scene.role('heading', { name: 'Groaner' })).toExist(),
          Scene.expect(
            Scene.role('img', {
              name: 'Groaner shuffling along and falling apart',
            }),
          ).toExist(),
          Scene.expect(
            Scene.role('heading', { name: 'What it does' }),
          ).toExist(),
          Scene.expect(
            Scene.role('heading', { name: 'How to beat it' }),
          ).toExist(),
          Scene.expect(Scene.text('1,203 splatted')).toExist(),
          Scene.inside(
            Scene.role('list', { name: 'Badges' }),
            Scene.expectAll(
              Scene.all.selector("[data-earned='Earned']"),
            ).toHaveCount(3),
          ),
          Scene.click(Scene.role('button', { name: 'Back to every zombie' })),
          Scene.expect(
            Scene.role('button', { name: 'Hotfoot, 7 splatted, new entry' }),
          ).toExist(),
          Scene.expect(
            Scene.role('button', { name: 'Groaner, 1,203 splatted' }),
          ).toExist(),
        ),
        Scene.expect(munchopediaPip).toExist(),
      ),
  )

  it.effect('badges light up only past their counts', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(withKills(home, { Tank: 12 })),
      measureSurface,
      ...openHandInScene(),
      ...pickCardInScene(MUNCHOPEDIA_NEWS),
      Scene.click(
        Scene.role('button', { name: 'Big Lug, 12 splatted, new entry' }),
      ),
      Scene.inside(
        Scene.role('list', { name: 'Badges' }),
        Scene.expectAll(
          Scene.all.selector("[data-earned='Earned']"),
        ).toHaveCount(1),
        Scene.expect(Scene.selector("[data-badge='Bronze']")).toHaveAttr(
          'data-earned',
          'Earned',
        ),
        Scene.expect(Scene.selector("[data-badge='Silver']")).toHaveAttr(
          'data-earned',
          'Unearned',
        ),
      ),
    ),
  )

  it.effect('Uncle Chunk is locked until beaten, then counts the wins', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(withKills(home, { Boss: 2 })),
      measureSurface,
      ...openHandInScene(),
      ...pickCardInScene(MUNCHOPEDIA_NEWS),
      Scene.click(
        Scene.role('button', {
          name: 'Uncle Chunk, Beaten 2 times, new entry',
        }),
      ),
      Scene.expect(Scene.role('heading', { name: 'Uncle Chunk' })).toExist(),
      Scene.expect(Scene.text('Beaten 2 times')).toExist(),
    ),
  )

  it.effect('a NEW ENTRY pop on the menu opens that entry', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(
        modifyFields(withKills(home, { Runner: 1 }), {
          home: menu => modifyFields(menu, { newEntries: () => ['Runner'] }),
        }),
      ),
      measureSurface,
      Scene.click(
        Scene.role('button', {
          name: 'New Munchopedia entry: Hotfoot. Open it',
        }),
      ),
      ...showDialogInScene(),
      Scene.inside(
        munchopediaDialog,
        Scene.expect(Scene.role('heading', { name: 'Hotfoot' })).toExist(),
      ),
      Scene.expect(munchopediaPip).toBeAbsent(),
    ),
  )

  it.effect('Game Over tells about a NEW ENTRY waiting on the menu', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(
        modifyFields(withKills(home, { Runner: 1, Crawler: 1 }), {
          phase: () => Phase.GameOver({ wave: 7 }),
          screenMs: () => RESTART_GRACE_MS,
          home: menu =>
            modifyFields(menu, { newEntries: () => ['Runner', 'Crawler'] }),
        }),
      ),
      measureSurface,
      shareMountSettles('Cancelled'),
      Scene.inside(
        Scene.selector('.new-entry-notice'),
        Scene.expect(Scene.text('NEW ENTRY!')).toExist(),
        Scene.expect(Scene.text('Hotfoot and 1 more')).toExist(),
      ),
    ),
  )
})
