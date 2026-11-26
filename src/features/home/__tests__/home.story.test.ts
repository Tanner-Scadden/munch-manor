import { Array, Effect, Option, type Scope } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it, test } from '@effect/vitest'

import { Message } from '#app/message.ts'
import {
  type Model,
  Phase,
  RunMode,
  type ZombieKind,
  noKills,
} from '#app/model.ts'
import { WriteSave } from '#app/update/save.ts'
import type { MenuPanel } from '#features/home/homeSchema.ts'
import { LobbyMessage } from '#features/lobby/message.ts'
import { MunchopediaPage } from '#features/munchopedia/model.ts'
import {
  MUNCHOPEDIA,
  earnedBadges,
  hasUnopenedEntry,
  isDiscovered,
  unopenedKinds,
} from '#features/munchopedia/munchopedia.ts'
import {
  NEWS_DAYS,
  newsHeadline,
  parseChangelog,
} from '#features/whatsNew/changelog.ts'
import { saveOf } from '#platform/save/save.ts'
import { HOME_BUTTONS, HOME_KEYS, isNewsUnseen } from '#screens/home/home.ts'
import { FIXED_STEP_MS } from '#shared/constants.ts'
import { DISTANT_SPAWN, readyModel } from '#test/model.fixture.ts'
import {
  type StoryStep,
  checkModel,
  openLobbyByKey,
  press,
  resolveFocusLobby,
  send,
  startRunFromHome,
  steps,
  storyOf,
  throughIntro,
  tick,
  writeSave,
} from '#test/testing.ts'
import { modifyFocus } from '#world/party/party.ts'

import changelogMarkdown from '../../../../CHANGELOG.md?raw'

const homeAfterRead: Model = UiStruct.evolve(readyModel, {
  saving: UiStruct.evolve({ saveStatus: () => 'Read' }),
})

const withKills = (
  base: Model,
  kills: Partial<Record<ZombieKind, number>>,
): Model =>
  UiStruct.evolve(base, {
    bests: bests =>
      UiStruct.evolve(bests, {
        killsByKind: byKind => ({ ...byKind, ...kills }),
      }),
  })

const dyingWith = (
  base: Model,
  kills: Partial<Record<ZombieKind, number>>,
): Model =>
  modifyFocus(
    UiStruct.evolve(base, {
      phase: () =>
        Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [DISTANT_SPAWN] }),
      stats: stats =>
        UiStruct.evolve(stats, { kills: () => ({ ...noKills, ...kills }) }),
    }),
    { player: player => UiStruct.evolve(player, { hp: () => 0 }) },
  )

const expectPanel = (panel: MenuPanel): StoryStep =>
  checkModel(current => {
    expect(current.rootDialog._tag).toBe('Panel')
    expect(current.panel).toBe(panel)
  })

const storyOver = (
  model: Model,
  ...each: ReadonlyArray<StoryStep>
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.map(storyOf(model), s => {
    steps(...each)(s)
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
          storyOver(readyModel, press(code), expectPanel(panel)),
        )
        yield* storyOver(
          readyModel,
          press('KeyC'),
          checkModel(current => {
            expect(current.rootDialog._tag).toBe('Profile')
            expect(current.profile.tab).toBe('Look')
          }),
        )
        yield* storyOver(
          readyModel,
          press('KeyO'),
          checkModel(current => {
            expect(current.rootDialog._tag).toBe('Profile')
            expect(current.profile.tab).toBe('Settings')
            expect(current.rootDialog._tag).not.toBe('Panel')
          }),
        )
      }),
  )

  it.effect('the rail keys and E do nothing in a wave', () =>
    Effect.gen(function* () {
      const fighting = UiStruct.evolve(readyModel, {
        phase: () =>
          Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
      })
      yield* Effect.forEach(['KeyL', 'KeyZ', 'KeyI', 'KeyO', 'KeyE'], code =>
        storyOver(
          fighting,
          press(code),
          checkModel(current => {
            expect(current.rootDialog._tag).not.toBe('Panel')
            expect(current.rootDialog._tag).not.toBe('Profile')
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
      storyOver(
        readyModel,
        openLobbyByKey,
        press('KeyE'),
        resolveFocusLobby(),
        checkModel(current => {
          expect(current.home.mode).toBe('Endless')
          expect(Phase.guards.Ready(current.phase)).toBe(true)
        }),
        send(LobbyMessage.PickedLobbyMode({ mode: 'Campaign' })),
        resolveFocusLobby(),
        checkModel(current => {
          expect(current.home.mode).toBe('Campaign')
          expect(Phase.guards.Ready(current.phase)).toBe(true)
        }),
      ),
  )

  it.effect('E on the home menu itself does nothing now', () =>
    storyOver(
      readyModel,
      press('KeyE'),
      checkModel(current => {
        expect(current.home.mode).toBe('Campaign')
      }),
    ),
  )

  it.effect('START plays the chosen mode', () =>
    Effect.gen(function* () {
      yield* storyOver(
        readyModel,
        send(Message.ClickedPlayButton()),
        resolveFocusLobby(),
        send(LobbyMessage.PickedLobbyMode({ mode: 'Endless' })),
        resolveFocusLobby(),
        send(LobbyMessage.RequestedStartFromLobby()),
        throughIntro,
        checkModel(current => {
          expect(Phase.guards.Preparation(current.phase)).toBe(true)
          expect(current.mode).toEqual(RunMode.Endless())
        }),
      )
      yield* storyOver(
        readyModel,
        send(Message.ClickedPlayButton()),
        resolveFocusLobby(),
        send(LobbyMessage.RequestedStartFromLobby()),
        checkModel(current => {
          expect(current.mode).toEqual(RunMode.Campaign())
        }),
      )
    }),
  )

  it.effect('the chosen mode stays when the player comes home', () =>
    storyOver(
      readyModel,
      openLobbyByKey,
      press('KeyE'),
      resolveFocusLobby(),
      press('Enter'),
      throughIntro,
      press('Escape'),
      press('KeyH'),
      send(Message.ClickedLeaveRunButton()),
      checkModel(current => {
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
      storyOver(
        homeAfterRead,
        checkModel(current => {
          expect(isNewsUnseen(current)).toBe(true)
        }),
        send(Message.ClickedWhatsNewButton()),
        s => s.expectExact(WriteSave),
        writeSave,
        checkModel(current => {
          expect(isNewsUnseen(current)).toBe(false)
          expect(saveOf(current).home.seenNewsDay).toBe(
            Option.getOrThrow(Array.head(NEWS_DAYS)).date,
          )
        }),
      ),
  )

  it.effect(
    'the Older and Newer arrows page through the days and stop at either end',
    () => {
      const lastPage = NEWS_DAYS.length - 1
      return storyOver(
        readyModel,
        send(Message.ClickedWhatsNewButton()),
        send(Message.ClickedNewerNewsButton()),
        checkModel(current => {
          expect(current.home.newsPage).toBe(0)
        }),
        steps(
          ...Array.makeBy(NEWS_DAYS.length + 1, () =>
            send(Message.ClickedOlderNewsButton()),
          ),
        ),
        checkModel(current => {
          expect(current.home.newsPage).toBe(lastPage)
        }),
        send(Message.ClickedNewerNewsButton()),
        checkModel(current => {
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
      storyOver(
        withKills(dyingWith(readyModel, { Runner: 1, Shambler: 3 }), {
          Shambler: 5,
        }),
        tick(FIXED_STEP_MS),
        checkModel(current => {
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
      const fresh = UiStruct.evolve(withKills(homeAfterRead, { Runner: 1 }), {
        home: menu => UiStruct.evolve(menu, { newEntries: () => ['Runner'] }),
      })
      return storyOver(
        fresh,
        send(Message.ClickedNewEntryButton({ kind: 'Runner' })),
        send(Message.OpenedMunchopediaEntry({ kind: 'Runner' })),
        s => s.expectExact(WriteSave),
        writeSave,
        expectPanel('Munchopedia'),
        checkModel(current => {
          expect(current.munchopediaPage).toEqual(
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
      storyOver(
        readyModel,
        send(Message.ClickedMunchopediaButton()),
        send(
          Message.ChangedMunchopediaPage({
            page: MunchopediaPage.Entry({ kind: 'Tank' }),
          }),
        ),
        send(Message.OpenedMunchopediaEntry({ kind: 'Tank' })),
        s => s.expectNone(),
        checkModel(current => {
          expect(current.munchopediaPage).toEqual(
            MunchopediaPage.Entry({ kind: 'Tank' }),
          )
          expect(current.home.openedEntries).toEqual([])
        }),
        send(Message.ChangedMunchopediaPage({ page: MunchopediaPage.List() })),
        checkModel(current => {
          expect(current.munchopediaPage).toEqual(MunchopediaPage.List())
        }),
      ),
  )

  it.effect(
    'the NEW ENTRY pop goes away when the next run starts, but the dot stays',
    () => {
      const fresh = UiStruct.evolve(withKills(readyModel, { Runner: 1 }), {
        home: menu => UiStruct.evolve(menu, { newEntries: () => ['Runner'] }),
      })
      return storyOver(
        fresh,
        startRunFromHome,
        checkModel(current => {
          expect(Phase.guards.Preparation(current.phase)).toBe(true)
          expect(current.home.newEntries).toEqual([])
          expect(hasUnopenedEntry(current)).toBe(true)
        }),
      )
    },
  )

  it.effect('a kind already found raises no NEW ENTRY', () =>
    storyOver(
      withKills(dyingWith(readyModel, { Runner: 4 }), { Runner: 9 }),
      tick(FIXED_STEP_MS),
      checkModel(current => {
        expect(current.bests.killsByKind.Runner).toBe(13)
        expect(current.home.newEntries).toEqual([])
      }),
    ),
  )

  it.effect(
    'Uncle Chunk unlocks when he is beaten, and his entry counts every win over him',
    () =>
      storyOver(
        dyingWith(readyModel, { Boss: 1, Shambler: 20 }),
        tick(FIXED_STEP_MS),
        checkModel(current => {
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
