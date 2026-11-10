import { Array, Function, Option, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { giveWeapon } from '../fridge/leftovers'
import {
  type Box,
  type Level,
  type Tile,
  levelOf,
  tileBox,
} from '../level/arena'
import { atSeat, forEachSeat } from '../party/party'
import { DIFFICULTY_ORDER } from '../run/difficulty'
import type { World } from '../schema/world'
import {
  type CasePrize,
  CaseState,
  type Difficulty,
  type DisplayCase,
  Feat,
  GameEvent,
  type PlayerSlot,
  Purchasable,
  type Vector,
} from '../schema/worldSchema'
import type { Offer } from '../shop/purchase'
import { shuffle } from '../waves/wavePacks'
import { hasDone } from './feats'

// Display cases (owner, 2026-11-10, "No shop" in GAME_DESIGN.md): the guns
// and the Laser Sight sit locked in cases about the house, each opened by a
// feat (src/world/feats/feats.ts). Each run rolls which prize and which feat
// go in which case, from its own generator, the easier feats in the cases
// nearer the start and on the easier difficulties. A case in a room still
// boarded shut waits for the room. When a player finishes its feat (the
// first in slot order, if two finish on one tick) it springs open for them
// alone, and they take the prize by the same stand or hold as the fridge's
// (src/world/shop/purchase.ts). A gun from a case arrives fresh, at tier 0
// with no kills, and levels on its own kills (src/world/gear/gunLevels.ts).

// THE SPOTS

// NOTE: how a case looks: a gun rack on the wall, a glass display case, or
// a trophy case. Only the drawing reads it.
export type CaseLook = 'Rack' | 'Glass' | 'Trophy'

// NOTE: `isNear` spots sit by the start and draw from the easier pool. A
// spot is the run of tiles a room's map marks for it (`cc`), left to right.
export type CaseSpot = Readonly<{
  tiles: Array.NonEmptyReadonlyArray<Tile>
  room: string
  look: CaseLook
  isNear: boolean
}>

// NOTE: floor tiles against a wall, clear of the doors, Rattles, the fridge,
// the pantry, and the valve: the dining room's three (docs/ROOM_DRAFTS.md),
// where every run starts, by the North door and on the west and east walls,
// then one in each room behind boards, the parlour's south west corner (its
// map's first `cc`, in the west slot) and the kitchen's west wall.
export const CASE_SPOTS: Array.NonEmptyReadonlyArray<CaseSpot> = [
  {
    tiles: [
      { column: 30, row: 2 },
      { column: 31, row: 2 },
    ],
    room: 'Dining',
    look: 'Rack',
    isNear: true,
  },
  {
    tiles: [
      { column: 1, row: 15 },
      { column: 2, row: 15 },
    ],
    room: 'Dining',
    look: 'Glass',
    isNear: true,
  },
  {
    tiles: [
      { column: 33, row: 15 },
      { column: 34, row: 15 },
    ],
    room: 'Dining',
    look: 'Rack',
    isNear: true,
  },
  {
    tiles: [
      { column: -31, row: 20 },
      { column: -30, row: 20 },
    ],
    room: 'Parlour',
    look: 'Glass',
    isNear: false,
  },
  {
    tiles: [{ column: 1, row: -5 }],
    room: 'Kitchen',
    look: 'Trophy',
    isNear: false,
  },
]

type CaseRules = Readonly<{ reachPx: number; tagLiftPx: number }>

const CASE_RULES: CaseRules = { reachPx: 10, tagLiftPx: 18 }

const spotOf = (displayCase: DisplayCase): CaseSpot =>
  Option.getOrElse(Array.get(CASE_SPOTS, displayCase.spot), () =>
    Array.headNonEmpty(CASE_SPOTS),
  )

export const caseBoxOf = (displayCase: DisplayCase): Box => {
  const { tiles } = spotOf(displayCase)
  const first = tileBox(Array.headNonEmpty(tiles))
  const last = tileBox(Array.lastNonEmpty(tiles))
  return { ...first, right: last.right }
}

export const caseLookOf = (displayCase: DisplayCase): CaseLook =>
  spotOf(displayCase).look

// NOTE: the floor point a case stands on, the middle of its tile's bottom.
export const caseFootOf = (displayCase: DisplayCase): Vector => {
  const box = caseBoxOf(displayCase)
  return { x: (box.left + box.right) / 2, y: box.bottom }
}

// NOTE: a case counts once its room is open.
export const isCaseShown: {
  (displayCase: DisplayCase): (level: Level) => boolean
  (level: Level, displayCase: DisplayCase): boolean
} = Function.dual(2, (level: Level, displayCase: DisplayCase): boolean =>
  Array.some(
    level.rooms,
    ({ id, isOpen }) => id === spotOf(displayCase).room && isOpen,
  ),
)

// THE ROLL

type FeatPick = Readonly<{
  feat: Feat
  from: Difficulty
}>

// NOTE: kill counts and streaks grow with the difficulty; a feat done once
// (a clean wave, a room, the fire) stays one.
const COUNT_SCALE: Readonly<Record<Difficulty, number>> = {
  Easy: 0.75,
  Normal: 1,
  Hard: 1.25,
  Nightmare: 1.5,
}

// NOTE: the feats a case by the start may ask, and from which difficulty.
const NEAR_FEATS: Array.NonEmptyReadonlyArray<FeatPick> = [
  { feat: Feat.Kills({ count: 20 }), from: 'Easy' },
  { feat: Feat.KillsWith({ armament: 'Pistol', count: 15 }), from: 'Easy' },
  { feat: Feat.KillsWith({ armament: 'Knife', count: 3 }), from: 'Easy' },
  { feat: Feat.KillsOf({ kind: 'Runner', count: 5 }), from: 'Easy' },
  { feat: Feat.Streak({ count: 6 }), from: 'Easy' },
  { feat: Feat.OpenedRoom({ count: 1 }), from: 'Easy' },
  { feat: Feat.NoHitWave({ count: 1 }), from: 'Normal' },
]

// NOTE: the feats a case further in may ask.
const FAR_FEATS: Array.NonEmptyReadonlyArray<FeatPick> = [
  { feat: Feat.Kills({ count: 50 }), from: 'Easy' },
  { feat: Feat.KillsOf({ kind: 'Exploder', count: 4 }), from: 'Easy' },
  { feat: Feat.OwnBlast({ count: 3 }), from: 'Easy' },
  { feat: Feat.LitFire(), from: 'Easy' },
  { feat: Feat.KillsOf({ kind: 'Tank', count: 2 }), from: 'Normal' },
  { feat: Feat.Streak({ count: 12 }), from: 'Normal' },
  { feat: Feat.KillsWith({ armament: 'Knife', count: 8 }), from: 'Hard' },
  { feat: Feat.NoHitWave({ count: 2 }), from: 'Hard' },
]

const scaled = (count: number, difficulty: Difficulty): number =>
  Math.max(1, Math.round(count * COUNT_SCALE[difficulty]))

const scaleFeat = (feat: Feat, difficulty: Difficulty): Feat =>
  Feat.match(feat, {
    Kills: ({ count }) => Feat.Kills({ count: scaled(count, difficulty) }),
    KillsWith: ({ armament, count }) =>
      Feat.KillsWith({ armament, count: scaled(count, difficulty) }),
    KillsOf: ({ kind, count }) =>
      Feat.KillsOf({ kind, count: scaled(count, difficulty) }),
    NoHitWave: () => feat,
    Streak: ({ count }) => Feat.Streak({ count: scaled(count, difficulty) }),
    OwnBlast: ({ count }) =>
      Feat.OwnBlast({ count: scaled(count, difficulty) }),
    OpenedRoom: () => feat,
    LitFire: () => feat,
    KeyFromMarked: () => feat,
    Delivered: () => feat,
    KitchenKills: () => feat,
    KitchenStandKills: () => feat,
  })

const rankOf = (difficulty: Difficulty): number =>
  DIFFICULTY_ORDER.indexOf(difficulty)

// NOTE: a pool's feats for a difficulty; each pool's first feat is open
// from Easy, so none is ever empty.
const poolFor = (
  pool: Array.NonEmptyReadonlyArray<FeatPick>,
  difficulty: Difficulty,
): Array.NonEmptyReadonlyArray<Feat> =>
  Array.map(
    Array.prepend(
      Array.filter(
        Array.tailNonEmpty(pool),
        ({ from }) => rankOf(from) <= rankOf(difficulty),
      ),
      Array.headNonEmpty(pool),
    ),
    ({ feat }) => scaleFeat(feat, difficulty),
  )

// NOTE: the prizes the near cases draw from; the one left over joins Old
// Thunder, which only ever sits in a case further in, behind a harder feat.
const NEAR_PRIZES: Array.NonEmptyReadonlyArray<CasePrize> = [
  'Shotgun',
  'Smg',
  'Blunderbuss',
  'LaserSight',
]

const FAR_PRIZES: Array.NonEmptyReadonlyArray<CasePrize> = ['Rifle']

const CASES_SEED_SALT = 0xca5e5eed

// NOTE: a run's cases, from its seed through their own salted generator,
// so the roll moves no other. The near spots take the near prizes in a
// shuffled order and the far ones the far prizes with whatever the near
// spots left; the near spots take distinct feats from the near pool in
// turn, the far ones from the far pool. Each prize sits in one case.
export const rollCases: {
  (difficulty: Difficulty): (seed: number) => ReadonlyArray<DisplayCase>
  (seed: number, difficulty: Difficulty): ReadonlyArray<DisplayCase>
} = Function.dual(
  2,
  (seed: number, difficulty: Difficulty): ReadonlyArray<DisplayCase> => {
    const start = (seed ^ CASES_SEED_SALT) >>> 0
    const nearSpots = Array.filter(CASE_SPOTS, spot => spot.isNear)
    const farSpots = Array.filter(CASE_SPOTS, spot => !spot.isNear)
    const [nearPrizeState, nearPrizes] = shuffle(start, NEAR_PRIZES)
    const [prizeState, farPrizes] = shuffle(
      nearPrizeState,
      Array.appendAll(FAR_PRIZES, Array.drop(nearPrizes, nearSpots.length)),
    )
    const [nearState, near] = shuffle(
      prizeState,
      poolFor(NEAR_FEATS, difficulty),
    )
    const [, far] = shuffle(nearState, poolFor(FAR_FEATS, difficulty))
    const draws = { near, far }
    return Array.map(CASE_SPOTS, (spot, index): DisplayCase => {
      const pool = spot.isNear ? draws.near : draws.far
      const prizes = spot.isNear ? nearPrizes : farPrizes
      const place = spot.isNear
        ? nearSpots.indexOf(spot)
        : farSpots.indexOf(spot)
      return {
        id: index,
        spot: index,
        prize: Option.getOrElse(Array.get(prizes, place), () => prizes[0]),
        feat: Option.getOrElse(
          Array.get(pool, place % pool.length),
          () => pool[0],
        ),
        state: CaseState.Locked(),
      }
    })
  },
)

// OPENING

const openFor = (
  world: World,
  displayCase: DisplayCase,
  slot: PlayerSlot,
): World => {
  const foot = caseFootOf(displayCase)
  return modifyFields(world, {
    cases: cases =>
      Array.map(cases, current =>
        current.id === displayCase.id
          ? modifyFields(current, {
              state: () => CaseState.Opened({ by: slot }),
            })
          : current,
      ),
    frameEvents: frameEvents => [
      ...frameEvents,
      GameEvent.CaseOpened({
        x: foot.x,
        y: foot.y,
        prize: displayCase.prize,
        opener: slot,
      }),
    ],
  })
}

const tryOpen = (world: World, slot: PlayerSlot): World =>
  Array.reduce(world.cases, world, (current, displayCase) =>
    CaseState.isAnyOf(['Locked'])(displayCase.state) &&
    isCaseShown(levelOf(current), displayCase) &&
    hasDone(current, slot, displayCase.feat)
      ? openFor(current, displayCase, slot)
      : current,
  )

// NOTE: one tick of the cases: each locked case in an open room opens for
// the first seat, in slot order, that has done its feat.
export const advanceCases = (world: World): World =>
  Array.some(world.cases, ({ state }) => CaseState.isAnyOf(['Locked'])(state))
    ? forEachSeat(world, tryOpen)
    : world

// TAKING

const isOpenedFor = (displayCase: DisplayCase, slot: PlayerSlot): boolean =>
  CaseState.isAnyOf(['Opened'])(displayCase.state) &&
  displayCase.state.by === slot

export const caseOffers: {
  (slot: PlayerSlot): (world: World) => ReadonlyArray<Offer>
  (world: World, slot: PlayerSlot): ReadonlyArray<Offer>
} = Function.dual(2, (world: World, slot: PlayerSlot): ReadonlyArray<Offer> =>
  pipe(
    world.cases,
    Array.filter(
      displayCase =>
        isOpenedFor(displayCase, slot) &&
        isCaseShown(levelOf(world), displayCase),
    ),
    Array.map(displayCase => {
      const box = caseBoxOf(displayCase)
      return {
        target: Purchasable.Case({ id: displayCase.id }),
        price: 0,
        box,
        reachPx: CASE_RULES.reachPx,
        isFull: false,
        spot: {
          x: Math.round((box.left + box.right) / 2),
          y: box.bottom - CASE_RULES.tagLiftPx,
        },
      }
    }),
  ),
)

const givePrize = (world: World, slot: PlayerSlot, prize: CasePrize): World =>
  prize === 'LaserSight'
    ? modifyFields(world, {
        seats: atSeat(slot, { laserSight: () => 'Fitted' }),
      })
    : modifyFields(world, {
        seats: atSeat(slot, { player: player => giveWeapon(player, prize) }),
      })

// NOTE: the opener takes what the case held, and the case stands empty.
export const takeCase: {
  (slot: PlayerSlot, id: number): (world: World) => Option.Option<World>
  (world: World, slot: PlayerSlot, id: number): Option.Option<World>
} = Function.dual(
  3,
  (world: World, slot: PlayerSlot, id: number): Option.Option<World> =>
    pipe(
      Array.findFirst(world.cases, displayCase => displayCase.id === id),
      Option.filter(displayCase => isOpenedFor(displayCase, slot)),
      Option.map(displayCase => {
        const foot = caseFootOf(displayCase)
        return modifyFields(givePrize(world, slot, displayCase.prize), {
          cases: cases =>
            Array.map(cases, current =>
              current.id === id
                ? modifyFields(current, {
                    state: () => CaseState.Emptied({ by: slot }),
                  })
                : current,
            ),
          frameEvents: frameEvents => [
            ...frameEvents,
            GameEvent.PrizeTaken({ x: foot.x, y: foot.y }),
          ],
        })
      }),
    ),
)
