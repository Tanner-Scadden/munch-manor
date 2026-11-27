import { Array, Function, Option, Order } from 'effect'

import { UiStruct } from '@effect/ui'

import { freshRun } from '#app/frame/runReset.ts'
import {
  BreakClock,
  type Bullet,
  type CarriedGun,
  type Difficulty,
  DifficultyCard,
  type FridgePrize,
  Lesson,
  Loading,
  type Model,
  Phase,
  type PlannedSpawn,
  type Zombie,
} from '#app/model.ts'
import { initialModel } from '#app/pureApp.ts'
import { missionsOn } from '#features/missions/missions.ts'
import { PLAYER_MAX_HP, PREPARATION_MS } from '#shared/constants.ts'
import { nextRandom } from '#shared/prng.ts'
import { freezeOn } from '#shared/records/missionData.ts'
import { heroIdOf } from '#shared/records/playerData.ts'
import { type DareThing, Finale } from '#world/dare/dareSchema.ts'
import { frontDoorSillOf } from '#world/dare/finale.ts'
import { caseBoxOf } from '#world/feats/caseSpots.ts'
import {
  fridgeBoxOf,
  pickPrize,
  prizeWeights,
} from '#world/fridge/leftovers.ts'
import { STARTING_PISTOL } from '#world/gear/weapons.ts'
import { CALLINGS, isCallingUnlocked } from '#world/heroes/calling.ts'
import { grantedVeteran } from '#world/heroes/rank.ts'
import { VALVE_RULES, valveBoxOf } from '#world/kitchen/gasValve.ts'
import { STOVE_RULES, stoveBoxOf } from '#world/kitchen/stove.ts'
import {
  type Level,
  START_LEVEL,
  levelFor,
  levelOf,
  openExitIn,
  startingLevel,
  startingLevelFor,
} from '#world/level/arena.ts'
import { KITCHEN_EXIT } from '#world/level/exits.ts'
import {
  EVERY_LEVEL_SPEC,
  SLOTS,
  SLOT_IDS,
  roomSpotsOf,
} from '#world/level/plan.ts'
import { tileCenter } from '#world/level/tileGrid.ts'
import {
  atSeatBy,
  focusOf,
  focusSeat,
  focusSlotOf,
  modifyFocus,
  modifySeatRecord,
  seatCrew,
} from '#world/party/party.ts'
import { biteGraceScale } from '#world/run/difficulty.ts'
import {
  type World,
  modifyWorldFields,
  withWorld,
} from '#world/schema/world.ts'
import {
  type Arrangement,
  Arsenal,
  type CasePrize,
  CaseState,
  type ExitId,
  Feat,
  type FeatTally,
  Invulnerability,
  type LevelState,
  type Life,
  type Pickup,
  type PickupKind,
  type Seat,
  type SeatState,
  type SlotRoomId,
  type Vector,
  type WeaponKind,
} from '#world/schema/worldSchema.ts'

import { SHOTGUN, maybeSpareGun } from './arsenals.ts'
import {
  PHONE_PORTRAIT,
  SURFACE,
  bulletInto,
  doomed,
  zombieOf,
} from './testing.ts'
import { asVeteran } from './veteran.ts'

export const EVERY_LEVEL: ReadonlyArray<Level> = Array.flatMap(
  EVERY_LEVEL_SPEC,
  spec => [
    levelFor(spec),
    levelFor(
      spec,
      Array.map(spec.exits, ({ id }) => id),
    ),
  ],
)

export const NORMAL_BITE_GRACE = biteGraceScale('Normal')

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

export const DISTANT_SPAWN: PlannedSpawn = plannedSpawn(1e9)

export const breakSpawns = (model: Model): ReadonlyArray<PlannedSpawn> =>
  Phase.isAnyOf(['Preparation'])(model.phase) ? model.phase.spawns : []

export const WAVE_2_FIGHT = Phase.Wave({
  wave: 2,
  elapsedMs: 0,
  spawns: [DISTANT_SPAWN],
})

export const WAVE_2_BREAK = Phase.Preparation({
  clock: BreakClock.Counting(),
  wave: 2,
  remainingMs: 15_000,
  durationMs: PREPARATION_MS,
  spawns: [DISTANT_SPAWN],
})

export const WAVE_3_BREAK = Phase.Preparation({
  clock: BreakClock.Counting(),
  wave: 3,
  remainingMs: 15_000,
  durationMs: PREPARATION_MS,
  spawns: [],
})

export const heroesBoughtBy = (rank: number): ReadonlyArray<string> =>
  Array.flatMap(CALLINGS, calling =>
    calling !== 'You' && isCallingUnlocked(calling, rank)
      ? [heroIdOf(calling)]
      : [],
  )

export const knowingDay: {
  (day: string): (model: Model) => Model
  (model: Model, day: string): Model
} = Function.dual(2, (model: Model, day: string): Model => {
  const known = UiStruct.evolve(model, { maybeToday: () => Option.some(day) })
  return UiStruct.evolve(known, {
    missions: missions => freezeOn(missions, day, missionsOn(known, day)),
  })
})

export const withKeys: {
  (keys: number): <M extends World>(base: M) => M
  <M extends World>(base: M, keys: number): M
} = Function.dual(2, <M extends World>(base: M, keys: number): M =>
  modifyWorldFields(base, {
    keys: ring =>
      UiStruct.evolve(ring, { held: () => keys, found: () => keys }),
  }),
)

export const home: Model = asVeteran(initialModel)

export const homeAfterRead: Model = UiStruct.evolve(home, {
  rank: rank => grantedVeteran(rank, 0),
  saving: UiStruct.evolve({ saveStatus: () => 'Read' }),
})

export const readyModel: Model = UiStruct.evolve(home, {
  maybeSurface: () => Option.some(SURFACE),
})

export const newPlayerReady: Model = UiStruct.evolve(initialModel, {
  maybeSurface: () => Option.some(SURFACE),
})

export const newPlayerCardSeen: Model = UiStruct.evolve(initialModel, {
  difficultyCard: () => DifficultyCard.Seen,
  maybeSurface: () => Option.some(SURFACE),
})

export const readyAfterRead: Model = UiStruct.evolve(home, {
  maybeSurface: () => Option.some(SURFACE),
  rank: rank => grantedVeteran(rank, 0),
  saving: UiStruct.evolve({ saveStatus: () => 'Read' }),
})

export const loadingSave: Model = UiStruct.evolve(initialModel, {
  maybeSurface: () => Option.some(SURFACE),
  saving: UiStruct.evolve({
    loading: () => Loading.Loading({ pending: ['Save'] }),
  }),
})

export const fighting: Model = UiStruct.evolve(initialModel, {
  phase: () => Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [] }),
})

export const veteranFighting: Model = UiStruct.evolve(home, {
  phase: () => Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [] }),
})

export const withDareThings: {
  (things: ReadonlyArray<DareThing>): (model: Model) => Model
  (model: Model, things: ReadonlyArray<DareThing>): Model
} = Function.dual(2, (model: Model, things: ReadonlyArray<DareThing>): Model =>
  UiStruct.evolve(model, {
    dare: dare =>
      UiStruct.evolve(dare, {
        list: () => Array.map(things, ({ kind }) => kind),
      }),
    dareThings: () => things,
  }),
)

export const hidingSpotIn: {
  (room: string): (level: Level) => Vector
  (level: Level, room: string): Vector
} = Function.dual(2, (level: Level, room: string): Vector =>
  Option.getOrThrow(
    Option.map(
      Option.flatMap(
        Array.findFirst(roomSpotsOf(level.spec), spots => spots.room === room),
        ({ hiding }) => Array.head(hiding),
      ),
      ({ tile }) => tileCenter(tile),
    ),
  ),
)

export const withFinale: {
  (finale: Finale): (model: Model) => Model
  (model: Model, finale: Finale): Model
} = Function.dual(2, (model: Model, finale: Finale): Model =>
  UiStruct.evolve(model, {
    dare: dare => UiStruct.evolve(dare, { finale: () => finale }),
  }),
)

export const FRONT_DOOR_SILL: Readonly<{ x: number; y: number }> =
  frontDoorSillOf(levelOf(initialModel))

export const escaping = (model: Model): Model =>
  withPlayerAt(
    withFinale(model, Finale.Open()),
    FRONT_DOOR_SILL.x,
    FRONT_DOOR_SILL.y,
  )

export const armedFight: Model = modifyFocus(
  UiStruct.evolve(readyModel, { phase: () => WAVE_2_FIGHT }),
  {
    player: player =>
      UiStruct.evolve(player, {
        arsenal: () =>
          Arsenal.HoldingFirst({
            first: { ...STARTING_PISTOL, loaded: 3 },
            second: SHOTGUN,
          }),
      }),
  },
)

export const armedBreak: Model = UiStruct.evolve(armedFight, {
  phase: () => WAVE_2_BREAK,
})

export const openFloorWave: Model = UiStruct.evolve(initialModel, {
  maybeSurface: () => Option.some({ left: 0, top: 0, width: 800, height: 400 }),
  phase: () => Phase.Wave({ wave: 1, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
})

export const atClock: {
  (elapsedMs: number): (model: Model) => Model
  (model: Model, elapsedMs: number): Model
} = Function.dual(2, (model: Model, elapsedMs: number): Model =>
  UiStruct.evolve(model, { elapsedMs: () => elapsedMs }),
)

export const quietWave = (wave: number): Model =>
  UiStruct.evolve(initialModel, {
    maybeSurface: () => Option.some(SURFACE),
    phase: () => Phase.Wave({ wave, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
  })

export const killShot: {
  (weapon: WeaponKind): (arsenal: Arsenal) => Model
  (arsenal: Arsenal, weapon: WeaponKind): Model
} = Function.dual(2, (arsenal: Arsenal, weapon: WeaponKind): Model =>
  modifyFocus(
    UiStruct.evolve(quietWave(3), {
      zombies: () => [doomed],
      bullets: () => [{ ...bulletInto(500, doomed), weapon }],
    }),
    { player: player => UiStruct.evolve(player, { arsenal: () => arsenal }) },
  ),
)

export const spareGunOf = (current: Model): CarriedGun =>
  Option.getOrThrow(maybeSpareGun(focusOf(current).player.arsenal))

export const pastFirstBreak = (model: Model): Model =>
  UiStruct.evolve(model, {
    lessons: lessons =>
      UiStruct.evolve(lessons, {
        openBreak: () => Lesson.Learned({ atMs: 0 }),
        dareTour: () => Lesson.Learned({ atMs: 0 }),
        dareKey: () => Lesson.Learned({ atMs: 0 }),
        rattles: () => Lesson.Learned({ atMs: 0 }),
      }),
  })

export const breakBefore = (wave: number): Phase =>
  Phase.Preparation({
    clock: BreakClock.Counting(),
    wave,
    remainingMs: 15_000,
    durationMs: PREPARATION_MS,
    spawns: [DISTANT_SPAWN],
  })

export const trapReady: Model = UiStruct.evolve(pastFirstBreak(initialModel), {
  maybeSurface: () => Option.some({ left: 0, top: 0, width: 800, height: 400 }),
})

export const pastTimedBreaks = (model: Model): Model =>
  UiStruct.evolve(model, {
    lessons: lessons =>
      UiStruct.evolve(lessons, {
        timedBreaks: () => Lesson.Learned({ atMs: 0 }),
      }),
  })

export const onHard = (model: Model): Model =>
  UiStruct.evolve(model, {
    difficulty: setting => UiStruct.evolve(setting, { chosen: () => 'Hard' }),
  })

export const onDifficulty: {
  (difficulty: Difficulty): (model: Model) => Model
  (model: Model, difficulty: Difficulty): Model
} = Function.dual(2, (model: Model, difficulty: Difficulty): Model =>
  UiStruct.evolve(model, {
    difficulty: setting =>
      UiStruct.evolve(setting, { chosen: () => difficulty }),
  }),
)

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
    UiStruct.evolve(base, {
      zombies: () => zombies,
      bullets: () => bullets,
    }),
)

export const withPlayerAt: {
  (x: number, y: number): (base: Model) => Model
  (base: Model, x: number, y: number): Model
} = Function.dual(3, (base: Model, x: number, y: number): Model =>
  modifyFocus(base, {
    player: player => UiStruct.evolve(player, { x: () => x, y: () => y }),
  }),
)

export const withKnifeOut = (base: Model): Model =>
  modifyFocus(base, {
    player: player => UiStruct.evolve(player, { wield: () => 'Melee' }),
  })

export const withArsenal: {
  (arsenal: Arsenal): (base: Model) => Model
  (base: Model, arsenal: Arsenal): Model
} = Function.dual(2, (base: Model, arsenal: Arsenal): Model =>
  modifyFocus(base, {
    player: player => UiStruct.evolve(player, { arsenal: () => arsenal }),
  }),
)

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

export const modifyLeadSeat: {
  (change: (seat: Seat) => Seat): (world: World) => World
  (world: World, change: (seat: Seat) => Seat): World
} = Function.dual(2, (world: World, change: (seat: Seat) => Seat): World =>
  modifySeatRecord(world, focusSlotOf(world), change),
)

export const atSeat: {
  (slot: number, change: (world: World) => World): (current: Model) => Model
  (current: Model, slot: number, change: (world: World) => World): Model
} = Function.dual(
  3,
  (current: Model, slot: number, change: (world: World) => World): Model =>
    withWorld(current, world => withSeat(world, slot, change)),
)

export const inPortrait = (model: Model): Model =>
  UiStruct.evolve(model, {
    orientation: () => 'Portrait',
    maybeSurface: () => Option.some(PHONE_PORTRAIT),
  })

export const withNewerBuild = (model: Model): Model =>
  UiStruct.evolve(model, {
    release: UiStruct.evolve({
      maybeNewerBuild: () => Option.some('newer-build'),
    }),
  })

export const exitsToRoom: {
  (room: SlotRoomId): (arrangement: Arrangement) => ReadonlyArray<ExitId>
  (arrangement: Arrangement, room: SlotRoomId): ReadonlyArray<ExitId>
} = Function.dual(
  2,
  (arrangement: Arrangement, room: SlotRoomId): ReadonlyArray<ExitId> =>
    Option.match(
      Array.findFirst(SLOT_IDS, slot => arrangement[slot] === room),
      {
        onNone: () => [],
        onSome: slot => [...SLOTS[slot].requires, SLOTS[slot].exit],
      },
    ),
)

export const roomOpenIn: {
  (room: SlotRoomId): (arrangement: Arrangement) => LevelState
  (arrangement: Arrangement, room: SlotRoomId): LevelState
} = Function.dual(2, (arrangement: Arrangement, room: SlotRoomId): LevelState =>
  Array.reduce(
    exitsToRoom(arrangement, room),
    startingLevelFor(arrangement),
    (state, exit) => openExitIn(state, exit),
  ),
)

export function freshRunModel(): Model {
  const veteran = asVeteran(initialModel)
  return UiStruct.evolve(
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

export const atFridgeOnWave: {
  (keys: number): (wave: number) => Model
  (wave: number, keys: number): Model
} = Function.dual(2, (wave: number, keys: number): Model =>
  modifyFocus(
    UiStruct.evolve(withKeys(freshRunModel(), keys), {
      level: level => openExitIn(level, KITCHEN_EXIT),
      phase: () =>
        Phase.Preparation({
          clock: BreakClock.Counting(),
          wave,
          remainingMs: 120_000,
          durationMs: 120_000,
          spawns: [DISTANT_SPAWN],
        }),
    }),
    {
      player: player =>
        UiStruct.evolve(player, { x: () => AT_FRIDGE.x, y: () => AT_FRIDGE.y }),
    },
  ),
)

export const atFridge = (keys: number): Model => atFridgeOnWave(5, keys)

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
  return UiStruct.evolve(current, {
    loot: loot => UiStruct.evolve(loot, { fridgeRngState: () => seed }),
  })
})

export const FIGHTING_PHASE = Phase.Wave({
  wave: 1,
  elapsedMs: 0,
  spawns: [DISTANT_SPAWN],
})

export const playingModel: Model = UiStruct.evolve(readyModel, {
  phase: () => FIGHTING_PHASE,
})

export const withZombies: {
  (zombies: ReadonlyArray<Zombie>): (base: Model) => Model
  (base: Model, zombies: ReadonlyArray<Zombie>): Model
} = Function.dual(2, (base: Model, zombies: ReadonlyArray<Zombie>): Model =>
  UiStruct.evolve(base, { zombies: () => zombies }),
)

const CREW_WAVE = Phase.Wave({
  wave: 3,
  elapsedMs: 0,
  spawns: [DISTANT_SPAWN],
})

export const crewInWave: {
  (phase?: Phase): (count: number) => Model
  (count: number, phase?: Phase): Model
} = Function.dual(
  (args: IArguments) => typeof args[0] === 'number',
  (count: number, phase: Phase = CREW_WAVE): Model =>
    withWorld(
      UiStruct.evolve(home, {
        maybeSurface: () => Option.some(SURFACE),
        phase: () => phase,
      }),
      world => seatCrew(world, count),
    ),
)

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
          UiStruct.evolve(player, { x: () => x, y: () => y, hp: () => hp }),
      }),
    ),
)

export const withSeatLife: {
  (slot: number, life: Life): (current: Model) => Model
  (current: Model, slot: number, life: Life): Model
} = Function.dual(3, (current: Model, slot: number, life: Life): Model =>
  atSeat(current, slot, world =>
    UiStruct.evolve(world, {
      seats: atSeatBy(slot, state =>
        UiStruct.evolve(state, {
          seat: seat => UiStruct.evolve(seat, { life: () => life }),
        }),
      ),
    }),
  ),
)

export const untouchableSeat =
  (slot: number) =>
  (current: Model): Model =>
    atSeat(current, slot, world =>
      modifyFocus(world, {
        player: player =>
          UiStruct.evolve(player, {
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

export const lastHeart = (base: Model): Model =>
  modifyFocus(
    UiStruct.evolve(base, {
      zombies: () => [
        zombieOf('Runner', 100, START_LEVEL.start.x + 2, START_LEVEL.start.y),
      ],
    }),
    { player: player => UiStruct.evolve(player, { hp: () => 1 }) },
  )

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

const inKitchen = (
  spot: Readonly<{ x: number; y: number }>,
  keys: number,
  phase: Phase,
): Model =>
  modifyFocus(
    UiStruct.evolve(withKeys(freshRunModel(), keys), {
      level: level => openExitIn(level, KITCHEN_EXIT),
      phase: () => phase,
    }),
    {
      player: player =>
        UiStruct.evolve(player, { x: () => spot.x, y: () => spot.y }),
    },
  )

export const kitchenBreak = (wave: number): Phase =>
  Phase.Preparation({
    clock: BreakClock.Counting(),
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

export const withFeatsOf: {
  (change: (tally: FeatTally) => FeatTally): (model: Model) => Model
  (model: Model, change: (tally: FeatTally) => FeatTally): Model
} = Function.dual(
  2,
  (model: Model, change: (tally: FeatTally) => FeatTally): Model =>
    modifyFocus(model, { feats: change }),
)

export const atStove = (balance: number): Model =>
  withFeatsOf(inKitchen(AT_STOVE, balance, kitchenBreak(5)), tally =>
    UiStruct.evolve(tally, { kitchenKills: () => STOVE_RULES.kitchenKills }),
  )

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
  withFeatsOf(inKitchen(AT_VALVE, balance, phase), tally =>
    UiStruct.evolve(tally, { kitchenStandKills: () => VALVE_RULES.standKills }),
  ),
)

const firstCaseBox = caseBoxOf(START_LEVEL, {
  id: 0,
  spot: 0,
  prize: 'Shotgun',
  feat: Feat.Kills({ count: 1 }),
  state: CaseState.Locked(),
})

export const AT_CASE = {
  x: (firstCaseBox.left + firstCaseBox.right) / 2,
  y: firstCaseBox.bottom + 8,
}

export const atCase: {
  (prize: CasePrize, state: CaseState, feat?: Feat): (model: Model) => Model
  (model: Model, prize: CasePrize, state: CaseState, feat?: Feat): Model
} = Function.dual(
  (args: IArguments) => typeof args[0] !== 'string',
  (
    model: Model,
    prize: CasePrize,
    state: CaseState,
    feat: Feat = Feat.Kills({ count: 1 }),
  ): Model =>
    modifyFocus(
      UiStruct.evolve(model, {
        cases: () => [{ id: 0, spot: 0, prize, feat, state }],
      }),
      {
        player: player =>
          UiStruct.evolve(player, { x: () => AT_CASE.x, y: () => AT_CASE.y }),
      },
    ),
)

export const atOpenedCase: {
  (prize: CasePrize): (model: Model) => Model
  (model: Model, prize: CasePrize): Model
} = Function.dual(2, (model: Model, prize: CasePrize): Model =>
  atCase(
    UiStruct.evolve(model, { phase: () => kitchenBreak(2) }),
    prize,
    CaseState.Opened({ by: focusSlotOf(model) }),
  ),
)

export const withoutSupportLink = (model: Model): Model =>
  UiStruct.evolve(model, {
    release: UiStruct.evolve({ maybeSupportUrl: () => Option.none() }),
  })
