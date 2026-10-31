import { Array, Option } from 'effect'
import {
  all,
  click,
  expect,
  expectAll,
  given,
  inside,
  role,
  scene,
  selector,
  text,
  within,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'

import { NEWS_DAYS } from './changelog'
import { RESTART_GRACE_MS } from './constants'
import { type Model, Phase, type ZombieKind } from './model'
import { home } from './model.fixture'
import {
  ROOT,
  manorButton,
  measureSurface,
  openHandInScene,
  pickCardInScene,
  shareMountSettles,
  showDialogInScene,
} from './testing'

const withKills = (
  base: Model,
  kills: Partial<Record<ZombieKind, number>>,
): Model =>
  modifyFields(base, {
    bests: bests =>
      modifyFields(bests, {
        killsByKind: byKind => ({ ...byKind, ...kills }),
        totalKills: () =>
          Array.reduce(Object.values(kills), 0, (sum, count) => sum + count),
      }),
  })

const newestDay = Option.getOrThrow(Array.head(NEWS_DAYS))

const whatsNewWithDot = role('button', {
  name: "What's new: the latest changes. Something new",
})
const munchopediaButton = role('button', {
  name: 'Munchopedia: every zombie you have splatted',
})
const munchopediaWithDot = role('button', {
  name: 'Munchopedia: every zombie you have splatted. Something new',
})
const WHATS_NEW_NEWS = "What's new: the latest changes. Something new"
const MUNCHOPEDIA = 'Munchopedia: every zombie you have splatted'
const MUNCHOPEDIA_NEWS = `${MUNCHOPEDIA}. Something new`
const newsPip = selector(".manor-pip[data-card='WhatsNew']")
const munchopediaPip = selector(".manor-pip[data-card='Munchopedia']")
const whatsNewDialog = role('dialog', { name: "What's new" })
const munchopediaDialog = role('dialog', { name: 'Munchopedia' })

describe("What's New", () => {
  test("the closed MANOR button shows a What's New pip and its card a NEW tag until the newest day is seen, and the panel shows that day", () => {
    scene(
      ROOT,
      given(home),
      measureSurface,
      expect(newsPip).toExist(),
      expect(manorButton).toHaveAttr(
        'aria-label',
        "More: character, Munchopedia, what is new, and how to play. Something new in What's new",
      ),
      ...openHandInScene(),
      expect(whatsNewWithDot).toExist(),
      expect(within(whatsNewWithDot, selector('.hand-card-new'))).toHaveText(
        'NEW',
      ),
      ...pickCardInScene(WHATS_NEW_NEWS),
      inside(
        whatsNewDialog,
        expect(text(`${newestDay.date}: ${newestDay.title}`)).toExist(),
        expectAll(all.selector('.news-bullet')).toHaveCount(
          newestDay.bullets.length,
        ),
        expect(role('button', { name: 'Older news' })).toExist(),
        expect(role('button', { name: 'Newer news' })).toBeAbsent(),
      ),
      expect(newsPip).toBeAbsent(),
      expect(munchopediaPip).toBeAbsent(),
    )
  })

  test('Older shows the day before, with its intro line', () => {
    const before = Option.getOrThrow(Array.get(NEWS_DAYS, 1))
    scene(
      ROOT,
      given(home),
      measureSurface,
      ...openHandInScene(),
      ...pickCardInScene(WHATS_NEW_NEWS),
      click(role('button', { name: 'Older news' })),
      inside(
        whatsNewDialog,
        expect(text(`${before.date}: ${before.title}`)).toExist(),
        ...Option.match(before.maybeIntro, {
          onNone: () => [],
          onSome: intro => [expect(text(intro)).toExist()],
        }),
        expect(role('button', { name: 'Newer news' })).toExist(),
      ),
    )
  })
})

describe('the Munchopedia', () => {
  test('every zombie starts as a silhouette marked ???, and the header tallies the finds', () => {
    scene(
      ROOT,
      given(home),
      measureSurface,
      ...openHandInScene(),
      expect(munchopediaButton).toExist(),
      ...pickCardInScene(MUNCHOPEDIA),
      inside(
        munchopediaDialog,
        expect(text('0 of 7 discovered, 0 zombies splatted')).toExist(),
        inside(
          role('list', { name: 'Zombies' }),
          expectAll(
            all.role('button', { name: 'Unknown zombie, not found yet' }),
          ).toHaveCount(7),
        ),
        click(role('button', { name: 'Unknown zombie, not found yet' })),
        expect(role('heading', { name: '???' })).toExist(),
        expect(
          role('img', {
            name: 'A dark silhouette of a zombie you have not met yet',
          }),
        ).toExist(),
        expect(text('Splat one to fill in this page.')).toExist(),
      ),
    )
  })

  test('a found zombie shows its name, bio, tips, kills, and badges, and the Munchopedia pip stays until every new entry is opened', () => {
    scene(
      ROOT,
      given(withKills(home, { Shambler: 1203, Runner: 7 })),
      measureSurface,
      expect(munchopediaPip).toExist(),
      ...openHandInScene(),
      expect(munchopediaWithDot).toExist(),
      ...pickCardInScene(MUNCHOPEDIA_NEWS),
      inside(
        munchopediaDialog,
        expect(text('2 of 7 discovered, 1,210 zombies splatted')).toExist(),
        click(role('button', { name: 'Groaner, 1,203 splatted, new entry' })),
        expect(role('heading', { name: 'Groaner' })).toExist(),
        expect(
          role('img', { name: 'Groaner shuffling along and falling apart' }),
        ).toExist(),
        expect(role('heading', { name: 'What it does' })).toExist(),
        expect(role('heading', { name: 'How to beat it' })).toExist(),
        expect(text('1,203 splatted')).toExist(),
        inside(
          role('list', { name: 'Badges' }),
          expectAll(all.selector("[data-earned='Earned']")).toHaveCount(3),
        ),
        click(role('button', { name: 'Back to every zombie' })),
        expect(
          role('button', { name: 'Hotfoot, 7 splatted, new entry' }),
        ).toExist(),
        expect(role('button', { name: 'Groaner, 1,203 splatted' })).toExist(),
      ),
      expect(munchopediaPip).toExist(),
    )
  })

  test('badges light up only past their counts', () => {
    scene(
      ROOT,
      given(withKills(home, { Tank: 12 })),
      measureSurface,
      ...openHandInScene(),
      ...pickCardInScene(MUNCHOPEDIA_NEWS),
      click(role('button', { name: 'Big Lug, 12 splatted, new entry' })),
      inside(
        role('list', { name: 'Badges' }),
        expectAll(all.selector("[data-earned='Earned']")).toHaveCount(1),
        expect(selector("[data-badge='Bronze']")).toHaveAttr(
          'data-earned',
          'Earned',
        ),
        expect(selector("[data-badge='Silver']")).toHaveAttr(
          'data-earned',
          'Unearned',
        ),
      ),
    )
  })

  test('Uncle Chunk is locked until beaten, then counts the wins', () => {
    scene(
      ROOT,
      given(withKills(home, { Boss: 2 })),
      measureSurface,
      ...openHandInScene(),
      ...pickCardInScene(MUNCHOPEDIA_NEWS),
      click(role('button', { name: 'Uncle Chunk, Beaten 2 times, new entry' })),
      expect(role('heading', { name: 'Uncle Chunk' })).toExist(),
      expect(text('Beaten 2 times')).toExist(),
    )
  })

  test('a NEW ENTRY pop on the menu opens that entry', () => {
    scene(
      ROOT,
      given(
        modifyFields(withKills(home, { Runner: 1 }), {
          home: menu => modifyFields(menu, { newEntries: () => ['Runner'] }),
        }),
      ),
      measureSurface,
      click(
        role('button', { name: 'New Munchopedia entry: Hotfoot. Open it' }),
      ),
      ...showDialogInScene(),
      inside(
        munchopediaDialog,
        expect(role('heading', { name: 'Hotfoot' })).toExist(),
      ),
      expect(munchopediaPip).toBeAbsent(),
    )
  })

  test('Game Over tells about a NEW ENTRY waiting on the menu', () => {
    scene(
      ROOT,
      given(
        modifyFields(withKills(home, { Runner: 1, Crawler: 1 }), {
          phase: () => Phase.GameOver({ wave: 7 }),
          screenMs: () => RESTART_GRACE_MS,
          home: menu =>
            modifyFields(menu, { newEntries: () => ['Runner', 'Crawler'] }),
        }),
      ),
      measureSurface,
      shareMountSettles('Cancelled'),
      inside(
        selector('.new-entry-notice'),
        expect(text('NEW ENTRY!')).toExist(),
        expect(text('Hotfoot and 1 more')).toExist(),
      ),
    )
  })
})
