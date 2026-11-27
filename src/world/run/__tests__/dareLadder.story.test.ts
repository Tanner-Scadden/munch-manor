import { Array, Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it, test } from '@effect/vitest'

import { startOrResume } from '#app/frame/runFlow.ts'
import { Message } from '#app/message.ts'
import { type Model, Phase, RunMode } from '#app/model.ts'
import { effectiveModifiersOf } from '#domain/onlineRun.ts'
import { LobbyMessage } from '#features/lobby/message.ts'
import { FIXED_STEP_MS } from '#shared/constants.ts'
import {
  type SavedDareMarks,
  noDareMarks,
} from '#shared/records/dareMarkData.ts'
import {
  DISTANT_SPAWN,
  escaping,
  quietWave,
  readyAfterRead,
  withFinale,
} from '#test/model.fixture.ts'
import {
  checkModel,
  modelAfter,
  openLobbyByKey,
  playedThrough,
  resolveFocusLobby,
  send,
  settleRunCommands,
  steps,
  throughIntro,
} from '#test/testing.ts'
import { Finale } from '#world/dare/dareSchema.ts'
import { summonAtFrontDoor } from '#world/dare/finale.ts'
import { exitPriceFor } from '#world/level/exits.ts'
import { WEST_EXIT } from '#world/level/plan.ts'
import { roomSettingsOf, startRoomWorld } from '#world/net/roomWorld.ts'
import { focusOf } from '#world/party/party.ts'
import {
  MARKS,
  activeModifiersOf,
  chunkHealthScaleOf,
  markBonusPercentOf,
  markSpawns,
  runBonusPercentOf,
  withMarkModifiers,
} from '#world/run/dareLadder.ts'
import { breakClockMsOf } from '#world/run/difficulty.ts'
import { bonusPercentOf, noModifiers } from '#world/run/modifiers.ts'
import type { World } from '#world/schema/world.ts'
import type { PlannedSpawn } from '#world/schema/worldSchema.ts'
import { FINAL_WAVE } from '#world/waves/wavePlans.ts'
import { beginPreparation } from '#world/waves/waves.ts'

const atMark = (model: Model, mark: number): Model =>
  UiStruct.evolve(model, { dareMark: () => mark })

const withMarksOpened = (model: Model, dareMarks: SavedDareMarks): Model =>
  UiStruct.evolve(model, { dareMarks: () => dareMarks })

describe('the marks and their rules', () => {
  test('marks 1 to 4 turn on Big Crowd, Broke, Glass, then Friendly Fire', () => {
    expect(withMarkModifiers(noModifiers, 0)).toEqual(noModifiers)
    expect(withMarkModifiers(noModifiers, 1)).toEqual({
      ...noModifiers,
      bigCrowd: true,
    })
    expect(withMarkModifiers(noModifiers, 2)).toEqual({
      ...noModifiers,
      bigCrowd: true,
      broke: true,
    })
    expect(withMarkModifiers(noModifiers, 3)).toEqual({
      ...noModifiers,
      bigCrowd: true,
      broke: true,
      glass: true,
    })
    Array.forEach([4, 5, 8], mark => {
      expect(withMarkModifiers(noModifiers, mark)).toEqual({
        friendlyFire: true,
        bigCrowd: true,
        broke: true,
        glass: true,
      })
    })
  })

  test('each house rule adds 25 to the bonus, on top of its modifiers', () => {
    expect(Array.map([0, 1, 4, 5, 8], markBonusPercentOf)).toEqual([
      0, 0, 0, 25, 100,
    ])
    const all = withMarkModifiers(noModifiers, 8)
    expect(runBonusPercentOf(all, 8)).toBe(bonusPercentOf(all) + 100)
    expect(runBonusPercentOf(noModifiers, 0)).toBe(0)
  })

  test('mark 0 changes no rule of the World', () => {
    const wave = quietWave(3)
    const plain = atMark(wave, 0)
    expect(activeModifiersOf(plain)).toEqual(wave.modifiers)
    expect(breakClockMsOf(plain)).toEqual(breakClockMsOf(wave))
    expect(exitPriceFor(plain, WEST_EXIT)).toBe(exitPriceFor(wave, WEST_EXIT))
    expect(chunkHealthScaleOf(0)).toBe(1)
    const spawns: ReadonlyArray<PlannedSpawn> = [
      { ...DISTANT_SPAWN, kind: 'Runner' },
    ]
    expect(markSpawns(0, spawns)).toBe(spawns)
  })

  test('mark 5: Hotfoots run 1.15x faster, and nothing else does', () => {
    const spawns: ReadonlyArray<PlannedSpawn> = [
      { ...DISTANT_SPAWN, kind: 'Runner', speedScale: 1 },
      { ...DISTANT_SPAWN, kind: 'Shambler', speedScale: 1 },
    ]
    expect(Array.map(markSpawns(4, spawns), spawn => spawn.speedScale)).toEqual(
      [1, 1],
    )
    expect(Array.map(markSpawns(5, spawns), spawn => spawn.speedScale)).toEqual(
      [1.15, 1],
    )
  })

  test('mark 5 reaches the wave: its Hotfoots are planned faster', () => {
    const plannedRunnerSpeeds = (mark: number) => {
      const prepared = beginPreparation(atMark(quietWave(5), mark), 6, 10_000)
      return Phase.isAnyOf(['Preparation'])(prepared.phase)
        ? Array.map(
            Array.filter(
              prepared.phase.spawns,
              spawn => spawn.kind === 'Runner',
            ),
            spawn => spawn.speedScale,
          )
        : []
    }
    const plain = plannedRunnerSpeeds(4)
    const marked = plannedRunnerSpeeds(5)
    expect(plain.length).toBeGreaterThan(0)
    expect(marked).toEqual(Array.map(plain, speed => speed * 1.15))
  })

  test('mark 6: every padlock asks 1.25x its keys, rounded', () => {
    const wave = quietWave(3)
    const keys = exitPriceFor(atMark(wave, 5), WEST_EXIT)
    expect(exitPriceFor(atMark(wave, 6), WEST_EXIT)).toBe(
      Math.round(keys * 1.25),
    )
  })

  test('mark 7: the break clock runs three quarters of its time, and Dare gets one', () => {
    const wave = quietWave(3)
    const clock = Option.getOrThrow(breakClockMsOf(atMark(wave, 6)))
    expect(breakClockMsOf(atMark(wave, 7))).toEqual(
      Option.some(Math.max(10_000, Math.round(clock * 0.75))),
    )
    const dare = UiStruct.evolve(wave, {
      difficulty: setting => UiStruct.evolve(setting, { chosen: () => 'Easy' }),
      easyBreakSeconds: () => 0,
    })
    expect(breakClockMsOf(atMark(dare, 6))).toEqual(Option.none())
    expect(breakClockMsOf(atMark(dare, 7))).toEqual(Option.some(45_000))
  })

  test('Uncle Chunk never changes below mark 5, and mark 8 makes him 1.25x tougher', () => {
    const chunkHpAt = (mark: number): number => {
      const summoned = summonAtFrontDoor(
        atMark(withFinale(quietWave(FINAL_WAVE), Finale.Summoned()), mark),
        [DISTANT_SPAWN],
      )
      return summoned.boss._tag === 'Waiting' ? summoned.boss.hp : 0
    }
    const plain = chunkHpAt(0)
    expect(plain).toBeGreaterThan(0)
    Array.forEach([1, 2, 3, 4, 5, 6, 7], mark => {
      expect(chunkHpAt(mark)).toBe(plain)
    })
    expect(chunkHpAt(8)).toBe(Math.round(plain * 1.25))
  })
})

describe('a run at a mark', () => {
  it.effect(
    'START plays the mark picked: its modifiers bite in the World',
    () =>
      modelAfter(
        atMark(
          withMarksOpened(readyAfterRead, { ...noDareMarks, Normal: 3 }),
          3,
        ),
        steps(
          openLobbyByKey,
          send(LobbyMessage.RequestedStartFromLobby()),
          throughIntro,
          checkModel(current => {
            expect(Phase.guards.Preparation(current.phase)).toBe(true)
            expect(current.dareMark).toBe(3)
            expect(current.modifiers).toEqual(noModifiers)
            expect(activeModifiersOf(current)).toEqual({
              ...noModifiers,
              bigCrowd: true,
              broke: true,
              glass: true,
            })
            expect(focusOf(current).player.hp).toBe(1)
          }),
        ),
      ),
  )

  test('a run at mark 0 starts as it always has', () => {
    const plain = startOrResume(readyAfterRead, RunMode.Campaign())
    const marked = startOrResume(atMark(readyAfterRead, 0), RunMode.Campaign())
    expect(marked).toEqual(plain)
    expect(effectiveModifiersOf(plain)).toEqual(noModifiers)
  })

  it.effect(
    'the pick steps through the marks opened, and a new difficulty holds it there',
    () =>
      modelAfter(
        withMarksOpened(readyAfterRead, {
          ...noDareMarks,
          Normal: 2,
          Hard: 1,
        }),
        steps(
          openLobbyByKey,
          send(LobbyMessage.SteppedLobbyDareMark()),
          send(LobbyMessage.SteppedLobbyDareMark()),
          settleRunCommands,
          checkModel(current => {
            expect(current.dareMark).toBe(2)
          }),
          send(LobbyMessage.PickedLobbyDifficulty({ difficulty: 'Hard' })),
          resolveFocusLobby('Start'),
          settleRunCommands,
          checkModel(current => {
            expect(current.difficulty.chosen).toBe('Hard')
            expect(current.dareMark).toBe(1)
          }),
        ),
      ),
  )
})

describe('climbing the ladder', () => {
  const escapeAt = (mark: number, opened: SavedDareMarks): Model =>
    escaping(
      atMark(
        withMarksOpened(
          UiStruct.evolve(readyAfterRead, {
            phase: () =>
              Phase.Wave({
                wave: FINAL_WAVE,
                elapsedMs: 90_000,
                spawns: [DISTANT_SPAWN],
              }),
          }),
          opened,
        ),
        mark,
      ),
    )

  const escaped = (start: Model) =>
    playedThrough(start, [Message.TickedFrame({ deltaTime: FIXED_STEP_MS })])

  it.effect('an escape with no mark opens mark 1', () =>
    Effect.map(escaped(escapeAt(0, noDareMarks)), after => {
      expect(Phase.guards.Escaped(after.phase)).toBe(true)
      expect(after.dareMarks).toEqual({ ...noDareMarks, Normal: 1 })
    }),
  )

  it.effect('an escape at mark N opens N + 1, on that difficulty alone', () =>
    Effect.map(
      escaped(escapeAt(3, { ...noDareMarks, Normal: 3, Hard: 2 })),
      after => {
        expect(after.dareMarks).toEqual({ ...noDareMarks, Normal: 4, Hard: 2 })
      },
    ),
  )

  it.effect('an escape below the best opens nothing new', () =>
    Effect.map(escaped(escapeAt(1, { ...noDareMarks, Normal: 6 })), after => {
      expect(after.dareMarks).toEqual({ ...noDareMarks, Normal: 6 })
    }),
  )

  it.effect('the ladder stops at its top', () =>
    Effect.map(escaped(escapeAt(8, { ...noDareMarks, Normal: 8 })), after => {
      expect(after.dareMarks.Normal).toBe(Math.max(...MARKS))
    }),
  )

  it.effect('a run lost opens nothing', () =>
    Effect.map(
      playedThrough(
        atMark(withMarksOpened(quietWave(4), { ...noDareMarks, Normal: 2 }), 2),
        [Message.TickedFrame({ deltaTime: FIXED_STEP_MS })],
      ),
      after => {
        expect(after.dareMarks).toEqual({ ...noDareMarks, Normal: 2 })
      },
    ),
  )
})

describe('the crew room', () => {
  test('the room plays the mark it starts with, its modifiers and house rules', () => {
    const room = startRoomWorld(
      [0, 1],
      7,
      roomSettingsOf('Campaign', 'Normal', [], 0, 0, 6),
    )
    expect(room.world.dareMark).toBe(6)
    expect(activeModifiersOf(room.world)).toEqual({
      friendlyFire: true,
      bigCrowd: true,
      broke: true,
      glass: true,
    })
    Array.forEach(focusOfAll(room.world), hp => {
      expect(hp).toBe(1)
    })
    const plain = startRoomWorld(
      [0, 1],
      7,
      roomSettingsOf('Campaign', 'Normal', [], 0, 0),
    )
    expect(plain.world.dareMark).toBe(0)
    expect(activeModifiersOf(plain.world)).toEqual(noModifiers)
  })

  test('a mark off the ladder is held to it', () => {
    expect(roomSettingsOf('Campaign', 'Normal', [], 0, 0, 12).dareMark).toBe(8)
    expect(roomSettingsOf('Campaign', 'Normal', [], 0, 0, -1).dareMark).toBe(0)
  })
})

const focusOfAll = (world: World): ReadonlyArray<number> =>
  Array.map(world.seats, seat => seat.player.hp)
