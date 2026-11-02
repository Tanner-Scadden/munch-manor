import { Array, Option } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { localPlayersIn } from './boot'
import { cameraFocus } from './camera'
import { FIXED_STEP_MS } from './constants'
import { update } from './main'
import { Message } from './message'
import { type Model, Phase, ShopState, initialModel } from './model'
import { DISTANT_SPAWN, atSeat } from './model.fixture'
import { maybePlayerAt, playersOf } from './party'
import { SURFACE, press, release, startedRunOf, ticks } from './testing'
import { asVeteran } from './veteran'
import { type World } from './world'

// Two to four players at one keyboard (MULTIPLAYER.md, Phase 1): a dev-only
// `?local=N` link seats them, player 2 plays on IJKL with U to fire, and
// the camera frames everyone.

const TICK_MS = FIXED_STEP_MS

const onTheCouch = (count: number): Model =>
  modifyFields(asVeteran(initialModel), {
    maybeSurface: () => Option.some(SURFACE),
    localPlayers: () => count,
  })

const started = (count: number): Model => startedRunOf(onTheCouch(count))

const fighting = (count: number): Model =>
  modifyFields(started(count), {
    phase: () => Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
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

  test('seats every player at the start of a run', () => {
    expect(playersOf(started(2))).toHaveLength(2)
    expect(playersOf(started(4))).toHaveLength(4)
    expect(started(1).party._tag).toBe('Solo')
  })

  test('the first wave already counts the crew', () => {
    const spawnsOf = (current: Model) =>
      current.phase._tag === 'Preparation' ? current.phase.spawns.length : 0
    expect(spawnsOf(started(2))).toBeGreaterThan(spawnsOf(started(1)))
  })
})

describe('player 2 on IJKL', () => {
  test('walks with IJKL while player 1 stands still', () => {
    const before = fighting(2)
    story(
      update,
      given(before),
      press('KeyL'),
      ...ticks(20, TICK_MS),
      model(current => {
        expect(mateAt(current, 1).player.x).toBeGreaterThan(
          mateAt(before, 1).player.x,
        )
        expect(current.player.x).toBe(before.player.x)
      }),
      release('KeyL'),
    )
  })

  test('fires with U, and the shot is theirs', () => {
    story(
      update,
      given(fighting(2)),
      press('KeyU'),
      ...ticks(2, TICK_MS),
      model(current => {
        expect(current.bullets.length).toBeGreaterThan(0)
        expect(
          Array.every(current.bullets, ({ shooter }) => shooter === 1),
        ).toBe(true)
      }),
      release('KeyU'),
    )
  })

  test('the break ends once both players press READY', () => {
    story(
      update,
      given(
        modifyFields(started(2), {
          phase: () =>
            Phase.Preparation({
              wave: 3,
              remainingMs: 30_000,
              durationMs: 30_000,
              spawns: [DISTANT_SPAWN],
            }),
        }),
      ),
      press('Enter'),
      release('Enter'),
      ...ticks(1, TICK_MS),
      model(current => {
        expect(current.phase._tag).toBe('Preparation')
      }),
      press('KeyY'),
      release('KeyY'),
      ...ticks(1, TICK_MS),
      model(current => {
        expect(current.phase._tag).toBe('Wave')
      }),
    )
  })

  test('buys at the stall with U and walks off with O', () => {
    const shopping = atSeat(
      modifyFields(started(2), {
        phase: () =>
          Phase.Preparation({
            wave: 3,
            remainingMs: 30_000,
            durationMs: 30_000,
            spawns: [DISTANT_SPAWN],
          }),
      }),
      1,
      world =>
        modifyFields(world, {
          wallet: wallet => modifyFields(wallet, { balance: () => 200 }),
          shop: () => ShopState.Browsing({ focusedItem: 'Shotgun' }),
        }),
    )
    story(
      update,
      given(shopping),
      press('KeyU'),
      release('KeyU'),
      model(current => {
        expect(mateAt(current, 1).player.arsenal._tag).toBe('HoldingSecond')
        expect(mateAt(current, 1).wallet.balance).toBeLessThan(200)
        expect(current.wallet.balance).toBe(0)
      }),
      press('KeyO'),
      release('KeyO'),
      model(current => {
        const party = current.party
        expect(
          party._tag === 'Crew' ? party.mates[0]?.shop._tag : undefined,
        ).toBe('Dismissed')
      }),
    )
  })
})

describe('one camera for the couch', () => {
  test('follows the middle of every player', () => {
    const apart = atSeat(
      atSeat(fighting(2), 0, world =>
        modifyFields(world, {
          player: player => modifyFields(player, { x: () => 100 }),
        }),
      ),
      1,
      world =>
        modifyFields(world, {
          player: player => modifyFields(player, { x: () => 200 }),
        }),
    )
    expect(cameraFocus(apart).x).toBe(150)
  })

  test('single player follows the player as before', () => {
    const solo = fighting(1)
    expect(cameraFocus(solo).x).toBe(solo.player.x + solo.cameraLean.x)
  })
})

describe('keys outside a run', () => {
  test('player 2’s keys are player 1’s menu keys at home', () => {
    story(
      update,
      given(onTheCouch(2)),
      message(Message.PressedKey({ code: 'KeyU' })),
      model(current => {
        expect(current.phase._tag).toBe('Ready')
      }),
    )
  })
})
