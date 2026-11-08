import { Array, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'
import { NEUTRAL_INPUT } from '@munch/netcode'

import { Message } from '../../../app/message'
import {
  type CarriedGun,
  FridgeDoor,
  type FridgePrize,
  GameEvent,
  Melee,
  type Model,
  Phase,
  type Zombie,
} from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { gunIcon } from '../../../art/sprites/guns'
import {
  REPLACED_KNIFE,
  maybeReplacedIcon,
} from '../../../features/shop/purchaseView'
import { meleeSlotLook } from '../../../screens/game/hud'
import { FIXED_STEP_MS } from '../../../shared/constants'
import { nextRandom } from '../../../shared/prng'
import { DISTANT_SPAWN, atFridge, withSeat } from '../../../test/model.fixture'
import {
  APPLICATION,
  FRIDGE_OPEN_TICKS,
  SURFACE,
  holdFire,
  holdingSecond,
  press,
  tick,
  tickCountFor,
  ticks,
  zombieOf,
} from '../../../test/testing'
import { asVeteran } from '../../../test/veteran'
import { PAN_RULES } from '../../fridge/fridgeWeapons'
import {
  FRIDGE_RULES,
  PRIZE_ORDER,
  pickPrize,
  prizeWeights,
} from '../../fridge/leftovers'
import {
  AIM_REACH,
  DEFAULT_ROOM_SETTINGS,
  FIRE_BUTTON,
  type RoomWorld,
  actionCodeOf,
  heldAction,
  startRoomWorld,
  stepRoomWorld,
} from '../../net/roomWorld'
import {
  focusOf,
  focusSlotOf,
  maybePlayerAt,
  modifyFocus,
} from '../../party/party'
import { withWorld } from '../../schema/world'
import { Arsenal } from '../../schema/worldSchema'
import { purchase } from '../../shop/shop'
import { SeatAction } from '../../step/stepWorld'
import { freshGun, heldWeapon, inHandOf, maybePanOf, takePan } from '../weapons'

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
  modifyFocus(
    modifyFields(asVeteran(initialModel), {
      maybeSurface: () => Option.some(SURFACE),
      phase: () =>
        Phase.Wave({ wave: 4, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
      zombies: () => zombies,
    }),
    {
      player: player =>
        modifyFields(player, {
          x: () => PLAYER_X,
          y: () => ROW_Y,
          facing: () => ({ x: 1, y: 0 }),
          arsenal: () => BOTH_GUNS,
          melee: () => withPan(),
        }),
    },
  )

const groanerAhead = (id: number): Zombie =>
  zombieOf('Shambler', id, PLAYER_X + 10, ROW_Y, { hp: 99 })

const swungIn = (current: Model): boolean =>
  Array.some(current.frameEvents, GameEvent.isAnyOf(['PanSwung']))

describe('the Clang Pan in the melee slot', () => {
  it.effect(
    'taking it from the fridge keeps both guns and puts the Pan in hand',
    () => {
      const pullsPan = modifyFocus(
        modifyFields(atFridge(100), {
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
        }),
        {
          player: player => modifyFields(player, { arsenal: () => BOTH_GUNS }),
        },
      )
      return Story.story(
        APPLICATION,
        Story.given(pullsPan),
        press('Enter'),
        ...ticks(FRIDGE_OPEN_TICKS, FRAME_MS),
        Story.model(current => {
          expect(focusOf(current).player.arsenal).toEqual(BOTH_GUNS)
          expect(focusOf(current).player.melee).toEqual(withPan())
          expect(inHandOf(focusOf(current).player)).toBe('Pan')
        }),
      )
    },
  )

  test('the melee slot shows the Pan, its tier, and its dent meter, not the knife', () => {
    const knifeLook = meleeSlotLook(focusOf(initialModel).player)
    expect(Option.isSome(knifeLook.maybeIcon ?? Option.none())).toBe(true)
    expect(knifeLook.maybeGun).toEqual(Option.none())
    const dented = modifyFields(freshGun('Pan'), {
      loaded: () => 6,
      tier: () => 1,
    })
    const panLook = meleeSlotLook(
      modifyFields(focusOf(initialModel).player, {
        melee: () => withPan(dented),
      }),
    )
    expect(panLook.maybeGun).toEqual(Option.some({ weapon: 'Pan', tier: 1 }))
    expect(panLook.maybeIcon ?? Option.none()).toEqual(Option.none())
    expect(panLook.maybeMeter).toEqual(Option.some(6 / 24))
  })

  it.effect('F draws it, then fire swings it on repeat', () => {
    const bigLug = zombieOf('Tank', 900, PLAYER_X + 12, ROW_Y, { hp: 99 })
    return Story.story(
      APPLICATION,
      Story.given(panFight([bigLug])),
      press('KeyF'),
      Story.model(current => {
        expect(inHandOf(focusOf(current).player)).toBe('Pan')
        expect(heldWeapon(focusOf(current).player.arsenal)).toBe('Smg')
      }),
      holdFire,
      tick(FRAME_MS),
      Story.model(current => {
        expect(swungIn(current)).toBe(true)
        expect(
          Array.some(current.frameEvents, GameEvent.isAnyOf(['KnifeStabbed'])),
        ).toBe(false)
        expect(
          Option.getOrThrow(maybePanOf(focusOf(current).player)).loaded,
        ).toBe(23)
      }),
      ...ticks(tickCountFor(PAN_RULES.swingMs), FRAME_MS),
      Story.model(current => {
        expect(
          Option.getOrThrow(maybePanOf(focusOf(current).player)).loaded,
        ).toBe(22)
      }),
    )
  })

  it.effect(
    'a tap on the melee slot draws it, and Q goes back to the last gun',
    () =>
      Story.story(
        APPLICATION,
        Story.given(panFight()),
        Story.message(Message.ClickedMeleeSlot()),
        Story.model(current => {
          expect(inHandOf(focusOf(current).player)).toBe('Pan')
        }),
        press('KeyQ'),
        Story.model(current => {
          expect(inHandOf(focusOf(current).player)).toBe('Smg')
        }),
      ),
  )

  it.effect(
    'with every gun dry, the next pull draws the Pan by itself, and fire swings it',
    () => {
      const dry = (gun: CarriedGun): CarriedGun =>
        modifyFields(gun, { rounds: () => 0, loaded: () => 0 })
      const allDry = modifyFocus(panFight([groanerAhead(900)]), {
        player: player =>
          modifyFields(player, {
            arsenal: () =>
              Arsenal.HoldingSecond({
                first: dry(freshGun('Smg')),
                second: dry(freshGun('Shotgun')),
              }),
          }),
      })
      return Story.story(
        APPLICATION,
        Story.given(allDry),
        holdFire,
        tick(FRAME_MS),
        Story.model(current => {
          expect(inHandOf(focusOf(current).player)).toBe('Pan')
        }),
        ...ticks(tickCountFor(PAN_RULES.swingMs), FRAME_MS),
        Story.model(current => {
          expect(
            Option.getOrThrow(maybePanOf(focusOf(current).player)).loaded,
          ).toBe(23)
        }),
      )
    },
  )

  test('a second Pan never comes out of the fridge: its share goes to the rest', () => {
    const holder = modifyFields(focusOf(atFridge(500)).player, {
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
    const holder = modifyFields(focusOf(initialModel).player, {
      melee: () => withPan(worn),
    })
    const retaken = takePan(holder, freshGun('Pan'))
    const pan = Option.getOrThrow(maybePanOf(retaken))
    expect(pan.tier).toBe(2)
    expect(pan.loaded).toBe(48)
  })

  test("Rattles' Pan upgrade finds it in the melee slot", () => {
    const shopping = modifyFocus(atFridge(500), {
      player: player => modifyFields(player, { melee: () => withPan() }),
    })
    const upgraded = withWorld(shopping, world =>
      Option.getOrThrow(purchase(world, focusSlotOf(world), 'PanUpgrade')),
    )
    expect(Option.getOrThrow(maybePanOf(focusOf(upgraded).player)).tier).toBe(1)
    expect(focusOf(upgraded).player.arsenal).toEqual(
      focusOf(shopping).player.arsenal,
    )
  })

  it.effect('a new run starts with the knife in the melee slot again', () => {
    const over = modifyFields(panFight(), {
      phase: () => Phase.GameOver({ wave: 6 }),
      screenMs: () => 5000,
    })
    return Story.story(
      APPLICATION,
      Story.given(over),
      press('Enter'),
      Story.model(current => {
        expect(focusOf(current).player.melee).toEqual(Melee.Knife())
      }),
    )
  })
})

describe('the TAKE preview', () => {
  const offering = (prize: FridgePrize, melee: Melee): Model =>
    modifyFocus(
      modifyFields(atFridge(100), {
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
      }),
      {
        player: player =>
          modifyFields(player, {
            arsenal: () => BOTH_GUNS,
            melee: () => melee,
          }),
      },
    )

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
        modifyFocus(seatWorld, {
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
