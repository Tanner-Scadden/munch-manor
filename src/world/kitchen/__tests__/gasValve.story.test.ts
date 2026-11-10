import { Array, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import { GasValve, type Model, Phase } from '../../../app/model'
import { FIXED_STEP_MS } from '../../../shared/constants'
import {
  DISTANT_SPAWN,
  atValve,
  freshRunModel,
  kitchenBreak,
  withFeatsOf,
} from '../../../test/model.fixture'
import {
  APPLICATION,
  HOLD_TICKS,
  holdEnter,
  holdFireToward,
  steppedWorld,
  ticks,
  zombieOf,
} from '../../../test/testing'
import { levelOf } from '../../level/arena'
import {
  focusOf,
  focusSlotOf,
  maybePlayerAt,
  seatCrew,
} from '../../party/party'
import { type World, withWorld } from '../../schema/world'
import { freshTally } from '../../schema/worldSchema'
import { offersOf } from '../../shop/purchase'
import { VALVE_RULES, flameZoneOf, maybeValveLock } from '../gasValve'

// The kitchen's gas valve (src/world/kitchen/gasValve.ts): freed by a feat
// (kills made standing in the kitchen) and turned once with the hold to
// buy, it lights the parlour's fireplace, which burns zombies on the floor
// in front of it and never a player, and pays the player who turned it.

const FRAME_MS = FIXED_STEP_MS

const turn = holdEnter(HOLD_TICKS)

const midWave = Phase.Wave({
  wave: 4,
  elapsedMs: 5000,
  spawns: [DISTANT_SPAWN],
})

const isValveOffered = (current: Model): boolean =>
  Array.some(
    offersOf(current, focusSlotOf(current)),
    ({ target }) => target._tag === 'Valve',
  )

const zone = Option.getOrThrow(flameZoneOf(levelOf(freshRunModel())))

const IN_THE_FIRE = {
  x: (zone.left + zone.right) / 2 + 12,
  y: (zone.top + zone.bottom) / 2,
}

const OUT_OF_THE_FIRE = { x: IN_THE_FIRE.x, y: zone.bottom + 40 }

// NOTE: a wave with the valve already turned by `owner`, the player
// standing in the fire at its west end, and a Shambler with `hp` in the
// fire and another out of it, neither walking.
const litWith = (hp: number, owner = 0): Model =>
  modifyFields(freshRunModel(), {
    phase: () => midWave,
    gasValve: () =>
      GasValve.Lit({ owner, nextBurnMs: VALVE_RULES.burnEveryMs }),
    zombies: () => [
      zombieOf('Shambler', 900, IN_THE_FIRE.x, IN_THE_FIRE.y, { hp }),
      zombieOf('Shambler', 901, OUT_OF_THE_FIRE.x, OUT_OF_THE_FIRE.y, { hp }),
    ],
    seats: seats =>
      Array.map(seats, state =>
        modifyFields(state, {
          player: player =>
            modifyFields(player, {
              x: () => zone.left + 4,
              y: () => IN_THE_FIRE.y,
            }),
        }),
      ),
  })

const hpOf = (world: World, id: number): number =>
  Option.getOrElse(
    Option.map(
      Array.findFirst(world.zombies, zombie => zombie.id === id),
      ({ hp }) => hp,
    ),
    () => 0,
  )

const BURN_TICKS = Math.ceil(VALVE_RULES.burnEveryMs / FRAME_MS)

// NOTE: a spot in the kitchen a little west of the player at the valve.
const AT_VALVE_SHOT = {
  x: focusOf(atValve(0, midWave)).player.x - 30,
  y: focusOf(atValve(0, midWave)).player.y,
}

const holdFireLeft = holdFireToward({ x: -1, y: 0 })

describe('turning the gas valve', () => {
  test('the valve is in the kitchen: boarded up, nobody reaches it', () => {
    const boarded = modifyFields(atValve(500, midWave), {
      level: level => modifyFields(level, { openExits: () => [] }),
    })
    expect(isValveOffered(boarded)).toBe(false)
    expect(isValveOffered(atValve(500, midWave))).toBe(true)
    expect(isValveOffered(atValve(500, kitchenBreak(5)))).toBe(true)
  })

  it.effect(
    'holding Enter at the valve, its feat done, costs nothing and lights the fireplace for good',
    () =>
      Story.story(
        APPLICATION,
        Story.given(atValve(500, midWave)),
        ...turn,
        Story.model(current => {
          expect(current.keys.held).toBe(500)
          expect(
            GasValve.isAnyOf(['Lit'])(current.gasValve) &&
              current.gasValve.owner,
          ).toBe(focusSlotOf(current))
          expect(isValveOffered(current)).toBe(false)
          expect(focusOf(current).feats.firesLit).toBe(1)
        }),
      ),
  )

  it.effect(
    'short of its feat, the valve is locked and a press turns nothing',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          withFeatsOf(atValve(500, midWave), tally =>
            modifyFields(tally, {
              kitchenStandKills: () => VALVE_RULES.standKills - 1,
            }),
          ),
        ),
        Story.model(current => {
          expect(isValveOffered(current)).toBe(false)
          expect(
            Option.isSome(maybeValveLock(current, focusSlotOf(current))),
          ).toBe(true)
        }),
        ...turn,
        Story.model(current => {
          expect(GasValve.isAnyOf(['Shut'])(current.gasValve)).toBe(true)
        }),
      ),
  )

  it.effect('a kill made standing in the kitchen counts toward the valve', () =>
    Story.story(
      APPLICATION,
      Story.given(
        withFeatsOf(
          modifyFields(atValve(0, midWave), {
            zombies: () => [
              zombieOf('Shambler', 900, AT_VALVE_SHOT.x, AT_VALVE_SHOT.y, {
                hp: 1,
                speed: 0,
              }),
            ],
          }),
          () => freshTally,
        ),
      ),
      Story.model(current => {
        expect(focusOf(current).feats.kitchenStandKills).toBe(0)
      }),
      holdFireLeft,
      ...ticks(20, FRAME_MS),
      Story.model(current => {
        expect(focusOf(current).feats.kitchenStandKills).toBe(1)
        expect(focusOf(current).feats.kitchenKills).toBe(1)
      }),
    ),
  )
})

describe('the lit fireplace', () => {
  test('burns a zombie in front of the hearth 2 every 0.3 s, and not one outside', () => {
    const crew = withWorld(litWith(20), world => seatCrew(world, 2))
    const once = withWorld(crew, world => steppedWorld(world, BURN_TICKS + 1))
    expect(hpOf(once, 900)).toBe(20 - VALVE_RULES.damage)
    expect(hpOf(once, 901)).toBe(20)
    const later = withWorld(once, world => steppedWorld(world, BURN_TICKS * 2))
    expect(hpOf(later, 900)).toBe(20 - VALVE_RULES.damage * 3)
    expect(hpOf(later, 901)).toBe(20)
  })

  it.effect('never burns a player standing in it', () => {
    const start = litWith(20)
    return Story.story(
      APPLICATION,
      Story.given(start),
      ...ticks(BURN_TICKS * 4, FRAME_MS),
      Story.model(current => {
        expect(focusOf(current).player.hp).toBe(focusOf(start).player.hp)
        expect(hpOf(current, 900)).toBeLessThan(20)
      }),
    )
  })

  it.effect('a shut valve burns nothing', () => {
    const shut = modifyFields(litWith(20), {
      gasValve: () => GasValve.Shut(),
    })
    return Story.story(
      APPLICATION,
      Story.given(shut),
      ...ticks(BURN_TICKS * 4, FRAME_MS),
      Story.model(current => {
        expect(hpOf(current, 900)).toBe(20)
      }),
    )
  })

  test('its kills pay the player who turned the valve', () => {
    const crew = withWorld(litWith(VALVE_RULES.damage, 1), world =>
      seatCrew(world, 2),
    )
    const burned = withWorld(crew, world => steppedWorld(world, BURN_TICKS + 1))
    const owner = Option.getOrThrow(maybePlayerAt(burned, 1))
    const teammate = Option.getOrThrow(maybePlayerAt(burned, 0))
    expect(hpOf(burned, 900)).toBe(0)
    expect(owner.seat.kills).toBe(1)
    expect(teammate.seat.kills).toBe(0)
  })
})
