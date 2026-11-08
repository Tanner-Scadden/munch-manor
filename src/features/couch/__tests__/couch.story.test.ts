import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import { localPlayersIn } from '../../../app/boot'
import { Message } from '../../../app/message'
import { type Model, Phase, ShopState } from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { cameraFocus } from '../../../render/camera'
import { FIXED_STEP_MS } from '../../../shared/constants'
import { DISTANT_SPAWN, atSeat } from '../../../test/model.fixture'
import {
  APPLICATION,
  SURFACE,
  press,
  release,
  startedRun,
  ticks,
} from '../../../test/testing'
import { asVeteran } from '../../../test/veteran'
import {
  focusOf,
  maybePlayerAt,
  modifyFocus,
  playersOf,
} from '../../../world/party/party'
import { type World } from '../../../world/schema/world'

// Two to four players at one keyboard (MULTIPLAYER.md, Phase 1): a dev-only
// `?local=N` link seats them, player 2 plays on IJKL with U to fire, and
// the camera frames everyone.

const TICK_MS = FIXED_STEP_MS

const onTheCouch = (count: number): Model =>
  modifyFields(asVeteran(initialModel), {
    maybeSurface: () => Option.some(SURFACE),
    localPlayers: () => count,
  })

const started = (count: number) => startedRun(onTheCouch(count))

const inWave = (current: Model): Model =>
  modifyFields(current, {
    phase: () => Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
  })

const fighting = (count: number) => started(count).pipe(Effect.map(inWave))

const inBreak = (current: Model): Model =>
  modifyFields(current, {
    phase: () =>
      Phase.Preparation({
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
      return yield* Story.story(
        APPLICATION,
        Story.given(before),
        press('KeyL'),
        ...ticks(20, TICK_MS),
        Story.model(current => {
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
      return yield* Story.story(
        APPLICATION,
        Story.given(before),
        press('KeyU'),
        ...ticks(2, TICK_MS),
        Story.model(current => {
          expect(current.bullets.length).toBeGreaterThan(0)
          expect(
            Array.every(current.bullets, ({ shooter }) => shooter === 1),
          ).toBe(true)
        }),
        release('KeyU'),
      )
    }),
  )

  it.effect('the break ends once both players press READY', () =>
    Effect.gen(function* () {
      const run = yield* started(2)
      return yield* Story.story(
        APPLICATION,
        Story.given(inBreak(run)),
        press('Enter'),
        release('Enter'),
        ...ticks(1, TICK_MS),
        Story.model(current => {
          expect(current.phase._tag).toBe('Preparation')
        }),
        press('KeyY'),
        release('KeyY'),
        ...ticks(1, TICK_MS),
        Story.model(current => {
          expect(current.phase._tag).toBe('Wave')
        }),
      )
    }),
  )

  it.effect('buys at the stall with U and walks off with O', () =>
    Effect.gen(function* () {
      const run = yield* started(2)
      const shopping = atSeat(inBreak(run), 1, world =>
        modifyFocus(world, {
          wallet: wallet => modifyFields(wallet, { balance: () => 200 }),
          shop: () => ShopState.Browsing({ focusedItem: 'Shotgun' }),
        }),
      )
      return yield* Story.story(
        APPLICATION,
        Story.given(shopping),
        press('KeyU'),
        release('KeyU'),
        Story.model(current => {
          expect(mateAt(current, 1).player.arsenal._tag).toBe('HoldingSecond')
          expect(mateAt(current, 1).wallet.balance).toBeLessThan(200)
          expect(focusOf(current).wallet.balance).toBe(0)
        }),
        press('KeyO'),
        release('KeyO'),
        Story.model(current => {
          expect(current.seats[1]?.shop._tag).toBe('Dismissed')
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
            player: player => modifyFields(player, { x: () => 100 }),
          }),
        ),
        1,
        world =>
          modifyFocus(world, {
            player: player => modifyFields(player, { x: () => 200 }),
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
    Story.story(
      APPLICATION,
      Story.given(onTheCouch(2)),
      Story.message(Message.PressedKey({ code: 'KeyU' })),
      Story.model(current => {
        expect(current.phase._tag).toBe('Ready')
      }),
    ),
  )
})
