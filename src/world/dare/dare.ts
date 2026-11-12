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
  DareKind,
  type DareThing,
  DareThingState,
  Finale,
} from './dareSchema'
import { FIND_RULES, type FindStyle, findStyleOfRoom } from './finds'

// The dare (LORE.md, "What the dare asks for changes every run"): your
// friends' card asks you to bring things out of the house. One rule finds
// them all (owner, 2026-11-10): each room holds one thing. The list rolls
// as a campaign run starts, from the dare's own salted generator
// (`freshDare`): which rooms behind boards hold a thing, as many as the
// difficulty asks for, and which thing lies in each, any thing in any room
// (owner, 2026-11-10: "fully random"), on one of the room's hand-picked
// spots (roomSpotsOf in src/world/level/plan.ts).
// So the loop is the same for every thing: survive the waves, earn keys,
// open a room, find its thing in it. The list is only the rooms' things:
// Uncle Chunk is no slot on it, just the fight once it is done
// (src/world/dare/finale.ts).
//
// Each room finds its thing its own way (src/world/dare/finds.ts): a walk
// onto it, or work at it, a rummage, a hollow book, the dumbwaiter. Either
// way it is found for the whole crew; the seat only says who. The finale
// waits on `isDareListDone` and the DareListDone event.

// NOTE: how many things a list asks for, by difficulty
// (Dare, Double Dare, Triple Dare, Triple Dog Dare). The house has four
// rooms behind boards (the kitchen and the three slot rooms), so even
// Triple Dog Dare's list has a room of its own for each thing, and the
// dining room, where the run starts, holds none: a thing there would be
// found before the first wave. A list longer than the rooms behind boards
// (a test's level) spills into the rooms with none.
export const LIST_LENGTHS: Readonly<Record<Difficulty, number>> = {
  Easy: 2,
  Normal: 3,
  Hard: 3,
  Nightmare: 4,
}

type DareRules = Readonly<{ reachPx: number }>

const DARE_RULES: DareRules = { reachPx: 10 }

// THE ROOMS' THINGS

// NOTE: the things a room may still hold, in the Schema's order: any but
// those `taken`. Any of them may lie in any room (owner, 2026-11-10: "fully
// random"), so a room draws from all of them but those the list already
// holds, and a run's things never repeat.
const thingsLeft = (taken: ReadonlyArray<DareKind>): ReadonlyArray<DareKind> =>
  Array.filter(DareKind.literals, kind => !Array.contains(taken, kind))

// NOTE: a draw from the dare's stream as one of `items`.
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

// NOTE: the rooms a list may fill, in the order it fills them: the rooms
// behind boards shuffled, then those with none in the level's order, each
// with a hiding spot at least.
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
  taken: ReadonlyArray<DareKind>
}>

// NOTE: a room's thing, drawn from those left, on one of its hiding spots.
const placeIn = (
  placing: Placing,
  { hiding }: RoomSpots,
): Seeded<Option.Option<Readonly<{ kind: DareKind; point: Vector }>>> => {
  const [kindState, maybeKind] = drawOne(
    placing.state,
    thingsLeft(placing.taken),
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
): Readonly<{ dare: Dare; things: ReadonlyArray<DareThing> }> => {
  const level = levelOf(world)
  const [orderState, rooms] = roomOrder(world.dare.rngState, level)
  const chosen = Array.take(rooms, LIST_LENGTHS[world.difficulty.chosen])
  const [placing, placed] = Array.mapAccum(
    chosen,
    { state: orderState, taken: [] },
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

// NOTE: rolls the run's list and lays each thing in its room, as a run
// starts. Endless ("stay the night") has no list.
export const rollDare = <M extends World>(world: M): M => {
  if (!RunMode.isAnyOf(['Campaign'])(world.mode)) {
    return modifyWorldFields(world, {
      dare: current => ({ ...current, list: [] }),
      dareThings: () => [],
    })
  }
  const { dare, things } = rolledThings(world)
  return modifyWorldFields(world, {
    dare: () => dare,
    dareThings: () => things,
  })
}

// READING

const isFound = (thing: DareThing): boolean =>
  DareThingState.isAnyOf(['Found'])(thing.state)

// NOTE: whether the run has a list at all: a campaign run's, never Endless.
const hasDare = (world: World): boolean =>
  Array.isReadonlyArrayNonEmpty(world.dare.list)

// NOTE: every thing on the list found: the finale's cue.
export const isDareListDone = (world: World): boolean =>
  hasDare(world) && Array.every(world.dareThings, isFound)

// NOTE: how many things on the list the crew has found: each pays rank
// (src/world/heroes/rank.ts) and rides the run's summary.
export const dareItemsFoundOf = (world: World): number =>
  Array.filter(world.dareThings, isFound).length

// NOTE: the list in order with whether each is found yet: what the dare
// card draws, only the rooms' things.
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

// NOTE: a point in a room the crew can walk in: one with no exit, or one
// whose exit is open.
export const isInOpenRoom: {
  (point: Vector): (level: Level) => boolean
  (level: Level, point: Vector): boolean
} = Function.dual(2, (level: Level, point: Vector): boolean =>
  Array.some(level.rooms, room => room.isOpen && isInBox(point, room)),
)

// NOTE: the room a thing lies in, open or shut, by its id: what Rattles
// names in a hint (src/features/dare/rattlesHint.ts) and the boards the
// balance bot buys.
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

// NOTE: where a thing lies on the floor to be walked onto: a hidden one's
// spot in an open room.
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

// NOTE: the music box's spot while it still lies there, for its tune: pure
// flavor now, as each room's thing is found by opening the room.
export const maybeTuneSpot = (world: World): Option.Option<Vector> =>
  Array.findFirst(world.dareThings, ({ kind, state }) =>
    kind === 'MusicBox' && DareThingState.isAnyOf(['Hidden'])(state)
      ? Option.some({ x: state.x, y: state.y })
      : Option.none(),
  )

// THE STEP

const setThing = (
  things: ReadonlyArray<DareThing>,
  id: number,
  state: DareThingState,
): ReadonlyArray<DareThing> =>
  Array.map(things, thing => (thing.id === id ? { ...thing, state } : thing))

// NOTE: the find style of the room a thing lies in.
export const findStyleOf: {
  (level: Level): (thing: DareThing) => FindStyle
  (thing: DareThing, level: Level): FindStyle
} = Function.dual(2, (thing: DareThing, level: Level): FindStyle =>
  Option.match(maybeThingRoom(thing, level), {
    onNone: (): FindStyle => 'Walk',
    onSome: ({ id }) => findStyleOfRoom(id),
  }),
)

// NOTE: a lying thing found by walking onto it: a hidden one in an open
// room that finds its thing that way.
const maybeWalkOnto = (thing: DareThing, level: Level): Option.Option<Vector> =>
  Option.filter(
    maybeLyingAt(thing, level),
    () => FIND_RULES[findStyleOf(thing, level)].workMs <= 0,
  )

// NOTE: the first standing player in slot order on a thing found by
// walking finds it for the crew. The cellar's thing is found only while
// the bulb lights the cellar (src/world/cellar/bulb.ts).
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

// WORKED FINDS

// NOTE: a hidden thing in an open room whose room finds it by work, with
// the work it asks for, while its room says it can be worked.
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

// NOTE: a player at work on a room's find holds their fire, as at a
// station (src/world/step/simulation.ts).
export const isWorkingFind: {
  (slot: PlayerSlot): (world: World) => boolean
  (world: World, slot: PlayerSlot): boolean
} = Function.dual(2, (world: World, slot: PlayerSlot): boolean => {
  if (
    !Array.isReadonlyArrayNonEmpty(world.dareThings) ||
    !isHunting(world.phase)
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

// NOTE: one thing's work: each player at it adds their share, nobody at it
// drains it at half pace, and full, it is found by the first worker in
// slot order.
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

// NOTE: one tick of the dare: every standing player's walk onto a lying
// thing, the work at each room's find, then the list's end.
export const advanceDare: {
  (deltaMs: number): (world: World) => World
  (world: World, deltaMs: number): World
} = Function.dual(2, (world: World, deltaMs: number): World =>
  Array.isReadonlyArrayNonEmpty(world.dareThings) && isHunting(world.phase)
    ? finishList(world, workFinds(forEachSeat(world, takeFor), deltaMs))
    : world,
)
