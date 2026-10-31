// What a run of the balance bot reports, as Schemas: the campaign run's
// RunResult and a wave run's WaveRun, with the logs inside them.
// simulate.ts's workers write them as JSON and the main process decodes
// them back with these Schemas, so a worker's result reads exactly as one
// played in process. Nothing here has a hole or an undefined that JSON
// would turn into something else: a shop visit is an entry of its own, not
// a slot in a list by wave.

import { Schema } from 'effect'

import { ZombieKind } from '../../../src/model'

const ByKind = Schema.Record(ZombieKind, Schema.Number)
// NOTE: a number by name: a count, or a share of a batch.
export const Counts = Schema.Record(Schema.String, Schema.Number)

// What the bot pulled from the Mystery Leftovers fridge and what it did
// with the fridge weapons: lids thrown and popped, Pan swings and the ones
// that connected, sprays, and frozen zombies shattered.
export const FridgeLog = Schema.Struct({
  pulls: Schema.Number,
  firstPullWave: Schema.Number,
  prizes: Counts,
  lids: Schema.Number,
  pops: Schema.Number,
  swings: Schema.Number,
  clangs: Schema.Number,
  sprays: Schema.Number,
  shatters: Schema.Number,
  // The fridge weapon carried when the run ended, or 'None'.
  endedWith: Schema.String,
  // Weapons taken from the fridge, and the knife's stabs and hits.
  taken: Schema.Number,
  stabs: Schema.Number,
  stabHits: Schema.Number,
  // Refills bought at the ammo window mid-wave.
  counterBuys: Schema.Number,
})
export type FridgeLog = typeof FridgeLog.Type

// What the Big Leaguer, the Ankle Biter, and frenzied packs did in a run.
export const NewKindLog = Schema.Struct({
  throws: Schema.Number,
  shields: Schema.Number,
  throwHits: Schema.Number,
  grabs: Schema.Number,
  surfaced: Schema.Number,
  frenzies: Schema.Number,
  wipes: Schema.Number,
  wipeBonus: Schema.Number,
  heartsWhileClung: Schema.Number,
})
export type NewKindLog = typeof NewKindLog.Type

export const BossBlame = Schema.Literals(['Stomp', 'Charge', 'Glob', 'Bite'])
export type BossBlame = typeof BossBlame.Type

// Each boss wave the run reached: whether the boss walked in, whether it
// fell, how long it stood, and whether the run ended while it stood.
export const BossFight = Schema.Struct({
  wave: Schema.Number,
  arrived: Schema.Boolean,
  felled: Schema.Boolean,
  fightMs: Schema.Number,
  diedToIt: Schema.Boolean,
  stomps: Schema.Number,
  stompHits: Schema.Number,
  belches: Schema.Number,
  charges: Schema.Number,
  chargeHits: Schema.Number,
  bonks: Schema.Number,
  spits: Schema.Number,
  spitHits: Schema.Number,
  enraged: Schema.Boolean,
  heartsLost: Schema.Number,
  heartsByAttack: Schema.Record(BossBlame, Schema.Number),
  damageTaken: Schema.Number,
  aimedMs: Schema.Number,
})
export type BossFight = typeof BossFight.Type

// The timeline of one wave in wall time from its start: every pack as it
// walks in, and the stretches with no zombie alive. A stretch is announced
// while a warned pack still waits at its door or the dinner bell rings.
const PackArrival = Schema.Struct({
  atMs: Schema.Number,
  pack: Schema.Number,
  door: Schema.String,
  size: Schema.Number,
  kinds: Schema.Array(Schema.String),
  formation: Schema.String,
})

export const EmptyStretch = Schema.Struct({
  fromMs: Schema.Number,
  ms: Schema.Number,
  announcedMs: Schema.Number,
})
export type EmptyStretch = typeof EmptyStretch.Type

export const WaveTimeline = Schema.Struct({
  packs: Schema.Array(PackArrival),
  empty: Schema.Array(EmptyStretch),
  restMs: Schema.Array(Schema.Number),
  lengthMs: Schema.Number,
})
export type WaveTimeline = typeof WaveTimeline.Type

// Per wave: hearts lost, seconds with 6 or more zombies within 48 px
// (pressure), seconds with none alive (relax), seconds with none alive,
// none announced, and spawns still to come (quiet, the dead air the pacing
// rules forbid) and its longest stretch, its length, and the most alive at
// once.
export const WaveLog = Schema.Struct({
  heartsLost: Schema.Number,
  pressureMs: Schema.Number,
  relaxMs: Schema.Number,
  quietMs: Schema.Number,
  quietRunMs: Schema.Number,
  longestQuietMs: Schema.Number,
  lengthMs: Schema.Number,
  peakAlive: Schema.Number,
})
export type WaveLog = typeof WaveLog.Type

// A break the bot found the shop open in: the wave it came before, the
// money it arrived with, and what it bought, in order.
export const ShopVisit = Schema.Struct({
  wave: Schema.Number,
  money: Schema.Number,
  bought: Schema.Array(Schema.String),
})
export type ShopVisit = typeof ShopVisit.Type

export const RunResult = Schema.Struct({
  seed: Schema.Number,
  cleared: Schema.Number,
  killedBy: Schema.optional(ZombieKind),
  victory: Schema.Boolean,
  runMs: Schema.Number,
  moneyAfterWave: Schema.Array(Schema.Number),
  hurtBy: ByKind,
  maxAlive: Schema.Number,
  pistolTier: Schema.Number,
  spareTier: Schema.Number,
  upgradeSpend: Schema.Number,
  minHp: Schema.Number,
  waves: Schema.Array(WaveLog),
  shopVisits: Schema.Array(ShopVisit),
  gnomesPlaced: Schema.Number,
  dropped: Counts,
  grabbed: Counts,
  boostedMs: Schema.Number,
  waveMs: Schema.Number,
  timelines: Schema.Array(WaveTimeline),
  boss: Schema.Array(BossFight),
  newKinds: NewKindLog,
  // The wave whose break the kitchen was bought in, or 0 when it never was.
  kitchenWave: Schema.Number,
  fridge: FridgeLog,
})
export type RunResult = typeof RunResult.Type

export const RunResults = Schema.Array(RunResult)

export const WaveOutcome = Schema.Literals(['Cleared', 'Died', 'TimedOut'])
export type WaveOutcome = typeof WaveOutcome.Type

export const WaveRun = Schema.Struct({
  wave: Schema.Number,
  snapshotSeed: Schema.Number,
  waveSeed: Schema.Number,
  outcome: WaveOutcome,
  heartsLost: Schema.Number,
  lengthMs: Schema.Number,
  emptyMs: Schema.Number,
  quietMs: Schema.Number,
  longestQuietMs: Schema.Number,
  pressureMs: Schema.Number,
  peakAlive: Schema.Number,
  killedBy: Schema.optional(ZombieKind),
  hurtBy: ByKind,
})
export type WaveRun = typeof WaveRun.Type

export const WaveRuns = Schema.Array(WaveRun)
