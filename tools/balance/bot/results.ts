// What a run of the balance bot reports, as Schemas: the campaign run's
// RunResult and a wave run's WaveRun, with the logs inside them.
// simulate.ts's workers write them as JSON and the main process decodes
// them back with these Schemas, so a worker's result reads exactly as one
// played in process. Nothing here has a hole or an undefined that JSON
// would turn into something else: a shop visit is an entry of its own, not
// a slot in a list by wave.

import { Schema } from 'effect'

import { ZombieKind } from '../../../src/app/model'

const ByKind = Schema.Record(ZombieKind, Schema.Finite)
// NOTE: a number by name: a count, or a share of a batch.
export const Counts = Schema.Record(Schema.String, Schema.Finite)

// What the bot pulled from the Mystery Leftovers fridge and what it did
// with the fridge weapons: lids thrown and popped, Pan swings and the ones
// that connected, sprays, and frozen zombies shattered.
export const FridgeLog = Schema.Struct({
  pulls: Schema.Finite,
  firstPullWave: Schema.Finite,
  prizes: Counts,
  lids: Schema.Finite,
  pops: Schema.Finite,
  swings: Schema.Finite,
  clangs: Schema.Finite,
  sprays: Schema.Finite,
  shatters: Schema.Finite,
  // The fridge weapon carried when the run ended, or 'None'.
  endedWith: Schema.String,
  // Weapons taken from the fridge, and the knife's stabs and hits.
  taken: Schema.Finite,
  stabs: Schema.Finite,
  stabHits: Schema.Finite,
  // Refills bought at the ammo window mid-wave.
  counterBuys: Schema.Finite,
})
export type FridgeLog = typeof FridgeLog.Type

// What the Big Leaguer, the Ankle Biter, and frenzied packs did in a run.
export const NewKindLog = Schema.Struct({
  throws: Schema.Finite,
  shields: Schema.Finite,
  throwHits: Schema.Finite,
  grabs: Schema.Finite,
  surfaced: Schema.Finite,
  frenzies: Schema.Finite,
  wipes: Schema.Finite,
  wipeBonus: Schema.Finite,
  heartsWhileClung: Schema.Finite,
})
export type NewKindLog = typeof NewKindLog.Type

export const BossBlame = Schema.Literals(['Stomp', 'Charge', 'Glob', 'Bite'])
export type BossBlame = typeof BossBlame.Type

// Each boss wave the run reached: whether the boss walked in, whether it
// fell, how long it stood, and whether the run ended while it stood.
export const BossFight = Schema.Struct({
  wave: Schema.Finite,
  arrived: Schema.Boolean,
  felled: Schema.Boolean,
  fightMs: Schema.Finite,
  diedToIt: Schema.Boolean,
  stomps: Schema.Finite,
  stompHits: Schema.Finite,
  belches: Schema.Finite,
  charges: Schema.Finite,
  chargeHits: Schema.Finite,
  bonks: Schema.Finite,
  spits: Schema.Finite,
  spitHits: Schema.Finite,
  enraged: Schema.Boolean,
  heartsLost: Schema.Finite,
  heartsByAttack: Schema.Record(BossBlame, Schema.Finite),
  damageTaken: Schema.Finite,
  aimedMs: Schema.Finite,
})
export type BossFight = typeof BossFight.Type

// The timeline of one wave in wall time from its start: every pack as it
// walks in, and the stretches with no zombie alive. A stretch is announced
// while a warned pack still waits at its door or the dinner bell rings.
const PackArrival = Schema.Struct({
  atMs: Schema.Finite,
  pack: Schema.Finite,
  door: Schema.String,
  size: Schema.Finite,
  kinds: Schema.Array(Schema.String),
  formation: Schema.String,
})

export const EmptyStretch = Schema.Struct({
  fromMs: Schema.Finite,
  ms: Schema.Finite,
  announcedMs: Schema.Finite,
})
export type EmptyStretch = typeof EmptyStretch.Type

export const WaveTimeline = Schema.Struct({
  packs: Schema.Array(PackArrival),
  empty: Schema.Array(EmptyStretch),
  restMs: Schema.Array(Schema.Finite),
  lengthMs: Schema.Finite,
})
export type WaveTimeline = typeof WaveTimeline.Type

// Per wave: hearts lost, seconds with 6 or more zombies within 48 px
// (pressure), seconds with none alive (relax), seconds with none alive,
// none announced, and spawns still to come (quiet, the dead air the pacing
// rules forbid) and its longest stretch, its length, and the most alive at
// once.
export const WaveLog = Schema.Struct({
  heartsLost: Schema.Finite,
  pressureMs: Schema.Finite,
  relaxMs: Schema.Finite,
  quietMs: Schema.Finite,
  quietRunMs: Schema.Finite,
  longestQuietMs: Schema.Finite,
  lengthMs: Schema.Finite,
  peakAlive: Schema.Finite,
})
export type WaveLog = typeof WaveLog.Type

// A break the bot found the shop open in: the wave it came before, the
// money it arrived with, and what it bought, in order.
export const ShopVisit = Schema.Struct({
  wave: Schema.Finite,
  money: Schema.Finite,
  bought: Schema.Array(Schema.String),
})
export type ShopVisit = typeof ShopVisit.Type

export const RunResult = Schema.Struct({
  seed: Schema.Finite,
  cleared: Schema.Finite,
  killedBy: Schema.optional(ZombieKind),
  victory: Schema.Boolean,
  runMs: Schema.Finite,
  moneyAfterWave: Schema.Array(Schema.Finite),
  hurtBy: ByKind,
  maxAlive: Schema.Finite,
  pistolTier: Schema.Finite,
  spareTier: Schema.Finite,
  upgradeSpend: Schema.Finite,
  minHp: Schema.Finite,
  waves: Schema.Array(WaveLog),
  shopVisits: Schema.Array(ShopVisit),
  gnomesPlaced: Schema.Finite,
  dropped: Counts,
  grabbed: Counts,
  boostedMs: Schema.Finite,
  waveMs: Schema.Finite,
  timelines: Schema.Array(WaveTimeline),
  boss: Schema.Array(BossFight),
  newKinds: NewKindLog,
  // The wave whose break the kitchen was bought in, or 0 when it never was.
  kitchenWave: Schema.Finite,
  fridge: FridgeLog,
})
export type RunResult = typeof RunResult.Type

export const RunResults = Schema.Array(RunResult)

export const WaveOutcome = Schema.Literals(['Cleared', 'Died', 'TimedOut'])
export type WaveOutcome = typeof WaveOutcome.Type

export const WaveRun = Schema.Struct({
  wave: Schema.Finite,
  snapshotSeed: Schema.Finite,
  waveSeed: Schema.Finite,
  outcome: WaveOutcome,
  heartsLost: Schema.Finite,
  lengthMs: Schema.Finite,
  emptyMs: Schema.Finite,
  quietMs: Schema.Finite,
  longestQuietMs: Schema.Finite,
  pressureMs: Schema.Finite,
  peakAlive: Schema.Finite,
  killedBy: Schema.optional(ZombieKind),
  hurtBy: ByKind,
  // NOTE: the boss fight on a boss wave, for the wave pass's boss lines.
  boss: Schema.optional(BossFight),
})
export type WaveRun = typeof WaveRun.Type

export const WaveRuns = Schema.Array(WaveRun)
