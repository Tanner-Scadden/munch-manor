import { Array, Function, Option, pipe } from 'effect'

import { UiStruct } from '@effect/ui'

import { shuffle } from '#shared/prng.ts'
import { giveWeapon } from '#world/fridge/leftovers.ts'
import { levelOf } from '#world/level/arena.ts'
import { atSeat, forEachSeat } from '#world/party/party.ts'
import { DIFFICULTY_ORDER } from '#world/run/difficulty.ts'
import type { World } from '#world/schema/world.ts'
import {
  type CasePrize,
  CaseState,
  type Difficulty,
  type DisplayCase,
  Feat,
  GameEvent,
  type PlayerSlot,
  Purchasable,
} from '#world/schema/worldSchema.ts'
import type { Offer } from '#world/shop/purchase.ts'

import { CASE_SPOTS, caseBoxOf, caseFootOf, isCaseShown } from './caseSpots.ts'
import { hasDone } from './feats.ts'

type CaseRules = Readonly<{ reachPx: number; tagLiftPx: number }>

const CASE_RULES: CaseRules = { reachPx: 10, tagLiftPx: 18 }

type FeatPick = Readonly<{
  feat: Feat
  from: Difficulty
}>

const COUNT_SCALE: Readonly<Record<Difficulty, number>> = {
  Easy: 0.75,
  Normal: 1,
  Hard: 1.25,
  Nightmare: 1.5,
}

const NEAR_FEATS: Array.NonEmptyReadonlyArray<FeatPick> = [
  { feat: Feat.Kills({ count: 20 }), from: 'Easy' },
  { feat: Feat.KillsWith({ armament: 'Pistol', count: 15 }), from: 'Easy' },
  { feat: Feat.KillsWith({ armament: 'Knife', count: 3 }), from: 'Easy' },
  { feat: Feat.KillsOf({ kind: 'Runner', count: 5 }), from: 'Easy' },
  { feat: Feat.Streak({ count: 6 }), from: 'Easy' },
  { feat: Feat.OpenedRoom({ count: 1 }), from: 'Easy' },
  { feat: Feat.NoHitWave({ count: 1 }), from: 'Normal' },
]

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
    KitchenKills: () => feat,
    KitchenStandKills: () => feat,
  })

const rankOf = (difficulty: Difficulty): number =>
  DIFFICULTY_ORDER.indexOf(difficulty)

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

const NEAR_PRIZES: Array.NonEmptyReadonlyArray<CasePrize> = [
  'Shotgun',
  'Smg',
  'Blunderbuss',
  'LaserSight',
]

const FAR_PRIZES: Array.NonEmptyReadonlyArray<CasePrize> = ['Rifle']

const CASES_SEED_SALT = 0xca5e5eed

export const rollCases: {
  (difficulty: Difficulty): (seed: number) => ReadonlyArray<DisplayCase>
  (seed: number, difficulty: Difficulty): ReadonlyArray<DisplayCase>
} = Function.dual(
  2,
  (seed: number, difficulty: Difficulty): ReadonlyArray<DisplayCase> => {
    const start = (seed ^ CASES_SEED_SALT) >>> 0
    const nearSpots = Array.filter(CASE_SPOTS, spot => spot.isNear)
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
    let nearPlace = 0
    let farPlace = 0
    return Array.map(CASE_SPOTS, (spot, index): DisplayCase => {
      const pool = spot.isNear ? draws.near : draws.far
      const prizes = spot.isNear ? nearPrizes : farPrizes
      const place = spot.isNear ? nearPlace++ : farPlace++
      return {
        id: index,
        spot: index,
        prize: Option.getOrElse(
          Array.get(prizes, place % prizes.length),
          () => prizes[0],
        ),
        feat: Option.getOrElse(
          Array.get(pool, place % pool.length),
          () => pool[0],
        ),
        state: CaseState.Locked(),
      }
    })
  },
)

const openCaseFor: {
  (displayCase: DisplayCase, slot: PlayerSlot): (world: World) => World
  (world: World, displayCase: DisplayCase, slot: PlayerSlot): World
} = Function.dual(
  3,
  (world: World, displayCase: DisplayCase, slot: PlayerSlot): World => {
    const foot = caseFootOf(levelOf(world), displayCase)
    return UiStruct.evolve(world, {
      cases: cases =>
        Array.map(cases, current =>
          current.id === displayCase.id
            ? UiStruct.evolve(current, {
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
  },
)

const tryOpen = (world: World, slot: PlayerSlot): World =>
  Array.reduce(world.cases, world, (current, displayCase) =>
    CaseState.isAnyOf(['Locked'])(displayCase.state) &&
    isCaseShown(levelOf(current), displayCase) &&
    hasDone(current, slot, displayCase.feat)
      ? openCaseFor(current, displayCase, slot)
      : current,
  )

export const advanceCases = (world: World): World =>
  Array.some(world.cases, ({ state }) => CaseState.isAnyOf(['Locked'])(state))
    ? forEachSeat(world, tryOpen)
    : world

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
      const box = caseBoxOf(levelOf(world), displayCase)
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
    ? UiStruct.evolve(world, {
        seats: atSeat(slot, { laserSight: () => 'Fitted' }),
      })
    : UiStruct.evolve(world, {
        seats: atSeat(slot, { player: player => giveWeapon(player, prize) }),
      })

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
        const foot = caseFootOf(levelOf(world), displayCase)
        return UiStruct.evolve(givePrize(world, slot, displayCase.prize), {
          cases: cases =>
            Array.map(cases, current =>
              current.id === id
                ? UiStruct.evolve(current, {
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
