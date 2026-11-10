import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import { Message } from '../../../app/message'
import {
  type Model,
  Phase,
  type PlannedSpawn,
  type Zombie,
} from '../../../app/model'
import {
  FIRST_PREPARATION_MS,
  FIXED_STEP_MS,
  PREPARATION_MS,
} from '../../../shared/constants'
import { plannedSpawn, readyModel } from '../../../test/model.fixture'
import {
  APPLICATION,
  bulletInto,
  doomed,
  holdFire,
  press,
  release,
  scoring,
  startRunFromHome,
  tick,
  ticks,
  zombieAt,
} from '../../../test/testing'
import { START_LEVEL } from '../../level/arena'
import { modifyFocus } from '../../party/party'
import { scoreOf } from '../../run/stats'
import { hasBoss } from '../../zombies/boss'
import { frenzyPacksOf, isFrenzyPack } from '../../zombies/frenzy'
import { ZOMBIE_KINDS } from '../../zombies/zombies'
import { doorCounts, rollSpawns } from '../endlessWaves'
import { CHUCKER_ESCORT_SIZE } from '../wavePacks'
import { FINAL_WAVE, type SpawnGroup, WAVE_PLANS } from '../wavePlans'
import { roundWave } from '../waves'

const FRAME_MS = 50
const inWave = (
  wave: number,
  spawns: ReadonlyArray<PlannedSpawn>,
  zombies: ReadonlyArray<Zombie>,
): Model =>
  modifyFields(readyModel, {
    phase: () => Phase.Wave({ wave, elapsedMs: 0, spawns }),
    zombies: () => zombies,
  })

const killShot = (base: Model, zombie: Zombie): Model =>
  modifyFields(base, { bullets: () => [bulletInto(500, zombie)] })

const farAway = zombieAt(101, 40, 150)

describe('preparation', () => {
  it.effect(
    'the first preparation is short, counts down, and starts wave 1 with its plan',
    () => {
      const frames = Math.ceil(FIRST_PREPARATION_MS / FRAME_MS)
      const plans: Array<ReadonlyArray<PlannedSpawn>> = []

      return Story.story(
        APPLICATION,
        Story.given(readyModel),
        startRunFromHome,
        release('Enter'),
        Story.model(({ phase }) => {
          const preparation = Option.getOrThrow(
            Option.liftPredicate(phase, Phase.guards.Preparation),
          )
          expect(preparation.wave).toBe(1)
          expect(preparation.remainingMs).toBe(FIRST_PREPARATION_MS)
          expect(preparation.durationMs).toBe(FIRST_PREPARATION_MS)
          expect(Array.isReadonlyArrayNonEmpty(preparation.spawns)).toBe(true)
          plans.push(preparation.spawns)
        }),
        ...ticks(10, FRAME_MS),
        Story.model(({ phase }) => {
          const preparation = Option.getOrThrow(
            Option.liftPredicate(phase, Phase.guards.Preparation),
          )
          expect(preparation.wave).toBe(1)
          expect(preparation.remainingMs).toBeCloseTo(
            FIRST_PREPARATION_MS - 10 * FRAME_MS,
          )
          expect(preparation.durationMs).toBe(FIRST_PREPARATION_MS)
          expect(preparation.spawns).toEqual(
            Option.getOrThrow(Array.head(plans)),
          )
        }),
        ...ticks(frames - 11, FRAME_MS),
        Story.model(({ phase }) => {
          expect(Phase.guards.Preparation(phase)).toBe(true)
        }),
        tick(FRAME_MS),
        Story.model(({ phase }) => {
          expect(phase).toEqual(
            Phase.Wave({
              wave: 1,
              elapsedMs: 0,
              spawns: Option.getOrThrow(Array.head(plans)),
            }),
          )
        }),
      )
    },
  )

  it.effect('the player can move and shoot during preparation', () =>
    Story.story(
      APPLICATION,
      Story.given(readyModel),
      startRunFromHome,
      release('Enter'),
      press('KeyD'),
      holdFire,
      ...ticks(4, FRAME_MS),
      Story.model(({ phase, seats: [{ player }], bullets }) => {
        expect(Phase.guards.Preparation(phase)).toBe(true)
        expect(player.x).toBeGreaterThan(START_LEVEL.start.x)
        expect(Array.isReadonlyArrayNonEmpty(bullets)).toBe(true)
      }),
    ),
  )

  it.effect('Enter starts the wave early, and R and Space do not', () =>
    Effect.gen(function* () {
      const skipWith = (code: string) =>
        Story.story(
          APPLICATION,
          Story.given(readyModel),
          startRunFromHome,
          release('Enter'),
          tick(FRAME_MS),
          press(code),
          Story.model(({ phase }) => {
            expect(phase._tag).toBe(code === 'Enter' ? 'Wave' : 'Preparation')
          }),
        )

      yield* skipWith('Enter')
      yield* skipWith('KeyR')
      yield* skipWith('Space')
    }),
  )

  it.effect(
    'the Start wave button starts the wave early and does nothing mid-wave',
    () => {
      const started: Array<Phase> = []
      return Story.story(
        APPLICATION,
        Story.given(readyModel),
        startRunFromHome,
        Story.message(Message.ClickedStartWaveButton()),
        Story.model(({ phase }) => {
          expect(Phase.guards.Wave(phase)).toBe(true)
          started.push(phase)
        }),
        Story.message(Message.ClickedStartWaveButton()),
        Story.model(({ phase }) => {
          expect(Array.head(started)).toEqual(Option.some(phase))
        }),
      )
    },
  )
})

describe('waves', () => {
  it.effect(
    'a wave with zombies still to spawn does not end when the room is empty',
    () =>
      Story.story(
        APPLICATION,
        Story.given(inWave(2, [plannedSpawn(5000)], [])),
        ...ticks(8, FRAME_MS),
        Story.model(({ phase, zombies }) => {
          expect(zombies).toEqual([])
          const wave = Option.getOrThrow(
            Option.liftPredicate(phase, Phase.guards.Wave),
          )
          expect(wave.wave).toBe(2)
          expect(wave.elapsedMs).toBeCloseTo(8 * FRAME_MS)
          expect(wave.spawns).toEqual([plannedSpawn(5000)])
        }),
        ...ticks(80, FRAME_MS),
        Story.model(({ phase, zombies }) => {
          expect(zombies).toHaveLength(1)
          expect(Phase.guards.Wave(phase)).toBe(true)
        }),
      ),
  )

  it.effect(
    'a wave whose plan is spent ends only when the last zombie dies, and hearts carry over',
    () =>
      Effect.gen(function* () {
        yield* Story.story(
          APPLICATION,
          Story.given(
            modifyFocus(killShot(inWave(2, [], [doomed, farAway]), doomed), {
              player: player => modifyFields(player, { hp: () => 3 }),
            }),
          ),
          tick(FRAME_MS),
          Story.model(({ phase }) => {
            expect(Phase.guards.Wave(phase)).toBe(true)
          }),
          Story.model(current => {
            expect(current.zombies).toHaveLength(2)
          }),
        )

        yield* Story.story(
          APPLICATION,
          Story.given(
            modifyFocus(killShot(inWave(2, [], [doomed]), doomed), {
              player: player => modifyFields(player, { hp: () => 3 }),
            }),
          ),
          tick(FRAME_MS),
          Story.model(({ phase, seats: [{ player }] }) => {
            const preparation = Option.getOrThrow(
              Option.liftPredicate(phase, Phase.guards.Preparation),
            )
            expect(preparation.wave).toBe(3)
            expect(preparation.remainingMs).toBe(PREPARATION_MS)
            expect(player.hp).toBe(3)
          }),
        )
      }),
  )

  it.effect(
    'clearing the last tuned wave keeps the escape going, score and all',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          modifyFields(killShot(inWave(FINAL_WAVE, [], [doomed]), doomed), {
            stats: scoring(990),
          }),
        ),
        tick(FIXED_STEP_MS),
        Story.model(({ phase, stats }) => {
          expect(Phase.guards.Preparation(phase)).toBe(true)
          expect(roundWave(phase)).toBe(FINAL_WAVE + 1)
          expect(scoreOf(stats)).toBe(1000)
        }),
      ),
  )

  it.effect(
    'dying during preparation gives GameOver on the upcoming wave',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          modifyFocus(
            modifyFields(readyModel, {
              phase: () =>
                Phase.Preparation({
                  wave: 4,
                  remainingMs: 9000,
                  durationMs: PREPARATION_MS,
                  spawns: [plannedSpawn(0)],
                }),
              zombies: () => [
                zombieAt(100, START_LEVEL.start.x + 2, START_LEVEL.start.y),
              ],
            }),
            { player: player => modifyFields(player, { hp: () => 1 }) },
          ),
        ),
        tick(FRAME_MS),
        Story.model(({ phase, seats: [{ player }] }) => {
          expect(player.hp).toBe(0)
          expect(phase).toEqual(Phase.GameOver({ wave: 4 }))
        }),
      ),
  )

  it.effect(
    'a death in the same frame as the last kill is still a GameOver',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          modifyFocus(
            modifyFields(killShot(inWave(FINAL_WAVE, [], [doomed]), doomed), {
              zombies: zombies => [
                ...zombies,
                zombieAt(102, START_LEVEL.start.x - 2, START_LEVEL.start.y),
              ],
            }),
            { player: player => modifyFields(player, { hp: () => 1 }) },
          ),
        ),
        tick(FRAME_MS),
        Story.model(({ phase }) => {
          expect(phase).toEqual(Phase.GameOver({ wave: FINAL_WAVE }))
        }),
      ),
  )
})

describe('pause', () => {
  it.effect(
    'pausing preparation freezes its timer and Escape resumes it rather than skipping',
    () => {
      const preparation = Phase.Preparation({
        wave: 3,
        remainingMs: 12_345,
        durationMs: PREPARATION_MS,
        spawns: [plannedSpawn(100)],
      })

      return Story.story(
        APPLICATION,
        Story.given(modifyFields(readyModel, { phase: () => preparation })),
        press('Escape'),
        Story.model(({ phase }) => {
          expect(phase).toEqual(Phase.Paused({ round: preparation }))
        }),
        ...ticks(30, FRAME_MS),
        press('Escape'),
        Story.model(({ phase }) => {
          expect(phase).toEqual(preparation)
        }),
      )
    },
  )

  it.effect('pausing a wave keeps its clock and remaining spawns', () => {
    const wave = Phase.Wave({
      wave: 5,
      elapsedMs: 4321,
      spawns: [plannedSpawn(8000), plannedSpawn(9000)],
    })

    return Story.story(
      APPLICATION,
      Story.given(
        modifyFields(readyModel, {
          phase: () => wave,
          zombies: () => [farAway],
        }),
      ),
      Story.message(Message.ChangedPageVisibility({ visibility: 'Hidden' })),
      ...ticks(30, FRAME_MS),
      Story.model(({ phase, zombies }) => {
        expect(phase).toEqual(Phase.Paused({ round: wave }))
        expect(zombies).toEqual([farAway])
      }),
      Story.message(
        Message.PressedPointer({
          pointerId: 1,
          device: 'Mouse',
          clientX: 400,
          clientY: 200,
        }),
      ),
      Story.model(({ phase }) => {
        expect(phase).toEqual(wave)
      }),
    )
  })
})

describe('wave plans', () => {
  // NOTE: every Big Leaguer brings his Groaners along (src/world/waves/wavePacks.ts).
  const isChuckerGroup = (group: SpawnGroup): boolean =>
    Array.every(group.mix, ({ kind }) => kind === 'Thrower')

  const totalOf = (wave: number) =>
    Array.reduce(
      Option.getOrThrow(Array.get(WAVE_PLANS, wave - 1)).groups,
      0,
      (sum, group) =>
        sum +
        group.count +
        (isChuckerGroup(group) ? group.count * CHUCKER_ESCORT_SIZE : 0),
    )

  const mixHealth = (group: SpawnGroup): number => {
    const totalWeight = Array.reduce(
      group.mix,
      0,
      (sum, { weight }) => sum + weight,
    )
    return Array.reduce(
      group.mix,
      0,
      (sum, { kind, weight }) =>
        sum + (weight / totalWeight) * ZOMBIE_KINDS[kind].hp,
    )
  }

  const healthOf = (wave: number) => {
    const plan = Option.getOrThrow(Array.get(WAVE_PLANS, wave - 1))
    return (
      plan.hpScale *
      (Array.reduce(
        plan.groups,
        0,
        (sum, group) => sum + group.count * mixHealth(group),
      ) +
        (hasBoss(wave) ? ZOMBIE_KINDS.Boss.hp : 0))
    )
  }

  // NOTE: waves 8 and 9 are a breather and a test between the Ankle Biters
  // and the finale, so health grows through wave 7 and the finale tops it,
  // while speed grows every wave.
  test('there are ten waves that grow in speed, grow in health to wave 7, and peak at the finale', () => {
    expect(FINAL_WAVE).toBe(10)
    const totals = Array.makeBy(FINAL_WAVE, index => healthOf(index + 1))
    const speeds = Array.map(WAVE_PLANS, ({ speedScale }) => speedScale)
    expect(
      Array.every(
        Array.zip(Array.dropRight(speeds, 1), Array.drop(speeds, 1)),
        ([earlier, later]) => later > earlier,
      ),
    ).toBe(true)
    const arc = Array.take(totals, 7)
    expect(
      Array.every(
        Array.zip(Array.dropRight(arc, 1), Array.drop(arc, 1)),
        ([earlier, later]) => later > earlier,
      ),
    ).toBe(true)
    expect(
      Array.every(
        Array.dropRight(totals, 1),
        total => total < (totals[9] ?? 0),
      ),
    ).toBe(true)
  })

  test('every Big Leaguer walks in with three Groaners of his own, who never frenzy', () => {
    const [, spawns] = rollSpawns(1234, 6)
    const leaguers = Array.filter(spawns, ({ kind }) => kind === 'Thrower')
    expect(leaguers.length).toBeGreaterThan(0)
    Array.forEach(leaguers, leaguer => {
      const crew = Array.filter(spawns, ({ pack }) => pack === leaguer.pack)
      expect(Array.map(crew, ({ kind }) => kind).sort()).toEqual([
        'Shambler',
        'Shambler',
        'Shambler',
        'Thrower',
      ])
      expect(Array.every(crew, ({ door }) => door === leaguer.door)).toBe(true)
      expect(isFrenzyPack(frenzyPacksOf(spawns), leaguer.pack)).toBe(false)
    })
  })

  test('a roll matches its plan, is sorted by time, and is the same for the same seed', () => {
    Array.forEach(
      Array.makeBy(FINAL_WAVE, index => index + 1),
      wave => {
        const [firstState, first] = rollSpawns(1234, wave)
        const [secondState, second] = rollSpawns(1234, wave)
        const [, other] = rollSpawns(98765, wave)
        const plan = Option.getOrThrow(Array.get(WAVE_PLANS, wave - 1))
        const plannedDoors = Array.flatMap(plan.groups, ({ doors }) => doors)

        expect(second).toEqual(first)
        expect(secondState).toBe(firstState)
        expect(other).not.toEqual(first)
        expect(first).toHaveLength(totalOf(wave))
        expect(
          Array.every(doorCounts(first, []), ({ door }) =>
            Array.contains(plannedDoors, door),
          ),
        ).toBe(true)
        expect(
          Array.every(
            Array.zip(Array.dropRight(first, 1), Array.drop(first, 1)),
            ([earlier, later]) => earlier.atMs <= later.atMs,
          ),
        ).toBe(true)
      },
    )
  })
})
