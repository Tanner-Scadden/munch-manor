import { Array, Option } from 'effect'
import { given, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { crewBotSlots } from './bots'
import { cameraFocus } from './camera'
import { FIXED_STEP_MS, PLAYER_MAX_HP } from './constants'
import { coopNameShapes } from './coopMarksView'
import { update } from './main'
import { Message } from './message'
import { type Bot, type Model, Phase } from './model'
import {
  DISTANT_SPAWN,
  atSeat,
  crewInWave,
  pickupAt,
  placeSeat,
  withPickups,
  withSeatLife,
  withZombies,
} from './model.fixture'
import { isLeftFromRoom } from './onlineRun'
import { maybePlayerAt, modifyFocus, playersOf } from './party'
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

  test('a bot does not back itself into a corner: it gets out and keeps moving', () => {
    const cornered = withZombies(
      placeSeat(1, 25, 155)(placeSeat(0, 200, 60)(crew())),
      [zombieOf('Tank', 7, 50, 130, { speed: 20 })],
    )
    story(
      update,
      given(cornered),
      ...ticks(90, TICK_MS),
      model(current => {
        const bot = seatOf(current, 1).player
        expect(Math.hypot(bot.x - 10, bot.y - 170)).toBeGreaterThan(45)
      }),
    )
  })

  test('a bot revives a downed human by standing still beside them', () => {
    const downed = withSeatLife(
      0,
      Life.Downed({ bleedMs: 10_000, reviveMs: 0, callMs: 0 }),
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
      Life.Downed({ bleedMs: 10_000, reviveMs: 0, callMs: 0 }),
    )(placeSeat(1, 60, 60, 0)(placeSeat(0, 62, 60)(crew())))
    expect(botInputs(downed, [1]).get(1)?.trigger).toBe('Released')
  })
})

describe('on its own', () => {
  const distance = (current: Model, first: number, second: number) =>
    Math.hypot(
      seatOf(current, first).player.x - seatOf(current, second).player.x,
      seatOf(current, first).player.y - seatOf(current, second).player.y,
    )

  test('a bot does not follow the human: it walks to its own post', () => {
    const apart = modifyFields(
      placeSeat(1, 150, 90)(placeSeat(0, 40, 140)(crew())),
      { phase: () => BREAK },
    )
    story(
      update,
      given(apart),
      ...ticks(240, TICK_MS),
      model(current => {
        expect(distance(current, 0, 1)).toBeGreaterThan(60)
        expect(seatOf(current, 1).player.x).not.toBeCloseTo(150)
      }),
    )
  })

  test('two bots side by side split up to posts of their own', () => {
    const twoBots = modifyFields(
      placeSeat(2, 152, 90)(placeSeat(1, 148, 90)(crewInWave(3))),
      { crewBots: () => [BOT, BOT], phase: () => BREAK },
    )
    story(
      update,
      given(twoBots),
      ...ticks(300, TICK_MS),
      model(current => {
        expect(distance(current, 1, 2)).toBeGreaterThan(60)
      }),
    )
  })

  test('a bot hunts a zombie out of its sight range instead of waiting by the human', () => {
    const far = withZombies(
      placeSeat(1, 40, 70)(placeSeat(0, 30, 140)(crew())),
      [zombieOf('Shambler', 7, 190, 70, { speed: 0, hp: 6 })],
    )
    story(
      update,
      given(far),
      ...ticks(180, TICK_MS),
      model(current => {
        expect(seatOf(current, 1).player.x).toBeGreaterThan(80)
        expect(seatOf(current, 1).seat.shotsFired).toBeGreaterThan(0)
      }),
    )
  })
})

describe('power-ups', () => {
  const boostOf = (current: Model, slot: number) =>
    seatOf(current, slot).boosts.Damage._tag

  test('a bot goes for a power-up near it, like a player would', () => {
    const start = withPickups(
      placeSeat(1, 150, 90)(placeSeat(0, 30, 140)(crew())),
      [pickupAt(900, 'Damage', 150, 135)],
    )
    story(
      update,
      given(start),
      ...ticks(60, TICK_MS),
      model(current => {
        expect(boostOf(current, 1)).toBe('On')
        expect(current.pickups).toEqual([])
      }),
    )
  })

  test('it leaves one the human is nearer to', () => {
    const start = withPickups(
      placeSeat(1, 150, 90)(placeSeat(0, 150, 150)(crew())),
      [pickupAt(900, 'Damage', 150, 135)],
    )
    story(
      update,
      given(start),
      ...ticks(60, TICK_MS),
      model(current => {
        expect(boostOf(current, 1)).toBe('Off')
        expect(current.pickups).toHaveLength(1)
      }),
    )
  })

  test('it leaves a Heart at full health, and takes one when hurt', () => {
    const start = (hp: number) =>
      withPickups(placeSeat(1, 150, 90, hp)(placeSeat(0, 30, 140)(crew())), [
        pickupAt(900, 'Heart', 150, 135),
      ])
    story(
      update,
      given(start(PLAYER_MAX_HP)),
      ...ticks(60, TICK_MS),
      model(current => {
        expect(current.pickups).toHaveLength(1)
      }),
    )
    story(
      update,
      given(start(2)),
      ...ticks(60, TICK_MS),
      model(current => {
        expect(seatOf(current, 1).player.hp).toBe(3)
        expect(current.pickups).toEqual([])
      }),
    )
  })

  test('it grabs one in a break too', () => {
    const stocked = withPickups(
      placeSeat(1, 150, 90)(placeSeat(0, 30, 140)(crew())),
      [pickupAt(900, 'Damage', 150, 135)],
    )
    const start = modifyFields(stocked, { phase: () => BREAK })
    story(
      update,
      given(start),
      ...ticks(60, TICK_MS),
      model(current => {
        expect(boostOf(current, 1)).toBe('On')
      }),
    )
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
      modifyFocus(world, {
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
          modifyFocus(world, {
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
