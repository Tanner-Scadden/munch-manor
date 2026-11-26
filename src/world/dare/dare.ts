import { Array, Function, Option } from 'effect'

import { type Difficulty } from '../../shared/playerData'
import { type Seeded, nextRandom, shuffle } from '../../shared/prng'
import { isHiddenInDark } from '../cellar/bulb'
import { type Level, type Room, levelOf } from '../level/arena'
import { type LevelSpec, type RoomSpots, roomSpotsOf } from '../level/plan'
import { tileCenter } from '../level/tileGrid'
import { focusOf, forEachSeat, isStanding, seatStateAt } from '../party/party'
import { type World, modifyWorldFields } from '../schema/world'
import {
  GameEvent,
  Phase,
  type PlayerSlot,
  RunMode,
  type Vector,
} from '../schema/worldSchema'
import { DRAIN_SCALE, isStill } from '../stations/work'
import { distanceBetween } from '../step/geometry'
import {
  type Dare,
  type DareKind,
  type DareThing,
  DareThingState,
  Finale,
} from './dareSchema'
import { FIND_RULES, type FindStyle, findStyleOfRoom } from './finds'
import { dareThingPool } from './milestones'

export const LIST_LENGTHS: Readonly<Record<Difficulty, number>> = {
  Easy: 2,
  Normal: 3,
  Hard: 3,
  Nightmare: 4,
}

type DareRules = Readonly<{ reachPx: number }>

const DARE_RULES: DareRules = { reachPx: 10 }

const thingsLeft = (
  pool: ReadonlyArray<DareKind>,
  taken: ReadonlyArray<DareKind>,
): ReadonlyArray<DareKind> =>
  Array.filter(pool, kind => !Array.contains(taken, kind))

const drawOne = <A>(
  state: number,
  items: ReadonlyArray<A>,
): Seeded<Option.Option<A>> => {
  const draw = nextRandom(state)
  return [
    draw.nextState,
    Array.get(items, Math.floor(draw.value * items.length)),
  ]
}

const hasExit = (spec: LevelSpec, room: string): boolean =>
  Array.some(
    spec.rooms,
    ({ id, maybeExit }) => id === room && Option.isSome(maybeExit),
  )

const roomOrder = (
  state: number,
  level: Level,
): Seeded<ReadonlyArray<RoomSpots>> => {
  const rooms = Array.filter(roomSpotsOf(level.spec), ({ hiding }) =>
    Array.isReadonlyArrayNonEmpty(hiding),
  )
  const boarded = Array.filter(rooms, ({ room }) => hasExit(level.spec, room))
  const open = Array.filter(rooms, ({ room }) => !hasExit(level.spec, room))
  const [nextState, shuffled] = Array.match(boarded, {
    onEmpty: (): Seeded<ReadonlyArray<RoomSpots>> => [state, []],
    onNonEmpty: nonEmpty => shuffle(state, nonEmpty),
  })
  return [nextState, [...shuffled, ...open]]
}

type Placing = Readonly<{
  state: number
  pool: ReadonlyArray<DareKind>
  taken: ReadonlyArray<DareKind>
}>

const placeIn = (
  placing: Placing,
  { hiding }: RoomSpots,
): Seeded<Option.Option<Readonly<{ kind: DareKind; point: Vector }>>> => {
  const [kindState, maybeKind] = drawOne(
    placing.state,
    thingsLeft(placing.pool, placing.taken),
  )
  const [spotState, maybeSpot] = drawOne(kindState, hiding)
  return [
    spotState,
    Option.zipWith(maybeKind, maybeSpot, (kind, { tile }) => ({
      kind,
      point: tileCenter(tile),
    })),
  ]
}

const rolledThings = (
  world: World,
  pool: ReadonlyArray<DareKind>,
): Readonly<{ dare: Dare; things: ReadonlyArray<DareThing> }> => {
  const level = levelOf(world)
  const [orderState, rooms] = roomOrder(world.dare.rngState, level)
  const chosen = Array.take(rooms, LIST_LENGTHS[world.difficulty.chosen])
  const [placing, placed] = Array.mapAccum(
    chosen,
    { state: orderState, pool, taken: [] },
    (
      current: Placing,
      room,
    ): readonly [
      Placing,
      Option.Option<Readonly<{ kind: DareKind; point: Vector }>>,
    ] => {
      const [state, maybePlaced] = placeIn(current, room)
      return [
        {
          state,
          pool: current.pool,
          taken: Option.match(maybePlaced, {
            onNone: () => current.taken,
            onSome: ({ kind }) => [...current.taken, kind],
          }),
        },
        maybePlaced,
      ]
    },
  )
  const things = Array.map(
    Array.getSomes(placed),
    ({ kind, point }, id): DareThing => ({
      id,
      kind,
      state: DareThingState.Hidden({ ...point, workedMs: 0 }),
    }),
  )
  return {
    dare: {
      rngState: placing.state,
      list: Array.map(things, ({ kind }) => kind),
      finale: Finale.Hunting(),
    },
    things,
  }
}

export const rollDare =
  (opened: ReadonlyArray<DareKind>) =>
  <M extends World>(world: M): M => {
    if (!RunMode.isAnyOf(['Campaign'])(world.mode)) {
      return modifyWorldFields(world, {
        dare: current => ({ ...current, list: [] }),
        dareThings: () => [],
      })
    }
    const { dare, things } = rolledThings(world, dareThingPool(opened))
    return modifyWorldFields(world, {
      dare: () => dare,
      dareThings: () => things,
    })
  }

const isFound = (thing: DareThing): boolean =>
  DareThingState.isAnyOf(['Found'])(thing.state)

const hasDare = (world: World): boolean =>
  Array.isReadonlyArrayNonEmpty(world.dare.list)

export const isDareListDone = (world: World): boolean =>
  hasDare(world) && Array.every(world.dareThings, isFound)

export const dareItemsFoundOf = (world: World): number =>
  Array.filter(world.dareThings, isFound).length

export const dareCardOf = (
  world: World,
): ReadonlyArray<Readonly<{ kind: DareKind; isFound: boolean }>> =>
  hasDare(world)
    ? Array.map(world.dare.list, kind => ({
        kind,
        isFound: Array.some(
          world.dareThings,
          thing => thing.kind === kind && isFound(thing),
        ),
      }))
    : []

const isInBox = (point: Vector, { box }: Room): boolean =>
  point.x >= box.left &&
  point.x < box.right &&
  point.y >= box.top &&
  point.y < box.bottom

export const isInOpenRoom: {
  (point: Vector): (level: Level) => boolean
  (level: Level, point: Vector): boolean
} = Function.dual(2, (level: Level, point: Vector): boolean =>
  Array.some(level.rooms, room => room.isOpen && isInBox(point, room)),
)

export const maybeThingRoom: {
  (level: Level): (thing: DareThing) => Option.Option<Room>
  (thing: DareThing, level: Level): Option.Option<Room>
} = Function.dual(2, (thing: DareThing, level: Level): Option.Option<Room> =>
  DareThingState.matchOrElse(
    thing.state,
    {
      Hidden: (point): Option.Option<Room> =>
        Array.findFirst(level.rooms, room => isInBox(point, room)),
    },
    (): Option.Option<Room> => Option.none(),
  ),
)

export const maybeLyingAt: {
  (level: Level): (thing: DareThing) => Option.Option<Vector>
  (thing: DareThing, level: Level): Option.Option<Vector>
} = Function.dual(2, (thing: DareThing, level: Level): Option.Option<Vector> =>
  DareThingState.matchOrElse(
    thing.state,
    {
      Hidden: ({ x, y }): Option.Option<Vector> =>
        isInOpenRoom(level, { x, y }) ? Option.some({ x, y }) : Option.none(),
    },
    (): Option.Option<Vector> => Option.none(),
  ),
)

export const maybeTuneSpot = (world: World): Option.Option<Vector> =>
  Array.findFirst(world.dareThings, ({ kind, state }) =>
    kind === 'MusicBox' && DareThingState.isAnyOf(['Hidden'])(state)
      ? Option.some({ x: state.x, y: state.y })
      : Option.none(),
  )

const setThing = (
  things: ReadonlyArray<DareThing>,
  id: number,
  state: DareThingState,
): ReadonlyArray<DareThing> =>
  Array.map(things, thing => (thing.id === id ? { ...thing, state } : thing))

export const findStyleOf: {
  (level: Level): (thing: DareThing) => FindStyle
  (thing: DareThing, level: Level): FindStyle
} = Function.dual(2, (thing: DareThing, level: Level): FindStyle =>
  Option.match(maybeThingRoom(thing, level), {
    onNone: (): FindStyle => 'Walk',
    onSome: ({ id }) => findStyleOfRoom(id),
  }),
)

const maybeWalkOnto = (thing: DareThing, level: Level): Option.Option<Vector> =>
  Option.filter(
    maybeLyingAt(thing, level),
    () => FIND_RULES[findStyleOf(thing, level)].workMs <= 0,
  )

const takeFor = (world: World, slot: PlayerSlot): World => {
  const { seat, player } = seatStateAt(world, slot)
  if (!isStanding(seat)) {
    return world
  }
  const level = levelOf(world)
  return Array.reduce(world.dareThings, world, (current, thing) =>
    Option.match(maybeWalkOnto(thing, level), {
      onNone: () => current,
      onSome: spot =>
        distanceBetween(player, spot) <= DARE_RULES.reachPx &&
        !isHiddenInDark(current, spot)
          ? modifyWorldFields(current, {
              dareThings: things =>
                setThing(things, thing.id, DareThingState.Found({ slot })),
              frameEvents: events => [
                ...events,
                GameEvent.DareFound({ ...spot, kind: thing.kind }),
              ],
            })
          : current,
    }),
  )
}

const finishList = (before: World, after: World): World =>
  !isDareListDone(before) && isDareListDone(after)
    ? modifyWorldFields(after, {
        frameEvents: events => [
          ...events,
          GameEvent.DareListDone({
            x: focusOf(after).player.x,
            y: focusOf(after).player.y,
          }),
        ],
      })
    : after

const isHunting = Phase.isAnyOf(['Preparation', 'Wave'])

const maybeWorkSpot = (
  world: World,
  level: Level,
  thing: DareThing,
): Option.Option<
  Readonly<{ spot: Vector; workedMs: number; style: FindStyle }>
> =>
  DareThingState.isAnyOf(['Hidden'])(thing.state) &&
  isInOpenRoom(level, thing.state)
    ? Option.filter(
        Option.some({
          spot: { x: thing.state.x, y: thing.state.y },
          workedMs: thing.state.workedMs,
          style: findStyleOf(thing, level),
        }),
        ({ spot, style }) =>
          FIND_RULES[style].workMs > 0 &&
          FIND_RULES[style].isReady(world, spot),
      )
    : Option.none()

const isWorkingAt = (
  world: World,
  slot: PlayerSlot,
  spot: Vector,
  style: FindStyle,
): boolean =>
  isStill(world, slot) &&
  distanceBetween(seatStateAt(world, slot).player, spot) <=
    FIND_RULES[style].reachPx

export const isWorkingFind: {
  (slot: PlayerSlot): (world: World) => boolean
  (world: World, slot: PlayerSlot): boolean
} = Function.dual(2, (world: World, slot: PlayerSlot): boolean => {
  if (
    !Array.isReadonlyArrayNonEmpty(world.dareThings) ||
    !isHunting(world.phase) ||
    !isStill(world, slot)
  ) {
    return false
  }
  const level = levelOf(world)
  return Array.some(world.dareThings, thing =>
    Option.exists(maybeWorkSpot(world, level, thing), ({ spot, style }) =>
      isWorkingAt(world, slot, spot, style),
    ),
  )
})

export const maybeFindWorkOf: {
  (
    slot: PlayerSlot,
  ): (
    world: World,
  ) => Option.Option<
    Readonly<{ style: FindStyle; spot: Vector; share: number }>
  >
  (
    world: World,
    slot: PlayerSlot,
  ): Option.Option<Readonly<{ style: FindStyle; spot: Vector; share: number }>>
} = Function.dual(
  2,
  (
    world: World,
    slot: PlayerSlot,
  ): Option.Option<
    Readonly<{ style: FindStyle; spot: Vector; share: number }>
  > => {
    if (
      !Array.isReadonlyArrayNonEmpty(world.dareThings) ||
      !isHunting(world.phase) ||
      !isStill(world, slot)
    ) {
      return Option.none()
    }
    const level = levelOf(world)
    return Array.findFirst(world.dareThings, thing =>
      Option.map(
        Option.filter(maybeWorkSpot(world, level, thing), ({ spot, style }) =>
          isWorkingAt(world, slot, spot, style),
        ),
        ({ spot, style, workedMs }) => ({
          style,
          spot,
          share: Math.min(1, workedMs / FIND_RULES[style].workMs),
        }),
      ),
    )
  },
)

const workThing =
  (deltaMs: number, level: Level) =>
  (world: World, thing: DareThing): World =>
    Option.match(maybeWorkSpot(world, level, thing), {
      onNone: () => world,
      onSome: ({ spot, workedMs, style }) => {
        const workers = Array.filter(world.seats, ({ seat }) =>
          isWorkingAt(world, seat.slot, spot, style),
        )
        const worked = Array.match(workers, {
          onEmpty: () => Math.max(0, workedMs - deltaMs * DRAIN_SCALE),
          onNonEmpty: () => workedMs + deltaMs * workers.length,
        })
        return Option.match(
          Option.filter(
            Array.head(workers),
            () => worked >= FIND_RULES[style].workMs,
          ),
          {
            onNone: () =>
              worked === workedMs
                ? world
                : modifyWorldFields(world, {
                    dareThings: things =>
                      setThing(
                        things,
                        thing.id,
                        DareThingState.Hidden({ ...spot, workedMs: worked }),
                      ),
                  }),
            onSome: ({ seat }) =>
              modifyWorldFields(world, {
                dareThings: things =>
                  setThing(
                    things,
                    thing.id,
                    DareThingState.Found({ slot: seat.slot }),
                  ),
                frameEvents: events => [
                  ...events,
                  GameEvent.DareFound({ ...spot, kind: thing.kind }),
                ],
              }),
          },
        )
      },
    })

const workFinds = (world: World, deltaMs: number): World =>
  Array.reduce(world.dareThings, world, workThing(deltaMs, levelOf(world)))

export const advanceDare: {
  (deltaMs: number): (world: World) => World
  (world: World, deltaMs: number): World
} = Function.dual(2, (world: World, deltaMs: number): World =>
  Array.isReadonlyArrayNonEmpty(world.dareThings) && isHunting(world.phase)
    ? finishList(world, workFinds(forEachSeat(world, takeFor), deltaMs))
    : world,
)
