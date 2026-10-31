import { Array, Option } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { NEUTRAL_INPUT } from '@munch/netcode'

import { FIXED_STEP_MS } from './constants'
import { PAN_RULES } from './fridgeWeapons'
import { meleeSlotLook } from './hud'
import { FRIDGE_RULES, PRIZE_ORDER, pickPrize, prizeWeights } from './leftovers'
import { update } from './main'
import { Message } from './message'
import {
  type CarriedGun,
  FridgeDoor,
  type FridgePrize,
  GameEvent,
  Melee,
  type Model,
  Phase,
  type Zombie,
  initialModel,
} from './model'
import { DISTANT_SPAWN, atFridge } from './model.fixture'
import { maybePlayerAt, withSeat } from './party'
import { nextRandom } from './prng'
import { REPLACED_KNIFE, maybeReplacedIcon } from './purchaseView'
import {
  AIM_REACH,
  DEFAULT_ROOM_SETTINGS,
  FIRE_BUTTON,
  type RoomWorld,
  actionCodeOf,
  heldAction,
  startRoomWorld,
  stepRoomWorld,
} from './roomWorld'
import { purchase } from './shop'
import { gunIcon } from './sprites/guns'
import { SeatAction } from './stepWorld'
import {
  FRIDGE_OPEN_TICKS,
  SURFACE,
  holdFire,
  holdingSecond,
  press,
  tick,
  tickCountFor,
  ticks,
  zombieOf,
} from './testing'
import { asVeteran } from './veteran'
import { freshGun, heldWeapon, inHandOf, maybePanOf, takePan } from './weapons'
import { withWorld } from './world'

// The Clang Pan in the melee slot (GAME_DESIGN.md, "The Clang Pan"):
// taken from the fridge it replaces the knife, not a gun, and is drawn and
// swung the way the knife is drawn and stabs.

const FRAME_MS = FIXED_STEP_MS
const ROW_Y = 104
const PLAYER_X = 100
const SMG: CarriedGun = { kind: 'Smg', rounds: 120, loaded: 30, tier: 0 }
const BOTH_GUNS = holdingSecond(SMG)

const withPan = (pan: CarriedGun = freshGun('Pan')): Melee => Melee.Pan({ pan })

const panFight = (zombies: ReadonlyArray<Zombie> = []): Model =>
  modifyFields(asVeteran(initialModel), {
    maybeSurface: () => Option.some(SURFACE),
    phase: () => Phase.Wave({ wave: 4, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
    zombies: () => zombies,
    player: player =>
      modifyFields(player, {
        x: () => PLAYER_X,
        y: () => ROW_Y,
        facing: () => ({ x: 1, y: 0 }),
        arsenal: () => BOTH_GUNS,
        melee: () => withPan(),
      }),
  })

const groanerAhead = (id: number): Zombie =>
  zombieOf('Shambler', id, PLAYER_X + 10, ROW_Y, { hp: 99 })

const swungIn = (current: Model): boolean =>
  Array.some(current.frameEvents, GameEvent.isAnyOf(['PanSwung']))

describe('the Clang Pan in the melee slot', () => {
  test('taking it from the fridge keeps both guns and puts the Pan in hand', () => {
    const pullsPan = modifyFields(atFridge(100), {
      player: player => modifyFields(player, { arsenal: () => BOTH_GUNS }),
      fridge: fridge =>
        modifyFields(fridge, {
          door: () =>
            FridgeDoor.Offering({
              prize: 'Pan',
              slot: 0,
              remainingMs: FRIDGE_RULES.offerMs,
              durationMs: FRIDGE_RULES.offerMs,
            }),
        }),
    })
    story(
      update,
      given(pullsPan),
      press('Enter'),
      ...ticks(FRIDGE_OPEN_TICKS, FRAME_MS),
      model(current => {
        expect(current.player.arsenal).toEqual(BOTH_GUNS)
        expect(current.player.melee).toEqual(withPan())
        expect(inHandOf(current.player)).toBe('Pan')
      }),
    )
  })

  test('the melee slot shows the Pan, its tier, and its dent meter, not the knife', () => {
    const knifeLook = meleeSlotLook(initialModel.player)
    expect(Option.isSome(knifeLook.maybeIcon ?? Option.none())).toBe(true)
    expect(knifeLook.maybeGun).toEqual(Option.none())
    const dented = modifyFields(freshGun('Pan'), {
      loaded: () => 6,
      tier: () => 1,
    })
    const panLook = meleeSlotLook(
      modifyFields(initialModel.player, { melee: () => withPan(dented) }),
    )
    expect(panLook.maybeGun).toEqual(Option.some({ weapon: 'Pan', tier: 1 }))
    expect(panLook.maybeIcon ?? Option.none()).toEqual(Option.none())
    expect(panLook.maybeMeter).toEqual(Option.some(6 / 24))
  })

  test('F draws it, then fire swings it on repeat', () => {
    const bigLug = zombieOf('Tank', 900, PLAYER_X + 12, ROW_Y, { hp: 99 })
    story(
      update,
      given(panFight([bigLug])),
      press('KeyF'),
      model(current => {
        expect(inHandOf(current.player)).toBe('Pan')
        expect(heldWeapon(current.player.arsenal)).toBe('Smg')
      }),
      holdFire,
      tick(FRAME_MS),
      model(current => {
        expect(swungIn(current)).toBe(true)
        expect(
          Array.some(current.frameEvents, GameEvent.isAnyOf(['KnifeStabbed'])),
        ).toBe(false)
        expect(Option.getOrThrow(maybePanOf(current.player)).loaded).toBe(23)
      }),
      ...ticks(tickCountFor(PAN_RULES.swingMs), FRAME_MS),
      model(current => {
        expect(Option.getOrThrow(maybePanOf(current.player)).loaded).toBe(22)
      }),
    )
  })

  test('a tap on the melee slot draws it, and Q goes back to the last gun', () => {
    story(
      update,
      given(panFight()),
      message(Message.ClickedMeleeSlot()),
      model(current => {
        expect(inHandOf(current.player)).toBe('Pan')
      }),
      press('KeyQ'),
      model(current => {
        expect(inHandOf(current.player)).toBe('Smg')
      }),
    )
  })

  test('with every gun dry, the next pull draws the Pan by itself, and fire swings it', () => {
    const dry = (gun: CarriedGun): CarriedGun =>
      modifyFields(gun, { rounds: () => 0, loaded: () => 0 })
    const allDry = modifyFields(panFight([groanerAhead(900)]), {
      player: player =>
        modifyFields(player, {
          arsenal: () =>
            holdingSecond(dry(freshGun('Shotgun')), dry(freshGun('Smg'))),
        }),
    })
    story(
      update,
      given(allDry),
      holdFire,
      tick(FRAME_MS),
      model(current => {
        expect(inHandOf(current.player)).toBe('Pan')
      }),
      ...ticks(tickCountFor(PAN_RULES.swingMs), FRAME_MS),
      model(current => {
        expect(Option.getOrThrow(maybePanOf(current.player)).loaded).toBe(23)
      }),
    )
  })

  test('a second Pan never comes out of the fridge: its share goes to the rest', () => {
    const holder = modifyFields(atFridge(500).player, {
      melee: () => withPan(),
    })
    const weights = prizeWeights(atFridge(500).fridge, holder)
    expect(weights).toContainEqual(['Pan', 0])
    const prizes = Array.makeBy(400, seed =>
      pickPrize(weights, nextRandom(seed + 1).value),
    )
    expect(Array.some(prizes, prize => prize === 'Pan')).toBe(false)
    expect(
      Array.every(PRIZE_ORDER, prize =>
        prize === 'Pan' ? true : Array.contains(prizes, prize),
      ),
    ).toBe(true)
  })

  test('a Pan given over a Pan keeps its tier and is banged flat', () => {
    const worn = modifyFields(freshGun('Pan'), {
      loaded: () => 3,
      tier: () => 2,
    })
    const holder = modifyFields(initialModel.player, {
      melee: () => withPan(worn),
    })
    const retaken = takePan(holder, freshGun('Pan'))
    const pan = Option.getOrThrow(maybePanOf(retaken))
    expect(pan.tier).toBe(2)
    expect(pan.loaded).toBe(48)
  })

  test("Rattles' Pan upgrade finds it in the melee slot", () => {
    const shopping = modifyFields(atFridge(500), {
      player: player => modifyFields(player, { melee: () => withPan() }),
    })
    const upgraded = withWorld(shopping, world =>
      Option.getOrThrow(purchase(world, 'PanUpgrade')),
    )
    expect(Option.getOrThrow(maybePanOf(upgraded.player)).tier).toBe(1)
    expect(upgraded.player.arsenal).toEqual(shopping.player.arsenal)
  })

  test('a new run starts with the knife in the melee slot again', () => {
    const over = modifyFields(panFight(), {
      phase: () => Phase.GameOver({ wave: 6 }),
      screenMs: () => 5000,
    })
    story(
      update,
      given(over),
      press('Enter'),
      model(current => {
        expect(current.player.melee).toEqual(Melee.Knife())
      }),
    )
  })
})

describe('the TAKE preview', () => {
  const offering = (prize: FridgePrize, melee: Melee): Model =>
    modifyFields(atFridge(100), {
      player: player =>
        modifyFields(player, { arsenal: () => BOTH_GUNS, melee: () => melee }),
      fridge: fridge =>
        modifyFields(fridge, {
          door: () =>
            FridgeDoor.Offering({
              prize,
              slot: 0,
              remainingMs: FRIDGE_RULES.offerMs,
              durationMs: FRIDGE_RULES.offerMs,
            }),
        }),
    })

  test('for the Pan it crosses out the knife; for a gun-slot prize, the gun in hand', () => {
    expect(maybeReplacedIcon(offering('Pan', Melee.Knife()))).toEqual(
      Option.some(REPLACED_KNIFE),
    )
    expect(maybeReplacedIcon(offering('Cooker', withPan()))).toEqual(
      Option.some(gunIcon('Smg', 0)),
    )
  })
})

describe('the Clang Pan in co-op', () => {
  const room = (): RoomWorld => {
    const started = startRoomWorld([0, 1], 7, DEFAULT_ROOM_SETTINGS)
    const placed = (slot: number, x: number) => (world: RoomWorld['world']) =>
      withSeat(world, slot, seatWorld =>
        modifyFields(seatWorld, {
          player: player =>
            modifyFields(player, {
              x: () => x,
              y: () => ROW_Y,
              facing: () => ({ x: 1, y: 0 }),
              melee: () => (slot === 1 ? withPan() : Melee.Knife()),
            }),
        }),
      )
    return modifyFields(started, {
      world: world =>
        modifyFields(placed(1, 200)(placed(0, 60)(world)), {
          phase: () =>
            Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
          zombies: () => [
            zombieOf('Shambler', 900, 210, ROW_Y, { hp: 99 }),
            zombieOf('Shambler', 901, 70, ROW_Y, { hp: 99 }),
          ],
        }),
    })
  }

  test("each seat's melee press draws its own slot: the Pan swings, the knife stabs", () => {
    const stepped = stepRoomWorld(
      room(),
      Array.map([0, 1], slot => ({
        slot,
        input: {
          ...NEUTRAL_INPUT,
          aimX: AIM_REACH,
          action: heldAction(actionCodeOf(SeatAction.Melee()), 1),
          buttons: FIRE_BUTTON,
        },
        presence: 'Here' as const,
        viewLagTicks: 0,
        rttMs: 0,
      })),
    )
    const seatOf = (slot: number) =>
      Option.getOrThrow(maybePlayerAt(stepped.world, slot)).player
    expect(inHandOf(seatOf(1))).toBe('Pan')
    expect(inHandOf(seatOf(0))).toBe('Knife')
    expect(Option.getOrThrow(maybePanOf(seatOf(1))).loaded).toBe(23)
    expect(maybePanOf(seatOf(0))).toEqual(Option.none())
    expect(seatOf(0).knifeCooldownMs).toBeGreaterThan(0)
    expect(seatOf(1).knifeCooldownMs).toBe(0)
  })
})
