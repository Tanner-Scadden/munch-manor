import { Array, Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it, test } from '@effect/vitest'

import { localPlayersIn } from '../../app/boot'
import { Message } from '../../app/message'
import { BreakClock, type Model, Phase } from '../../app/model'
import { initialModel } from '../../app/pureApp'
import { cameraFocus } from '../../render/camera'
import { FIXED_STEP_MS } from '../../shared/constants'
import { DISTANT_SPAWN, atSeat } from '../../test/model.fixture'
import {
  SURFACE,
  checkModel,
  press,
  release,
  send,
  startedRun,
  storyOf,
  ticks,
} from '../../test/testing'
import { asVeteran } from '../../test/veteran'
import {
  focusOf,
  maybePlayerAt,
  modifyFocus,
  playersOf,
} from '../../world/party/party'
import { type World } from '../../world/schema/world'

// Two to four players at one keyboard (MULTIPLAYER.md, Phase 1): a dev-only
// `?local=N` link seats them, player 2 plays on IJKL with U to fire, and
// the camera frames everyone.

const TICK_MS = FIXED_STEP_MS

const onTheCouch = (count: number): Model =>
  UiStruct.evolve(asVeteran(initialModel), {
    maybeSurface: () => Option.some(SURFACE),
    localPlayers: () => count,
  })

const started = (count: number) => startedRun(onTheCouch(count))

const inWave = (current: Model): Model =>
  UiStruct.evolve(current, {
    phase: () => Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
  })

const fighting = (count: number) => started(count).pipe(Effect.map(inWave))

const inBreak = (current: Model): Model =>
  UiStruct.evolve(current, {
    phase: () =>
      Phase.Preparation({
        clock: BreakClock.Counting(),
        wave: 3,
        remainingMs: 30_000,
        durationMs: 30_000,
        spawns: [DISTANT_SPAWN],
      }),
  })

const mateAt = (current: World, slot: number) =>
  Option.getOrThrow(maybePlayerAt(current, slot))

describe('a ?local link', () => {
  test('reads 2 to 4 players and 1 for anything else', () => {
    expect(localPlayersIn('?local=2')).toBe(2)
    expect(localPlayersIn('?local=4')).toBe(4)
    expect(localPlayersIn('?local=9')).toBe(4)
    expect(localPlayersIn('?local=zero')).toBe(1)
    expect(localPlayersIn('')).toBe(1)
  })

  it.effect('seats every player at the start of a run', () =>
    Effect.gen(function* () {
      const pair = yield* started(2)
      const four = yield* started(4)
      const solo = yield* started(1)
      expect(playersOf(pair)).toHaveLength(2)
      expect(playersOf(four)).toHaveLength(4)
      expect(solo.party._tag).toBe('Solo')
    }),
  )

  it.effect('the first wave already counts the crew', () =>
    Effect.gen(function* () {
      const spawnsOf = (current: Model) =>
        current.phase._tag === 'Preparation' ? current.phase.spawns.length : 0
      const crew = yield* started(2)
      const solo = yield* started(1)
      expect(spawnsOf(crew)).toBeGreaterThan(spawnsOf(solo))
    }),
  )
})

describe('player 2 on IJKL', () => {
  it.effect('walks with IJKL while player 1 stands still', () =>
    Effect.gen(function* () {
      const before = yield* fighting(2)

      const s = yield* storyOf(before)
      s.pipe(
        press('KeyL'),
        ticks(20, TICK_MS),
        checkModel(current => {
          expect(mateAt(current, 1).player.x).toBeGreaterThan(
            mateAt(before, 1).player.x,
          )
          expect(focusOf(current).player.x).toBe(focusOf(before).player.x)
        }),
        release('KeyL'),
      )
    }),
  )

  it.effect('fires with U, and the shot is theirs', () =>
    Effect.gen(function* () {
      const before = yield* fighting(2)

      const s = yield* storyOf(before)
      s.pipe(
        press('KeyU'),
        ticks(2, TICK_MS),
        checkModel(current => {
          expect(current.bullets.length).toBeGreaterThan(0)
          expect(
            Array.every(current.bullets, ({ shooter }) => shooter === 1),
          ).toBe(true)
        }),
        release('KeyU'),
      )
    }),
  )

  // NOTE: player 3's block holds the numpad's 1 to 3, so they stay theirs
  // and never draw player 1's guns; the top row's 1 to 3 are player 1's.
  it.effect("player 3's numpad 3 draws their knife, not player 1's", () =>
    Effect.gen(function* () {
      const before = yield* fighting(3)

      const s = yield* storyOf(before)
      s.pipe(
        press('Numpad3'),
        release('Numpad3'),
        checkModel(current => {
          expect(mateAt(current, 2).player.wield).toBe('Melee')
          expect(focusOf(current).player.wield).toBe('Gun')
        }),
        press('Digit3'),
        release('Digit3'),
        checkModel(current => {
          expect(focusOf(current).player.wield).toBe('Melee')
        }),
      )
    }),
  )

  it.effect('the break ends once both players press READY', () =>
    Effect.gen(function* () {
      const run = yield* started(2)

      const s = yield* storyOf(inBreak(run))
      s.pipe(
        press('Enter'),
        release('Enter'),
        ticks(1, TICK_MS),
        checkModel(current => {
          expect(current.phase._tag).toBe('Preparation')
        }),
        press('KeyY'),
        release('KeyY'),
        ticks(1, TICK_MS),
        checkModel(current => {
          expect(current.phase._tag).toBe('Wave')
        }),
      )
    }),
  )
})

describe('one camera for the couch', () => {
  it.effect('follows the middle of every player', () =>
    Effect.gen(function* () {
      const pair = yield* fighting(2)
      const apart = atSeat(
        atSeat(pair, 0, world =>
          modifyFocus(world, {
            player: player => UiStruct.evolve(player, { x: () => 100 }),
          }),
        ),
        1,
        world =>
          modifyFocus(world, {
            player: player => UiStruct.evolve(player, { x: () => 200 }),
          }),
      )
      expect(cameraFocus(apart).x).toBe(150)
    }),
  )

  it.effect('single player follows the player as before', () =>
    Effect.gen(function* () {
      const solo = yield* fighting(1)
      expect(cameraFocus(solo).x).toBe(
        focusOf(solo).player.x + solo.cameraLean.x,
      )
    }),
  )
})

describe('keys outside a run', () => {
  it.effect('player 2’s keys are player 1’s menu keys at home', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(onTheCouch(2))
      s.pipe(
        send(Message.PressedKey({ code: 'KeyU' })),
        checkModel(current => {
          expect(current.phase._tag).toBe('Ready')
        }),
      )
    }),
  )
})
