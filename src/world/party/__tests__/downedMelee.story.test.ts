import { Array, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { Life, Melee, type Model } from '../../../app/model'
import { botInputs } from '../../../features/bots/teammateBot'
import { lyingShapes } from '../../../render/playerView'
import {
  atSeat,
  crewInWave,
  placeSeat,
  withSeatLife,
  withZombies,
} from '../../../test/model.fixture'
import { zombieOf } from '../../../test/testing'
import { freshGun } from '../../gear/weapons'
import type { World } from '../../schema/world'
import { type Intent, idleIntent } from '../../schema/worldSchema'
import { type InputsByPlayer, stepWorld } from '../../step/stepWorld'
import { modifyFocus, seatStateAt } from '../party'

// A co-op player who is down, Downed or BledOut, cannot shoot, but the
// trigger swings their melee slot: the knife, or the Clang Pan
// (swingWhileDown in src/world/step/simulation.ts). The gun stays drawn for when they
// get up.

const PLAYER_X = 100
const ROW_Y = 104
const TANK_ID = 7

const swinging: Intent = {
  ...idleIntent,
  maybeAim: Option.some({ x: 1, y: 0 }),
  trigger: 'Held',
}

const DOWNED = Life.Downed({ bleedMs: 10_000, reviveMs: 0, callMs: 0 })

// NOTE: player 1 lies at PLAYER_X with a Tank close in front; player 2
// stands far off, so the run goes on.
const downedBeside = (life: Life = DOWNED): Model =>
  withZombies(
    withSeatLife(
      0,
      life,
    )(placeSeat(1, 260, 40)(placeSeat(0, PLAYER_X, ROW_Y, 0)(crewInWave(2)))),
    [zombieOf('Tank', TANK_ID, PLAYER_X + 10, ROW_Y, { hp: 30 })],
  )

const PAN = Melee.Pan({ pan: freshGun('Pan') })

const holdingPan = (current: Model): Model =>
  atSeat(current, 0, world =>
    modifyFocus(world, {
      player: player => modifyFields(player, { melee: () => PAN }),
    }),
  )

const run = (start: World, frames: number, intent = swinging): World =>
  Array.reduce(Array.range(1, frames), start, current => {
    const inputs: InputsByPlayer = new Map([[0, intent]])
    return stepWorld(current, inputs).world
  })

const tankHp = (world: World): number =>
  Option.match(
    Array.findFirst(world.zombies, zombie => zombie.id === TANK_ID),
    { onNone: () => 0, onSome: zombie => zombie.hp },
  )

const FRAMES = 40

describe('a player who is down', () => {
  test('stabs with the knife, and never fires the gun', () => {
    const after = run(downedBeside(), FRAMES)
    const { player, seat } = seatStateAt(after, 0)
    expect(tankHp(after)).toBeLessThan(30)
    expect(after.bullets).toEqual([])
    expect(seat.shotsFired).toBe(0)
    expect(player.wield).toBe('Gun')
  })

  test('swings the Clang Pan when it has one, harder than the knife', () => {
    const knifed = run(downedBeside(), FRAMES)
    const panned = run(holdingPan(downedBeside()), FRAMES)
    expect(tankHp(panned)).toBeLessThan(tankHp(knifed))
    expect(seatStateAt(panned, 0).player.wield).toBe('Gun')
  })

  test('with the trigger let go, does nothing', () => {
    expect(tankHp(run(downedBeside(), FRAMES, idleIntent))).toBe(30)
  })

  test('bled out, still swings but cannot crawl', () => {
    const start = downedBeside(Life.BledOut())
    const after = run(start, FRAMES, {
      ...swinging,
      move: { x: 0, y: 1 },
    })
    expect(tankHp(after)).toBeLessThan(30)
    expect(seatStateAt(after, 0).player.y).toBe(ROW_Y)
  })

  test('shows the slash over its body while it stabs', () => {
    const before = downedBeside()
    const after = run(before, 1)
    const asModel = (world: World): Model =>
      modifyFields(before, { seats: () => world.seats })
    expect(lyingShapes(asModel(after), 'Downed').length).toBeGreaterThan(
      lyingShapes(before, 'Downed').length,
    )
  })

  test('a downed bot swings at a zombie in reach, and rests with none near', () => {
    const near = downedBeside()
    expect(botInputs(near, [0]).get(0)?.trigger).toBe('Held')
    const alone = withZombies(near, [])
    expect(botInputs(alone, [0]).get(0)?.trigger).toBe('Released')
  })
})
