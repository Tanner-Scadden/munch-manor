import { Array, Function, Option, Result, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { payShared } from '../party/party'
import type { World } from '../schema/world'
import {
  Frenzy,
  type FrenzyPack,
  GameEvent,
  type PlannedSpawn,
  type Zombie,
} from '../schema/worldSchema'
import { isFloorKind, isWalking } from './zombies'

// RULES

type FrenzyRules = {
  packMin: number
  paceScale: number
  togetherPx: number
  apartMs: number
  fadeMs: number
  bonusPerZombie: number
}

export const FRENZY_RULES: FrenzyRules = {
  packMin: 4,
  paceScale: 1.15,
  togetherPx: 40,
  apartMs: 900,
  fadeMs: 1000,
  bonusPerZombie: 1,
}

// PLANNING

const packOf = (spawn: PlannedSpawn): number => spawn.pack

// NOTE: a pack that comes up through the floor never comes in together, so
// only packs that walk in through a door can frenzy. A Big Leaguer's pack
// never frenzies either: his Groaners are there to be thrown.
export const frenzyPacksOf = (
  spawns: ReadonlyArray<PlannedSpawn>,
): ReadonlyArray<FrenzyPack> =>
  pipe(
    spawns,
    Array.filter(spawn => !isFloorKind(spawn.kind)),
    Array.map(packOf),
    Array.dedupe,
    Array.filter(
      pack =>
        !Array.some(
          spawns,
          spawn => spawn.pack === pack && spawn.kind === 'Thrower',
        ),
    ),
    Array.filterMap(pack => {
      const size = Array.filter(spawns, spawn => spawn.pack === pack).length
      return size >= FRENZY_RULES.packMin
        ? Result.succeed({
            pack,
            left: size,
            bonus: size * FRENZY_RULES.bonusPerZombie,
          })
        : Result.failVoid
    }),
  )

export const isFrenzyPack: {
  (pack: number): (frenzyPacks: ReadonlyArray<FrenzyPack>) => boolean
  (frenzyPacks: ReadonlyArray<FrenzyPack>, pack: number): boolean
} = Function.dual(
  2,
  (frenzyPacks: ReadonlyArray<FrenzyPack>, pack: number): boolean =>
    Array.some(frenzyPacks, entry => entry.pack === pack),
)

export const frenzyOnArrival: {
  (spawn: PlannedSpawn): (frenzyPacks: ReadonlyArray<FrenzyPack>) => Frenzy
  (frenzyPacks: ReadonlyArray<FrenzyPack>, spawn: PlannedSpawn): Frenzy
} = Function.dual(
  2,
  (frenzyPacks: ReadonlyArray<FrenzyPack>, spawn: PlannedSpawn): Frenzy =>
    isFrenzyPack(frenzyPacks, spawn.pack)
      ? Frenzy.Frenzied({ pack: spawn.pack, apartMs: 0 })
      : Frenzy.Calm(),
)

// PACE

export const isFrenzied = (zombie: Zombie): boolean =>
  Frenzy.isAnyOf(['Frenzied'])(zombie.frenzy)

export const frenzyPace = (zombie: Zombie): number =>
  Frenzy.match(zombie.frenzy, {
    Calm: () => 1,
    Frenzied: () => FRENZY_RULES.paceScale,
    Fading: ({ remainingMs }) =>
      1 +
      ((FRENZY_RULES.paceScale - 1) * remainingMs) /
        Math.max(1, FRENZY_RULES.fadeMs),
    Spent: () => 1,
  })

// TOGETHERNESS

const packIdOf = (zombie: Zombie): Option.Option<number> =>
  Frenzy.match(zombie.frenzy, {
    Calm: () => Option.none(),
    Frenzied: ({ pack }) => Option.some(pack),
    Fading: ({ pack }) => Option.some(pack),
    Spent: ({ pack }) => Option.some(pack),
  })

const hasPackmateNear = (
  zombie: Zombie,
  pack: number,
  zombies: ReadonlyArray<Zombie>,
): boolean =>
  Array.some(
    zombies,
    other =>
      other.id !== zombie.id &&
      isWalking(other) &&
      Frenzy.isAnyOf(['Frenzied'])(other.frenzy) &&
      other.frenzy.pack === pack &&
      Math.hypot(other.x - zombie.x, other.y - zombie.y) <=
        FRENZY_RULES.togetherPx,
  )

const nextFrenzy =
  (zombies: ReadonlyArray<Zombie>, deltaMs: number) =>
  (zombie: Zombie): Frenzy =>
    Frenzy.match(zombie.frenzy, {
      Calm: () => zombie.frenzy,
      Frenzied: ({ pack, apartMs }) => {
        if (hasPackmateNear(zombie, pack, zombies)) {
          return apartMs === 0
            ? zombie.frenzy
            : Frenzy.Frenzied({ pack, apartMs: 0 })
        } else if (apartMs + deltaMs < FRENZY_RULES.apartMs) {
          return Frenzy.Frenzied({ pack, apartMs: apartMs + deltaMs })
        } else {
          return Frenzy.Fading({ pack, remainingMs: FRENZY_RULES.fadeMs })
        }
      },
      Fading: ({ pack, remainingMs }) =>
        remainingMs > deltaMs
          ? Frenzy.Fading({ pack, remainingMs: remainingMs - deltaMs })
          : Frenzy.Spent({ pack }),
      Spent: () => zombie.frenzy,
    })

const hasAnyFrenzy = (zombies: ReadonlyArray<Zombie>): boolean =>
  Array.some(zombies, zombie =>
    Frenzy.isAnyOf(['Frenzied', 'Fading'])(zombie.frenzy),
  )

export const advanceFrenzy: {
  (deltaMs: number): (model: World) => World
  (model: World, deltaMs: number): World
} = Function.dual(2, (model: World, deltaMs: number): World =>
  hasAnyFrenzy(model.zombies)
    ? modifyFields(model, {
        zombies: zombies =>
          Array.map(zombies, zombie => {
            if (!isWalking(zombie)) {
              return zombie
            }
            const frenzy = nextFrenzy(zombies, deltaMs)(zombie)
            return frenzy === zombie.frenzy
              ? zombie
              : modifyFields(zombie, { frenzy: () => frenzy })
          }),
      })
    : model,
)

// BONUS

type Kill = Readonly<{ pack: number; x: number; y: number }>

const wasStanding = (before: ReadonlyArray<Zombie>, id: number): boolean =>
  Array.some(before, zombie => zombie.id === id && zombie.hp > 0)

const packKills = (
  before: ReadonlyArray<Zombie>,
  after: ReadonlyArray<Zombie>,
): ReadonlyArray<Kill> =>
  Array.filterMap(after, zombie =>
    zombie.hp <= 0 && wasStanding(before, zombie.id)
      ? Option.match(packIdOf(zombie), {
          onNone: () => Result.failVoid,
          onSome: pack => Result.succeed({ pack, x: zombie.x, y: zombie.y }),
        })
      : Result.failVoid,
  )

const tallyPack =
  (kills: ReadonlyArray<Kill>) =>
  (entry: FrenzyPack): FrenzyPack => {
    const killed = Array.filter(kills, kill => kill.pack === entry.pack).length
    return killed > 0
      ? modifyFields(entry, { left: left => Math.max(0, left - killed) })
      : entry
  }

const wipeEvent =
  (kills: ReadonlyArray<Kill>) =>
  (entry: FrenzyPack): Option.Option<GameEvent> =>
    Option.map(
      Array.findLast(kills, kill => kill.pack === entry.pack),
      ({ x, y }) => GameEvent.PackWiped({ x, y, bonus: entry.bonus }),
    )

export const payWipedPacks: {
  (after: World): (before: World) => World
  (before: World, after: World): World
} = Function.dual(2, (before: World, after: World): World => {
  if (Array.isReadonlyArrayEmpty(after.frenzyPacks)) {
    return after
  }

  const kills = packKills(before.zombies, after.zombies)
  if (Array.isReadonlyArrayEmpty(kills)) {
    return after
  }

  const [wiped, standing] = Array.partition(
    Array.map(after.frenzyPacks, tallyPack(kills)),
    entry => (entry.left <= 0 ? Result.succeed(entry) : Result.fail(entry)),
  )
  const bonus = Array.reduce(wiped, 0, (sum, entry) => sum + entry.bonus)
  const tallied = modifyFields(after, {
    frenzyPacks: () => standing,
    frameEvents: frameEvents => [
      ...frameEvents,
      ...Array.getSomes(Array.map(wiped, wipeEvent(kills))),
    ],
  })
  return bonus > 0 ? payShared(tallied, bonus) : tallied
})
