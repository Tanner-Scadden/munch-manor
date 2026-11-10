// The logs a run of the balance bot fills as it plays, and the wave
// timeline. What it reports is in results.ts, as Schemas.

import {
  Array,
  Record as EffectRecord,
  Function,
  Option,
  Schema,
  type Types,
} from 'effect'

import { ZombieKind } from '../../../src/app/model'
import { ZOMBIE_KINDS } from '../../../src/world/zombies/zombies'
import { FRAME_MS, type Kind, type Model } from './basics'
import type * as Results from './results'
import type { BossBlame, EmptyStretch } from './results'

// NOTE: the logs a run fills in place as it plays: the Schemas' types
// (results.ts), made mutable.
export type FridgeLog = Types.DeepMutable<Results.FridgeLog>
export type NewKindLog = Types.DeepMutable<Results.NewKindLog>
type BossFight = Types.DeepMutable<Results.BossFight>
export type BossLog = Array<BossFight>
export type WaveTimeline = Types.DeepMutable<Results.WaveTimeline>
export type WaveLog = Types.DeepMutable<Results.WaveLog>
export type ShopVisitLog = Types.DeepMutable<Results.ShopVisit>

export const emptyFridgeLog = (): FridgeLog => ({
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

export const emptyBossBlame = (): Record<BossBlame, number> => ({
  Stomp: 0,
  Charge: 0,
  Glob: 0,
  Bite: 0,
})

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
    Array.some(pendingSpawns(model), spawn => warned.has(spawn.pack))
  )
}

export const emptyTimeline = (): WaveTimeline => ({
  packs: [],
  empty: [],
  restMs: [],
  lengthMs: 0,
})

export const recordTimeline: {
  (before: Model, after: Model): (timeline: WaveTimeline) => void
  (timeline: WaveTimeline, before: Model, after: Model): void
} = Function.dual(
  3,
  (timeline: WaveTimeline, before: Model, after: Model): void => {
    const remaining = new Set(
      after.phase._tag === 'Wave'
        ? Array.map(after.phase.spawns, spawnKey)
        : [],
    )
    const released =
      after.phase._tag === 'Wave'
        ? Array.filter(
            pendingSpawns(before),
            spawn => !remaining.has(spawnKey(spawn)),
          )
        : []
    const atMs = timeline.lengthMs
    Array.forEach(released, spawn => {
      const known = Option.getOrUndefined(
        Array.findFirst(timeline.packs, arrival => arrival.pack === spawn.pack),
      )
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
    const isEmpty = !Array.some(after.zombies, isAliveZombie)
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
  },
)

// The longest stretch inside an empty stretch with nothing announced.
export const quietPartMs = (stretch: EmptyStretch) =>
  stretch.ms - stretch.announcedMs

export const KINDS: ReadonlyArray<Kind> = Array.filter(
  EffectRecord.keys(ZOMBIE_KINDS),
  Schema.is(ZombieKind),
)

export const emptyHurt = (): Record<Kind, number> =>
  EffectRecord.fromIterableWith(KINDS, kind => [kind, 0])
