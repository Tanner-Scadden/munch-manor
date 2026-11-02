import { Array, Option } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { toParentMessage } from 'foldkit/test'
import { describe, expect, test } from 'vitest'

import { DialogBlock } from '@foldkit/ui'

import { PanelDialogBinding } from './bindings'
import { FIXED_STEP_MS } from './constants'
import { biteDamage } from './difficulty'
import { bestsFor } from './home'
import { update } from './main'
import { Message } from './message'
import {
  type Difficulty,
  DifficultyCard,
  Frenzy,
  Invulnerability,
  type Model,
  type NightmareLock,
  Phase,
  RunMode,
  type Zombie,
  ZombieAction,
  ZombieState,
} from './model'
import { newPlayerReady, readyModel } from './model.fixture'
import {
  closeDialog,
  openLobbyByKey,
  press,
  resolveFocusLobby,
  showDialog,
  startRunFromHome,
  startedRunOf,
  tick,
} from './testing'
import { FINAL_WAVE } from './wavePlans'
import { ZOMBIE_KINDS } from './zombies'

const pick = (difficulty: Difficulty) =>
  message(Message.ClickedDifficultyCardButton({ difficulty }))

const preparationSpawns = (current: Model) =>
  Phase.match(current.phase, {
    Ready: () => [],
    Preparation: ({ spawns }) => spawns,
    Wave: ({ spawns }) => spawns,
    Paused: () => [],
    Victory: () => [],
    GameOver: () => [],
  })

const withDifficulty = (
  base: Model,
  chosen: Difficulty,
  nightmare: NightmareLock = 'Locked',
): Model => modifyFields(base, { difficulty: () => ({ chosen, nightmare }) })

describe('the first-time difficulty card', () => {
  test('the first PLAY asks, the pick starts the campaign, and it never asks again', () => {
    story(
      update,
      given(newPlayerReady),
      message(Message.ClickedCampaignButton()),
      showDialog(),
      model(current => {
        expect(Phase.guards.Ready(current.phase)).toBe(true)
        expect(current.panel).toBe('Difficulty')
        expect(current.panelDialog.isOpen).toBe(true)
        expect(current.difficultyCard).toEqual(
          DifficultyCard.Asking({ mode: RunMode.Campaign() }),
        )
      }),
      pick('Easy'),
      closeDialog(),
      model(current => {
        expect(Phase.guards.Preparation(current.phase)).toBe(true)
        expect(current.mode).toEqual(RunMode.Campaign())
        expect(current.difficulty.chosen).toBe('Easy')
        expect(current.difficultyCard).toEqual(DifficultyCard.Seen())
        expect(current.panelDialog.isOpen).toBe(false)
      }),
    )
  })

  test('closing the card starts nothing, and the next PLAY asks again', () => {
    story(
      update,
      given(newPlayerReady),
      press('Enter'),
      showDialog(),
      message(
        toParentMessage(
          PanelDialogBinding,
          DialogBlock.Message.RequestedClose(),
        ),
      ),
      closeDialog(),
      model(current => {
        expect(Phase.guards.Ready(current.phase)).toBe(true)
        expect(current.difficultyCard).toEqual(DifficultyCard.Unseen())
      }),
      press('Enter'),
      showDialog(),
      model(current => {
        expect(current.panel).toBe('Difficulty')
        expect(current.panelDialog.isOpen).toBe(true)
      }),
    )
  })

  test('a veteran who has picked opens the lobby, and START goes in', () => {
    story(
      update,
      given(readyModel),
      openLobbyByKey,
      model(current => {
        expect(Phase.guards.Ready(current.phase)).toBe(true)
        expect(current.panelDialog.isOpen).toBe(false)
      }),
      press('Enter'),
      model(current => {
        expect(Phase.guards.Preparation(current.phase)).toBe(true)
        expect(current.panelDialog.isOpen).toBe(false)
      }),
    )
  })

  test('Nightmare is locked until a Hard win', () => {
    story(
      update,
      given(newPlayerReady),
      press('Enter'),
      showDialog(),
      pick('Nightmare'),
      model(current => {
        expect(Phase.guards.Ready(current.phase)).toBe(true)
        expect(current.difficulty.chosen).toBe('Normal')
        expect(current.panelDialog.isOpen).toBe(true)
      }),
    )
  })
})

const lobbyDifficulty = (difficulty: Difficulty) =>
  message(Message.ClickedLobbyDifficultyButton({ difficulty }))

describe('difficulty in the lobby', () => {
  test('a tile changes the difficulty without starting a run, but not Nightmare while locked', () => {
    story(
      update,
      given(readyModel),
      openLobbyByKey,
      lobbyDifficulty('Nightmare'),
      model(current => {
        expect(current.difficulty.chosen).toBe('Normal')
      }),
      lobbyDifficulty('Hard'),
      resolveFocusLobby(),
      model(current => {
        expect(current.difficulty.chosen).toBe('Hard')
        expect(Phase.guards.Ready(current.phase)).toBe(true)
        expect(current.home.lobby).toBe('Open')
      }),
    )
  })

  test('X steps to the next difficulty, skipping a locked Nightmare', () => {
    story(
      update,
      given(withDifficulty(readyModel, 'Hard')),
      openLobbyByKey,
      press('KeyX'),
      resolveFocusLobby(),
      model(current => {
        expect(current.difficulty.chosen).toBe('Easy')
      }),
      press('KeyX'),
      resolveFocusLobby(),
      model(current => {
        expect(current.difficulty.chosen).toBe('Normal')
      }),
    )
    story(
      update,
      given(withDifficulty(readyModel, 'Hard', 'Unlocked')),
      openLobbyByKey,
      press('KeyX'),
      resolveFocusLobby(),
      model(current => {
        expect(current.difficulty.chosen).toBe('Nightmare')
      }),
    )
  })

  test('the home menu has no difficulty key', () => {
    story(
      update,
      given(readyModel),
      press('KeyX'),
      model(current => {
        expect(current.panelDialog.isOpen).toBe(false)
        expect(current.home.lobby).toBe('Closed')
      }),
    )
  })

  test('a difficulty tile outside the lobby does nothing', () => {
    story(
      update,
      given(
        modifyFields(readyModel, {
          phase: () => Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [] }),
        }),
      ),
      lobbyDifficulty('Easy'),
      model(current => {
        expect(current.difficulty.chosen).toBe('Normal')
      }),
    )
  })
})

const winning = (base: Model): Model =>
  modifyFields(base, {
    phase: () =>
      Phase.Wave({ wave: FINAL_WAVE, elapsedMs: 90_000, spawns: [] }),
  })

describe('unlocking Nightmare', () => {
  test('a Hard campaign win unlocks it, the next run settles it, and the picker can pick it', () => {
    story(
      update,
      given(winning(withDifficulty(readyModel, 'Hard'))),
      tick(FIXED_STEP_MS),
      model(current => {
        expect(Phase.guards.Victory(current.phase)).toBe(true)
        expect(current.difficulty.nightmare).toBe('JustUnlocked')
        expect(bestsFor(current).maybeFastestWinMs).toEqual(
          Option.some(FIXED_STEP_MS),
        )
        expect(current.bests.byDifficulty.Normal.maybeFastestWinMs).toEqual(
          Option.none(),
        )
      }),
    )

    story(
      update,
      given(withDifficulty(readyModel, 'Hard', 'JustUnlocked')),
      startRunFromHome,
      model(current => {
        expect(Phase.guards.Preparation(current.phase)).toBe(true)
        expect(current.difficulty.nightmare).toBe('Unlocked')
      }),
    )

    story(
      update,
      given(withDifficulty(readyModel, 'Hard', 'Unlocked')),
      openLobbyByKey,
      lobbyDifficulty('Nightmare'),
      resolveFocusLobby(),
      model(current => {
        expect(current.difficulty.chosen).toBe('Nightmare')
      }),
    )
  })

  test('a Normal win leaves it locked', () => {
    story(
      update,
      given(winning(readyModel)),
      tick(FIXED_STEP_MS),
      model(current => {
        expect(Phase.guards.Victory(current.phase)).toBe(true)
        expect(current.difficulty.nightmare).toBe('Locked')
      }),
    )
  })
})

describe('the multipliers', () => {
  const startedOn = (difficulty: Difficulty): Model =>
    startedRunOf(withDifficulty(readyModel, difficulty, 'Unlocked'))

  test('each difficulty scales the same wave by its health and speed', () => {
    const normal = preparationSpawns(startedOn('Normal'))
    const easy = preparationSpawns(startedOn('Easy'))
    const nightmare = preparationSpawns(startedOn('Nightmare'))
    expect(Array.isReadonlyArrayNonEmpty(normal)).toBe(true)
    expect(Array.map(easy, ({ kind, door }) => [kind, door])).toEqual(
      Array.map(normal, ({ kind, door }) => [kind, door]),
    )
    Array.forEach(Array.zip(normal, easy), ([base, scaled]) => {
      expect(scaled.hpScale).toBeCloseTo((base.hpScale * 0.6) / 0.75)
      expect(scaled.speedScale).toBeCloseTo((base.speedScale * 0.8) / 0.84)
    })
    Array.forEach(Array.zip(normal, nightmare), ([base, scaled]) => {
      expect(scaled.hpScale).toBeCloseTo((base.hpScale * 1.16) / 0.75)
      expect(scaled.speedScale).toBeCloseTo((base.speedScale * 1.02) / 0.84)
    })
  })

  test('bites round to whole hearts and never drop below one', () => {
    expect(biteDamage('Easy', 1)).toBe(1)
    expect(biteDamage('Easy', 2)).toBe(1)
    expect(biteDamage('Normal', 2)).toBe(2)
    expect(biteDamage('Hard', 2)).toBe(2)
    expect(biteDamage('Nightmare', 1)).toBe(1)
    expect(biteDamage('Nightmare', 2)).toBe(3)
  })

  test('a Big Lug bites one heart on Easy, two on Normal, and three on Nightmare', () => {
    const lug: Zombie = {
      id: 900,
      kind: 'Tank',
      x: 168,
      y: 95,
      speed: 0,
      hp: ZOMBIE_KINDS.Tank.hp,
      maxHp: ZOMBIE_KINDS.Tank.hp,
      knockback: { x: 0, y: 0 },
      hitRemainingMs: 0,
      state: ZombieState.Walking(),
      action: ZombieAction.Roaming(),
      frenzy: Frenzy.Calm(),
    }
    const bitten = (difficulty: Difficulty): number =>
      update(
        modifyFields(withDifficulty(readyModel, difficulty, 'Unlocked'), {
          phase: () => Phase.Wave({ wave: 5, elapsedMs: 0, spawns: [] }),
          zombies: () => [lug],
          player: player =>
            modifyFields(player, {
              x: () => 160,
              y: () => 95,
              invulnerability: () => Invulnerability.Vulnerable(),
            }),
        }),
        Message.TickedFrame({ deltaTime: FIXED_STEP_MS }),
      ).model.player.hp
    const full = readyModel.player.hp
    expect(full - bitten('Easy')).toBe(1)
    expect(full - bitten('Normal')).toBe(2)
    expect(full - bitten('Nightmare')).toBe(3)
  })
})
