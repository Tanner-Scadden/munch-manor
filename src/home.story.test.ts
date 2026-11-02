import { Array, Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { Dialog, DialogBlock } from '@foldkit/ui'

import changelogMarkdown from '../CHANGELOG.md?raw'
import { NEWS_DAYS, newsHeadline, parseChangelog } from './changelog'
import { FIXED_STEP_MS } from './constants'
import { HOME_BUTTONS, HOME_KEYS, isNewsUnseen } from './home'
import { update } from './main'
import { Message } from './message'
import {
  type MenuPanel,
  type Model,
  MunchopediaPage,
  Phase,
  RunMode,
  type ZombieKind,
  noKills,
} from './model'
import { DISTANT_SPAWN, readyModel } from './model.fixture'
import {
  MUNCHOPEDIA,
  earnedBadges,
  hasUnopenedEntry,
  isDiscovered,
  unopenedKinds,
} from './munchopedia'
import { saveOf } from './save'
import {
  openLobbyByKey,
  press,
  resolveFocusLobby,
  showDialog,
  startRunFromHome,
  tick,
  writeSave,
} from './testing'
import { WriteSave } from './update/save'

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
  modifyFields(base, {
    phase: () =>
      Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [DISTANT_SPAWN] }),
    player: player => modifyFields(player, { hp: () => 0 }),
    stats: stats =>
      modifyFields(stats, { kills: () => ({ ...noKills, ...kills }) }),
  })

const expectPanel = (panel: MenuPanel) =>
  model((current: Model) => {
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
      ].join('\n'),
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

  test('L, Z, and I open their panels, and C and O open the Profile on Look and Settings', () => {
    const opens: ReadonlyArray<readonly [string, MenuPanel]> = [
      ['KeyL', 'WhatsNew'],
      ['KeyZ', 'Munchopedia'],
      ['KeyI', 'HowToPlay'],
    ]
    Array.forEach(opens, ([code, panel]) =>
      story(
        update,
        given(readyModel),
        press(code),
        showDialog(),
        expectPanel(panel),
      ),
    )
    story(
      update,
      given(readyModel),
      press('KeyC'),
      showDialog(),
      model(current => {
        expect(current.profileDialog.isOpen).toBe(true)
        expect(current.profile.tab).toBe('Look')
      }),
    )
    story(
      update,
      given(readyModel),
      press('KeyO'),
      showDialog(),
      model(current => {
        expect(current.profileDialog.isOpen).toBe(true)
        expect(current.profile.tab).toBe('Settings')
        expect(current.panelDialog.isOpen).toBe(false)
      }),
    )
  })

  test('the rail keys and E do nothing in a wave', () => {
    const fighting = modifyFields(readyModel, {
      phase: () =>
        Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
    })
    Array.forEach(['KeyL', 'KeyZ', 'KeyI', 'KeyO', 'KeyE'], code =>
      story(
        update,
        given(fighting),
        press(code),
        model(current => {
          expect(current.panelDialog.isOpen).toBe(false)
          expect(current.profileDialog.isOpen).toBe(false)
          expect(current.home.mode).toBe('Campaign')
        }),
      ),
    )
  })
})

describe('the mode in the lobby', () => {
  test('E and the mode tiles switch the mode back and forth, and start nothing', () => {
    story(
      update,
      given(readyModel),
      openLobbyByKey,
      press('KeyE'),
      resolveFocusLobby(),
      model(current => {
        expect(current.home.mode).toBe('Endless')
        expect(Phase.guards.Ready(current.phase)).toBe(true)
      }),
      message(Message.ClickedLobbyModeButton({ mode: 'Campaign' })),
      resolveFocusLobby(),
      model(current => {
        expect(current.home.mode).toBe('Campaign')
        expect(Phase.guards.Ready(current.phase)).toBe(true)
      }),
    )
  })

  test('E on the home menu itself does nothing now', () => {
    story(
      update,
      given(readyModel),
      press('KeyE'),
      model(current => {
        expect(current.home.mode).toBe('Campaign')
      }),
    )
  })

  test('START plays the chosen mode', () => {
    story(
      update,
      given(readyModel),
      message(Message.ClickedPlayButton()),
      resolveFocusLobby(),
      message(Message.ClickedLobbyModeButton({ mode: 'Endless' })),
      resolveFocusLobby(),
      message(Message.ClickedLobbyStartButton()),
      model(current => {
        expect(Phase.guards.Preparation(current.phase)).toBe(true)
        expect(current.mode).toEqual(RunMode.Endless())
      }),
    )
    story(
      update,
      given(readyModel),
      message(Message.ClickedPlayButton()),
      resolveFocusLobby(),
      message(Message.ClickedLobbyStartButton()),
      model(current => {
        expect(current.mode).toEqual(RunMode.Campaign())
      }),
    )
  })

  test('the chosen mode stays when the player comes home', () => {
    story(
      update,
      given(readyModel),
      openLobbyByKey,
      press('KeyE'),
      resolveFocusLobby(),
      press('Enter'),
      press('Escape'),
      press('KeyH'),
      showDialog(),
      message(Message.ClickedLeaveRunButton()),
      Command.resolve(
        Dialog.test.CloseDialog,
        DialogBlock.Message.CompletedCloseDialog(),
      ),
      model(current => {
        expect(Phase.guards.Ready(current.phase)).toBe(true)
        expect(current.home.mode).toBe('Endless')
        expect(current.home.lobby).toBe('Closed')
      }),
    )
  })
})

describe("What's New", () => {
  test('shows a dot until the newest day is opened, and the seen day is saved', () => {
    story(
      update,
      given(homeAfterRead),
      model(current => {
        expect(isNewsUnseen(current)).toBe(true)
      }),
      message(Message.ClickedWhatsNewButton()),
      showDialog(),
      Command.expectHas(WriteSave),
      writeSave(),
      model(current => {
        expect(isNewsUnseen(current)).toBe(false)
        expect(saveOf(current).home.seenNewsDay).toBe(
          Option.getOrThrow(Array.head(NEWS_DAYS)).date,
        )
      }),
    )
  })

  test('Older and Newer page through the days and stop at either end', () => {
    const lastPage = NEWS_DAYS.length - 1
    story(
      update,
      given(readyModel),
      message(Message.ClickedWhatsNewButton()),
      showDialog(),
      message(Message.ClickedNewerNewsButton()),
      model(current => {
        expect(current.home.newsPage).toBe(0)
      }),
      ...Array.makeBy(NEWS_DAYS.length + 1, () =>
        message(Message.ClickedOlderNewsButton()),
      ),
      model(current => {
        expect(current.home.newsPage).toBe(lastPage)
      }),
      message(Message.ClickedNewerNewsButton()),
      model(current => {
        expect(current.home.newsPage).toBe(Math.max(0, lastPage - 1))
      }),
    )
  })
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

  test('the first kill of a kind raises NEW ENTRY and the rail dot when the run ends', () => {
    story(
      update,
      given(
        withKills(dyingWith(readyModel, { Runner: 1, Shambler: 3 }), {
          Shambler: 5,
        }),
      ),
      tick(FIXED_STEP_MS),
      model(current => {
        expect(Phase.guards.GameOver(current.phase)).toBe(true)
        expect(current.home.newEntries).toEqual(['Runner'])
        expect(unopenedKinds(current)).toEqual(['Shambler', 'Runner'])
        expect(hasUnopenedEntry(current)).toBe(true)
      }),
    )
  })

  test('opening a new entry clears its NEW ENTRY and dot, and the opened entry is saved', () => {
    const fresh = modifyFields(withKills(homeAfterRead, { Runner: 1 }), {
      home: menu => modifyFields(menu, { newEntries: () => ['Runner'] }),
    })
    story(
      update,
      given(fresh),
      message(Message.ClickedNewEntryButton({ kind: 'Runner' })),
      showDialog(),
      Command.expectHas(WriteSave),
      writeSave(),
      expectPanel('Munchopedia'),
      model(current => {
        expect(current.home.munchopediaPage).toEqual(
          MunchopediaPage.Entry({ kind: 'Runner' }),
        )
        expect(current.home.newEntries).toEqual([])
        expect(hasUnopenedEntry(current)).toBe(false)
        expect(saveOf(current).home.openedEntries).toEqual(['Runner'])
      }),
    )
  })

  test('a locked entry opens as a silhouette and is not marked as opened', () => {
    story(
      update,
      given(readyModel),
      message(Message.ClickedMunchopediaButton()),
      showDialog(),
      message(Message.ClickedMunchopediaEntryButton({ kind: 'Tank' })),
      Command.expectNone(),
      model(current => {
        expect(current.home.munchopediaPage).toEqual(
          MunchopediaPage.Entry({ kind: 'Tank' }),
        )
        expect(current.home.openedEntries).toEqual([])
      }),
      message(Message.ClickedMunchopediaListButton()),
      model(current => {
        expect(current.home.munchopediaPage).toEqual(MunchopediaPage.List())
      }),
    )
  })

  test('the NEW ENTRY pop goes away when the next run starts, but the dot stays', () => {
    const fresh = modifyFields(withKills(readyModel, { Runner: 1 }), {
      home: menu => modifyFields(menu, { newEntries: () => ['Runner'] }),
    })
    story(
      update,
      given(fresh),
      startRunFromHome,
      model(current => {
        expect(Phase.guards.Preparation(current.phase)).toBe(true)
        expect(current.home.newEntries).toEqual([])
        expect(hasUnopenedEntry(current)).toBe(true)
      }),
    )
  })

  test('a kind already found raises no NEW ENTRY', () => {
    story(
      update,
      given(withKills(dyingWith(readyModel, { Runner: 4 }), { Runner: 9 })),
      tick(FIXED_STEP_MS),
      model(current => {
        expect(current.bests.killsByKind.Runner).toBe(13)
        expect(current.home.newEntries).toEqual([])
      }),
    )
  })

  test('Uncle Chunk unlocks when he is beaten, and his entry counts every win over him', () => {
    story(
      update,
      given(dyingWith(readyModel, { Boss: 1, Shambler: 20 })),
      tick(FIXED_STEP_MS),
      model(current => {
        expect(isDiscovered(current.bests.killsByKind, 'Boss')).toBe(true)
        expect(current.bests.killsByKind['Boss']).toBe(1)
        expect(current.home.newEntries).toEqual(['Shambler', 'Boss'])
        expect(saveOf(current).bests.killsByKind['Boss']).toBe(1)
      }),
    )
  })

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
