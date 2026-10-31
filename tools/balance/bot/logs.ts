// What a run of the balance bot reports: its result, the logs it fills
// as it plays, and the wave timeline. simulate.ts and summary.ts read them.

import { Record as EffectRecord, Schema } from 'effect'

import { ZombieKind } from '../../../src/model'
import { ZOMBIE_KINDS } from '../../../src/zombies'
import { FRAME_MS, type Kind, type Model } from './basics'

export type RunResult = {
  seed: number
  cleared: number
  killedBy: Kind | undefined
  victory: boolean
  runMs: number
  moneyAfterWave: Array<number>
  hurtBy: Record<Kind, number>
  maxAlive: number
  pistolTier: number
  spareTier: number
  upgradeSpend: number
  minHp: number
  waves: Array<WaveLog>
  moneyAtVisit: Array<number | undefined>
  gnomesPlaced: number
  boughtAtVisit: Array<Array<string>>
  dropped: Record<string, number>
  grabbed: Record<string, number>
  boostedMs: number
  waveMs: number
  timelines: Array<WaveTimeline>
  boss: BossLog
  newKinds: NewKindLog
  // The wave whose break the kitchen was bought in, or 0 when it never was.
  kitchenWave: number
  fridge: FridgeLog
}

// What the bot pulled from the Mystery Leftovers fridge and what it did
// with the fridge weapons: lids thrown and popped, Pan swings and the ones
// that connected, sprays, and frozen zombies shattered.
export type FridgeLog = {
  pulls: number
  firstPullWave: number
  prizes: Record<string, number>
  lids: number
  pops: number
  swings: number
  clangs: number
  sprays: number
  shatters: number
  // The fridge weapon carried when the run ended, or 'None'.
  endedWith: string
  // Weapons taken from the fridge, and the knife's stabs and hits.
  taken: number
  stabs: number
  stabHits: number
  // Refills bought at the ammo window mid-wave.
  counterBuys: number
}

export const emptyFridgeLog = (): FridgeLog => ({
  counterBuys: 0,
  taken: 0,
  stabs: 0,
  stabHits: 0,
  pulls: 0,
  firstPullWave: 0,
  prizes: {},
  lids: 0,
  pops: 0,
  swings: 0,
  clangs: 0,
  sprays: 0,
  shatters: 0,
  endedWith: 'None',
})

// What the Big Leaguer, the Ankle Biter, and frenzied packs did in a run.
export type NewKindLog = {
  throws: number
  shields: number
  throwHits: number
  grabs: number
  surfaced: number
  frenzies: number
  wipes: number
  wipeBonus: number
  heartsWhileClung: number
}

export const emptyNewKinds = (): NewKindLog => ({
  throws: 0,
  shields: 0,
  throwHits: 0,
  grabs: 0,
  surfaced: 0,
  frenzies: 0,
  wipes: 0,
  wipeBonus: 0,
  heartsWhileClung: 0,
})

// Each boss wave the run reached: whether the boss walked in, whether it
// fell, how long it stood, and whether the run ended while it stood.
export type BossFight = {
  wave: number
  arrived: boolean
  felled: boolean
  fightMs: number
  diedToIt: boolean
  stomps: number
  stompHits: number
  belches: number
  charges: number
  chargeHits: number
  bonks: number
  spits: number
  spitHits: number
  enraged: boolean
  heartsLost: number
  heartsByAttack: Record<BossBlame, number>
  damageTaken: number
  aimedMs: number
}

export type BossBlame = 'Stomp' | 'Charge' | 'Glob' | 'Bite'

export const emptyBossBlame = (): Record<BossBlame, number> => ({
  Stomp: 0,
  Charge: 0,
  Glob: 0,
  Bite: 0,
})

export type BossLog = Array<BossFight>

// The timeline of one wave in wall time from its start: every pack as it
// walks in, and the stretches with no zombie alive. A stretch is announced
// while a warned pack still waits at its door or the dinner bell rings.
type PackArrival = {
  atMs: number
  pack: number
  door: string
  size: number
  kinds: Array<string>
  formation: string
}

export type EmptyStretch = { fromMs: number; ms: number; announcedMs: number }

export type WaveTimeline = {
  packs: Array<PackArrival>
  empty: Array<EmptyStretch>
  restMs: Array<number>
  lengthMs: number
}

// Per wave: hearts lost, seconds with 6 or more zombies within 48 px
// (pressure), seconds with none alive (relax), seconds with none alive,
// none announced, and spawns still to come (quiet, the dead air the pacing
// rules forbid) and its longest stretch, its length, and the most alive at
// once.
export type WaveLog = {
  heartsLost: number
  pressureMs: number
  relaxMs: number
  quietMs: number
  quietRunMs: number
  longestQuietMs: number
  lengthMs: number
  peakAlive: number
}

export const PRESSURE_PX = 48
export const PRESSURE_CROWD = 6

export const emptyWaveLog = (): WaveLog => ({
  heartsLost: 0,
  pressureMs: 0,
  relaxMs: 0,
  quietMs: 0,
  quietRunMs: 0,
  longestQuietMs: 0,
  lengthMs: 0,
  peakAlive: 0,
})

const spawnKey = (spawn: { pack: number; offset: number; kind: string }) =>
  `${spawn.pack}:${spawn.offset}:${spawn.kind}`

export const pendingSpawns = (model: Model) =>
  model.phase._tag === 'Wave' || model.phase._tag === 'Preparation'
    ? model.phase.spawns
    : []

const isAliveZombie = (zombie: Model['zombies'][number]) =>
  zombie.state._tag === 'Walking' || zombie.state._tag === 'Fusing'

export const isAnnounced = (model: Model): boolean => {
  const warned = new Set(model.pacing.warnedPacks)
  return (
    model.pacing.alarm._tag === 'Ringing' ||
    model.boss._tag === 'Arriving' ||
    pendingSpawns(model).some(spawn => warned.has(spawn.pack))
  )
}

export const emptyTimeline = (): WaveTimeline => ({
  packs: [],
  empty: [],
  restMs: [],
  lengthMs: 0,
})

export const recordTimeline = (
  timeline: WaveTimeline,
  before: Model,
  after: Model,
) => {
  const remaining = new Set(
    after.phase._tag === 'Wave' ? after.phase.spawns.map(spawnKey) : [],
  )
  const released =
    after.phase._tag === 'Wave'
      ? pendingSpawns(before).filter(spawn => !remaining.has(spawnKey(spawn)))
      : []
  const atMs = timeline.lengthMs
  released.forEach(spawn => {
    const known = timeline.packs.find(arrival => arrival.pack === spawn.pack)
    if (known === undefined) {
      timeline.packs.push({
        atMs,
        pack: spawn.pack,
        door: spawn.door,
        size: 1,
        kinds: [spawn.kind],
        formation: spawn.formation,
      })
    } else {
      known.size += 1
      known.kinds.push(spawn.kind)
    }
  })
  timeline.lengthMs += FRAME_MS
  const isEmpty = !after.zombies.some(isAliveZombie)
  const last = timeline.empty[timeline.empty.length - 1]
  const isOngoing = last !== undefined && last.fromMs + last.ms >= atMs - 1
  if (isEmpty) {
    const stretch = isOngoing ? last : { fromMs: atMs, ms: 0, announcedMs: 0 }
    if (!isOngoing) {
      timeline.empty.push(stretch)
    }
    stretch.ms += FRAME_MS
    stretch.announcedMs += isAnnounced(after) ? FRAME_MS : 0
  }
  const resting = after.pacing.beat._tag === 'Resting'
  const wasResting = before.pacing.beat._tag === 'Resting'
  if (resting && !wasResting) {
    timeline.restMs.push(0)
  }
  if (resting) {
    timeline.restMs[timeline.restMs.length - 1] =
      (timeline.restMs[timeline.restMs.length - 1] ?? 0) + FRAME_MS
  }
}

// The longest stretch inside an empty stretch with nothing announced.
export const quietPartMs = (stretch: EmptyStretch) =>
  stretch.ms - stretch.announcedMs

export const KINDS: ReadonlyArray<Kind> = Object.keys(ZOMBIE_KINDS).filter(
  Schema.is(ZombieKind),
)

export const emptyHurt = (): Record<Kind, number> =>
  EffectRecord.fromIterableWith(KINDS, kind => [kind, 0])
