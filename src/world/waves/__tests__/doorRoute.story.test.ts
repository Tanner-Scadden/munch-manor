import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import { Message } from '../../../app/message'
import {
  type DoorId,
  Frenzy,
  Invulnerability,
  type Model,
  Phase,
  type PlannedSpawn,
  Trap,
  type Zombie,
  ZombieAction,
  ZombieState,
} from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { PREPARATION_MS } from '../../../shared/constants'
import { APPLICATION, ticks } from '../../../test/testing'
import { TRAPS, trapBox } from '../../gear/traps'
import {
  PARLOUR,
  distanceToBox,
  isInsideRoomAt,
  nearestDoor,
} from '../../level/arena'
import { modifyFocus } from '../../party/party'
import { drawSurfacingSpot } from '../../zombies/crawler'
import { doorCounts } from '../endlessWaves'

const FRAME_MS = 50

const spawnAt = (
  door: DoorId,
  pack: number,
  atMs = 0,
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

const DISTANT_SPAWN = spawnAt('North', 999, 1e9)

const plank = (id: number, door: DoorId, hp = TRAPS.Barricade.hp): Trap =>
  Trap.Barricade({ id, door, hp, hitRemainingMs: 0 })

const base: Model = modifyFocus(
  modifyFields(initialModel, {
    maybeSurface: () =>
      Option.some({ left: 0, top: 0, width: 800, height: 400 }),
  }),
  {
    player: player =>
      modifyFields(player, {
        invulnerability: () =>
          Invulnerability.Invulnerable({ remainingMs: 1e9, durationMs: 1e9 }),
      }),
  },
)

const fighting = (
  spawns: ReadonlyArray<PlannedSpawn>,
  traps: ReadonlyArray<Trap>,
): Model =>
  modifyFields(base, {
    phase: () =>
      Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [...spawns, DISTANT_SPAWN] }),
    traps: () => traps,
  })

const doorsOf = (current: Model): ReadonlyArray<DoorId> =>
  Array.map(current.zombies, zombie => nearestDoor(PARLOUR, zombie).id)

const previewDoors = (current: Model): ReadonlyArray<DoorId> =>
  Phase.match(current.phase, {
    Ready: () => [],
    Arriving: () => [],
    Preparation: ({ spawns }) =>
      Array.map(doorCounts(spawns, current.traps), ({ door }) => door),
    Wave: () => [],
    Paused: () => [],
    Victory: () => [],
    GameOver: () => [],
  })

describe('boarded doors are no spawn points', () => {
  it.effect(
    'a pack due at a boarded door comes through the next open door clockwise',
    () =>
      Effect.gen(function* () {
        yield* Story.story(
          APPLICATION,
          Story.given(fighting([spawnAt('North', 1)], [plank(1, 'North')])),
          ...ticks(2, FRAME_MS),
          Story.model(current => {
            expect(doorsOf(current)).toEqual(['East'])
          }),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(
            fighting(
              [spawnAt('North', 1)],
              [plank(1, 'North'), plank(2, 'East')],
            ),
          ),
          ...ticks(2, FRAME_MS),
          Story.model(current => {
            expect(doorsOf(current)).toEqual(['South'])
          }),
        )
      }),
  )

  it.effect('a pincer keeps to two different open doors', () =>
    Effect.gen(function* () {
      const pincer = [
        spawnAt('North', 10, 0, 'Pincer'),
        spawnAt('South', 11, 0, 'Pincer'),
      ]
      yield* Story.story(
        APPLICATION,
        Story.given(fighting(pincer, [plank(1, 'North'), plank(2, 'South')])),
        ...ticks(2, FRAME_MS),
        Story.model(current => {
          expect(Array.sort(doorsOf(current), stringOrder)).toEqual([
            'East',
            'West',
          ])
        }),
      )
      yield* Story.story(
        APPLICATION,
        Story.given(fighting(pincer, [plank(1, 'North'), plank(2, 'East')])),
        ...ticks(2, FRAME_MS),
        Story.model(current => {
          expect(Array.sort(doorsOf(current), stringOrder)).toEqual([
            'South',
            'West',
          ])
        }),
      )
    }),
  )

  it.effect('the later pack of a pincer avoids the door its mate took', () =>
    Story.story(
      APPLICATION,
      Story.given(
        fighting(
          [spawnAt('North', 10, 0, 'Pincer'), spawnAt('East', 11, 0, 'Pincer')],
          [plank(1, 'North')],
        ),
      ),
      ...ticks(2, FRAME_MS),
      Story.model(current => {
        expect(Array.sort(doorsOf(current), stringOrder)).toEqual([
          'East',
          'South',
        ])
      }),
    ),
  )

  it.effect(
    'a plank that breaks mid-wave opens its door for the later packs',
    () => {
      const chewer: Zombie = {
        id: 500,
        kind: 'Tank',
        x: 220,
        y: 31,
        speed: 12,
        hp: 999,
        maxHp: 999,
        knockback: { x: 0, y: 0 },
        hitRemainingMs: 0,
        state: ZombieState.Walking(),
        action: ZombieAction.Roaming(),
        frenzy: Frenzy.Calm(),
      }
      return Story.story(
        APPLICATION,
        Story.given(
          modifyFields(
            fighting(
              [spawnAt('North', 1), spawnAt('North', 2, 7000)],
              [plank(1, 'North')],
            ),
            { zombies: () => [chewer] },
          ),
        ),
        ...ticks(2, FRAME_MS),
        Story.model(current => {
          expect(doorsOf(current)).toEqual(['North', 'East'])
          expect(current.traps).toHaveLength(1)
        }),
        ...ticks(200, FRAME_MS),
        Story.model(current => {
          expect(current.traps).toEqual([])
          expect(Array.drop(doorsOf(current), 2)).toEqual(['North'])
        }),
      )
    },
  )
})

const preparing: Model = modifyFocus(
  modifyFields(base, {
    phase: () =>
      Phase.Preparation({
        wave: 3,
        remainingMs: 15_000,
        durationMs: PREPARATION_MS,
        spawns: [spawnAt('North', 1), spawnAt('North', 1), spawnAt('West', 2)],
      }),
  }),
  {
    trapStock: () => ({ Barricade: 1, Turret: 0 }),
    selectedTrap: () => 'Barricade',
    player: player => modifyFields(player, { x: () => 220, y: () => 27 }),
  },
)

describe('the door preview follows the planks', () => {
  it.effect(
    'a plank moves its door count, live, and a broken one moves it back',
    () =>
      Effect.gen(function* () {
        yield* Story.story(
          APPLICATION,
          Story.given(preparing),
          Story.model(current => {
            expect(previewDoors(current)).toEqual(['North', 'West'])
          }),
          Story.message(Message.PressedKey({ code: 'KeyT' })),
          Story.model(current => {
            expect(current.traps).toHaveLength(1)
            expect(previewDoors(current)).toEqual(['West', 'East'])
          }),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(
            modifyFields(preparing, { traps: () => [plank(1, 'North', 0)] }),
          ),
          Story.model(current => {
            expect(previewDoors(current)).toEqual(['West', 'East'])
          }),
          Story.message(Message.TickedFrame({ deltaTime: FRAME_MS })),
          Story.model(current => {
            expect(current.traps).toEqual([])
            expect(previewDoors(current)).toEqual(['North', 'West'])
          }),
        )
      }),
  )
})

describe('Ankle Biters and boarded doors', () => {
  test('an Ankle Biter never comes up beside or behind a boarded doorway', () => {
    const traps = [plank(1, 'West'), plank(2, 'North')]
    Array.forEach(
      Array.makeBy(60, index => index * 7919 + 1),
      state => {
        const [, spot] = drawSurfacingSpot(
          PARLOUR,
          state,
          { x: 160, y: 95 },
          traps,
        )
        expect(isInsideRoomAt(PARLOUR, spot)).toBe(true)
        Array.forEach(traps, trap => {
          expect(distanceToBox(spot, trapBox(PARLOUR, trap))).toBeGreaterThan(0)
        })
      },
    )
  })
})

const stringOrder = (first: string, second: string): -1 | 0 | 1 =>
  first < second ? -1 : first > second ? 1 : 0
