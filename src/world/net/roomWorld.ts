import { Array, Function, Option, Result, pipe } from 'effect'

import { UiStruct } from '@effect/ui'
import type {
  PlayerInput,
  PlayerTick,
  Reader,
  RoomDifficulty,
  RoomMode,
  World as RoomWorldOf,
  RunEndReason,
  Score,
  Writer,
} from '@munch/netcode'

import { FIXED_STEP_MS } from '#shared/constants.ts'
import * as DetMath from '#shared/detMath.ts'
import { type Calling, callingOfCode } from '#shared/records/playerData.ts'
import { rollDare } from '#world/dare/dare.ts'
import type { DareKind } from '#world/dare/dareSchema.ts'
import { rollCases } from '#world/feats/cases.ts'
import { TURRET_WEAPON } from '#world/gear/traps.ts'
import { seatedAs } from '#world/heroes/callingPlayer.ts'
import { freshOvens } from '#world/kitchen/kitchen.ts'
import { START_LEVEL } from '#world/level/arena.ts'
import {
  biteGraceFor,
  focusSeat,
  maybePlayerAt,
  modifySeat,
  modifySeatRecord,
  playerAt,
  playersOf,
  presenceOf,
  seatCrew,
  setPresence,
  soloSeat,
  soloState,
  withStartingHearts,
} from '#world/party/party.ts'
import { beginArrival, endArrival, isArriving } from '#world/run/arrival.ts'
import { clampMark } from '#world/run/dareLadder.ts'
import { settledLessons } from '#world/run/lessons.ts'
import {
  type Modifiers,
  modifiersOfMask,
  noModifiers,
} from '#world/run/modifiers.ts'
import { type World, modifyWorldFields } from '#world/schema/world.ts'
import {
  Boss,
  type Bullet,
  DebutCard,
  type Difficulty,
  type GameEvent,
  GunSlot,
  type Intent,
  type IntroCut,
  Party,
  Phase,
  type Player,
  type PlayerSlot,
  RunMode,
  type Seat,
  barePantry,
  calmPacing,
  freshCrates,
  freshDare,
  freshKeys,
  freshLevel,
  freshLoot,
  freshStats,
  freshStove,
  idleStations,
  initialHitStop,
  noPractice,
  shutFridge,
  shutValve,
} from '#world/schema/worldSchema.ts'
import { type ZombieAt, catchUpShots, zombiesAt } from '#world/step/firing.ts'
import { lerp, normalize } from '#world/step/geometry.ts'
import { predictSeat } from '#world/step/simulation.ts'
import {
  SeatAction,
  applySeatAction,
  stepWorld,
} from '#world/step/stepWorld.ts'

import {
  readEvent,
  readMany,
  readWorld,
  readWorldDiff,
  writeEvent,
  writeWorld,
  writeWorldDiff,
} from './worldCodec.ts'

type TickEvents = Readonly<{
  tick: number
  events: ReadonlyArray<GameEvent>
}>

type TickPositions = Readonly<{
  tick: number
  zombies: ReadonlyArray<ZombieAt>
}>

export type RoomWorld = Readonly<{
  tick: number
  world: World
  events: ReadonlyArray<TickEvents>
  pressed: ReadonlyArray<readonly [slot: PlayerSlot, action: number]>
  history: ReadonlyArray<TickPositions>
}>

export type OwnSeat = Readonly<{ slot: PlayerSlot; player: Player }>

export type RoomSettings = Readonly<{
  difficulty: Difficulty
  modifiers: Modifiers
  easyBreakSeconds: number
  dareMark: number
  mode: RunMode
  callings: ReadonlyArray<Readonly<{ slot: PlayerSlot; calling: Calling }>>
  intro: IntroCut
  things: ReadonlyArray<DareKind>
}>

export const roomSettingsOf: {
  (
    difficulty: RoomDifficulty,
    members?: ReadonlyArray<Readonly<{ slot: number; calling: string }>>,
    modifierMask?: number,
    easyBreakSeconds?: number,
    dareMark?: number,
  ): (mode: RoomMode) => RoomSettings
  (
    mode: RoomMode,
    difficulty: RoomDifficulty,
    members?: ReadonlyArray<Readonly<{ slot: number; calling: string }>>,
    modifierMask?: number,
    easyBreakSeconds?: number,
    dareMark?: number,
  ): RoomSettings
} = Function.dual(
  (args: IArguments): boolean => typeof args[1] === 'string',
  (
    mode: RoomMode,
    difficulty: RoomDifficulty,
    members: ReadonlyArray<Readonly<{ slot: number; calling: string }>> = [],
    modifierMask: number = 0,
    easyBreakSeconds: number = 0,
    dareMark: number = 0,
  ): RoomSettings => ({
    difficulty,
    modifiers: modifiersOfMask(modifierMask),
    easyBreakSeconds,
    dareMark: clampMark(dareMark),
    mode:
      mode === 'Endless' || mode === 'KeepGoing'
        ? RunMode.Endless()
        : RunMode.Campaign(),
    callings: Array.filterMap(members, ({ slot, calling }) =>
      Option.match(callingOfCode(calling), {
        onNone: () => Result.failVoid,
        onSome: known => Result.succeed({ slot, calling: known }),
      }),
    ),
    intro: 'Short',
    things: [],
  }),
)

export const introForRound: {
  (
    crew: ReadonlyArray<Readonly<{ hasSeenIntro: boolean }>>,
  ): (round: number) => IntroCut
  (
    round: number,
    crew: ReadonlyArray<Readonly<{ hasSeenIntro: boolean }>>,
  ): IntroCut
} = Function.dual(
  2,
  (
    round: number,
    crew: ReadonlyArray<Readonly<{ hasSeenIntro: boolean }>>,
  ): IntroCut =>
    round <= 1 && Array.some(crew, member => !member.hasSeenIntro)
      ? 'Full'
      : 'Short',
)

const MAX_VIEW_LAG_TICKS = 15

const EVENT_TICKS = 60

export const MOVE_SCALE = 127
export const AIM_REACH = 1024
export const FIRE_BUTTON = 1
export const INTERACT_BUTTON = 2
const AIM_PRECISION = 8

const eighths = (value: number): number =>
  Math.round(value * AIM_PRECISION) / AIM_PRECISION

export const inputOfIntent: {
  (action: number): (intent: Intent) => PlayerInput
  (intent: Intent, action: number): PlayerInput
} = Function.dual(2, (intent: Intent, action: number): PlayerInput => {
  const aim = Option.getOrElse(intent.maybeAim, () => ({ x: 0, y: 0 }))
  return {
    moveX: Math.round(Math.max(-1, Math.min(1, intent.move.x)) * MOVE_SCALE),
    moveY: Math.round(Math.max(-1, Math.min(1, intent.move.y)) * MOVE_SCALE),
    aimX: eighths(aim.x * AIM_REACH),
    aimY: eighths(aim.y * AIM_REACH),
    buttons:
      (intent.trigger === 'Held' ? FIRE_BUTTON : 0) |
      (intent.interact === 'Held' ? INTERACT_BUTTON : 0),
    action,
  }
})

const moveOf = (input: PlayerInput) => {
  const x = input.moveX / MOVE_SCALE
  const y = input.moveY / MOVE_SCALE
  const length = Math.sqrt(x * x + y * y)
  return length > 1 ? { x: x / length, y: y / length } : { x, y }
}

export const intentOfInput = (input: PlayerInput): Intent => ({
  move: moveOf(input),
  maybeAim:
    input.aimX === 0 && input.aimY === 0
      ? Option.none()
      : normalize({ x: input.aimX, y: input.aimY }),
  trigger: (input.buttons & FIRE_BUTTON) !== 0 ? 'Held' : 'Released',
  interact: (input.buttons & INTERACT_BUTTON) !== 0 ? 'Held' : 'Released',
})

const ACTION_BITS = 12
const ACTION_SPAN = 2 ** ACTION_BITS
const PRESS_COUNTS = 15

const SIMPLE_ACTIONS: ReadonlyArray<SeatAction> = [
  SeatAction.Swap(),
  SeatAction.Reload(),
  SeatAction.PlaceTrap(),
  SeatAction.NextTrap(),
  SeatAction.Ready(),
  SeatAction.Melee(),
]

const DRAW_BASE = SIMPLE_ACTIONS.length + 1
const DRAW_SLOTS = GunSlot.literals

const drawCode = (slot: GunSlot): number =>
  DRAW_BASE + (slot === 'First' ? 0 : 1)

const MEDIC_CODE = DRAW_BASE + DRAW_SLOTS.length

const simpleCode = (tag: SeatAction['_tag']): number =>
  Option.getOrElse(
    Array.findFirstIndex(SIMPLE_ACTIONS, simple => simple._tag === tag),
    () => -1,
  ) + 1

export const actionCodeOf = (action: SeatAction): number =>
  SeatAction.match(action, {
    Swap: () => simpleCode('Swap'),
    Melee: () => simpleCode('Melee'),
    Draw: ({ slot }) => drawCode(slot),
    Reload: () => simpleCode('Reload'),
    PlaceTrap: () => simpleCode('PlaceTrap'),
    NextTrap: () => simpleCode('NextTrap'),
    Ready: () => simpleCode('Ready'),
    CallMedic: () => MEDIC_CODE,
  })

export const heldAction: {
  (press: number): (code: number) => number
  (code: number, press: number): number
} = Function.dual(
  2,
  (code: number, press: number): number =>
    ((press % PRESS_COUNTS) + 1) * ACTION_SPAN + code,
)

export const seatActionOf: {
  (held: number): (world: World) => Option.Option<SeatAction>
  (world: World, held: number): Option.Option<SeatAction>
} = Function.dual(
  2,
  (_world: World, held: number): Option.Option<SeatAction> => {
    const code = held % ACTION_SPAN
    if (code === MEDIC_CODE) {
      return Option.some(SeatAction.CallMedic())
    } else if (code >= DRAW_BASE) {
      return Option.map(Array.get(DRAW_SLOTS, code - DRAW_BASE), slot =>
        SeatAction.Draw({ slot }),
      )
    } else {
      return Array.get(SIMPLE_ACTIONS, code - 1)
    }
  },
)

const freshWorld = (seed: number, settings: RoomSettings): World => ({
  phase: Phase.Ready(),
  pacing: calmPacing,
  boss: Boss.Absent(),
  frenzyPacks: [],
  intensity: 0,
  mode: settings.mode,
  difficulty: { chosen: settings.difficulty, nightmare: 'Locked' },
  modifiers: settings.modifiers,
  easyBreakSeconds: settings.easyBreakSeconds,
  dareMark: settings.dareMark,
  zombies: [],
  bullets: [],
  lobs: [],
  nextEntityId: 0,
  elapsedMs: 0,
  frameEvents: [],
  traps: [],
  pickups: [],
  loot: freshLoot(seed),
  level: freshLevel(seed),
  ovens: freshOvens(START_LEVEL),
  rngState: seed,
  fridge: shutFridge,
  pantry: barePantry,
  stove: freshStove(seed),
  crates: freshCrates(seed),
  keys: freshKeys(seed),
  dare: freshDare(seed),
  dareThings: [],
  gasValve: shutValve,
  stations: idleStations,
  cases: rollCases(seed, settings.difficulty),
  hitStop: initialHitStop,
  lessons: settledLessons,
  practice: noPractice,
  debutCard: DebutCard.Hidden(),
  stats: freshStats,
  party: Party.Solo(),
  seats: [soloState],
})

const seatAt = (slot: PlayerSlot): Seat =>
  UiStruct.evolve(soloSeat, { slot: () => slot })

const seatSlots = (world: World, slots: ReadonlyArray<PlayerSlot>): World => {
  const ordered = Array.sort(Array.dedupe(slots), (a: number, b: number) =>
    a < b ? -1 : a > b ? 1 : 0,
  )
  const [lead, ...mates] = seatCrew(world, Math.max(2, ordered.length)).seats
  return modifyWorldFields(world, {
    party: () => Party.Crew(),
    seats: () => [
      UiStruct.evolve(lead, { seat: () => seatAt(ordered[0] ?? 0) }),
      ...Array.filterMap(mates, (mate, index) =>
        Option.match(Array.get(ordered, index + 1), {
          onNone: () => Result.failVoid,
          onSome: slot =>
            Result.succeed(UiStruct.evolve(mate, { seat: () => seatAt(slot) })),
        }),
      ),
    ],
  })
}

const seatCallings = (
  world: World,
  callings: RoomSettings['callings'],
): World =>
  Array.reduce(callings, world, (current, { slot, calling }) =>
    modifySeat(current, slot, {
      player: player => seatedAs(player, calling),
    }),
  )

export const startRoomWorld: {
  (
    seed: number,
    settings: RoomSettings,
  ): (slots: ReadonlyArray<PlayerSlot>) => RoomWorld
  (
    slots: ReadonlyArray<PlayerSlot>,
    seed: number,
    settings: RoomSettings,
  ): RoomWorld
} = Function.dual(
  3,
  (
    slots: ReadonlyArray<PlayerSlot>,
    seed: number,
    settings: RoomSettings,
  ): RoomWorld => ({
    tick: 0,
    world: beginArrival(
      withStartingHearts(
        seatCallings(
          seatSlots(
            rollDare(settings.things)(freshWorld(seed, settings)),
            slots,
          ),
          settings.callings,
        ),
      ),
      settings.intro,
    ),
    events: [],
    pressed: [],
    history: [],
  }),
)

export const pastArrival = (room: RoomWorld): RoomWorld => ({
  ...room,
  world: endArrival(room.world),
})

const isWonRun = (world: World): boolean =>
  Phase.isAnyOf(['Escaped'])(world.phase) &&
  RunMode.isAnyOf(['Campaign'])(world.mode)

const endReasonOf = (world: World): RunEndReason =>
  isWonRun(world)
    ? 'Won'
    : Phase.isAnyOf(['LeftEarly'])(world.phase)
      ? 'LeftEarly'
      : 'GameOver'

const syncPresence = (world: World, tick: PlayerTick): World =>
  presenceOf(world, tick.slot) === tick.presence
    ? world
    : setPresence(world, tick.slot, tick.presence)

const lastPressOf = (room: RoomWorld, slot: PlayerSlot): number =>
  Option.getOrElse(
    Option.map(
      Array.findFirst(room.pressed, ([pressedSlot]) => pressedSlot === slot),
      ([, action]) => action,
    ),
    () => 0,
  )

const pressOf = (room: RoomWorld, world: World, tick: PlayerTick): World =>
  tick.input.action !== 0 && tick.input.action !== lastPressOf(room, tick.slot)
    ? Option.match(seatActionOf(world, tick.input.action), {
        onNone: () => world,
        onSome: action => applySeatAction(world, tick.slot, action),
      })
    : world

const syncGrace = (world: World, tick: PlayerTick): World => {
  const graceMs = biteGraceFor(tick.rttMs)
  return Option.exists(
    maybeSeatOf(world, tick.slot),
    seat => seat.graceMs === graceMs,
  )
    ? world
    : modifySeatRecord(world, tick.slot, seat =>
        UiStruct.evolve(seat, { graceMs: () => graceMs }),
      )
}

const isOwnGunShot =
  (slot: PlayerSlot, firstId: number) =>
  (bullet: Bullet): boolean =>
    bullet.id >= firstId &&
    bullet.shooter === slot &&
    bullet.weapon !== TURRET_WEAPON

const catchUp = (
  room: RoomWorld,
  world: World,
  players: ReadonlyArray<PlayerTick>,
  firstId: number,
): World =>
  Array.reduce(players, world, (current, player) => {
    const ticks = Math.min(MAX_VIEW_LAG_TICKS, player.viewLagTicks)
    const shots = new Set(
      Array.map(
        Array.filter(current.bullets, isOwnGunShot(player.slot, firstId)),
        bullet => bullet.id,
      ),
    )
    if (ticks <= 0 || shots.size === 0) {
      return current
    }
    const pasts = Array.map(
      Array.filter(
        room.history,
        entry => entry.tick > room.tick - ticks && entry.tick <= room.tick,
      ),
      entry => entry.zombies,
    )
    return catchUpShots(current, shots, pasts)
  })

export const stepRoomWorld: {
  (players: ReadonlyArray<PlayerTick>): (room: RoomWorld) => RoomWorld
  (room: RoomWorld, players: ReadonlyArray<PlayerTick>): RoomWorld
} = Function.dual(
  2,
  (room: RoomWorld, players: ReadonlyArray<PlayerTick>): RoomWorld => {
    const pressedWorld = Array.reduce(players, room.world, (world, tick) =>
      syncGrace(pressOf(room, syncPresence(world, tick), tick), tick),
    )
    const stepped = stepWorld(
      pressedWorld,
      new Map(
        Array.map(players, tick => [tick.slot, intentOfInput(tick.input)]),
      ),
    )
    const caught = catchUp(
      room,
      stepped.world,
      players,
      pressedWorld.nextEntityId,
    )
    const events = [
      ...stepped.events,
      ...Array.drop(caught.frameEvents, stepped.world.frameEvents.length),
    ]
    const tick = room.tick + 1
    return {
      tick,
      world: caught,
      events: Array.filter(
        Array.isReadonlyArrayEmpty(events)
          ? room.events
          : Array.append(room.events, { tick, events }),
        entry => entry.tick > tick - EVENT_TICKS,
      ),
      pressed: Array.map(players, player => [player.slot, player.input.action]),
      history: Array.takeRight(
        Array.append(room.history, { tick, zombies: zombiesAt(caught) }),
        MAX_VIEW_LAG_TICKS,
      ),
    }
  },
)

export const writeRoomSnapshot: {
  (room: RoomWorld): (writer: Writer) => void
  (writer: Writer, room: RoomWorld): void
} = Function.dual(2, (writer: Writer, room: RoomWorld): void => {
  writer.varint(room.tick)
  writeWorld(writer, room.world)
})

export const readRoomSnapshot = (reader: Reader): RoomWorld => ({
  tick: reader.varint(),
  world: readWorld(reader),
  events: [],
  pressed: [],
  history: [],
})

const MAX_EVENTS = 4096

export const writeRoomDiff: {
  (prev: RoomWorld, next: RoomWorld): (writer: Writer) => void
  (writer: Writer, prev: RoomWorld, next: RoomWorld): void
} = Function.dual(
  3,
  (writer: Writer, prev: RoomWorld, next: RoomWorld): void => {
    writer.varint(Math.max(0, next.tick - prev.tick))
    writeWorldDiff(writer, prev.world, next.world)
    const fresh = Array.filter(
      next.events,
      entry => entry.tick > prev.tick && entry.tick <= next.tick,
    )
    writer.varint(fresh.length)
    Array.forEach(fresh, entry => {
      writer.varint(entry.tick - prev.tick)
      writer.varint(entry.events.length)
      Array.forEach(entry.events, event => writeEvent(writer, event))
    })
  },
)

const readCount = (reader: Reader): number => {
  const count = reader.varint()
  if (count > MAX_EVENTS) {
    throw new Error(`${count} events in a diff`)
  }
  return count
}

export const readRoomDiff: {
  (prev: RoomWorld): (reader: Reader) => RoomWorld
  (reader: Reader, prev: RoomWorld): RoomWorld
} = Function.dual(2, (reader: Reader, prev: RoomWorld): RoomWorld => {
  const tick = prev.tick + reader.varint()
  const world = readWorldDiff(reader, prev.world)
  const events = readMany(readCount(reader), () => {
    const at = prev.tick + reader.varint()
    return {
      tick: at,
      events: readMany(readCount(reader), () => readEvent(reader)),
    }
  })
  return { tick, world, events, pressed: [], history: [] }
})

const TELEPORT_PX = 64

type Placed = Readonly<{ x: number; y: number }>

const lerpPlaced = <A extends Placed>(from: A, to: A, t: number): A =>
  Math.abs(to.x - from.x) + Math.abs(to.y - from.y) > TELEPORT_PX
    ? to
    : { ...to, x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) }

const lerpById = <A extends Placed & Readonly<{ id: number }>>(
  from: ReadonlyArray<A>,
  to: ReadonlyArray<A>,
  t: number,
): ReadonlyArray<A> => {
  const before = new Map(Array.map(from, item => [item.id, item] as const))
  return Array.map(to, item =>
    Option.match(Option.fromNullishOr(before.get(item.id)), {
      onNone: () => item,
      onSome: was => lerpPlaced(was, item, t),
    }),
  )
}

const lerpSeats = (from: World, to: World, t: number): World['seats'] =>
  Array.map(to.seats, state =>
    Option.match(maybePlayerAt(from, state.seat.slot), {
      onNone: () => state,
      onSome: was =>
        UiStruct.evolve(state, {
          player: player => lerpPlaced(was.player, player, t),
        }),
    }),
  )

const interpolateWorld = (from: World, to: World, t: number): World =>
  UiStruct.evolve(to, {
    zombies: zombies => lerpById(from.zombies, zombies, t),
    bullets: bullets => lerpById(from.bullets, bullets, t),
    seats: () => lerpSeats(from, to, t),
  })

const ownOf = (room: RoomWorld, slot: PlayerSlot): Option.Option<OwnSeat> =>
  Option.map(maybePlayerAt(room.world, slot), ({ player }) => ({
    slot,
    player,
  }))

const putOwn = (
  room: RoomWorld,
  slot: PlayerSlot,
  own: OwnSeat,
): RoomWorld => ({
  ...room,
  world: modifySeat(room.world, slot, { player: () => own.player }),
})

export const predictOwn: {
  (input: PlayerInput, room: RoomWorld): (own: OwnSeat) => OwnSeat
  (own: OwnSeat, input: PlayerInput, room: RoomWorld): OwnSeat
} = Function.dual(
  3,
  (own: OwnSeat, input: PlayerInput, room: RoomWorld): OwnSeat =>
    isArriving(room.world.phase)
      ? own
      : {
          ...own,
          player: playerAt(
            predictSeat(
              modifySeat(room.world, own.slot, {
                player: () => own.player,
                intent: () => intentOfInput(input),
              }),
              own.slot,
              FIXED_STEP_MS,
            ),
            own.slot,
          ),
        },
)

const gapOf = (a: OwnSeat, b: OwnSeat): number =>
  DetMath.hypot(a.player.x - b.player.x, a.player.y - b.player.y)

const blendOwn = (from: OwnSeat, to: OwnSeat, t: number): OwnSeat => ({
  ...to,
  player: {
    ...to.player,
    x: lerp(from.player.x, to.player.x, t),
    y: lerp(from.player.y, to.player.y, t),
  },
})

const isRunOver = (world: World): boolean =>
  Phase.isAnyOf(['GameOver', 'LeftEarly', 'Escaped'])(world.phase)

const scoresOf = (world: World): ReadonlyArray<Score> =>
  Array.map(playersOf(world), ({ seat }) => ({
    slot: seat.slot,
    score: seat.kills,
  }))

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  difficulty: 'Normal',
  modifiers: noModifiers,
  easyBreakSeconds: 0,
  dareMark: 0,
  mode: RunMode.Campaign(),
  callings: [],
  intro: 'Short',
  things: [],
}

export const roomWorldFor = (
  settings: RoomSettings,
): RoomWorldOf<RoomWorld, OwnSeat> => ({
  name: 'MunchManor',
  start: (slots, seed) => startRoomWorld(slots, seed, settings),
  step: stepRoomWorld,
  removePlayer: (room, slot) => ({
    ...room,
    world: setPresence(room.world, slot, 'Away'),
  }),
  isOver: room => isRunOver(room.world),
  endReason: room => endReasonOf(room.world),
  scores: room => scoresOf(room.world),
  snapshot: writeRoomSnapshot,
  readSnapshot: readRoomSnapshot,
  diff: writeRoomDiff,
  applyDiff: readRoomDiff,
  interpolate: (from, to, t) => ({
    ...to,
    world: interpolateWorld(from.world, to.world, t),
  }),
  own: {
    of: ownOf,
    put: putOwn,
    step: predictOwn,
    gap: gapOf,
    blend: blendOwn,
  },
})

export const ROOM_WORLD = roomWorldFor(DEFAULT_ROOM_SETTINGS)

export const ownWorldOf: {
  (slot: PlayerSlot): (room: RoomWorld) => World
  (room: RoomWorld, slot: PlayerSlot): World
} = Function.dual(2, (room: RoomWorld, slot: PlayerSlot): World =>
  focusSeat(room.world, slot),
)

export const eventsBetween: {
  (
    afterTick: number,
    untilTick: number,
  ): (
    frames: ReadonlyArray<Readonly<{ world: RoomWorld }>>,
  ) => ReadonlyArray<GameEvent>
  (
    frames: ReadonlyArray<Readonly<{ world: RoomWorld }>>,
    afterTick: number,
    untilTick: number,
  ): ReadonlyArray<GameEvent>
} = Function.dual(
  3,
  (
    frames: ReadonlyArray<Readonly<{ world: RoomWorld }>>,
    afterTick: number,
    untilTick: number,
  ): ReadonlyArray<GameEvent> =>
    pipe(
      frames,
      Array.flatMap(frame => frame.world.events),
      Array.filter(entry => entry.tick > afterTick && entry.tick <= untilTick),
      Array.sort((a: TickEvents, b: TickEvents) =>
        a.tick < b.tick ? -1 : a.tick > b.tick ? 1 : 0,
      ),
      Array.flatMap(entry => entry.events),
    ),
)

const maybeSeatOf = (world: World, slot: PlayerSlot): Option.Option<Seat> =>
  Option.map(maybePlayerAt(world, slot), ({ seat }) => seat)
