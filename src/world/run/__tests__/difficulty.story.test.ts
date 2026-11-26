import { Array, Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it, test } from '@effect/vitest'

import { Message } from '../../../app/message'
import {
  type Difficulty,
  DifficultyCard,
  Frenzy,
  Invulnerability,
  type Model,
  type NightmareLock,
  Phase,
  type PlannedSpawn,
  RunMode,
  type Zombie,
  ZombieAction,
  ZombieState,
} from '../../../app/model'
import { LobbyMessage } from '../../../features/lobby/message'
import { bestsFor } from '../../../screens/home/home'
import { FIXED_STEP_MS } from '../../../shared/constants'
import {
  DISTANT_SPAWN,
  escaping,
  newPlayerReady,
  readyModel,
} from '../../../test/model.fixture'
import {
  checkModel,
  modelAfter,
  openLobbyByKey,
  playPendingSounds,
  press,
  resolveFocusLobby,
  send,
  startRunFromHome,
  startedRun,
  steps,
  throughIntro,
  tick,
} from '../../../test/testing'
import { focusOf, modifyFocus } from '../../party/party'
import { FINAL_WAVE } from '../../waves/wavePlans'
import { ZOMBIE_KINDS } from '../../zombies/zombies'
import { DIFFICULTIES, biteDamage, toughenSpawns } from '../difficulty'

const pick = (difficulty: Difficulty) =>
  send(Message.ClickedDifficultyCardButton({ difficulty }))

const preparationSpawns = (current: Model) =>
  Phase.match(current.phase, {
    Ready: () => [],
    Arriving: () => [],
    Preparation: ({ spawns }) => spawns,
    Wave: ({ spawns }) => spawns,
    Paused: () => [],
    Escaped: () => [],
    LeftEarly: () => [],
    GameOver: () => [],
  })

const runnerScale = (difficulty: Difficulty, kind: string) =>
  kind === 'Runner' ? DIFFICULTIES[difficulty].runnerSpeedScale : 1

const withDifficulty = (
  base: Model,
  chosen: Difficulty,
  nightmare: NightmareLock = 'Locked',
): Model => UiStruct.evolve(base, { difficulty: () => ({ chosen, nightmare }) })

describe('the first-time difficulty card', () => {
  it.effect(
    'the first PLAY asks, the pick starts the campaign, and it never asks again',
    () =>
      modelAfter(
        newPlayerReady,
        steps(
          send(Message.ClickedCampaignButton()),
          checkModel(current => {
            expect(Phase.guards.Ready(current.phase)).toBe(true)
            expect(current.panel).toBe('Difficulty')
            expect(current.panelDialog.isOpen).toBe(true)
            expect(current.difficultyCard).toEqual(
              DifficultyCard.Asking({
                mode: RunMode.Campaign(),
                tutorial: 'Tutorial',
              }),
            )
          }),
          pick('Easy'),
          throughIntro,
          checkModel(current => {
            expect(Phase.guards.Preparation(current.phase)).toBe(true)
            expect(current.mode).toEqual(RunMode.Campaign())
            expect(current.difficulty.chosen).toBe('Easy')
            expect(current.difficultyCard).toEqual(DifficultyCard.Seen())
            expect(current.panelDialog.isOpen).toBe(false)
          }),
        ),
      ),
  )

  it.effect(
    'closing the card starts nothing, and the next PLAY asks again',
    () =>
      modelAfter(
        newPlayerReady,
        steps(
          press('Enter'),
          send(Message.ClosedDialog({ dialog: 'Panel' })),
          checkModel(current => {
            expect(Phase.guards.Ready(current.phase)).toBe(true)
            expect(current.difficultyCard).toEqual(DifficultyCard.Unseen())
          }),
          press('Enter'),
          checkModel(current => {
            expect(current.panel).toBe('Difficulty')
            expect(current.panelDialog.isOpen).toBe(true)
          }),
        ),
      ),
  )

  it.effect('a veteran who has picked opens the lobby, and START goes in', () =>
    modelAfter(
      readyModel,
      steps(
        openLobbyByKey,
        checkModel(current => {
          expect(Phase.guards.Ready(current.phase)).toBe(true)
          expect(current.panelDialog.isOpen).toBe(false)
        }),
        press('Enter'),
        throughIntro,
        checkModel(current => {
          expect(Phase.guards.Preparation(current.phase)).toBe(true)
          expect(current.panelDialog.isOpen).toBe(false)
        }),
      ),
    ),
  )

  it.effect('Nightmare is locked until a Hard win', () =>
    modelAfter(
      newPlayerReady,
      steps(
        press('Enter'),
        pick('Nightmare'),
        checkModel(current => {
          expect(Phase.guards.Ready(current.phase)).toBe(true)
          expect(current.difficulty.chosen).toBe('Normal')
          expect(current.panelDialog.isOpen).toBe(true)
        }),
      ),
    ),
  )
})

const lobbyDifficulty = (difficulty: Difficulty) =>
  send(LobbyMessage.PickedLobbyDifficulty({ difficulty }))

describe('difficulty in the lobby', () => {
  it.effect(
    'a tile changes the difficulty without starting a run, but not Nightmare while locked',
    () =>
      modelAfter(
        readyModel,
        steps(
          openLobbyByKey,
          lobbyDifficulty('Nightmare'),
          checkModel(current => {
            expect(current.difficulty.chosen).toBe('Normal')
          }),
          lobbyDifficulty('Hard'),
          resolveFocusLobby(),
          checkModel(current => {
            expect(current.difficulty.chosen).toBe('Hard')
            expect(Phase.guards.Ready(current.phase)).toBe(true)
            expect(current.lobby.status).toBe('Open')
          }),
        ),
      ),
  )

  it.effect('X steps to the next difficulty, skipping a locked Nightmare', () =>
    Effect.gen(function* () {
      yield* modelAfter(
        withDifficulty(readyModel, 'Hard'),
        steps(
          openLobbyByKey,
          press('KeyX'),
          resolveFocusLobby(),
          checkModel(current => {
            expect(current.difficulty.chosen).toBe('Easy')
          }),
          press('KeyX'),
          resolveFocusLobby(),
          checkModel(current => {
            expect(current.difficulty.chosen).toBe('Normal')
          }),
        ),
      )
      yield* modelAfter(
        withDifficulty(readyModel, 'Hard', 'Unlocked'),
        steps(
          openLobbyByKey,
          press('KeyX'),
          resolveFocusLobby(),
          checkModel(current => {
            expect(current.difficulty.chosen).toBe('Nightmare')
          }),
        ),
      )
    }),
  )

  it.effect('the home menu has no difficulty key', () =>
    modelAfter(
      readyModel,
      steps(
        press('KeyX'),
        checkModel(current => {
          expect(current.panelDialog.isOpen).toBe(false)
          expect(current.lobby.status).toBe('Closed')
        }),
      ),
    ),
  )

  it.effect('a difficulty tile outside the lobby does nothing', () =>
    modelAfter(
      UiStruct.evolve(readyModel, {
        phase: () => Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [] }),
      }),
      steps(
        lobbyDifficulty('Easy'),
        checkModel(current => {
          expect(current.difficulty.chosen).toBe('Normal')
        }),
      ),
    ),
  )
})

const winning = (base: Model): Model =>
  escaping(
    UiStruct.evolve(base, {
      phase: () =>
        Phase.Wave({
          wave: FINAL_WAVE,
          elapsedMs: 90_000,
          spawns: [DISTANT_SPAWN],
        }),
    }),
  )

describe('unlocking Nightmare', () => {
  it.effect(
    'a Hard escape unlocks it, the next run settles it, and the picker can pick it',
    () =>
      Effect.gen(function* () {
        yield* modelAfter(
          winning(withDifficulty(readyModel, 'Hard')),
          steps(
            tick(FIXED_STEP_MS),
            checkModel(current => {
              expect(Phase.guards.Escaped(current.phase)).toBe(true)
              expect(current.difficulty.nightmare).toBe('JustUnlocked')
              expect(bestsFor(current).maybeFastestWinMs).toEqual(
                Option.some(FIXED_STEP_MS),
              )
              expect(
                current.bests.byDifficulty.Normal.maybeFastestWinMs,
              ).toEqual(Option.none())
            }),
          ),
        )

        yield* modelAfter(
          withDifficulty(readyModel, 'Hard', 'JustUnlocked'),
          steps(
            startRunFromHome,
            checkModel(current => {
              expect(Phase.guards.Preparation(current.phase)).toBe(true)
              expect(current.difficulty.nightmare).toBe('Unlocked')
            }),
          ),
        )

        yield* modelAfter(
          withDifficulty(readyModel, 'Hard', 'Unlocked'),
          steps(
            openLobbyByKey,
            lobbyDifficulty('Nightmare'),
            resolveFocusLobby(),
            checkModel(current => {
              expect(current.difficulty.chosen).toBe('Nightmare')
            }),
          ),
        )
      }),
  )

  it.effect('a Normal escape leaves it locked', () =>
    modelAfter(
      winning(readyModel),
      steps(
        tick(FIXED_STEP_MS),
        checkModel(current => {
          expect(Phase.guards.Escaped(current.phase)).toBe(true)
          expect(current.difficulty.nightmare).toBe('Locked')
        }),
      ),
    ),
  )
})

describe('the multipliers', () => {
  const spawnsOn = (difficulty: Difficulty) =>
    Effect.map(
      startedRun(withDifficulty(readyModel, difficulty, 'Unlocked')),
      preparationSpawns,
    )

  it.effect(
    'each difficulty scales the same wave by its health and speed',
    () =>
      Effect.gen(function* () {
        const normal = yield* spawnsOn('Normal')
        const easy = yield* spawnsOn('Easy')
        const nightmare = yield* spawnsOn('Nightmare')
        expect(Array.isReadonlyArrayNonEmpty(normal)).toBe(true)
        expect(Array.map(easy, ({ kind, door }) => [kind, door])).toEqual(
          Array.map(normal, ({ kind, door }) => [kind, door]),
        )
        Array.forEach(Array.zip(normal, easy), ([base, scaled]) => {
          expect(scaled.hpScale).toBeCloseTo((base.hpScale * 0.6) / 0.68)
          expect(scaled.speedScale).toBeCloseTo(
            (base.speedScale * 0.8 * runnerScale('Easy', scaled.kind)) /
              (0.84 * runnerScale('Normal', base.kind)),
          )
        })
        Array.forEach(Array.zip(normal, nightmare), ([base, scaled]) => {
          expect(scaled.hpScale).toBeCloseTo((base.hpScale * 1.12) / 0.68)
          expect(scaled.speedScale).toBeCloseTo(
            (base.speedScale * 1.02) /
              (0.84 * runnerScale('Normal', base.kind)),
          )
        })
      }),
  )

  describe('the Runners catch their breath on Easy and Normal', () => {
    const planned = [
      { ...DISTANT_SPAWN, kind: 'Shambler', speedScale: 1, hpScale: 1 },
      { ...DISTANT_SPAWN, kind: 'Runner', speedScale: 1, hpScale: 1 },
    ] satisfies ReadonlyArray<PlannedSpawn>
    const speedsOn = (difficulty: Difficulty) =>
      Array.map(toughenSpawns(difficulty, planned), spawn => spawn.speedScale)

    test('Easy and Normal slow a Runner more than a Shambler', () => {
      expect(speedsOn('Easy')).toEqual([0.8, 0.8 * 0.6])
      expect(speedsOn('Normal')).toEqual([0.84, 0.84 * 0.65])
    })

    test('Hard and Nightmare keep a Runner at the plain scale', () => {
      expect(speedsOn('Hard')).toEqual([1.02, 1.02])
      expect(speedsOn('Nightmare')).toEqual([1.02, 1.02])
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

  it.effect(
    'a Big Lug bites one heart on Easy, two on Normal, and three on Nightmare',
    () => {
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
      const full = focusOf(readyModel).player.hp
      const bites = (difficulty: Difficulty, hearts: number) =>
        modelAfter(
          modifyFocus(
            UiStruct.evolve(
              withDifficulty(readyModel, difficulty, 'Unlocked'),
              {
                phase: () => Phase.Wave({ wave: 5, elapsedMs: 0, spawns: [] }),
                zombies: () => [lug],
              },
            ),
            {
              player: player =>
                UiStruct.evolve(player, {
                  x: () => 160,
                  y: () => 95,
                  invulnerability: () => Invulnerability.Vulnerable(),
                }),
            },
          ),
          steps(
            tick(FIXED_STEP_MS),
            checkModel(current => {
              expect(full - focusOf(current).player.hp).toBe(hearts)
            }),
            playPendingSounds,
          ),
        )
      return Effect.gen(function* () {
        yield* bites('Easy', 1)
        yield* bites('Normal', 2)
        yield* bites('Nightmare', 3)
      })
    },
  )
})
