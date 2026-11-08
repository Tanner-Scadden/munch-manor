import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import changelogMarkdown from '../../../../CHANGELOG.md?raw'
import { LobbyBinding, MunchopediaBinding } from '../../../app/bindings'
import { Message } from '../../../app/message'
import {
  type Model,
  Phase,
  RunMode,
  type ZombieKind,
  noKills,
} from '../../../app/model'
import { WriteSave } from '../../../app/update/save'
import { Message as LobbyMessage } from '../../../features/lobby/message'
import { saveOf } from '../../../platform/save'
import { FIXED_STEP_MS } from '../../../shared/constants'
import { DISTANT_SPAWN, readyModel } from '../../../test/model.fixture'
import {
  APPLICATION,
  closeDialog,
  openLobbyByKey,
  press,
  resolveFocusLobby,
  showDialog,
  startRunFromHome,
  tick,
  writeSave,
} from '../../../test/testing'
import { modifyFocus } from '../../../world/party/party'
import { Message as MunchopediaMessage } from '../../munchopedia/message'
import { MunchopediaPage } from '../../munchopedia/model'
import {
  MUNCHOPEDIA,
  earnedBadges,
  hasUnopenedEntry,
  isDiscovered,
  unopenedKinds,
} from '../../munchopedia/munchopedia'
import {
  NEWS_DAYS,
  newsHeadline,
  parseChangelog,
} from '../../whatsNew/changelog'
import { HOME_BUTTONS, HOME_KEYS, isNewsUnseen } from '../home'
import type { MenuPanel } from '../homeSchema'

const homeAfterRead: Model = modifyFields(readyModel, {
  saveStatus: () => 'Read',
})

const withKills = (
  base: Model,
  kills: Partial<Record<ZombieKind, number>>,
): Model =>
  modifyFields(base, {
    bests: bests =>
      modifyFields(bests, {
        killsByKind: byKind => ({ ...byKind, ...kills }),
      }),
  })

const dyingWith = (
  base: Model,
  kills: Partial<Record<ZombieKind, number>>,
): Model =>
  modifyFocus(
    modifyFields(base, {
      phase: () =>
        Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [DISTANT_SPAWN] }),
      stats: stats =>
        modifyFields(stats, { kills: () => ({ ...noKills, ...kills }) }),
    }),
    { player: player => modifyFields(player, { hp: () => 0 }) },
  )

const expectPanel = (panel: MenuPanel) =>
  Story.model((current: Model) => {
    expect(current.panelDialog.isOpen).toBe(true)
    expect(current.panel).toBe(panel)
  })

describe('the changelog', () => {
  test('CHANGELOG.md parses into days, newest first, each with a title and a handful of bullets', () => {
    const days = parseChangelog(changelogMarkdown)
    expect(days.length).toBeGreaterThanOrEqual(2)
    expect(NEWS_DAYS).toEqual(days)
    Array.forEach(days, day => {
      expect(day.date).toMatch(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/)
      expect(day.title.length).toBeGreaterThan(0)
      expect(day.bullets.length).toBeGreaterThanOrEqual(1)
      expect(day.bullets.length).toBeLessThanOrEqual(6)
      Array.forEach(day.bullets, bullet => {
        expect(bullet.emoji.length).toBeGreaterThan(0)
        expect(bullet.text).not.toMatch(/^-/)
      })
    })
    expect(Array.map(days, ({ date }) => date)).toContain('October 28, 2026')
    const opening = Array.findFirst(
      days,
      ({ date }) => date === 'October 28, 2026',
    )
    expect(Option.flatMap(opening, ({ maybeIntro }) => maybeIntro)).toEqual(
      Option.some('The doors are open. Bring snacks. Do not become the snack.'),
    )
  })

  test('a day with no bullets is skipped, the intro is optional, and text before the first day is ignored', () => {
    const days = parseChangelog(
      Array.join(
        [
          '# What is new',
          'Some notes for us.',
          '',
          '## May 2, 2027: Two',
          '',
          '- 🎉 Party time.',
          '- 🧟 More zombies.',
          '',
          '## May 1, 2027: Empty',
          '',
          'Nothing here.',
        ],
        '\n',
      ),
    )
    expect(days).toEqual([
      {
        date: 'May 2, 2027',
        title: 'Two',
        maybeIntro: Option.none(),
        bullets: [
          { emoji: '🎉', text: 'Party time.' },
          { emoji: '🧟', text: 'More zombies.' },
        ],
      },
    ])
  })

  test('a headline is the first clause of a bullet, seven words at most', () => {
    expect(newsHeadline('PLAY is one big arrow now, every menu slimmed.')).toBe(
      'PLAY is one big arrow now',
    )
    expect(newsHeadline('Big hordes run smoother on slower phones.')).toBe(
      'Big hordes run smoother on slower phones',
    )
    expect(
      newsHeadline('Upgraded guns keep their names now: Beefy, then DELUXE.'),
    ).toBe('Upgraded guns keep their names now')
    expect(
      newsHeadline('Your Profile fits small phones held upright: every tab.'),
    ).toBe('Your Profile fits small phones held upright')
    expect(
      newsHeadline(
        'Smash open the kitchen behind the parlour and last ten waves.',
      ),
    ).toBe('Smash open the kitchen behind the parlour…')
  })
})

describe('the home menu keys', () => {
  test('every home key is its own, and none is a key the game already uses', () => {
    const codes = Array.map(HOME_BUTTONS, button => HOME_KEYS[button].code)
    expect(new Set(codes).size).toBe(codes.length)
    const gameKeys: ReadonlyArray<string> = [
      'KeyW',
      'KeyA',
      'KeyS',
      'KeyD',
      'KeyR',
      'KeyQ',
      'KeyT',
      'KeyG',
      'KeyH',
      'KeyK',
      'KeyM',
      'KeyN',
      'Escape',
    ]
    Array.forEach(codes, code => expect(gameKeys).not.toContain(code))
  })

  it.effect(
    'L, Z, and I open their panels, and C and O open the Profile on Look and Settings',
    () =>
      Effect.gen(function* () {
        const opens: ReadonlyArray<readonly [string, MenuPanel]> = [
          ['KeyL', 'WhatsNew'],
          ['KeyZ', 'Munchopedia'],
          ['KeyI', 'HowToPlay'],
        ]
        yield* Effect.forEach(opens, ([code, panel]) =>
          Story.story(
            APPLICATION,
            Story.given(readyModel),
            press(code),
            showDialog(),
            expectPanel(panel),
          ),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(readyModel),
          press('KeyC'),
          showDialog(),
          Story.model(current => {
            expect(current.profileDialog.isOpen).toBe(true)
            expect(current.profile.tab).toBe('Look')
          }),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(readyModel),
          press('KeyO'),
          showDialog(),
          Story.model(current => {
            expect(current.profileDialog.isOpen).toBe(true)
            expect(current.profile.tab).toBe('Settings')
            expect(current.panelDialog.isOpen).toBe(false)
          }),
        )
      }),
  )

  it.effect('the rail keys and E do nothing in a wave', () =>
    Effect.gen(function* () {
      const fighting = modifyFields(readyModel, {
        phase: () =>
          Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
      })
      yield* Effect.forEach(['KeyL', 'KeyZ', 'KeyI', 'KeyO', 'KeyE'], code =>
        Story.story(
          APPLICATION,
          Story.given(fighting),
          press(code),
          Story.model(current => {
            expect(current.panelDialog.isOpen).toBe(false)
            expect(current.profileDialog.isOpen).toBe(false)
            expect(current.home.mode).toBe('Campaign')
          }),
        ),
      )
    }),
  )
})

describe('the mode in the lobby', () => {
  it.effect(
    'E and the mode tiles switch the mode back and forth, and start nothing',
    () =>
      Story.story(
        APPLICATION,
        Story.given(readyModel),
        openLobbyByKey,
        press('KeyE'),
        resolveFocusLobby(),
        Story.model(current => {
          expect(current.home.mode).toBe('Endless')
          expect(Phase.guards.Ready(current.phase)).toBe(true)
        }),
        Story.messageIn(
          LobbyBinding,
          LobbyMessage.ClickedModeButton({ mode: 'Campaign' }),
        ),
        resolveFocusLobby(),
        Story.model(current => {
          expect(current.home.mode).toBe('Campaign')
          expect(Phase.guards.Ready(current.phase)).toBe(true)
        }),
      ),
  )

  it.effect('E on the home menu itself does nothing now', () =>
    Story.story(
      APPLICATION,
      Story.given(readyModel),
      press('KeyE'),
      Story.model(current => {
        expect(current.home.mode).toBe('Campaign')
      }),
    ),
  )

  it.effect('START plays the chosen mode', () =>
    Effect.gen(function* () {
      yield* Story.story(
        APPLICATION,
        Story.given(readyModel),
        Story.message(Message.ClickedPlayButton()),
        resolveFocusLobby(),
        Story.messageIn(
          LobbyBinding,
          LobbyMessage.ClickedModeButton({ mode: 'Endless' }),
        ),
        resolveFocusLobby(),
        Story.messageIn(LobbyBinding, LobbyMessage.ClickedStartButton()),
        Story.model(current => {
          expect(Phase.guards.Preparation(current.phase)).toBe(true)
          expect(current.mode).toEqual(RunMode.Endless())
        }),
      )
      yield* Story.story(
        APPLICATION,
        Story.given(readyModel),
        Story.message(Message.ClickedPlayButton()),
        resolveFocusLobby(),
        Story.messageIn(LobbyBinding, LobbyMessage.ClickedStartButton()),
        Story.model(current => {
          expect(current.mode).toEqual(RunMode.Campaign())
        }),
      )
    }),
  )

  it.effect('the chosen mode stays when the player comes home', () =>
    Story.story(
      APPLICATION,
      Story.given(readyModel),
      openLobbyByKey,
      press('KeyE'),
      resolveFocusLobby(),
      press('Enter'),
      press('Escape'),
      press('KeyH'),
      showDialog(),
      Story.message(Message.ClickedLeaveRunButton()),
      closeDialog(),
      Story.model(current => {
        expect(Phase.guards.Ready(current.phase)).toBe(true)
        expect(current.home.mode).toBe('Endless')
        expect(current.lobby.status).toBe('Closed')
      }),
    ),
  )
})

describe("What's New", () => {
  it.effect(
    'shows a dot until the newest day is opened, and the seen day is saved',
    () =>
      Story.story(
        APPLICATION,
        Story.given(homeAfterRead),
        Story.model(current => {
          expect(isNewsUnseen(current)).toBe(true)
        }),
        Story.message(Message.ClickedWhatsNewButton()),
        showDialog(),
        Story.Command.expectHas(WriteSave),
        writeSave(),
        Story.model(current => {
          expect(isNewsUnseen(current)).toBe(false)
          expect(saveOf(current).home.seenNewsDay).toBe(
            Option.getOrThrow(Array.head(NEWS_DAYS)).date,
          )
        }),
      ),
  )

  it.effect(
    'Older and Newer page through the days and stop at either end',
    () => {
      const lastPage = NEWS_DAYS.length - 1
      return Story.story(
        APPLICATION,
        Story.given(readyModel),
        Story.message(Message.ClickedWhatsNewButton()),
        showDialog(),
        Story.message(Message.ClickedNewerNewsButton()),
        Story.model(current => {
          expect(current.home.newsPage).toBe(0)
        }),
        ...Array.makeBy(NEWS_DAYS.length + 1, () =>
          Story.message(Message.ClickedOlderNewsButton()),
        ),
        Story.model(current => {
          expect(current.home.newsPage).toBe(lastPage)
        }),
        Story.message(Message.ClickedNewerNewsButton()),
        Story.model(current => {
          expect(current.home.newsPage).toBe(Math.max(0, lastPage - 1))
        }),
      )
    },
  )
})

describe('the Munchopedia', () => {
  test('every kind starts locked, and a kind unlocks with its first kill', () => {
    expect(
      Array.filter(MUNCHOPEDIA, ({ kind }) =>
        isDiscovered(readyModel.bests.killsByKind, kind),
      ),
    ).toEqual([])
    expect(MUNCHOPEDIA.length).toBe(7)
    const tallied = withKills(readyModel, { Runner: 1 })
    expect(isDiscovered(tallied.bests.killsByKind, 'Runner')).toBe(true)
    expect(isDiscovered(tallied.bests.killsByKind, 'Shambler')).toBe(false)
  })

  it.effect(
    'the first kill of a kind raises NEW ENTRY and the rail dot when the run ends',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          withKills(dyingWith(readyModel, { Runner: 1, Shambler: 3 }), {
            Shambler: 5,
          }),
        ),
        tick(FIXED_STEP_MS),
        Story.model(current => {
          expect(Phase.guards.GameOver(current.phase)).toBe(true)
          expect(current.home.newEntries).toEqual(['Runner'])
          expect(unopenedKinds(current)).toEqual(['Shambler', 'Runner'])
          expect(hasUnopenedEntry(current)).toBe(true)
        }),
      ),
  )

  it.effect(
    'opening a new entry clears its NEW ENTRY and dot, and the opened entry is saved',
    () => {
      const fresh = modifyFields(withKills(homeAfterRead, { Runner: 1 }), {
        home: menu => modifyFields(menu, { newEntries: () => ['Runner'] }),
      })
      return Story.story(
        APPLICATION,
        Story.given(fresh),
        Story.message(Message.ClickedNewEntryButton({ kind: 'Runner' })),
        showDialog(),
        Story.Command.expectHas(WriteSave),
        writeSave(),
        expectPanel('Munchopedia'),
        Story.model(current => {
          expect(current.munchopedia.page).toEqual(
            MunchopediaPage.Entry({ kind: 'Runner' }),
          )
          expect(current.home.newEntries).toEqual([])
          expect(hasUnopenedEntry(current)).toBe(false)
          expect(saveOf(current).home.openedEntries).toEqual(['Runner'])
        }),
      )
    },
  )

  it.effect(
    'a locked entry opens as a silhouette and is not marked as opened',
    () =>
      Story.story(
        APPLICATION,
        Story.given(readyModel),
        Story.message(Message.ClickedMunchopediaButton()),
        showDialog(),
        Story.messageIn(
          MunchopediaBinding,
          MunchopediaMessage.ClickedEntryButton({ kind: 'Tank' }),
        ),
        Story.Command.expectNone(),
        Story.model(current => {
          expect(current.munchopedia.page).toEqual(
            MunchopediaPage.Entry({ kind: 'Tank' }),
          )
          expect(current.home.openedEntries).toEqual([])
        }),
        Story.messageIn(
          MunchopediaBinding,
          MunchopediaMessage.ClickedListButton(),
        ),
        Story.model(current => {
          expect(current.munchopedia.page).toEqual(MunchopediaPage.List())
        }),
      ),
  )

  it.effect(
    'the NEW ENTRY pop goes away when the next run starts, but the dot stays',
    () => {
      const fresh = modifyFields(withKills(readyModel, { Runner: 1 }), {
        home: menu => modifyFields(menu, { newEntries: () => ['Runner'] }),
      })
      return Story.story(
        APPLICATION,
        Story.given(fresh),
        startRunFromHome,
        Story.model(current => {
          expect(Phase.guards.Preparation(current.phase)).toBe(true)
          expect(current.home.newEntries).toEqual([])
          expect(hasUnopenedEntry(current)).toBe(true)
        }),
      )
    },
  )

  it.effect('a kind already found raises no NEW ENTRY', () =>
    Story.story(
      APPLICATION,
      Story.given(
        withKills(dyingWith(readyModel, { Runner: 4 }), { Runner: 9 }),
      ),
      tick(FIXED_STEP_MS),
      Story.model(current => {
        expect(current.bests.killsByKind.Runner).toBe(13)
        expect(current.home.newEntries).toEqual([])
      }),
    ),
  )

  it.effect(
    'Uncle Chunk unlocks when he is beaten, and his entry counts every win over him',
    () =>
      Story.story(
        APPLICATION,
        Story.given(dyingWith(readyModel, { Boss: 1, Shambler: 20 })),
        tick(FIXED_STEP_MS),
        Story.model(current => {
          expect(isDiscovered(current.bests.killsByKind, 'Boss')).toBe(true)
          expect(current.bests.killsByKind['Boss']).toBe(1)
          expect(current.home.newEntries).toEqual(['Shambler', 'Boss'])
          expect(saveOf(current).bests.killsByKind['Boss']).toBe(1)
        }),
      ),
  )

  test('badges come at 10, 100, and 1,000', () => {
    expect(earnedBadges(9)).toEqual([])
    expect(Array.map(earnedBadges(10), ({ name }) => name)).toEqual(['Bronze'])
    expect(Array.map(earnedBadges(99), ({ name }) => name)).toEqual(['Bronze'])
    expect(Array.map(earnedBadges(100), ({ name }) => name)).toEqual([
      'Bronze',
      'Silver',
    ])
    expect(Array.map(earnedBadges(999), ({ name }) => name)).toEqual([
      'Bronze',
      'Silver',
    ])
    expect(Array.map(earnedBadges(1000), ({ name }) => name)).toEqual([
      'Bronze',
      'Silver',
      'Gold',
    ])
  })
})
