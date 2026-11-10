import { Array, Function, Option, Record, Result, pipe } from 'effect'

import { type Difficulty } from '../../shared/playerData'
import { type Seeded, nextRandom, shuffle } from '../../shared/prng'
import { type Level, type Tile, levelOf, tileCenter } from '../level/arena'
import { focusOf, forEachSeat, isStanding, seatStateAt } from '../party/party'
import { type World, modifyWorldFields } from '../schema/world'
import {
  GameEvent,
  Phase,
  type PlayerSlot,
  RunMode,
  type Vector,
  type Zombie,
  ZombieState,
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
// friends' card asks you to bring things out of the house, and each thing in
// the pool comes back to you its own way. The list rolls as a campaign run
// starts, from the dare's own salted generator (`freshDare`), sized by the
// difficulty, and Uncle Chunk's party hat always closes it. A couple of the
// pool's other things are in the house too, off the list: a player can pick
// one up and carry it, for the display cases to take.
//
// Walking onto a thing the dare asked for finds it for the whole crew; the
// seat that touched it only says who. The finale (Uncle Chunk at the front
// door) waits on `isDareListDone` and the DareListDone event.

// WAYS

// NOTE: how each thing comes back to you. Hidden things sit in one of a
// few hand-picked spots; the marked zombie carries his and drops it when he
// goes down; behind the boards is a spot in a room not open yet; the music
// box sits in a spot and plays its tune. A case's page opens with a feat and
// the recipe cooks at the stove, so neither rolls until the display cases
// and the stove's recipe are built. The hat comes with the finale.
export type DareWay =
  | 'Hidden'
  | 'Marked'
  | 'BehindBoards'
  | 'Heard'
  | 'InCase'
  | 'Cooked'
  | 'Finale'

export const DARE_WAYS: Readonly<Record<DareKind, DareWay>> = {
  SilverSpoon: 'Hidden',
  FamilyPortrait: 'Marked',
  GuestBookPage: 'InCase',
  GrandmasRecipe: 'Cooked',
  MusicBox: 'Heard',
  ButlersBell: 'BehindBoards',
  PartyHat: 'Finale',
}

const ROLLABLE_WAYS: ReadonlyArray<DareWay> = [
  'Hidden',
  'Marked',
  'BehindBoards',
  'Heard',
]

const isRollable = (kind: DareKind): boolean =>
  Array.contains(ROLLABLE_WAYS, DARE_WAYS[kind])

// NOTE: the pool a list rolls from, in the Schema's order so a seed always
// rolls the same list.
const ROLLABLE_KINDS: ReadonlyArray<DareKind> = Array.filter(
  DareKind.literals,
  isRollable,
)

export const LAST_THING: DareKind = 'PartyHat'

// NOTE: how many things a list asks for before the hat, by difficulty
// (Dare, Double Dare, Triple Dare, Triple Dog Dare).
export const LIST_LENGTHS: Readonly<Record<Difficulty, number>> = {
  Easy: 2,
  Normal: 3,
  Hard: 3,
  Nightmare: 4,
}

type DareRules = Readonly<{
  reachPx: number
  deliverReachPx: number
  offListCount: number
  markFromWave: number
  dropInsetPx: number
}>

const DARE_RULES: DareRules = {
  reachPx: 10,
  deliverReachPx: 14,
  offListCount: 2,
  markFromWave: 2,
  dropInsetPx: 8,
}

// SPOTS

// NOTE: the hand-picked spots by room id, as tiles of the room's own map
// (src/world/level/plan.ts): floor tiles beside its furniture. The dining
// room's, the start room's, are the draft's marks 1 to 4 (by the sideboard,
// the west cabinet, the table's east end, and the east door's cabinet); the
// parlour's are by the sofa, the trunk, the crates, the bookshelf, and the
// piano; the kitchen's under the prep table, by the sacks, and by the
// pantry. A room built later adds its own.
const HIDING_SPOTS: Readonly<Record<string, ReadonlyArray<Tile>>> = {
  Dining: [
    { column: 14, row: 3 },
    { column: 4, row: 7 },
    { column: 27, row: 9 },
    { column: 34, row: 19 },
  ],
  Parlour: [
    { column: 15, row: 13 },
    { column: 12, row: 14 },
    { column: 22, row: 16 },
    { column: 28, row: 3 },
    { column: 2, row: 4 },
  ],
  Kitchen: [
    { column: 9, row: 9 },
    { column: 17, row: 5 },
    { column: 2, row: 10 },
    { column: 5, row: 4 },
  ],
}

type Spot = Readonly<{ point: Vector; isBehindBoards: boolean }>

const spotsByLevel = new WeakMap<Level, ReadonlyArray<Spot>>()

// NOTE: every spot of the level's rooms in world pixels, each room's tiles
// placed by its origin on the plan; a room behind an exit is behind boards.
export const spotsOf = (level: Level): ReadonlyArray<Spot> => {
  const cached = spotsByLevel.get(level)
  if (cached !== undefined) {
    return cached
  }
  const spots = Array.flatMap(level.spec.rooms, room =>
    Array.map(
      Option.getOrElse(Record.get(HIDING_SPOTS, room.id), () => []),
      ({ column, row }): Spot => ({
        point: tileCenter({
          column: room.origin.column + column,
          row: room.origin.row + row,
        }),
        isBehindBoards: Option.isSome(room.maybeExit),
      }),
    ),
  )
  spotsByLevel.set(level, spots)
  return spots
}

// NOTE: a point in a room the crew can walk in: one with no exit, or one
// whose exit is open.
export const isInOpenRoom: {
  (point: Vector): (level: Level) => boolean
  (level: Level, point: Vector): boolean
} = Function.dual(2, (level: Level, point: Vector): boolean =>
  Array.some(
    level.rooms,
    ({ box, isOpen }) =>
      isOpen &&
      point.x >= box.left &&
      point.x < box.right &&
      point.y >= box.top &&
      point.y < box.bottom,
  ),
)

// ROLLING

type Placing = Readonly<{
  state: number
  free: ReadonlyArray<Spot>
}>

const drawSpot = (
  placing: Placing,
  wantsBoards: boolean,
  start: Vector,
): Seeded<Readonly<{ free: ReadonlyArray<Spot>; point: Vector }>> => {
  const draw = nextRandom(placing.state)
  const fitting = Array.filter(
    placing.free,
    ({ isBehindBoards }) => !wantsBoards || isBehindBoards,
  )
  const pool = Array.isReadonlyArrayNonEmpty(fitting) ? fitting : placing.free
  return Option.match(Array.get(pool, Math.floor(draw.value * pool.length)), {
    onNone: () => [draw.nextState, { free: placing.free, point: start }],
    onSome: spot => [
      draw.nextState,
      {
        free: Array.filter(placing.free, other => other !== spot),
        point: spot.point,
      },
    ],
  })
}

const placeThing = (
  placing: Placing,
  kind: DareKind,
  start: Vector,
): Seeded<Readonly<{ free: ReadonlyArray<Spot>; state: DareThingState }>> => {
  const way = DARE_WAYS[kind]
  if (way === 'Marked') {
    return [
      placing.state,
      { free: placing.free, state: DareThingState.Marked() },
    ]
  }
  const [state, { free, point }] = drawSpot(
    placing,
    way === 'BehindBoards',
    start,
  )
  return [state, { free, state: DareThingState.Hidden(point) }]
}

// NOTE: the list before the hat: the pool shuffled, the first `length` of
// it, and on Triple Dare the marked zombie's thing always among them.
const rollList = (
  state: number,
  difficulty: Difficulty,
): Seeded<
  Readonly<{ asked: ReadonlyArray<DareKind>; rest: ReadonlyArray<DareKind> }>
> => {
  const [nextState, order] = Array.match(ROLLABLE_KINDS, {
    onEmpty: (): Seeded<ReadonlyArray<DareKind>> => [state, []],
    onNonEmpty: kinds => shuffle(state, kinds),
  })
  const length = LIST_LENGTHS[difficulty]
  const ordered =
    difficulty === 'Hard'
      ? Array.prepend(
          Array.filter(order, kind => DARE_WAYS[kind] !== 'Marked'),
          'FamilyPortrait' as const,
        )
      : order
  return [
    nextState,
    { asked: Array.take(ordered, length), rest: Array.drop(ordered, length) },
  ]
}

const rolledThings = (
  world: World,
): Readonly<{ dare: Dare; things: ReadonlyArray<DareThing> }> => {
  const level = levelOf(world)
  const [listState, { asked, rest }] = rollList(
    world.dare.rngState,
    world.difficulty.chosen,
  )
  const offList = Array.take(rest, DARE_RULES.offListCount)
  const wanted = [
    ...Array.map(asked, kind => ({ kind, isAsked: true })),
    ...Array.map(offList, kind => ({ kind, isAsked: false })),
  ]
  const [placing, things] = Array.mapAccum(
    wanted,
    { state: listState, free: spotsOf(level) },
    (
      current: Placing,
      { kind, isAsked },
      index,
    ): readonly [Placing, DareThing] => {
      const [state, placed] = placeThing(current, kind, level.start)
      return [
        { state, free: placed.free },
        { id: index, kind, isAsked, state: placed.state },
      ]
    },
  )
  return {
    dare: { rngState: placing.state, list: asked, finale: Finale.Hunting() },
    things,
  }
}

// NOTE: rolls the run's list and puts its things in the house, as a run
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

// NOTE: the things the list asked for, the hat aside: the hat is in the
// house only once Uncle Chunk drops it (src/world/dare/finale.ts).
const askedThings = (world: World): ReadonlyArray<DareThing> =>
  Array.filter(
    world.dareThings,
    ({ isAsked, kind }) => isAsked && kind !== LAST_THING,
  )

const maybeHat = (world: World): Option.Option<DareThing> =>
  Array.findFirst(world.dareThings, ({ kind }) => kind === LAST_THING)

// NOTE: every thing on the list found, the hat aside: the finale's cue.
export const isDareListDone = (world: World): boolean =>
  hasDare(world) && Array.every(askedThings(world), isFound)

// NOTE: how many things on the list the crew has found, the hat aside:
// each pays rank (src/world/heroes/rank.ts) and rides the run's summary.
export const dareItemsFoundOf = (world: World): number =>
  Array.filter(askedThings(world), isFound).length

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
            askedThings(world),
            thing => thing.kind === kind && isFound(thing),
          ),
        })),
        { kind: LAST_THING, isFound: isHatFound(world) },
      ]
    : []

// NOTE: the things a seat has in hand, off the list.
export const heldBy: {
  (slot: PlayerSlot): (world: World) => ReadonlyArray<DareThing>
  (world: World, slot: PlayerSlot): ReadonlyArray<DareThing>
} = Function.dual(
  2,
  (world: World, slot: PlayerSlot): ReadonlyArray<DareThing> =>
    Array.filter(
      world.dareThings,
      ({ state }) =>
        DareThingState.isAnyOf(['Held'])(state) && state.slot === slot,
    ),
)

// NOTE: where a thing lies on the floor to be walked onto: a hidden one's
// spot in an open room, or where its carrier fell.
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

// NOTE: the music box's spot while it still sits there, for its tune.
export const maybeTuneSpot = (world: World): Option.Option<Vector> =>
  pipe(
    world.dareThings,
    Array.findFirst(
      ({ kind, state }) =>
        DARE_WAYS[kind] === 'Heard' &&
        DareThingState.isAnyOf(['Hidden'])(state),
    ),
    Option.flatMap(({ state }) =>
      DareThingState.isAnyOf(['Hidden'])(state)
        ? Option.some({ x: state.x, y: state.y })
        : Option.none(),
    ),
  )

// NOTE: the zombie wearing the mark, by id, if one wears it now.
const markedZombieIds = (world: World): ReadonlyArray<number> =>
  Array.filterMap(world.dareThings, ({ state }) =>
    DareThingState.isAnyOf(['Carried'])(state)
      ? Result.succeed(state.zombieId)
      : Result.failVoid,
  )

// THE STEP

const setThing = (
  things: ReadonlyArray<DareThing>,
  id: number,
  state: DareThingState,
): ReadonlyArray<DareThing> =>
  Array.map(things, thing => (thing.id === id ? { ...thing, state } : thing))

const CARRIER_KINDS: ReadonlyArray<Zombie['kind']> = [
  'Shambler',
  'Runner',
  'Tank',
]

const isCarrierFor =
  (level: Level, taken: ReadonlyArray<number>): ((zombie: Zombie) => boolean) =>
  zombie =>
    Array.contains(CARRIER_KINDS, zombie.kind) &&
    ZombieState.isAnyOf(['Walking'])(zombie.state) &&
    !Array.contains(taken, zombie.id) &&
    isInOpenRoom(level, zombie)

const markFromWave = (world: World): boolean =>
  Phase.isAnyOf(['Wave'])(world.phase) &&
  world.phase.wave >= DARE_RULES.markFromWave

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

const dropAt = (world: World, thing: DareThing, spot: Vector): World =>
  modifyWorldFields(world, {
    dareThings: things =>
      setThing(things, thing.id, DareThingState.Dropped(spot)),
    frameEvents: events => [
      ...events,
      GameEvent.DareDropped({ ...spot, kind: thing.kind }),
    ],
  })

// NOTE: Uncle Chunk's party hat falls where he does, on the list, for the
// first standing player to walk onto it. Its id follows the house's things.
export const dropHat: {
  (at: Vector): (world: World) => World
  (world: World, at: Vector): World
} = Function.dual(2, (world: World, at: Vector): World => {
  const hat: DareThing = {
    id:
      Array.reduce(world.dareThings, -1, (largest, { id }) =>
        Math.max(largest, id),
      ) + 1,
    kind: LAST_THING,
    isAsked: true,
    state: DareThingState.Marked(),
  }
  return dropAt(
    modifyWorldFields(world, { dareThings: Array.append(hat) }),
    hat,
    insideBounds(levelOf(world), at),
  )
})

// NOTE: the marked thing finds a carrier once a wave from the second is on
// and a zombie that can wear it walks in a room; he drops it where he falls,
// and a carrier gone with no fall leaves it marked for the next.
const carryMarked = (world: World): World => {
  const level = levelOf(world)
  return Array.reduce(world.dareThings, world, (current, thing) =>
    DareThingState.matchOrElse(
      thing.state,
      {
        Marked: (): World =>
          markFromWave(current)
            ? Option.match(
                Array.findFirst(
                  current.zombies,
                  isCarrierFor(level, markedZombieIds(current)),
                ),
                {
                  onNone: () => current,
                  onSome: zombie =>
                    modifyWorldFields(current, {
                      dareThings: things =>
                        setThing(
                          things,
                          thing.id,
                          DareThingState.Carried({ zombieId: zombie.id }),
                        ),
                    }),
                },
              )
            : current,
        Carried: ({ zombieId }): World =>
          Option.match(
            Array.findFirst(current.zombies, ({ id }) => id === zombieId),
            {
              onNone: () =>
                modifyWorldFields(current, {
                  dareThings: things =>
                    setThing(things, thing.id, DareThingState.Marked()),
                }),
              onSome: zombie =>
                ZombieState.isAnyOf(['Dying'])(zombie.state)
                  ? dropAt(current, thing, insideBounds(level, zombie))
                  : current,
            },
          ),
      },
      (): World => current,
    ),
  )
}

// NOTE: the first standing player in slot order on a lying thing takes it:
// one on the list is found for the crew, one off it goes in that seat's hand.
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
                setThing(
                  things,
                  thing.id,
                  thing.isAsked
                    ? DareThingState.Found({ slot })
                    : DareThingState.Held({ slot }),
                ),
              frameEvents: events => [
                ...events,
                thing.isAsked
                  ? GameEvent.DareFound({ ...spot, kind: thing.kind })
                  : GameEvent.DareTaken({ ...spot, kind: thing.kind }),
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

// NOTE: one tick of the dare: the marked thing's carrier, then every
// standing player's walk onto a lying thing, then the list's end.
export const advanceDare = (world: World): World =>
  Array.isReadonlyArrayNonEmpty(world.dareThings) && isHunting(world.phase)
    ? finishList(world, forEachSeat(carryMarked(world), takeFor))
    : world

// DELIVERING

// NOTE: the display cases' hook: a seat standing within reach of `point`
// with a thing off the list in hand delivers it there (the first it took),
// and the DareDelivered event says what and by whom. Out of reach, or with
// nothing in hand, nothing changes.
export const deliverHeld: {
  (slot: PlayerSlot, point: Vector): (world: World) => World
  (world: World, slot: PlayerSlot, point: Vector): World
} = Function.dual(3, (world: World, slot: PlayerSlot, point: Vector): World => {
  const { seat, player } = seatStateAt(world, slot)
  return isStanding(seat) &&
    distanceBetween(player, point) <= DARE_RULES.deliverReachPx
    ? Option.match(Array.head(heldBy(world, slot)), {
        onNone: () => world,
        onSome: thing =>
          modifyWorldFields(world, {
            dareThings: things =>
              setThing(things, thing.id, DareThingState.Delivered({ slot })),
            frameEvents: events => [
              ...events,
              GameEvent.DareDelivered({
                x: point.x,
                y: point.y,
                kind: thing.kind,
                slot,
              }),
            ],
          }),
      })
    : world
})
