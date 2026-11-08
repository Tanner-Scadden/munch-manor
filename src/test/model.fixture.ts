// Named Models for Story and Scene tests, and the changes tests make to one
// most often. A test starts from one with `given(...)`, so the setup it does
// not care about reads as a name, and the steps it is about stay in the test.
// Steps and locators live in `testing.ts`.

import { Array, Function, Option, Order, Record } from 'effect'
import { modifyFields } from 'foldkit/struct'

import {
  type Bullet,
  DifficultyCard,
  type FridgePrize,
  Lesson,
  Loading,
  type Model,
  Phase,
  type PlannedSpawn,
  type Zombie,
} from '../app/model'
import { initialModel } from '../app/pureApp'
import { freshRun } from '../app/runReset'
import { PLAYER_MAX_HP, PREPARATION_MS } from '../shared/constants'
import { heroIdOf } from '../shared/playerData'
import { nextRandom } from '../shared/prng'
import { fridgeBoxOf, pickPrize, prizeWeights } from '../world/fridge/leftovers'
import { freshGun } from '../world/gear/weapons'
import { CALLINGS, isCallingUnlocked } from '../world/heroes/calling'
import { grantedVeteran } from '../world/heroes/rank'
import { valveBoxOf } from '../world/kitchen/gasValve'
import { stoveBoxOf } from '../world/kitchen/stove'
import {
  LEVEL_SPECS,
  type Level,
  PARLOUR,
  levelFor,
  levelOf,
  openExitIn,
  startingLevel,
} from '../world/level/arena'
import { KITCHEN_EXIT } from '../world/level/exits'
import {
  atSeatBy,
  focusOf,
  focusSeat,
  focusSlotOf,
  modifyFocus,
  modifySeatRecord,
  seatCrew,
} from '../world/party/party'
import { biteGraceScale } from '../world/run/difficulty'
import { type World, modifyWorldFields, withWorld } from '../world/schema/world'
import {
  Arsenal,
  Invulnerability,
  type Life,
  type Pickup,
  type PickupKind,
  type Seat,
  type SeatState,
  type WeaponKind,
} from '../world/schema/worldSchema'
import { STALL_BOX } from '../world/shop/shop'
import { PHONE_PORTRAIT, SURFACE, zombieOf } from './testing'
import { asVeteran } from './veteran'

// The stretch of the blink after a bite on Normal, where the named Models
// play: a bite's invulnerability is the base times this.
// NOTE: every level the game builds, shut and with all its exits open.
export const EVERY_LEVEL: ReadonlyArray<Level> = Array.flatMap(
  Record.values(LEVEL_SPECS),
  spec => [
    levelFor(spec),
    levelFor(
      spec,
      Array.map(spec.exits, ({ id }) => id),
    ),
  ],
)

export const NORMAL_BITE_GRACE = biteGraceScale('Normal')

// SPAWNS

export const plannedSpawn = (atMs: number): PlannedSpawn => ({
  atMs,
  kind: 'Shambler',
  door: 'North',
  offset: 0,
  speedScale: 1,
  hpScale: 1,
  pack: 0,
  formation: 'Squad',
})

// NOTE: a spawn planned so far out that it never comes, so a wave that holds
// it stays in progress with only the zombies a test puts in the room.
export const DISTANT_SPAWN: PlannedSpawn = plannedSpawn(1e9)

// PHASES

// NOTE: wave 2 under way, and the break before it, each holding a spawn
// that never comes.
export const WAVE_2_FIGHT = Phase.Wave({
  wave: 2,
  elapsedMs: 0,
  spawns: [DISTANT_SPAWN],
})

export const WAVE_2_BREAK = Phase.Preparation({
  wave: 2,
  remainingMs: 15_000,
  durationMs: PREPARATION_MS,
  spawns: [DISTANT_SPAWN],
})

// NOTE: the break before wave 3, with nothing planned.
export const WAVE_3_BREAK = Phase.Preparation({
  wave: 3,
  remainingMs: 15_000,
  durationMs: PREPARATION_MS,
  spawns: [],
})

// HOME

// NOTE: the ids of the heroes a player of this rank could have bought, all
// of them bought, for tests that pick or start a run as a hero.
export const heroesBoughtBy = (rank: number): ReadonlyArray<string> =>
  Array.flatMap(CALLINGS, calling =>
    calling !== 'You' && isCallingUnlocked(calling, rank)
      ? [heroIdOf(calling)]
      : [],
  )

// NOTE: a returning player on the home menu: the tutorial is done, so no
// lesson or first-run card gets in the way.
// NOTE: Rattles' shop dialog shown, as if the frame had opened it, for a
// test that starts at the counter.
export const withShopDialogOpen = (model: Model): Model =>
  modifyFields(model, {
    shopDialog: shop =>
      modifyFields(shop, {
        dialog: dialog => modifyFields(dialog, { isOpen: () => true }),
      }),
  })

export const home: Model = asVeteran(initialModel)

// NOTE: the home menu once the save has been read, so the menu's buttons are
// up. A save that was read has been granted its veteran start (0 here).
export const homeAfterRead: Model = modifyFields(home, {
  saveStatus: () => 'Read',
  rank: rank => grantedVeteran(rank, 0),
})

// NOTE: a returning player on a measured surface, ready to start a run.
export const readyModel: Model = modifyFields(home, {
  maybeSurface: () => Option.some(SURFACE),
})

// NOTE: a new player on a measured surface: the tutorial is still ahead.
export const newPlayerReady: Model = modifyFields(initialModel, {
  maybeSurface: () => Option.some(SURFACE),
})

// NOTE: a new player on a measured surface who has picked a difficulty, so
// the card does not come up.
export const newPlayerCardSeen: Model = modifyFields(initialModel, {
  difficultyCard: () => DifficultyCard.Seen(),
  maybeSurface: () => Option.some(SURFACE),
})

// NOTE: a returning player on a measured surface once the save has been
// read.
export const readyAfterRead: Model = modifyFields(home, {
  maybeSurface: () => Option.some(SURFACE),
  saveStatus: () => 'Read',
  rank: rank => grantedVeteran(rank, 0),
})

// NOTE: the boot splash, still reading the save.
export const loadingSave: Model = modifyFields(initialModel, {
  maybeSurface: () => Option.some(SURFACE),
  loading: () => Loading.Loading({ pending: ['Save'] }),
})

// FIGHTING

export const fighting: Model = modifyFields(initialModel, {
  phase: () => Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [] }),
})

export const veteranFighting: Model = modifyFields(home, {
  phase: () => Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [] }),
})

// A wave in progress on a measured surface, with nothing coming in.
export const quietWave = (wave: number): Model =>
  modifyFields(initialModel, {
    maybeSurface: () => Option.some(SURFACE),
    phase: () => Phase.Wave({ wave, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
  })

// NOTE: past the first break's lesson, so a Plank Pile has its price (a
// new save's first one is free, see isFirstPlankFree in src/world/shop/shop.ts).
export const pastFirstBreak = (model: Model): Model =>
  modifyFields(model, {
    lessons: lessons =>
      modifyFields(lessons, { openBreak: () => Lesson.Learned({ atMs: 0 }) }),
  })

// NOTE: past the kitchen tour's break, so the break before wave 3 counts
// down and the kitchen and the fridge have their prices (the tour holds the
// clock and gives them away in a new save, see src/world/run/tutorialRules.ts).
export const pastTimedBreaks = (model: Model): Model =>
  modifyFields(model, {
    lessons: lessons =>
      modifyFields(lessons, { timedBreaks: () => Lesson.Learned({ atMs: 0 }) }),
  })

// NOTE: Hard keeps the break clock, which Easy and Normal do not have (the
// default Model is Normal), so a test of the countdown starts from this.
export const onHard = (model: Model): Model =>
  modifyFields(model, {
    difficulty: setting => modifyFields(setting, { chosen: () => 'Hard' }),
  })

// NOTE: data first when the Model leads: a Model is no array, zombies are.
export const withActors: {
  (
    zombies: ReadonlyArray<Zombie>,
    bullets?: ReadonlyArray<Bullet>,
  ): (base: Model) => Model
  (
    base: Model,
    zombies: ReadonlyArray<Zombie>,
    bullets?: ReadonlyArray<Bullet>,
  ): Model
} = Function.dual(
  (args: IArguments) => !Array.isArray(args[0]),
  (
    base: Model,
    zombies: ReadonlyArray<Zombie>,
    bullets: ReadonlyArray<Bullet> = [],
  ): Model =>
    modifyFields(base, {
      zombies: () => zombies,
      bullets: () => bullets,
    }),
)

export const withPlayerAt: {
  (x: number, y: number): (base: Model) => Model
  (base: Model, x: number, y: number): Model
} = Function.dual(3, (base: Model, x: number, y: number): Model =>
  modifyFocus(base, {
    player: player => modifyFields(player, { x: () => x, y: () => y }),
  }),
)

export const withArsenal: {
  (arsenal: Arsenal): (base: Model) => Model
  (base: Model, arsenal: Arsenal): Model
} = Function.dual(2, (base: Model, arsenal: Arsenal): Model =>
  modifyFocus(base, {
    player: player => modifyFields(player, { arsenal: () => arsenal }),
  }),
)

// NOTE: runs a step on a World with the seat at `slot` first, so the seat
// reads as `focusOf(world)`, then puts the seats back in the order they
// were.
export const withSeat: {
  (slot: number, step: (focused: World) => World): (world: World) => World
  (world: World, slot: number, step: (focused: World) => World): World
} = Function.dual(
  3,
  (world: World, slot: number, step: (focused: World) => World): World => {
    const order = Array.map(world.seats, ({ seat }) => seat.slot)
    return modifyWorldFields(step(focusSeat(world, slot)), {
      seats: seats =>
        Array.sort(
          seats,
          Order.mapInput(Order.Number, ({ seat }: SeatState) =>
            order.indexOf(seat.slot),
          ),
        ),
    })
  },
)

// NOTE: a change to the record of the seat a World is about.
export const modifyLeadSeat: {
  (change: (seat: Seat) => Seat): (world: World) => World
  (world: World, change: (seat: Seat) => Seat): World
} = Function.dual(2, (world: World, change: (seat: Seat) => Seat): World =>
  modifySeatRecord(world, focusSlotOf(world), change),
)

// NOTE: changes one seat of a co-op World held in the Model.
export const atSeat: {
  (slot: number, change: (world: World) => World): (current: Model) => Model
  (current: Model, slot: number, change: (world: World) => World): Model
} = Function.dual(
  3,
  (current: Model, slot: number, change: (world: World) => World): Model =>
    withWorld(current, world => withSeat(world, slot, change)),
)

// SCREENS

export const inPortrait = (model: Model): Model =>
  modifyFields(model, {
    orientation: () => 'Portrait',
    maybeSurface: () => Option.some(PHONE_PORTRAIT),
  })

export const withNewerBuild = (model: Model): Model =>
  modifyFields(model, { maybeNewerBuild: () => Option.some('newer-build') })

// MYSTERY LEFTOVERS

// NOTE: a fresh run with the kitchen open and the player at the fridge's
// door in a break, for the fridge's Story tests.
export function freshRunModel(): Model {
  const veteran = asVeteran(initialModel)
  return modifyFields(
    { ...veteran, ...freshRun(veteran) },
    {
      maybeSurface: () =>
        Option.some({ left: 0, top: 0, width: 800, height: 400 }),
    },
  )
}

const fridgeBox = Option.getOrThrow(
  fridgeBoxOf(
    levelOf({ level: openExitIn(freshRunModel().level, KITCHEN_EXIT) }),
  ),
)

export const AT_FRIDGE = {
  x: (fridgeBox.left + fridgeBox.right) / 2,
  y: fridgeBox.bottom + 8,
}

// NOTE: at the fridge in the break before `wave`.
export const atFridgeOnWave: {
  (balance: number): (wave: number) => Model
  (wave: number, balance: number): Model
} = Function.dual(2, (wave: number, balance: number): Model =>
  modifyFocus(
    modifyFields(freshRunModel(), {
      level: level => openExitIn(level, KITCHEN_EXIT),
      phase: () =>
        Phase.Preparation({
          wave,
          remainingMs: 120_000,
          durationMs: 120_000,
          spawns: [DISTANT_SPAWN],
        }),
    }),
    {
      wallet: () => ({ balance, earned: balance, shown: balance }),
      player: player =>
        modifyFields(player, { x: () => AT_FRIDGE.x, y: () => AT_FRIDGE.y }),
    },
  ),
)

export const atFridge = (balance: number): Model => atFridgeOnWave(5, balance)

// THE AMMO WINDOW

const BELOW_STALL = {
  x: (STALL_BOX.left + STALL_BOX.right) / 2,
  y: STALL_BOX.bottom + 6,
}

// NOTE: the Pop Pistol first and `kind` in the hands with `rounds` left.
const holdingSecond = (kind: WeaponKind, rounds: number): Arsenal =>
  Arsenal.HoldingSecond({
    first: freshGun('Pistol'),
    second: modifyFields(freshGun(kind), { rounds: () => rounds }),
  })

// NOTE: mid-wave at the stall's ammo window (src/world/shop/ammoCounter.ts).
// NOTE: data first when the kind leads: a kind is a string, rounds are not.
export const midWaveAtStall: {
  (rounds: number, balance?: number): (kind: WeaponKind) => Model
  (kind: WeaponKind, rounds: number, balance?: number): Model
} = Function.dual(
  (args: IArguments) => typeof args[0] === 'string',
  (kind: WeaponKind, rounds: number, balance: number = 100): Model =>
    modifyFocus(
      modifyFields(freshRunModel(), {
        phase: () =>
          Phase.Wave({
            wave: 5,
            elapsedMs: 20_000,
            spawns: [DISTANT_SPAWN],
          }),
      }),
      {
        wallet: () => ({ balance, earned: balance, shown: balance }),
        player: player =>
          modifyFields(player, {
            x: () => BELOW_STALL.x,
            y: () => BELOW_STALL.y,
            arsenal: () => holdingSecond(kind, rounds),
          }),
      },
    ),
)

// NOTE: a fridge whose stream's next draw lands on `prize`, found by trying
// seeds, so a test can ask for each prize without knowing the stream.
export const fridgeSeededFor: {
  (prize: FridgePrize): (current: Model) => Model
  (current: Model, prize: FridgePrize): Model
} = Function.dual(2, (current: Model, prize: FridgePrize): Model => {
  const seed = Option.getOrThrow(
    Array.findFirst(
      Array.makeBy(500, index => index + 1),
      candidate =>
        pickPrize(
          prizeWeights(current.fridge, focusOf(current).player),
          nextRandom(candidate).value,
        ) === prize,
    ),
  )
  return modifyFields(current, {
    loot: loot => modifyFields(loot, { fridgeRngState: () => seed }),
  })
})

// NOTE: typed as the Wave it is, not as any Phase, so a test can pause it
// as a round.
export const FIGHTING_PHASE = Phase.Wave({
  wave: 1,
  elapsedMs: 0,
  spawns: [DISTANT_SPAWN],
})

export const playingModel: Model = modifyFields(readyModel, {
  phase: () => FIGHTING_PHASE,
})

export const withZombies: {
  (zombies: ReadonlyArray<Zombie>): (base: Model) => Model
  (base: Model, zombies: ReadonlyArray<Zombie>): Model
} = Function.dual(2, (base: Model, zombies: ReadonlyArray<Zombie>): Model =>
  modifyFields(base, { zombies: () => zombies }),
)

// CO-OP CREWS

// NOTE: wave 3 under way with a spawn that never comes, for a crew's tests.
const CREW_WAVE = Phase.Wave({
  wave: 3,
  elapsedMs: 0,
  spawns: [DISTANT_SPAWN],
})

// NOTE: a crew of `count` seats in one World, on a surface, mid-wave.
// NOTE: data first when the count leads: a count is a number, a Phase is not.
export const crewInWave: {
  (phase?: Phase): (count: number) => Model
  (count: number, phase?: Phase): Model
} = Function.dual(
  (args: IArguments) => typeof args[0] === 'number',
  (count: number, phase: Phase = CREW_WAVE): Model =>
    withWorld(
      modifyFields(home, {
        maybeSurface: () => Option.some(SURFACE),
        phase: () => phase,
      }),
      world => seatCrew(world, count),
    ),
)

// NOTE: data first when the Model leads: a Model is an object, a slot is not.
export const placeSeat: {
  (slot: number, x: number, y: number, hp?: number): (current: Model) => Model
  (current: Model, slot: number, x: number, y: number, hp?: number): Model
} = Function.dual(
  (args: IArguments) => typeof args[0] === 'object',
  (
    current: Model,
    slot: number,
    x: number,
    y: number,
    hp: number = PLAYER_MAX_HP,
  ): Model =>
    atSeat(current, slot, world =>
      modifyFocus(world, {
        player: player =>
          modifyFields(player, { x: () => x, y: () => y, hp: () => hp }),
      }),
    ),
)

export const withSeatLife: {
  (slot: number, life: Life): (current: Model) => Model
  (current: Model, slot: number, life: Life): Model
} = Function.dual(3, (current: Model, slot: number, life: Life): Model =>
  atSeat(current, slot, world =>
    modifyFields(world, {
      seats: atSeatBy(slot, state =>
        modifyFields(state, {
          seat: seat => modifyFields(seat, { life: () => life }),
        }),
      ),
    }),
  ),
)

// NOTE: changes made to a Model one after another, in order.
// NOTE: a seat no zombie can hurt, so a long test keeps its run going.
export const untouchableSeat =
  (slot: number) =>
  (current: Model): Model =>
    atSeat(current, slot, world =>
      modifyFocus(world, {
        player: player =>
          modifyFields(player, {
            invulnerability: () =>
              Invulnerability.Invulnerable({
                remainingMs: 1e9,
                durationMs: 1e9,
              }),
          }),
      }),
    )

export const pipeline =
  (...steps: ReadonlyArray<(current: Model) => Model>) =>
  (start: Model): Model =>
    Array.reduce(steps, start, (current, step) => step(current))

// NOTE: one heart left and a zombie on the player, so the next tick bites.
export const lastHeart = (base: Model): Model =>
  modifyFocus(
    modifyFields(base, {
      zombies: () => [
        zombieOf('Runner', 100, PARLOUR.width / 2 + 2, PARLOUR.height / 2),
      ],
    }),
    { player: player => modifyFields(player, { hp: () => 1 }) },
  )

// PICKUPS

// NOTE: data first when the id leads: an id is a number, a kind is not.
export const pickupAt: {
  (
    kind: PickupKind,
    x: number,
    y: number,
    ageMs?: number,
  ): (id: number) => Pickup
  (id: number, kind: PickupKind, x: number, y: number, ageMs?: number): Pickup
} = Function.dual(
  (args: IArguments) => typeof args[0] === 'number',
  (
    id: number,
    kind: PickupKind,
    x: number,
    y: number,
    ageMs: number = 0,
  ): Pickup => ({
    id,
    kind,
    x,
    y,
    ageMs,
  }),
)

export const withPickups: {
  <M extends World>(pickups: ReadonlyArray<Pickup>): (base: M) => M
  <M extends World>(base: M, pickups: ReadonlyArray<Pickup>): M
} = Function.dual(
  2,
  <M extends World>(base: M, pickups: ReadonlyArray<Pickup>): M =>
    modifyWorldFields(base, { pickups: () => pickups }),
)

// THE STOVE AND THE GAS VALVE

// NOTE: a fresh run with the kitchen open, in `phase`, and the player at
// `spot` with `balance` to spend, for the stove's and the valve's tests.
const inKitchen = (
  spot: Readonly<{ x: number; y: number }>,
  balance: number,
  phase: Phase,
): Model =>
  modifyFocus(
    modifyFields(freshRunModel(), {
      level: level => openExitIn(level, KITCHEN_EXIT),
      phase: () => phase,
    }),
    {
      wallet: () => ({ balance, earned: balance, shown: balance }),
      player: player =>
        modifyFields(player, { x: () => spot.x, y: () => spot.y }),
    },
  )

export const kitchenBreak = (wave: number): Phase =>
  Phase.Preparation({
    wave,
    remainingMs: 120_000,
    durationMs: 120_000,
    spawns: [DISTANT_SPAWN],
  })

const stoveBox = Option.getOrThrow(
  stoveBoxOf(inKitchen({ x: 0, y: 0 }, 0, kitchenBreak(5))),
)

const AT_STOVE = {
  x: (stoveBox.left + stoveBox.right) / 2,
  y: stoveBox.bottom + 8,
}

export const atStove = (balance: number): Model =>
  inKitchen(AT_STOVE, balance, kitchenBreak(5))

const valveBox = Option.getOrThrow(
  valveBoxOf(levelOf({ level: openExitIn(startingLevel, KITCHEN_EXIT) })),
)

const AT_VALVE = {
  x: valveBox.left - 8,
  y: (valveBox.top + valveBox.bottom) / 2,
}

export const atValve: {
  (phase: Phase): (balance: number) => Model
  (balance: number, phase: Phase): Model
} = Function.dual(2, (balance: number, phase: Phase): Model =>
  inKitchen(AT_VALVE, balance, phase),
)
