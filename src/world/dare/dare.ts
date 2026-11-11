import { Array, Function, Option } from 'effect'

import { type Difficulty } from '../../shared/playerData'
import { type Seeded, nextRandom, shuffle } from '../../shared/prng'
import { type Level, type Room, levelOf, tileCenter } from '../level/arena'
import {
  CELLAR_ROOM_ID,
  DINING_ROOM_ID,
  KITCHEN_ROOM_ID,
  LIBRARY_ROOM_ID,
  type LevelSpec,
  PARLOUR_ROOM_ID,
  type RoomSpots,
  roomSpotsOf,
} from '../level/plan'
import { focusOf, forEachSeat, isStanding, seatStateAt } from '../party/party'
import { type World, modifyWorldFields } from '../schema/world'
import {
  GameEvent,
  Phase,
  type PlayerSlot,
  RunMode,
  type Vector,
} from '../schema/worldSchema'
import { clamp, distanceBetween } from '../step/geometry'
import {
  type Dare,
  DareKind,
  type DareThing,
  DareThingState,
  Finale,
} from './dareSchema'

// The dare (LORE.md, "What the dare asks for changes every run"): your
// friends' card asks you to bring things out of the house. One rule finds
// them all (owner, 2026-11-10): each room holds one thing. The list rolls
// as a campaign run starts, from the dare's own salted generator
// (`freshDare`): which rooms behind boards hold a thing, as many as the
// difficulty asks for, and which of the room's own things lies there (the
// recipe in the kitchen, the guest book's page in the library), on one of
// the room's hand-picked spots (roomSpotsOf in src/world/level/plan.ts).
// So the loop is the same for every thing: survive the waves, earn keys,
// open a room, find its thing in it. Uncle Chunk's party hat always closes
// the list, from the finale (src/world/dare/finale.ts).
//
// Walking onto a thing finds it for the whole crew; the seat that touched
// it only says who. The finale waits on `isDareListDone` and the
// DareListDone event.

export const LAST_THING: DareKind = 'PartyHat'

// NOTE: how many things a list asks for before the hat, by difficulty
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

type DareRules = Readonly<{ reachPx: number; dropInsetPx: number }>

const DARE_RULES: DareRules = { reachPx: 10, dropInsetPx: 8 }

// THE ROOMS' THINGS

// NOTE: the things each room may hold, the likeliest fit first: Grandma's
// recipe, the silver spoon, or the butler's bell in the kitchen, the music
// box or the family portrait in the parlour, the guest book's page or the
// portrait in the library, the bell or the spoon in the cellar. Every pair
// of rooms keeps a thing of its own, so a run's things never repeat.
const ROOM_THINGS: Readonly<Record<string, ReadonlyArray<DareKind>>> = {
  [KITCHEN_ROOM_ID]: ['GrandmasRecipe', 'SilverSpoon', 'ButlersBell'],
  [PARLOUR_ROOM_ID]: ['MusicBox', 'FamilyPortrait'],
  [LIBRARY_ROOM_ID]: ['GuestBookPage', 'FamilyPortrait'],
  [CELLAR_ROOM_ID]: ['ButlersBell', 'SilverSpoon'],
  [DINING_ROOM_ID]: ['SilverSpoon', 'FamilyPortrait'],
}

// NOTE: every thing a room can hold, in the Schema's order, the hat aside:
// a room's own fall back on these once its own are taken.
const ROLLABLE_KINDS: ReadonlyArray<DareKind> = Array.filter(
  DareKind.literals,
  kind => kind !== LAST_THING,
)

// NOTE: a room's things, its own first, then any other, none of `taken`.
const thingsFor = (
  room: string,
  taken: ReadonlyArray<DareKind>,
): ReadonlyArray<DareKind> => {
  const own = Array.filter(
    ROOM_THINGS[room] ?? [],
    kind => !Array.contains(taken, kind),
  )
  return Array.isReadonlyArrayNonEmpty(own)
    ? own
    : Array.filter(ROLLABLE_KINDS, kind => !Array.contains(taken, kind))
}

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

// NOTE: a room's thing, drawn from its own, on one of its hiding spots.
const placeIn = (
  placing: Placing,
  { room, hiding }: RoomSpots,
): Seeded<Option.Option<Readonly<{ kind: DareKind; point: Vector }>>> => {
  const [kindState, maybeKind] = drawOne(
    placing.state,
    thingsFor(room, placing.taken),
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
      state: DareThingState.Hidden(point),
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

// NOTE: the list's things, the hat aside: the hat is in the house only
// once Uncle Chunk drops it (src/world/dare/finale.ts).
const listThings = (world: World): ReadonlyArray<DareThing> =>
  Array.filter(world.dareThings, ({ kind }) => kind !== LAST_THING)

const maybeHat = (world: World): Option.Option<DareThing> =>
  Array.findFirst(world.dareThings, ({ kind }) => kind === LAST_THING)

// NOTE: every thing on the list found, the hat aside: the finale's cue.
export const isDareListDone = (world: World): boolean =>
  hasDare(world) && Array.every(listThings(world), isFound)

// NOTE: how many things on the list the crew has found, the hat aside:
// each pays rank (src/world/heroes/rank.ts) and rides the run's summary.
export const dareItemsFoundOf = (world: World): number =>
  Array.filter(listThings(world), isFound).length

// NOTE: whether Uncle Chunk has dropped his hat yet, and whether a player
// has taken it.
export const isHatDropped = (world: World): boolean =>
  Option.isSome(maybeHat(world))

export const isHatFound = (world: World): boolean =>
  Option.exists(maybeHat(world), isFound)

// NOTE: the list in order with whether each is found yet, the hat last,
// found once a player takes it from Uncle Chunk. What the dare card draws.
export const dareCardOf = (
  world: World,
): ReadonlyArray<Readonly<{ kind: DareKind; isFound: boolean }>> =>
  hasDare(world)
    ? [
        ...Array.map(world.dare.list, kind => ({
          kind,
          isFound: Array.some(
            listThings(world),
            thing => thing.kind === kind && isFound(thing),
          ),
        })),
        { kind: LAST_THING, isFound: isHatFound(world) },
      ]
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
// spot in an open room, or where Uncle Chunk dropped his hat.
export const maybeLyingAt: {
  (level: Level): (thing: DareThing) => Option.Option<Vector>
  (thing: DareThing, level: Level): Option.Option<Vector>
} = Function.dual(2, (thing: DareThing, level: Level): Option.Option<Vector> =>
  DareThingState.matchOrElse(
    thing.state,
    {
      Hidden: ({ x, y }): Option.Option<Vector> =>
        isInOpenRoom(level, { x, y }) ? Option.some({ x, y }) : Option.none(),
      Dropped: ({ x, y }): Option.Option<Vector> => Option.some({ x, y }),
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

const insideBounds = (level: Level, point: Vector): Vector => ({
  x: clamp(
    point.x,
    level.bounds.left + DARE_RULES.dropInsetPx,
    level.bounds.right - DARE_RULES.dropInsetPx,
  ),
  y: clamp(
    point.y,
    level.bounds.top + DARE_RULES.dropInsetPx,
    level.bounds.bottom - DARE_RULES.dropInsetPx,
  ),
})

// NOTE: Uncle Chunk's party hat falls where he does, on the list, for the
// first standing player to walk onto it. Its id follows the house's things.
export const dropHat: {
  (at: Vector): (world: World) => World
  (world: World, at: Vector): World
} = Function.dual(2, (world: World, at: Vector): World => {
  const spot = insideBounds(levelOf(world), at)
  const hat: DareThing = {
    id:
      Array.reduce(world.dareThings, -1, (largest, { id }) =>
        Math.max(largest, id),
      ) + 1,
    kind: LAST_THING,
    state: DareThingState.Dropped(spot),
  }
  return modifyWorldFields(world, {
    dareThings: Array.append(hat),
    frameEvents: events => [
      ...events,
      GameEvent.DareDropped({ ...spot, kind: hat.kind }),
    ],
  })
})

// NOTE: the first standing player in slot order on a lying thing finds it
// for the crew.
const takeFor = (world: World, slot: PlayerSlot): World => {
  const { seat, player } = seatStateAt(world, slot)
  if (!isStanding(seat)) {
    return world
  }
  const level = levelOf(world)
  return Array.reduce(world.dareThings, world, (current, thing) =>
    Option.match(maybeLyingAt(thing, level), {
      onNone: () => current,
      onSome: spot =>
        distanceBetween(player, spot) <= DARE_RULES.reachPx
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

// NOTE: one tick of the dare: every standing player's walk onto a lying
// thing, then the list's end.
export const advanceDare = (world: World): World =>
  Array.isReadonlyArrayNonEmpty(world.dareThings) && isHunting(world.phase)
    ? finishList(world, forEachSeat(world, takeFor))
    : world
