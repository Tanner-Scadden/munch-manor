import {
  Array,
  Console,
  Effect,
  Function,
  Number,
  Option,
  type Record,
  String,
} from 'effect'

import type {
  Difficulty,
  Hold,
  PlannedSpawn,
  ZombieKind,
} from '../../src/app/model'
import { tierForKills } from '../../src/world/gear/gunLevels'
import { UPGRADE_TIERS, WEAPONS } from '../../src/world/gear/weapons'
import { KEY_RULES, keyOddsOf } from '../../src/world/keys/keys'
import {
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  toughenSpawns,
} from '../../src/world/run/difficulty'
import { rollWave } from '../../src/world/waves/endlessWaves'
import { STRAGGLER_KINDS } from '../../src/world/waves/pacing'
import { FINAL_WAVE } from '../../src/world/waves/wavePlans'
import { bossHp, hasBoss } from '../../src/world/zombies/boss'
import { BOSS_RULES } from '../../src/world/zombies/bossRules'
import { frenzyPacksOf } from '../../src/world/zombies/frenzy'
import {
  ZOMBIE_KINDS,
  ZOMBIE_KIND_ORDER,
  scaledHp,
} from '../../src/world/zombies/zombies'
import { ASSUMPTIONS, type Assumptions } from './modelAssumptions'
import {
  type Arrival,
  type FlowBoss,
  type Incoming,
  type WaveFlow,
  flowRules,
  flowWave,
} from './modelFlow'
import {
  type Gun,
  type SpareGun,
  gunStats,
  sustainedDps,
  timeToKill,
} from './modelGuns'
import {
  CATALOG,
  type Catalog,
  type Loadout,
  type Purchase,
  STARTING_LOADOUT,
  type Visit,
  shopVisit,
  withPurchase,
} from './modelShop'
import { mean } from './summary'

export const withKills: {
  (kills: number): (loadout: Loadout) => Loadout
  (loadout: Loadout, kills: number): Loadout
} = Function.dual(2, (loadout: Loadout, kills: number): Loadout =>
  Option.match(loadout.maybeSpare, {
    onNone: () => {
      const pistolKills = loadout.pistolKills + kills
      return {
        ...loadout,
        pistolKills,
        pistolTier: tierForKills('Pistol', pistolKills),
      }
    },
    onSome: spare => ({
      ...loadout,
      maybeSpare: Option.some({
        ...spare,
        kills: spare.kills + kills,
        tier: tierForKills(spare.kind, spare.kills + kills),
      }),
    }),
  }),
)

export const heldGun = (
  loadout: Loadout,
): Readonly<{ gun: Gun; tier: number }> =>
  Option.match(loadout.maybeSpare, {
    onNone: () => ({ gun: 'Pistol', tier: loadout.pistolTier }),
    onSome: ({ kind, tier }) => ({ gun: kind, tier }),
  })

export const loadoutDps: {
  (assumptions: Assumptions): (loadout: Loadout) => number
  (loadout: Loadout, assumptions: Assumptions): number
} = Function.dual(2, (loadout: Loadout, assumptions: Assumptions): number => {
  const { gun, tier } = heldGun(loadout)
  const gnome = WEAPONS.Peashooter
  return (
    sustainedDps(gunStats(gun, tier), assumptions.hitShare[gun]) +
    loadout.gnomes *
      ((gnome.damage * assumptions.gnomeHitShare * 1000) / gnome.fireIntervalMs)
  )
})

export type RolledWave = Readonly<{
  spawns: ReadonlyArray<PlannedSpawn>
  holds: ReadonlyArray<Hold>
  boss: FlowBoss
}>

export const rolledWave: {
  (wave: number, difficulty: Difficulty): (seed: number) => RolledWave
  (seed: number, wave: number, difficulty: Difficulty): RolledWave
} = Function.dual(
  3,
  (seed: number, wave: number, difficulty: Difficulty): RolledWave => {
    const [, rolled] = rollWave(seed, wave)
    const spawns = toughenSpawns(difficulty, rolled.spawns)
    return {
      spawns,
      holds: rolled.holds,
      boss: hasBoss(wave)
        ? {
            _tag: 'Waiting',
            waitBelow: Math.round(
              spawns.length * (1 - BOSS_RULES.arriveAfterShare),
            ),
            hp: bossHp(difficulty, spawns),
          }
        : { _tag: 'Absent' },
    }
  },
)

export const spawnHp = (spawn: PlannedSpawn): number =>
  scaledHp(ZOMBIE_KINDS[spawn.kind].hp, spawn.hpScale)

const arrivalOf = (
  spawn: PlannedSpawn,
  spawns: ReadonlyArray<PlannedSpawn>,
): Arrival =>
  Array.contains(STRAGGLER_KINDS, spawn.kind) &&
  Array.filter(spawns, ({ pack }) => pack === spawn.pack).length === 1
    ? 'Straggler'
    : 'Pack'

const incomingOf = (rolled: RolledWave): ReadonlyArray<Incoming> =>
  Array.map(rolled.spawns, spawn => ({
    atMs: spawn.atMs,
    hp: spawnHp(spawn),
    arrival: arrivalOf(spawn, rolled.spawns),
  }))

export const wavePay: {
  (wave: number): (rolled: RolledWave) => number
  (rolled: RolledWave, wave: number): number
} = Function.dual(
  2,
  (rolled: RolledWave, _wave: number): number =>
    Number.sumAll(Array.map(rolled.spawns, ({ kind }) => keyOddsOf(kind))) +
    (rolled.boss._tag === 'Waiting' ? keyOddsOf('Boss') : 0) +
    frenzyPacksOf(rolled.spawns).length * KEY_RULES.perPackWiped +
    KEY_RULES.perWaveCleared,
)

export type WaveRow = Readonly<{
  wave: number
  difficulty: Difficulty
  zombies: number
  totalHp: number
  pay: number
  moneyOnArrival: number
  bought: ReadonlyArray<Purchase>
  loadout: Loadout
  dps: number
  lengthSeconds: number
  emptySeconds: number
  peakAlive: number
  meanIncomingHps: number
  peakIncomingHps: number
  peakRatio: number
  meanRatio: number
}>

export type Economy = Readonly<{
  visits: ReadonlyArray<Visit>
  pays: ReadonlyArray<number>
}>

export type WaveTake = Readonly<{ pay: number; kills: number }>

const FIRST_VISIT: Visit = {
  moneyOnArrival: 0,
  bought: [],
  spent: 0,
  moneyAfter: 0,
  loadout: STARTING_LOADOUT,
}

const FIRST_UPKEEP_WAVE = 3

export const upkeepFor: {
  (assumptions: Assumptions): (wave: number) => number
  (wave: number, assumptions: Assumptions): number
} = Function.dual(2, (wave: number, assumptions: Assumptions): number =>
  wave >= FIRST_UPKEEP_WAVE ? assumptions.upkeepPerVisit : 0,
)

export const economy: {
  (
    takes: ReadonlyArray<WaveTake>,
    assumptions: Assumptions,
  ): (catalog: Catalog) => Economy
  (
    catalog: Catalog,
    takes: ReadonlyArray<WaveTake>,
    assumptions: Assumptions,
  ): Economy
} = Function.dual(
  3,
  (
    catalog: Catalog,
    takes: ReadonlyArray<WaveTake>,
    assumptions: Assumptions,
  ): Economy => {
    const withCaseGun = (loadout: Loadout, wave: number): Loadout =>
      wave >= assumptions.caseGunWave && Option.isNone(loadout.maybeSpare)
        ? withPurchase(loadout, 'Smg')
        : loadout
    const visits = Array.scan(
      Array.map(
        Array.take(takes, Math.max(0, takes.length - 1)),
        (take, index) => ({
          take,
          wave: index + 2,
        }),
      ),
      FIRST_VISIT,
      (previous: Visit, { take, wave }): Visit =>
        shopVisit(
          catalog,
          previous.moneyAfter + take.pay,
          withCaseGun(withKills(previous.loadout, take.kills), wave),
          upkeepFor(wave, assumptions),
          assumptions.reserve,
        ),
    )
    return { visits, pays: Array.map(takes, ({ pay }) => pay) }
  },
)

const waveNumbers = (lastWave: number): Array.NonEmptyReadonlyArray<number> =>
  Array.makeBy(Math.max(1, lastWave), index => index + 1)

export const expectedPays: {
  (lastWave: number): (assumptions: Assumptions) => ReadonlyArray<number>
  (assumptions: Assumptions, lastWave: number): ReadonlyArray<number>
} = Function.dual(
  2,
  (assumptions: Assumptions, lastWave: number): ReadonlyArray<number> =>
    Array.map(waveNumbers(lastWave), wave =>
      mean(
        Array.map(assumptions.seeds, seed =>
          wavePay(rolledWave(seed, wave, 'Normal'), wave),
        ),
      ),
    ),
)

const expectedKills = (
  assumptions: Assumptions,
  lastWave: number,
  difficulty: Difficulty,
): ReadonlyArray<number> =>
  Array.map(waveNumbers(lastWave), wave =>
    mean(
      Array.map(assumptions.seeds, seed => {
        const { spawns, boss } = rolledWave(seed, wave, difficulty)
        return spawns.length + (boss._tag === 'Waiting' ? 1 : 0)
      }),
    ),
  )

const modelRows = (
  difficulty: Difficulty,
  assumptions: Assumptions = ASSUMPTIONS,
  lastWave: number = FINAL_WAVE,
): ReadonlyArray<WaveRow> => {
  const pays = expectedPays(assumptions, lastWave)
  const kills = expectedKills(assumptions, lastWave, difficulty)
  const { visits } = economy(
    CATALOG,
    Array.map(pays, (pay, index) => ({
      pay,
      kills: Option.getOrElse(Array.get(kills, index), () => 0),
    })),
    assumptions,
  )
  const rules = flowRules(assumptions)
  return Array.map(waveNumbers(lastWave), wave => {
    const visit = Option.getOrElse(
      Array.get(visits, wave - 1),
      () => FIRST_VISIT,
    )
    const dps = loadoutDps(visit.loadout, assumptions)
    const rolls = Array.map(assumptions.seeds, seed =>
      rolledWave(seed, wave, difficulty),
    )
    const flows = Array.map(rolls, rolled =>
      flowWave(
        incomingOf(rolled),
        rolled.holds,
        rolled.boss,
        dps,
        rules,
        assumptions.peakWindowMs,
      ),
    )
    const flowMean = (pick: (flow: WaveFlow) => number) =>
      mean(Array.map(flows, pick))
    const peakIncomingHps = flowMean(flow => flow.peakIncomingHps)
    const meanIncomingHps = flowMean(flow => flow.meanIncomingHps)
    return {
      wave,
      difficulty,
      zombies: mean(
        Array.map(
          rolls,
          ({ spawns, boss }) =>
            spawns.length + (boss._tag === 'Waiting' ? 1 : 0),
        ),
      ),
      totalHp: flowMean(({ totalHp }) => totalHp),
      pay: Option.getOrElse(Array.get(pays, wave - 1), () => 0),
      moneyOnArrival: visit.moneyOnArrival,
      bought: visit.bought,
      loadout: visit.loadout,
      dps,
      lengthSeconds: flowMean(({ lengthMs }) => lengthMs) / 1000,
      emptySeconds: flowMean(({ emptyMs }) => emptyMs) / 1000,
      peakAlive: flowMean(({ peakAlive }) => peakAlive),
      meanIncomingHps,
      peakIncomingHps,
      peakRatio: dps > 0 ? peakIncomingHps / dps : 0,
      meanRatio: dps > 0 ? meanIncomingHps / dps : 0,
    }
  })
}

export type BalanceModel = Readonly<Record<Difficulty, ReadonlyArray<WaveRow>>>

export const balanceModel = (
  assumptions: Assumptions = ASSUMPTIONS,
): BalanceModel => ({
  Easy: modelRows('Easy', assumptions),
  Normal: modelRows('Normal', assumptions),
  Hard: modelRows('Hard', assumptions),
  Nightmare: modelRows('Nightmare', assumptions),
})

export type KillTime = Readonly<{
  kind: ZombieKind
  hp: number
  seconds: Readonly<Record<Gun, number>>
}>

const KILL_TIME_KINDS: ReadonlyArray<ZombieKind> = [
  ...ZOMBIE_KIND_ORDER,
  'Boss',
]

const killTimes = (
  difficulty: Difficulty,
  tierOf: (gun: Gun) => number,
  assumptions: Assumptions = ASSUMPTIONS,
): ReadonlyArray<KillTime> =>
  Array.map(KILL_TIME_KINDS, kind => {
    const hp = scaledHp(
      ZOMBIE_KINDS[kind].hp,
      DIFFICULTIES[difficulty].healthScale,
    )
    const seconds = (gun: Gun) =>
      timeToKill(hp, gunStats(gun, tierOf(gun)), assumptions.hitShare[gun])
    return {
      kind,
      hp,
      seconds: {
        Pistol: seconds('Pistol'),
        Shotgun: seconds('Shotgun'),
        Smg: seconds('Smg'),
      },
    }
  })

export const maxTierOf = (gun: Gun): number => UPGRADE_TIERS[gun].length

export type Prices = Readonly<{
  earned: number
  fullKit: Readonly<Record<SpareGun, number>>
}>

export const moneyAgainstPrices = (): Prices => {
  const kit = (gun: SpareGun) =>
    CATALOG.gunPrice[gun] +
    CATALOG.plankLimit * CATALOG.plankPrice +
    CATALOG.gnomeLimit * CATALOG.gnomePrice +
    CATALOG.kitchenPrice
  return {
    earned: Number.sumAll(expectedPays(ASSUMPTIONS, FINAL_WAVE)),
    fullKit: { Shotgun: kit('Shotgun'), Smg: kit('Smg') },
  }
}

const fixed = (value: number, digits: number, width: number): string =>
  String.padStart(width)(value.toFixed(digits))

export const loadoutLabel = (loadout: Loadout): string =>
  Array.join(
    Array.filter(
      [
        Option.match(loadout.maybeSpare, {
          onNone: () => 'pistol',
          onSome: ({ kind, tier }) => `${String.toLowerCase(kind)} t${tier}`,
        }),
        loadout.pistolTier > 0 ? `pistol t${loadout.pistolTier}` : '',
        loadout.gnomes > 0 ? `${loadout.gnomes} gnome` : '',
        loadout.planks > 0 ? `${loadout.planks} plank` : '',
        loadout.hasKitchen ? 'kitchen' : '',
      ],
      part => part !== '',
    ),
    ', ',
  )

export const formatRows = (rows: ReadonlyArray<WaveRow>): string =>
  Array.join(
    [
      'Wave  zombies  total hp  $ arrive  loadout                              dps  length s  empty s  peak alive  in hp/s mean  peak  peak/dps',
      ...Array.map(
        rows,
        row =>
          `${fixed(row.wave, 0, 4)}  ${fixed(row.zombies, 1, 7)}  ${fixed(row.totalHp, 0, 8)}  ${fixed(row.moneyOnArrival, 0, 8)}  ${String.padEnd(35)(loadoutLabel(row.loadout))}  ${fixed(row.dps, 2, 5)}  ${fixed(row.lengthSeconds, 0, 8)}  ${fixed(row.emptySeconds, 1, 7)}  ${fixed(row.peakAlive, 1, 10)}  ${fixed(row.meanIncomingHps, 2, 12)}  ${fixed(row.peakIncomingHps, 2, 4)}  ${fixed(row.peakRatio, 2, 8)}`,
      ),
    ],
    '\n',
  )

export const formatKillTimes = (times: ReadonlyArray<KillTime>): string =>
  Array.join(
    [
      'Kind       hp  pistol s  shotgun s  smg s',
      ...Array.map(
        times,
        ({ kind, hp, seconds }) =>
          `${String.padEnd(9)(kind)} ${fixed(hp, 0, 3)}  ${fixed(seconds.Pistol, 2, 8)}  ${fixed(seconds.Shotgun, 2, 9)}  ${fixed(seconds.Smg, 2, 5)}`,
      ),
    ],
    '\n',
  )

export const formatModel = (model: BalanceModel): string => {
  const prices = moneyAgainstPrices()
  return Array.join(
    [
      ...Array.flatMap(DIFFICULTY_ORDER, difficulty => [
        `${difficulty}`,
        formatRows(model[difficulty]),
        '',
      ]),
      'Seconds to kill one zombie on Normal, tier 0',
      formatKillTimes(killTimes('Normal', () => 0)),
      '',
      'Seconds to kill one zombie on Normal, every gun at its top tier',
      formatKillTimes(killTimes('Normal', maxTierOf)),
      '',
      `Keys: a full campaign drops about ${prices.earned.toFixed(0)}. The kitchen costs ${CATALOG.kitchenPrice}; guns come from cases and traps from crates.`,
    ],
    '\n',
  )
}

if (import.meta.main === true) {
  Effect.runSync(Console.log(formatModel(balanceModel())))
}
