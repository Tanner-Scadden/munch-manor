import { Array, Option, Order, Record, pipe } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { PARLOUR, isInsideRoomAt, levelOf, nearestDoor } from './arena'
import {
  DINNER_BELL_MS,
  FADE_RELEASE_BELOW,
  FIXED_STEP_MS,
  INTENSITY_PER_HEART,
  LAST_HEART_INVULNERABLE_MS,
  PACK_GAP_MS,
  PACK_WARNING_MS,
  PINCER_LAG_MAX_MS,
  PINCER_LAG_MIN_MS,
  PLAYER_INVULNERABLE_MS,
  QUIET_HURRY_MS,
  RELAX_EXTEND_MAX_MS,
  ZOMBIE_ALIVE_MAX,
} from './constants'
import { rollSpawns, rollWave } from './endlessWaves'
import { update } from './main'
import { Message } from './message'
import {
  Alarm,
  Beat,
  type DoorId,
  Frenzy,
  GameEvent,
  Invulnerability,
  type Model,
  type Pacing,
  Phase,
  type PlannedSpawn,
  type Zombie,
  ZombieAction,
  type ZombieKind,
  ZombieState,
  calmPacing,
  initialModel,
} from './model'
import { tick, ticks, ticksFor } from './testing'
import { FINAL_WAVE, debutKinds } from './wavePlans'

const FRAME_MS = 50

const spawnAt = (
  atMs: number,
  door: DoorId,
  pack: number,
  formation: PlannedSpawn['formation'] = 'Squad',
): PlannedSpawn => ({
  atMs,
  kind: 'Shambler',
  door,
  offset: 0,
  speedScale: 1,
  hpScale: 1,
  pack,
  formation,
})

const standingZombie = (id: number, x: number, y: number): Zombie => ({
  id,
  kind: 'Shambler',
  x,
  y,
  speed: 0,
  hp: 3,
  maxHp: 3,
  knockback: { x: 0, y: 0 },
  hitRemainingMs: 0,
  state: ZombieState.Walking(),
  action: ZombieAction.Roaming(),
  frenzy: Frenzy.Calm(),
})

const crowdOf = (count: number): ReadonlyArray<Zombie> =>
  Array.makeBy(count, index =>
    standingZombie(500 + index, 40 + index * 12, 150),
  )

const waveModel = (
  spawns: ReadonlyArray<PlannedSpawn>,
  pacing: Pacing = calmPacing,
  zombies: ReadonlyArray<Zombie> = [],
): Model =>
  modifyFields(initialModel, {
    maybeSurface: () =>
      Option.some({ left: 0, top: 0, width: 800, height: 400 }),
    phase: () => Phase.Wave({ wave: 3, elapsedMs: 0, spawns }),
    pacing: () => pacing,
    zombies: () => zombies,
  })

const LINGERER_ID = 499

const lingerer = standingZombie(LINGERER_ID, 40, 150)

const arrivedDoors = (current: Model): ReadonlyArray<DoorId> =>
  pipe(
    current.zombies,
    Array.filter(({ id }) => id !== LINGERER_ID),
    Array.map(zombie => nearestDoor(PARLOUR, zombie).id),
  )

const waveClock = (current: Model): number =>
  Phase.guards.Wave(current.phase) ? current.phase.elapsedMs : -1

const packsOf = (
  spawns: ReadonlyArray<PlannedSpawn>,
): ReadonlyArray<ReadonlyArray<PlannedSpawn>> =>
  pipe(
    spawns,
    Array.map(({ pack }) => pack),
    Array.dedupe,
    Array.map(pack => Array.filter(spawns, spawn => spawn.pack === pack)),
  )

const volleyOf = (pack: number): number => Math.floor(pack / 10)

const GROUP_STRIDE = 1000

const EVERY_DOOR: ReadonlyArray<DoorId> = ['East', 'North', 'South', 'West']

const byName = Order.mapInput(Order.String, (door: DoorId) => door)

const sortedDoors = (doors: ReadonlyArray<DoorId>): ReadonlyArray<DoorId> =>
  Array.sort(doors, byName)

const OPPOSITE: Readonly<Record<DoorId, DoorId>> = {
  North: 'South',
  South: 'North',
  West: 'East',
  East: 'West',
  Back: 'South',
  Window: 'East',
}

describe('packs', () => {
  test('a squad comes from one door, one zombie every pack gap', () => {
    const squad = [
      spawnAt(1000, 'West', 7),
      spawnAt(1000 + PACK_GAP_MS, 'West', 7),
      spawnAt(1000 + 2 * PACK_GAP_MS, 'West', 7),
    ]
    story(
      update,
      given(waveModel(squad)),
      // NOTE: a frame past the second, as sixty 1000/60 ms ticks sum to a
      // hair under it.
      ...ticksFor(1000 + FRAME_MS, FRAME_MS),
      model(current => {
        expect(arrivedDoors(current)).toEqual(['West'])
      }),
      ...ticksFor(PACK_GAP_MS + FRAME_MS, FRAME_MS),
      model(current => {
        expect(arrivedDoors(current)).toEqual(['West', 'West'])
      }),
      ...ticksFor(PACK_GAP_MS, FRAME_MS),
      model(current => {
        expect(arrivedDoors(current)).toEqual(['West', 'West', 'West'])
      }),
    )
  })

  test('every rolled squad shares one door and keeps its inner gap', () => {
    Array.forEach([1, 77, 4242], seed => {
      const [, spawns] = rollSpawns(seed, 2)
      const squads = Array.filter(packsOf(spawns), pack =>
        Array.every(pack, ({ formation }) => formation === 'Squad'),
      )
      expect(Array.isReadonlyArrayNonEmpty(squads)).toBe(true)
      Array.forEach(squads, pack => {
        const first = Option.getOrThrow(Array.head(pack))
        Array.forEach(pack, (spawn, index) => {
          expect(spawn.door).toBe(first.door)
          expect(spawn.atMs - first.atMs).toBeCloseTo(index * PACK_GAP_MS)
        })
      })
    })
  })

  test('a pincer sends two packs from opposite doors, the second 1.5 to 3 s later', () => {
    Array.forEach([3, 99, 31337], seed => {
      const [, spawns] = rollSpawns(seed, 3)
      const pincers = Array.filter(packsOf(spawns), pack =>
        Array.every(pack, ({ formation }) => formation === 'Pincer'),
      )
      const volleys = pipe(
        pincers,
        Array.map(pack => Option.getOrThrow(Array.head(pack))),
        Array.groupBy(({ pack }) => String(volleyOf(pack))),
        Record.values,
      )
      expect(volleys.length).toBeGreaterThan(0)
      Array.forEach(volleys, ([first, maybeSecond]) => {
        const second = Option.getOrThrow(Option.fromNullishOr(maybeSecond))
        expect(second.door).toBe(OPPOSITE[first.door])
        const lag = second.atMs - first.atMs
        expect(lag).toBeGreaterThanOrEqual(PINCER_LAG_MIN_MS)
        expect(lag).toBeLessThanOrEqual(PINCER_LAG_MAX_MS)
      })
    })
  })

  test('a horde comes from every door at once and rings the dinner bell', () => {
    const [, spawns] = rollSpawns(5, FINAL_WAVE)
    const hordeFirsts = pipe(
      packsOf(spawns),
      Array.filter(pack =>
        Array.every(pack, ({ formation }) => formation === 'Horde'),
      ),
      Array.map(pack => Option.getOrThrow(Array.head(pack))),
    )
    const firstHordeVolley = volleyOf(
      Option.getOrThrow(Array.head(hordeFirsts)).pack,
    )
    const firstVolley = Array.filter(
      hordeFirsts,
      ({ pack }) => volleyOf(pack) === firstHordeVolley,
    )
    expect(sortedDoors(Array.map(firstVolley, ({ door }) => door))).toEqual(
      EVERY_DOOR,
    )
    expect(new Set(Array.map(firstVolley, ({ atMs }) => atMs)).size).toBe(1)

    const horde = Array.map(EVERY_DOOR, (door, index) =>
      spawnAt(PACK_WARNING_MS + 500, door, index, 'Horde'),
    )
    story(
      update,
      given(waveModel(horde)),
      ...ticksFor(500, FRAME_MS),
      model(current => {
        expect(
          Array.filter(current.frameEvents, GameEvent.guards.PackWarned),
        ).toHaveLength(4)
        expect(current.pacing.alarm).toEqual(
          Alarm.Ringing({ remainingMs: DINNER_BELL_MS }),
        )
      }),
      ...ticksFor(PACK_WARNING_MS, FRAME_MS),
      model(current => {
        expect(sortedDoors(arrivedDoors(current))).toEqual(EVERY_DOOR)
      }),
      ...ticksFor(DINNER_BELL_MS, FRAME_MS),
      model(current => {
        expect(current.pacing.alarm).toEqual(Alarm.Quiet())
      }),
    )
  })
})

describe('telegraphs', () => {
  test('a pack rattles its door a second before it walks in', () => {
    const atMs = 3000
    const warnedAt = atMs - PACK_WARNING_MS
    story(
      update,
      given(
        waveModel(
          [spawnAt(atMs, 'East', 1), spawnAt(atMs + 200, 'East', 1)],
          calmPacing,
          [lingerer],
        ),
      ),
      ...ticksFor(warnedAt - FRAME_MS, FRAME_MS),
      model(current => {
        expect(current.pacing.warnedPacks).toEqual([])
      }),
      tick(FRAME_MS),
      model(current => {
        expect(
          Array.filter(current.frameEvents, GameEvent.guards.PackWarned),
        ).toEqual([
          GameEvent.PackWarned({
            x: 315,
            y: 90,
            door: 'East',
            formation: 'Squad',
          }),
        ])
        expect(current.pacing.warnedPacks).toEqual([1])
        expect(arrivedDoors(current)).toEqual([])
      }),
      tick(FRAME_MS),
      model(current => {
        expect(
          Array.filter(current.frameEvents, GameEvent.guards.PackWarned),
        ).toEqual([])
      }),
      ...ticksFor(PACK_WARNING_MS, FRAME_MS),
      model(current => {
        expect(arrivedDoors(current)).toEqual(['East'])
      }),
    )
  })

  test('standing in a doorway holds its pack at that door until the player steps away', () => {
    const inNorthDoorway = (base: Model): Model =>
      modifyFields(base, {
        player: player => modifyFields(player, { x: () => 220, y: () => 24 }),
      })
    story(
      update,
      given(
        inNorthDoorway(
          waveModel([spawnAt(500, 'North', 2), spawnAt(700, 'West', 3)]),
        ),
      ),
      ...ticksFor(3000, FRAME_MS),
      model(current => {
        expect(arrivedDoors(current)).toEqual(['West'])
        const pending = Phase.guards.Wave(current.phase)
          ? current.phase.spawns
          : []
        expect(Array.map(pending, ({ door }) => door)).toEqual(['North'])
      }),
      message(Message.PressedKey({ code: 'KeyS' })),
      ...ticksFor(1000, FRAME_MS),
      model(current => {
        expect(sortedDoors(arrivedDoors(current))).toEqual(['North', 'West'])
      }),
    )
  })
})

// NOTE: a warned zombie stands in its doorway no later than this after its
// warning ends, whatever its kind and door.
const ARRIVAL_BEAT_MS = 300

const kindAt = (
  kind: ZombieKind,
  atMs: number,
  door: DoorId,
  pack: number,
): PlannedSpawn => modifyFields(spawnAt(atMs, door, pack), { kind: () => kind })

const newcomersInRoom = (current: Model): ReadonlyArray<Zombie> =>
  Array.filter(
    current.zombies,
    zombie =>
      zombie.id < LINGERER_ID && isInsideRoomAt(levelOf(current), zombie),
  )

const holdAt = (atMs: number): Pacing =>
  modifyFields(calmPacing, {
    holds: () => [{ atMs, releaseBelow: FADE_RELEASE_BELOW, relaxMs: 2500 }],
  })

describe('from warning to doorway', () => {
  const cases: ReadonlyArray<readonly [ZombieKind, DoorId]> = [
    ['Tank', 'North'],
    ['Tank', 'West'],
    ['Shambler', 'North'],
    ['Shambler', 'South'],
    ['Thrower', 'East'],
  ]
  test.each(cases)(
    'a %s at the %s door is in its doorway a beat after its warning ends',
    (kind, door) => {
      story(
        update,
        given(
          waveModel([kindAt(kind, PACK_WARNING_MS, door, 1)], calmPacing, [
            lingerer,
          ]),
        ),
        tick(FRAME_MS),
        model(current => {
          expect(current.pacing.warnedPacks).toEqual([1])
        }),
        ...ticksFor(PACK_WARNING_MS - FRAME_MS, FRAME_MS),
        model(current => {
          expect(newcomersInRoom(current)).toEqual([])
        }),
        ...ticksFor(ARRIVAL_BEAT_MS, FRAME_MS),
        model(current => {
          expect(
            Array.map(newcomersInRoom(current), zombie => zombie.kind),
          ).toEqual([kind])
        }),
      )
    },
  )

  test('a pack warned just before a hold walks in when its warning ends, not after the fade', () => {
    story(
      update,
      given(
        waveModel(
          [spawnAt(PACK_WARNING_MS, 'West', 1)],
          holdAt(500),
          crowdOf(FADE_RELEASE_BELOW + 2),
        ),
      ),
      tick(FRAME_MS),
      model(current => {
        expect(current.pacing.warnedPacks).toEqual([1])
      }),
      ...ticksFor(PACK_WARNING_MS - FRAME_MS + ARRIVAL_BEAT_MS, FRAME_MS),
      model(current => {
        expect(Beat.isAnyOf(['Fading'])(current.pacing.beat)).toBe(true)
        expect(waveClock(current)).toBe(500)
        expect(
          Array.map(
            newcomersInRoom(current),
            zombie => nearestDoor(PARLOUR, zombie).id,
          ),
        ).toEqual(['West'])
      }),
    )
  })

  test('a pack waits to warn while the alive cap has no place for it', () => {
    story(
      update,
      given(
        waveModel(
          [spawnAt(PACK_WARNING_MS, 'West', 1)],
          calmPacing,
          crowdOf(ZOMBIE_ALIVE_MAX),
        ),
      ),
      ...ticksFor(3000, FRAME_MS),
      model(current => {
        expect(current.pacing.warnedPacks).toEqual([])
        expect(current.zombies.length).toBe(ZOMBIE_ALIVE_MAX)
      }),
    )
  })
})

describe('sawtooth', () => {
  const HOLD_AT_MS = 1000
  const RELAX_MS = 2000
  const held: Pacing = modifyFields(calmPacing, {
    holds: () => [
      { atMs: HOLD_AT_MS, releaseBelow: FADE_RELEASE_BELOW, relaxMs: RELAX_MS },
    ],
  })
  const afterHold = [spawnAt(HOLD_AT_MS + 1500, 'South', 4)]

  test('a fade holds every later pack until the room thins', () => {
    story(
      update,
      given(waveModel(afterHold, held, crowdOf(FADE_RELEASE_BELOW))),
      ...ticksFor(HOLD_AT_MS + 10_000, FRAME_MS),
      model(current => {
        expect(waveClock(current)).toBe(HOLD_AT_MS)
        expect(Beat.guards.Fading(current.pacing.beat)).toBe(true)
        expect(current.zombies).toHaveLength(FADE_RELEASE_BELOW)
      }),
    )
  })

  test('once the room has thinned, a relax passes before the next pack', () => {
    story(
      update,
      given(waveModel(afterHold, held, crowdOf(FADE_RELEASE_BELOW - 1))),
      ...ticksFor(HOLD_AT_MS + FRAME_MS, FRAME_MS),
      model(current => {
        expect(waveClock(current)).toBe(HOLD_AT_MS)
        expect(Beat.guards.Resting(current.pacing.beat)).toBe(true)
      }),
      ...ticksFor(RELAX_MS - FRAME_MS, FRAME_MS),
      model(current => {
        expect(waveClock(current)).toBe(HOLD_AT_MS)
      }),
      ...ticksFor(1500 + 2 * FRAME_MS, FRAME_MS),
      model(current => {
        expect(Beat.guards.Flowing(current.pacing.beat)).toBe(true)
        expect(arrivedDoors(current)).toContain('South')
      }),
    )
  })

  test('high intensity lengthens a relax by up to its cap, and low intensity does not', () => {
    const resting = modifyFields(calmPacing, {
      beat: () =>
        Beat.Resting({ remainingMs: 500, extendedMs: 0, trickled: 0 }),
    })
    const restLength = (intensity: number): number => {
      const clocks: Array<number> = []
      story(
        update,
        given(
          modifyFields(
            waveModel([spawnAt(100_000, 'North', 9)], resting, [lingerer]),
            { intensity: () => intensity },
          ),
        ),
        ...Array.flatMap(ticksFor(8000, FRAME_MS), frame => [
          frame,
          model((current: Model) => {
            clocks.push(waveClock(current))
          }),
        ]),
      )
      return Array.filter(clocks, clock => clock === 0).length * FRAME_MS
    }
    const calm = restLength(0)
    const tense = restLength(0.9)
    expect(calm).toBeLessThanOrEqual(500)
    expect(tense).toBeGreaterThanOrEqual(500 + RELAX_EXTEND_MAX_MS - FRAME_MS)
    expect(tense).toBeLessThanOrEqual(500 + RELAX_EXTEND_MAX_MS + FRAME_MS)
  })
})

describe('mercy', () => {
  const biter = standingZombie(900, 162, 90)
  const bittenAt = (hp: number): Model => {
    const models: Array<Model> = []
    story(
      update,
      given(
        modifyFields(
          waveModel([spawnAt(100_000, 'North', 9)], calmPacing, [biter]),
          {
            player: player => modifyFields(player, { hp: () => hp }),
          },
        ),
      ),
      tick(FRAME_MS),
      model((current: Model) => {
        models.push(current)
      }),
    )
    return Option.getOrThrow(Array.head(models))
  }

  test('the blink after a hit lasts longer at the last heart, without drawing a random number', () => {
    const lastHeart = bittenAt(2)
    const roomy = bittenAt(3)
    expect(lastHeart.player.hp).toBe(1)
    expect(lastHeart.player.invulnerability).toEqual(
      Invulnerability.Invulnerable({
        remainingMs: LAST_HEART_INVULNERABLE_MS,
        durationMs: LAST_HEART_INVULNERABLE_MS,
      }),
    )
    expect(LAST_HEART_INVULNERABLE_MS).toBe(PLAYER_INVULNERABLE_MS * 1.5)
    expect(roomy.player.invulnerability).toEqual(
      Invulnerability.Invulnerable({
        remainingMs: PLAYER_INVULNERABLE_MS,
        durationMs: PLAYER_INVULNERABLE_MS,
      }),
    )
    expect(lastHeart.rngState).toBe(roomy.rngState)
  })

  test('losing a heart raises intensity, and it decays while nothing is close', () => {
    const bitten = bittenAt(3)
    expect(bitten.intensity).toBeGreaterThanOrEqual(INTENSITY_PER_HEART)
    story(
      update,
      given(
        modifyFields(waveModel([spawnAt(100_000, 'North', 9)]), {
          intensity: () => 0.5,
        }),
      ),
      ...ticksFor(2000, FRAME_MS),
      model(current => {
        expect(current.intensity).toBeLessThan(0.5)
        expect(current.intensity).toBeGreaterThan(0)
      }),
    )
  })
})

type Frame = Readonly<{
  clockMs: number
  beat: Beat['_tag']
  arrived: ReadonlyArray<DoorId>
}>

// NOTE: plays frames as a player who kills each zombie the frame it walks
// in, and notes the doors the new ones came through.
const playEmptied = (start: Model, ms: number): ReadonlyArray<Frame> =>
  Array.mapAccum(
    Array.makeBy(Math.round(ms / FRAME_MS), index => index),
    start,
    (current): readonly [Model, Frame] => {
      const next = update(
        current,
        Message.TickedFrame({ deltaTime: FRAME_MS }),
      ).model
      return [
        modifyFields(next, { zombies: () => [] }),
        {
          clockMs: waveClock(next),
          beat: next.pacing.beat._tag,
          arrived: Array.map(
            next.zombies,
            zombie => nearestDoor(PARLOUR, zombie).id,
          ),
        },
      ]
    },
  )[1]

describe('determinism and the preview', () => {
  test('the same seed rolls the same packs, doors, and holds', () => {
    Array.forEach(
      Array.makeBy(FINAL_WAVE + 4, index => index + 1),
      wave => {
        const [firstState, first] = rollWave(2024, wave)
        const [secondState, second] = rollWave(2024, wave)
        expect(second).toEqual(first)
        expect(secondState).toBe(firstState)
      },
    )
  })
})

describe('dead air', () => {
  test('an empty, quiet room pulls the next pack forward to its warning', () => {
    const atMs = 10_000
    story(
      update,
      given(waveModel([spawnAt(atMs, 'East', 1)])),
      ...ticksFor(QUIET_HURRY_MS - FRAME_MS, FRAME_MS),
      model(current => {
        expect(current.pacing.warnedPacks).toEqual([])
      }),
      ...ticksFor(2 * FRAME_MS, FRAME_MS),
      model(current => {
        expect(current.pacing.warnedPacks).toEqual([1])
        expect(waveClock(current)).toBeLessThan(atMs)
      }),
      ...ticksFor(PACK_WARNING_MS, FRAME_MS),
      model(current => {
        expect(arrivedDoors(current)).toEqual(['East'])
      }),
    )
  })

  test('a hurry never skips a hold', () => {
    const holdAtMs = 4000
    const holding: Pacing = modifyFields(calmPacing, {
      holds: () => [
        { atMs: holdAtMs, releaseBelow: FADE_RELEASE_BELOW, relaxMs: 20_000 },
      ],
    })
    // NOTE: read on the tick the hold's fade begins, since a relax that
    // starts quiet trickles its straggler in a few ticks later.
    const fadeStarts: Array<Model> = []
    story(
      update,
      given(waveModel([spawnAt(holdAtMs + 3000, 'West', 2)], holding)),
      ...Array.flatMap(
        ticks(
          Math.ceil((QUIET_HURRY_MS + 2 * FRAME_MS) / FIXED_STEP_MS),
          FIXED_STEP_MS,
        ),
        frame => [
          frame,
          model((current: Model) => {
            expect(waveClock(current)).toBeLessThanOrEqual(holdAtMs)
            if (
              Beat.guards.Fading(current.pacing.beat) &&
              Array.isReadonlyArrayEmpty(fadeStarts)
            ) {
              fadeStarts.push(current)
            }
          }),
        ],
      ),
    )
    const fadeStart = Option.getOrThrow(Array.head(fadeStarts))
    expect(waveClock(fadeStart)).toBe(holdAtMs)
    expect(fadeStart.pacing.warnedPacks).toEqual([])
  })

  test('an empty room warns its next pack within half a second', () => {
    story(
      update,
      given(waveModel([spawnAt(30_000, 'West', 3)])),
      ...ticksFor(500 - FRAME_MS, FRAME_MS),
      model(current => {
        expect(current.pacing.warnedPacks).toEqual([])
      }),
      ...ticksFor(2 * FRAME_MS, FRAME_MS),
      model(current => {
        expect(current.pacing.warnedPacks).toEqual([3])
      }),
    )
  })

  test('a relax with a zombie left runs its course', () => {
    const resting = modifyFields(calmPacing, {
      beat: () =>
        Beat.Resting({ remainingMs: 2500, extendedMs: 0, trickled: 0 }),
    })
    story(
      update,
      given(waveModel([spawnAt(100_000, 'North', 9)], resting, [lingerer])),
      ...ticksFor(2500 - 2 * FRAME_MS, FRAME_MS),
      model(current => {
        expect(waveClock(current)).toBe(0)
        expect(Beat.guards.Resting(current.pacing.beat)).toBe(true)
      }),
      ...ticksFor(3 * FRAME_MS, FRAME_MS),
      model(current => {
        expect(Beat.guards.Flowing(current.pacing.beat)).toBe(true)
      }),
    )
  })

  test('a relax in an empty room trickles in two stragglers, then ends', () => {
    const resting = modifyFields(calmPacing, {
      beat: () =>
        Beat.Resting({ remainingMs: 10_000, extendedMs: 0, trickled: 0 }),
    })
    const squad = [spawnAt(40_000, 'East', 7), spawnAt(40_200, 'East', 7)]
    const spawns = [
      ...squad,
      spawnAt(50_000, 'South', 8, 'Trickle'),
      spawnAt(60_000, 'West', 9, 'Trickle'),
    ]
    const frames = playEmptied(waveModel(spawns, resting), 3000)
    const arrivalsBy = (ms: number) =>
      Array.flatMap(Array.take(frames, ms / FRAME_MS), ({ arrived }) => arrived)
    expect(arrivalsBy(500 - FRAME_MS)).toEqual([])
    expect(arrivalsBy(500 + FRAME_MS)).toEqual(['South'])
    expect(arrivalsBy(1000 + 2 * FRAME_MS)).toEqual(['South', 'West'])
    expect(arrivalsBy(1500)).toEqual(['South', 'West'])
    expect(arrivalsBy(3000)).toContain('East')
    const clocks = Array.map(frames, ({ clockMs }) => clockMs)
    expect(Array.take(clocks, 1000 / FRAME_MS)).toEqual(
      Array.makeBy(1000 / FRAME_MS, () => 0),
    )
  })
})

describe('fades', () => {
  const holding: Pacing = modifyFields(calmPacing, {
    holds: () => [
      { atMs: 500, releaseBelow: FADE_RELEASE_BELOW, relaxMs: 2500 },
    ],
  })
  const later = [spawnAt(5000, 'South', 4)]

  test('a fade holds while six are alive', () => {
    story(
      update,
      given(waveModel(later, holding, crowdOf(6))),
      ...ticksFor(3000, FRAME_MS),
      model(current => {
        expect(Beat.guards.Fading(current.pacing.beat)).toBe(true)
      }),
    )
  })

  test('a fade lets go once five are left', () => {
    story(
      update,
      given(waveModel(later, holding, crowdOf(5))),
      ...ticksFor(500 + 2 * FRAME_MS, FRAME_MS),
      model(current => {
        expect(Beat.guards.Resting(current.pacing.beat)).toBe(true)
      }),
    )
  })
})

describe('spawn variety', () => {
  const SEEDS = Array.makeBy(20, index => 3 + index * 104_729)
  const CAMPAIGN = Array.makeBy(FINAL_WAVE - 1, index => index + 2)

  const packSizes = (spawns: ReadonlyArray<PlannedSpawn>) =>
    Array.map(packsOf(spawns), pack => pack.length)

  const doorOrder = (seed: number, wave: number): string =>
    Array.join(
      Array.map(
        packsOf(rollSpawns(seed, wave)[1]),
        pack => Option.getOrThrow(Array.head(pack)).door,
      ),
      ' ',
    )

  test('pack sizes vary inside every wave from wave 2 on', () => {
    Array.forEach(CAMPAIGN, wave => {
      Array.forEach(Array.take(SEEDS, 5), seed => {
        const [, spawns] = rollSpawns(seed, wave)
        expect(new Set(packSizes(spawns)).size).toBeGreaterThanOrEqual(3)
      })
    })
  })

  test('the same seed rolls the same doors, and other seeds roll other door orders', () => {
    Array.forEach(CAMPAIGN, wave => {
      Array.forEach(SEEDS, seed => {
        expect(doorOrder(seed, wave)).toBe(doorOrder(seed, wave))
      })
      const orders = new Set(Array.map(SEEDS, seed => doorOrder(seed, wave)))
      expect(orders.size).toBeGreaterThanOrEqual(SEEDS.length - 2)
    })
  })

  test('a debut comes alone and from one door per run, and that door changes between runs', () => {
    Array.forEach([2, 4], wave => {
      const debut = Option.getOrThrow(Array.head(debutKinds(wave)))
      const debutDoors = Array.map(SEEDS, seed => {
        const [, spawns] = rollSpawns(seed, wave)
        const first = Option.getOrThrow(
          Array.findFirst(spawns, ({ kind }) => kind === debut),
        )
        const debutGroup = Array.filter(
          spawns,
          ({ pack }) =>
            Math.floor(pack / GROUP_STRIDE) ===
            Math.floor(first.pack / GROUP_STRIDE),
        )
        expect(Array.every(debutGroup, ({ kind }) => kind === debut)).toBe(true)
        expect(new Set(Array.map(debutGroup, ({ door }) => door)).size).toBe(1)
        return first.door
      })
      expect(new Set(debutDoors).size).toBeGreaterThan(1)
    })
  })

  test('later waves mix kinds inside a pack and send stragglers from several doors', () => {
    Array.forEach(Array.take(SEEDS, 5), seed => {
      const [, spawns] = rollSpawns(seed, 6)
      const mixed = Array.filter(
        packsOf(spawns),
        pack => new Set(Array.map(pack, ({ kind }) => kind)).size > 1,
      )
      expect(Array.isReadonlyArrayNonEmpty(mixed)).toBe(true)
      const [, third] = rollSpawns(seed, 3)
      const strays = Array.filter(
        third,
        ({ formation }) => formation === 'Trickle',
      )
      expect(
        new Set(Array.map(strays, ({ door }) => door)).size,
      ).toBeGreaterThan(1)
    })
  })
})
