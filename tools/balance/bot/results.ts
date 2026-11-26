import { Schema } from 'effect'

import { ZombieKind } from '../../../src/app/model'

const ByKind = Schema.Record(ZombieKind, Schema.Finite)
export const Counts = Schema.Record(Schema.String, Schema.Finite)

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
  endedWith: Schema.String,
  taken: Schema.Finite,
  stabs: Schema.Finite,
  stabHits: Schema.Finite,
})
export type FridgeLog = typeof FridgeLog.Type

const EscapeLog = Schema.Struct({
  casesOpened: Schema.Finite,
  openedWaves: Schema.Array(Schema.Finite),
  found: Schema.Finite,
  listDoneWave: Schema.Finite,
  chunkWave: Schema.Finite,
  keyWave: Schema.Finite,
  chunkFightMs: Schema.Finite,
})

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

export const BossBlame = Schema.Literals([
  'Stomp',
  'Slam',
  'Charge',
  'Glob',
  'Bite',
])
export type BossBlame = typeof BossBlame.Type

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
  hpBySecond: Schema.Array(Schema.Finite),
  distanceBySecond: Schema.Array(Schema.Finite),
  nearMs: Schema.Finite,
  crowdedMs: Schema.Finite,
  crowdHurtBy: Counts,
})
export type BossFight = typeof BossFight.Type

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

export const ShopVisit = Schema.Struct({
  wave: Schema.Finite,
  money: Schema.Finite,
  bought: Schema.Array(Schema.String),
})
export type ShopVisit = typeof ShopVisit.Type

export const RunStop = Schema.Literals([
  'Escaped',
  'DiedToChunk',
  'DiedHunting',
  'DiedListDone',
  'TimedOut',
])
export type RunStop = typeof RunStop.Type

export const RunEnd = Schema.Struct({
  stop: RunStop,
  plan: Schema.String,
  wave: Schema.Finite,
  listLength: Schema.Finite,
  found: Schema.Finite,
  behindBoards: Schema.Finite,
  hiddenInOpen: Schema.Finite,
  shutBoards: Schema.Finite,
  keysHeld: Schema.Finite,
  casesWaiting: Schema.Finite,
  casesLocked: Schema.Finite,
  waitingPrizes: Schema.Array(Schema.String),
  guns: Schema.Array(Schema.String),
})
export type RunEnd = typeof RunEnd.Type

export const Doing = Schema.Literals([
  'Fighting',
  'Reloading',
  'Fetching',
  'Working',
])
export type Doing = typeof Doing.Type

export const CrowdHurt = Schema.Struct({
  wave: Schema.Finite,
  kind: Schema.String,
  doing: Doing,
  hearts: Schema.Finite,
  crowd: Schema.Finite,
})
export type CrowdHurt = typeof CrowdHurt.Type

const KeyLedger = Schema.Struct({
  kills: Schema.Finite,
  clears: Schema.Finite,
  wipes: Schema.Finite,
  pantry: Schema.Finite,
  dud: Schema.Finite,
  boards: Schema.Finite,
  fridge: Schema.Finite,
  chandelierDrops: Schema.Finite,
  heldAtBreak: Schema.Array(Schema.Finite),
  foundAtBreak: Schema.Array(Schema.Finite),
  hurts: Schema.Array(CrowdHurt),
  doingMs: Schema.Array(Schema.Struct({ wave: Schema.Finite, doing: Counts })),
})

export const RunResult = Schema.Struct({
  seed: Schema.Finite,
  cleared: Schema.Finite,
  killedBy: Schema.optional(ZombieKind),
  escaped: Schema.Boolean,
  runMs: Schema.Finite,
  moneyAfterWave: Schema.Array(Schema.Finite),
  hurtBy: ByKind,
  maxAlive: Schema.Finite,
  pistolTier: Schema.Finite,
  spareTier: Schema.Finite,
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
  kitchenWave: Schema.Finite,
  fridge: FridgeLog,
  escape: EscapeLog,
  end: RunEnd,
  ledger: KeyLedger,
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
  boss: Schema.optional(BossFight),
})
export type WaveRun = typeof WaveRun.Type

export const WaveRuns = Schema.Array(WaveRun)
