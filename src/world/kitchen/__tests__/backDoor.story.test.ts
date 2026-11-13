import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'
import { NEUTRAL_INPUT, type PlayerTick } from '@munch/netcode'

import { type Model, Phase, RunMode } from '../../../app/model'
import { endKindOf } from '../../../features/end/endBeat'
import { FIXED_STEP_MS } from '../../../shared/constants'
import {
  DISTANT_SPAWN,
  freshRunModel,
  kitchenBreak,
  withDareThings,
  withFinale,
} from '../../../test/model.fixture'
import { TWO_SEAT_ROOM } from '../../../test/roomTesting'
import {
  APPLICATION,
  holdEnter,
  settleRunCommands,
} from '../../../test/testing'
import { type DareThing, DareThingState, Finale } from '../../dare/dareSchema'
import { pointsForRun } from '../../heroes/rank'
import { levelOf, openExitIn } from '../../level/arena'
import { KITCHEN_EXIT } from '../../level/exits'
import {
  INTERACT_BUTTON,
  type RoomWorld,
  stepRoomWorld,
} from '../../net/roomWorld'
import {
  focusSlotOf,
  modifyFocus,
  modifySeat,
  modifySeatRecord,
} from '../../party/party'
import { type World, modifyWorldFields } from '../../schema/world'
import { Life, type Vector } from '../../schema/worldSchema'
import { offersOf } from '../../shop/purchase'
import { BACK_DOOR_RULES, backDoorStandOf } from '../backDoor'

// Leaving early by the kitchen's back door (src/world/kitchen/backDoor.ts):
// in a break, once a thing on the list is found, a hold at the door ends
// the run LeftEarly, paid for its waves and things and nothing more. With
// nothing found, in a wave, in Endless, or once Uncle Chunk's key is in
// the air, there is no leaving. In a crew the hold fills only while every
// standing player is at the door.

const HOLD_TICKS = Math.ceil(BACK_DOOR_RULES.holdMs / FIXED_STEP_MS) + 3

// NOTE: hidden far from anyone, so nobody finds it by walking past.
const HIDDEN = DareThingState.Hidden({ x: 2, y: 2, workedMs: 0 })

const FOUND: ReadonlyArray<DareThing> = [
  { id: 0, kind: 'SilverSpoon', state: DareThingState.Found({ slot: 0 }) },
  { id: 1, kind: 'MusicBox', state: HIDDEN },
  { id: 2, kind: 'FamilyPortrait', state: HIDDEN },
]

const NOTHING_FOUND: ReadonlyArray<DareThing> = Array.map(FOUND, thing => ({
  ...thing,
  state: HIDDEN,
}))

const withKitchen = <M extends World>(world: M): M =>
  modifyWorldFields(world, {
    level: level => openExitIn(level, KITCHEN_EXIT),
  })

const doorSpotOf = (world: World): Vector =>
  Option.getOrThrow(backDoorStandOf(levelOf(world)))

const placed = (spot: Vector) => (player: World['seats'][number]['player']) =>
  modifyFields(player, { x: () => spot.x, y: () => spot.y })

// NOTE: a campaign break on wave 4, three waves cleared, the kitchen open,
// and the player at the back door with `things` in the house.
const atBackDoor = (things: ReadonlyArray<DareThing> = FOUND): Model => {
  const run = withKitchen(
    withDareThings(
      modifyFields(freshRunModel(), {
        mode: () => RunMode.Campaign(),
        phase: () => kitchenBreak(4),
        stats: stats => modifyFields(stats, { wavesCleared: () => 3 }),
      }),
      things,
    ),
  )
  return modifyFocus(run, { player: placed(doorSpotOf(run)) })
}

const hasBackDoorOffer = (model: Model): boolean =>
  Array.some(
    offersOf(model, focusSlotOf(model)),
    ({ target, isFull }) => target._tag === 'BackDoor' && !isFull,
  )

const heldAtDoor = (start: Model) =>
  Story.story(
    APPLICATION,
    Story.given(start),
    ...holdEnter(HOLD_TICKS),
    settleRunCommands,
  )

describe('the back door alone', () => {
  it.effect('a hold in a break with a thing found leaves early', () =>
    Effect.map(heldAtDoor(atBackDoor()), after => {
      expect(after.phase).toEqual(Phase.LeftEarly({ wave: 4 }))
      expect(endKindOf(after)).toEqual(Option.some('Chicken'))
      expect(after.lastRunEnding).toBe('LeftEarly')
    }),
  )

  it.effect('pays the waves and the things, and no escape', () => {
    const start = atBackDoor()
    return Effect.map(heldAtDoor(start), after => {
      const input = {
        difficulty: start.difficulty.chosen,
        wavesCleared: 3,
        bossesFelled: 0,
        readyPoints: 0,
        dareItems: 1,
        isEscape: false,
        awards: 0,
        revives: 0,
        bonusPercent: 0,
        isGuided: false,
      }
      const gain = Option.getOrThrow(after.maybeRankGain)
      expect(gain.gained).toBe(pointsForRun(input))
      expect(gain.gained).toBeLessThan(
        pointsForRun({ ...input, isEscape: true }),
      )
      expect(gain.bonuses).not.toContain('FirstEscape')
      expect(after.bonuses.escapedOn).toEqual(start.bonuses.escapedOn)
      expect(after.difficulty.nightmare).toBe(start.difficulty.nightmare)
    })
  })

  it.effect('with nothing found the door stays shut', () =>
    Effect.map(heldAtDoor(atBackDoor(NOTHING_FOUND)), after => {
      expect(Phase.isAnyOf(['Preparation'])(after.phase)).toBe(true)
    }),
  )

  it.effect('in a wave there is no back door', () => {
    const start = modifyFields(atBackDoor(), {
      phase: () =>
        Phase.Wave({ wave: 4, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
    })
    expect(hasBackDoorOffer(start)).toBe(false)
    return Effect.map(heldAtDoor(start), after => {
      expect(Phase.isAnyOf(['Wave'])(after.phase)).toBe(true)
    })
  })

  test('Endless has no back door', () => {
    expect(hasBackDoorOffer(atBackDoor())).toBe(true)
    expect(
      hasBackDoorOffer(
        modifyFields(atBackDoor(), { mode: () => RunMode.Endless() }),
      ),
    ).toBe(false)
  })

  test("once Uncle Chunk's key flies, only the front door is out", () => {
    expect(hasBackDoorOffer(withFinale(atBackDoor(), Finale.Summoned()))).toBe(
      true,
    )
    expect(hasBackDoorOffer(withFinale(atBackDoor(), Finale.Open()))).toBe(
      false,
    )
  })
})

// THE CREW

const FAR: Vector = { x: 40, y: 40 }

// NOTE: the two seat room in a campaign break, the kitchen open, a thing
// found, seat 0 at the back door and seat 1 at `second`.
const crewRoom = (second: Vector, secondLife: Life = Life.Standing()) => {
  const opened = withKitchen(
    modifyFields(TWO_SEAT_ROOM.world, {
      phase: () => kitchenBreak(4),
      dare: dare =>
        modifyFields(dare, {
          list: () => Array.map(FOUND, ({ kind }) => kind),
        }),
      dareThings: () => FOUND,
    }),
  )
  const world = modifySeatRecord(
    modifySeat(
      modifySeat(opened, 0, { player: placed(doorSpotOf(opened)) }),
      1,
      { player: placed(second) },
    ),
    1,
    seat => modifyFields(seat, { life: () => secondLife }),
  )
  return { ...TWO_SEAT_ROOM, world }
}

const crewTick = (slot: number, buttons: number): PlayerTick => ({
  slot,
  input: { ...NEUTRAL_INPUT, buttons },
  presence: 'Here',
  viewLagTicks: 0,
  rttMs: 0,
})

// NOTE: seat 0 holds the door for the hold's time; seat 1 stands still.
const heldByOne = (room: RoomWorld): RoomWorld =>
  Array.reduce(Array.range(1, HOLD_TICKS), room, current =>
    stepRoomWorld(current, [crewTick(0, INTERACT_BUTTON), crewTick(1, 0)]),
  )

describe('the back door in a crew', () => {
  test('waits for everyone standing to be at the door', () => {
    const after = heldByOne(crewRoom(FAR))
    expect(Phase.isAnyOf(['Preparation'])(after.world.phase)).toBe(true)
  })

  test('leaves once the whole crew is there', () => {
    const room = crewRoom({ x: 0, y: 0 })
    const together = crewRoom(doorSpotOf(room.world))
    const after = heldByOne(together)
    expect(after.world.phase).toEqual(Phase.LeftEarly({ wave: 4 }))
  })

  test('a downed player goes with the crew', () => {
    const downed = Life.Downed({ bleedMs: 30_000, reviveMs: 0, callMs: 0 })
    const after = heldByOne(crewRoom(FAR, downed))
    expect(after.world.phase).toEqual(Phase.LeftEarly({ wave: 4 }))
  })
})
