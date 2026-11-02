import { Array, Option } from 'effect'
import { given, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { crewBotSlots } from './bots'
import { cameraFocus } from './camera'
import { FIXED_STEP_MS } from './constants'
import { coopNameShapes } from './coopMarksView'
import { update } from './main'
import { Message } from './message'
import { type Bot, type Model, Phase } from './model'
import {
  DISTANT_SPAWN,
  atSeat,
  crewInWave,
  placeSeat,
  withSeatLife,
  withZombies,
} from './model.fixture'
import { isLeftFromRoom } from './onlineRun'
import { maybePlayerAt, playersOf } from './party'
import { STALL_BOX } from './shop'
import { botInputs } from './teammateBot'
import { press, release, ticks, zombieOf } from './testing'
import { Life, ShopState } from './worldSchema'

// A teammate bot (src/teammateBot.ts) plays its seat from the World: it
// shoots, revives, keeps out of the human's way at the stall, buys, and
// presses READY. Each test seats one bot in a crew of two.

const TICK_MS = FIXED_STEP_MS

const BOT: Bot = {
  name: 'Gizmo',
  calling: 'You',
  look: crewInWave(1).appearance,
}

const withBot = (base: Model): Model =>
  modifyFields(base, { crewBots: () => [BOT] })

const crew = (): Model => withBot(crewInWave(2))

const BREAK = Phase.Preparation({
  wave: 3,
  remainingMs: 60_000,
  durationMs: 60_000,
  spawns: [DISTANT_SPAWN],
})

const seatOf = (current: Model, slot: number) =>
  Option.getOrThrow(maybePlayerAt(current, slot))

describe('in a fight', () => {
  test('a bot shoots the zombie in front of it', () => {
    const fight = withZombies(
      placeSeat(1, 60, 60)(placeSeat(0, 30, 60)(crew())),
      [zombieOf('Shambler', 7, 110, 60, { hp: 6 })],
    )
    story(
      update,
      given(fight),
      ...ticks(40, TICK_MS),
      model(current => {
        expect(seatOf(current, 1).seat.shotsFired).toBeGreaterThan(0)
        expect(seatOf(current, 0).seat.shotsFired).toBe(0)
      }),
    )
  })

  test('a bot keeps its distance: it backs off a zombie on top of it', () => {
    const fight = withZombies(
      placeSeat(1, 100, 60)(placeSeat(0, 30, 60)(crew())),
      [zombieOf('Tank', 7, 112, 60)],
    )
    story(
      update,
      given(fight),
      ...ticks(30, TICK_MS),
      model(current => {
        expect(seatOf(current, 1).player.x).toBeLessThan(100)
      }),
    )
  })

  test('a bot revives a downed human by standing still beside them', () => {
    const downed = withSeatLife(
      0,
      Life.Downed({ bleedMs: 10_000, reviveMs: 0 }),
    )(placeSeat(1, 120, 60)(placeSeat(0, 30, 60, 0)(crew())))
    story(
      update,
      given(downed),
      model(current => {
        expect(seatOf(current, 0).seat.life._tag).toBe('Downed')
      }),
      ...ticks(360, TICK_MS),
      model(current => {
        expect(seatOf(current, 0).seat.life._tag).toBe('Standing')
        expect(seatOf(current, 1).seat.revives).toBe(1)
      }),
    )
  })

  test('a downed bot sits out, and the human can revive it', () => {
    const downed = withSeatLife(
      1,
      Life.Downed({ bleedMs: 10_000, reviveMs: 0 }),
    )(placeSeat(1, 60, 60, 0)(placeSeat(0, 62, 60)(crew())))
    expect(botInputs(downed, [1]).get(1)?.trigger).toBe('Released')
  })
})

describe('in a break', () => {
  const inBreak = modifyFields(crew(), { phase: () => BREAK })

  test('presses READY with the human, and the wave starts', () => {
    story(
      update,
      given(inBreak),
      press('Enter'),
      release('Enter'),
      ...ticks(3, TICK_MS),
      model(current => {
        expect(current.phase._tag).toBe('Wave')
      }),
    )
  })

  test('presses READY after a short wait on its own, and the wave still waits for the human', () => {
    story(
      update,
      given(inBreak),
      ...ticks(40, TICK_MS),
      model(current => {
        expect(seatOf(current, 1).seat.readiness).toBe('Waiting')
      }),
      ...ticks(300, TICK_MS),
      model(current => {
        expect(current.phase._tag).toBe('Preparation')
        expect(seatOf(current, 1).seat.readiness).toBe('Ready')
      }),
    )
  })

  const wounded = (current: Model) =>
    atSeat(current, 1, world =>
      modifyFields(world, {
        player: player => modifyFields(player, { hp: () => 3 }),
        wallet: wallet => ({ ...wallet, balance: 200 }),
      }),
    )

  test('buys a heart at the stall when the human is elsewhere', () => {
    story(
      update,
      given(placeSeat(0, 40, 40)(wounded(inBreak))),
      ...ticks(900, TICK_MS),
      model(current => {
        expect(seatOf(current, 1).player.hp).toBeGreaterThan(3)
        expect(seatOf(current, 1).wallet.balance).toBeLessThan(200)
      }),
    )
  })

  test('never takes the human spot at the stall', () => {
    const humanAtStall = placeSeat(
      0,
      STALL_BOX.left - 6,
      (STALL_BOX.top + STALL_BOX.bottom) / 2,
    )(wounded(inBreak))
    story(
      update,
      given(
        atSeat(humanAtStall, 0, world =>
          modifyFields(world, {
            shop: () => ShopState.Browsing({ focusedItem: 'Heart' }),
          }),
        ),
      ),
      ...ticks(600, TICK_MS),
      model(current => {
        expect(seatOf(current, 1).player.hp).toBe(3)
        expect(
          Math.hypot(
            seatOf(current, 1).player.x - STALL_BOX.left,
            seatOf(current, 1).player.y - STALL_BOX.top,
          ),
        ).toBeGreaterThan(20)
      }),
    )
  })
})

describe('the same World gives the same bot', () => {
  test('its intent is a function of the World alone', () => {
    const fight = withZombies(
      placeSeat(1, 60, 60)(placeSeat(0, 30, 60)(crew())),
      [zombieOf('Shambler', 7, 110, 60), zombieOf('Runner', 8, 90, 80)],
    )
    expect(botInputs(fight, [1])).toEqual(botInputs(fight, [1]))
    expect(botInputs(fight, [1]).get(1)?.trigger).toBe('Held')
  })

  test('replaying the same frames plays the same run', () => {
    const run = (): Model => {
      let current = withZombies(
        placeSeat(1, 60, 60)(placeSeat(0, 30, 60)(crew())),
        [zombieOf('Shambler', 7, 110, 60, { speed: 12 })],
      )
      for (let frame = 0; frame < 200; frame += 1) {
        current = update(
          current,
          Message.TickedFrame({ deltaTime: TICK_MS }),
        ).model
      }
      return current
    }
    expect(playersOf(run())).toEqual(playersOf(run()))
  })
})

describe('what the player sees', () => {
  test('the camera stays on the human, not the middle of the crew', () => {
    const apart = placeSeat(1, 250, 150)(placeSeat(0, 40, 40)(crew()))
    expect(cameraFocus(apart).x).toBeCloseTo(40 + apart.cameraLean.x)
    expect(cameraFocus(apart).y).toBeCloseTo(40 + apart.cameraLean.y)
  })

  test('a bot wears a name tag, and a crew with no bots in a plain run has none', () => {
    expect(Array.isReadonlyArrayNonEmpty(coopNameShapes(crew()))).toBe(true)
    expect(coopNameShapes(crewInWave(2))).toEqual([])
    expect(crewBotSlots(crew())).toEqual([1])
  })
})

describe('a bot run in the root', () => {
  test('is not taken for a room run left behind, which goes home', () => {
    expect(isLeftFromRoom(crewInWave(2))).toBe(true)
    expect(isLeftFromRoom(crew())).toBe(false)
  })
})
