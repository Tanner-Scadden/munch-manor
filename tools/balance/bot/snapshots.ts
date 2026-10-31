import { Array as EffectArray } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { beginPreparation } from '../../../src/waves'
import { withWorld } from '../../../src/world'
import { play, seedAt, startedRun, waveSeedAt } from '../bot'
import { type BotOptions, type Kind, type Model } from './basics'
import { emptyWaveLog } from './logs'

// WAVE SNAPSHOTS

// A wave snapshot is the model on the first frame of a wave's Preparation in
// a campaign run the bot played from a seed: its money, guns, upgrades,
// traps, and hearts are what a typical run brings to that wave. Snapshots
// are derived by playing, never stored, so they always match the current
// game, and they are cached for the life of the process.
export type WaveSnapshot = { wave: number; seed: number; model: Model }

type DerivedStarts = { untilWave: number; starts: ReadonlyMap<number, Model> }

const derivedStarts = new Map<string, DerivedStarts>()

const startsKey = (seed: number, options: BotOptions) =>
  `${options.difficulty}:${options.swapsBack}:${options.noUpgrades}:${seed}`

// The models at the start of every wave the run of seed reached, up to and
// including untilWave.
export const waveStarts = (
  seed: number,
  options: BotOptions,
  untilWave: number,
): ReadonlyMap<number, Model> => {
  const key = startsKey(seed, options)
  const known = derivedStarts.get(key)
  if (known !== undefined && known.untilWave >= untilWave) {
    return known.starts
  }
  const campaign: BotOptions = { ...options, mode: 'Campaign' }
  const starts = new Map<number, Model>()
  play(
    startedRun(seed, campaign),
    seed,
    campaign,
    { _tag: 'WaveStart', wave: untilWave },
    (wave, model) => {
      starts.set(wave, model)
    },
  )
  derivedStarts.set(key, { untilWave, starts })
  return starts
}

// How many campaign seeds a snapshot slot tries before it gives up on a
// wave the bot rarely reaches.
const SNAPSHOT_TRIES = 12

// Slot k of slots takes its snapshot from the first of the seeds k,
// k + slots, k + 2 slots, and so on whose run reached the wave. Every slot
// is found on its own, so workers can split the slots between them.
export const snapshotFor = (
  wave: number,
  slot: number,
  slots: number,
  options: BotOptions,
  firstSeed: number,
  untilWave: number = wave,
): WaveSnapshot | undefined =>
  EffectArray.makeBy(SNAPSHOT_TRIES, attempt =>
    seedAt(firstSeed, slot + attempt * slots),
  ).reduce<WaveSnapshot | undefined>((found, seed) => {
    if (found !== undefined) {
      return found
    }
    const model = waveStarts(seed, options, untilWave).get(wave)
    return model === undefined ? undefined : { wave, seed, model }
  }, undefined)

// The same wave start with the wave rolled again from waveSeed: new packs,
// doors, kinds, and boss door, the same money, gear, traps, and hearts.
export const rerolled = (model: Model, waveSeed: number): Model => {
  const { phase } = model
  return phase._tag === 'Preparation'
    ? withWorld(modifyFields(model, { rngState: () => waveSeed }), world =>
        beginPreparation(world, phase.wave, phase.durationMs, phase.clock),
      )
    : model
}

type WaveOutcome = 'Cleared' | 'Died' | 'TimedOut'

export type WaveRun = {
  wave: number
  snapshotSeed: number
  waveSeed: number
  outcome: WaveOutcome
  heartsLost: number
  lengthMs: number
  emptyMs: number
  quietMs: number
  longestQuietMs: number
  pressureMs: number
  peakAlive: number
  killedBy: Kind | undefined
  hurtBy: Record<Kind, number>
}

export const playSnapshot = (
  snapshot: WaveSnapshot,
  waveSeed: number,
  options: BotOptions,
): WaveRun => {
  const result = play(
    rerolled(snapshot.model, waveSeed),
    waveSeed,
    { ...options, mode: 'Campaign' },
    { _tag: 'WaveEnd' },
  )
  const log = result.waves[snapshot.wave - 1] ?? emptyWaveLog()
  const outcome: WaveOutcome =
    result.victory || result.cleared >= snapshot.wave
      ? 'Cleared'
      : result.minHp <= 0
        ? 'Died'
        : 'TimedOut'
  return {
    wave: snapshot.wave,
    snapshotSeed: snapshot.seed,
    waveSeed,
    outcome,
    heartsLost: log.heartsLost,
    lengthMs: log.lengthMs,
    emptyMs: log.relaxMs,
    quietMs: log.quietMs,
    longestQuietMs: log.longestQuietMs,
    pressureMs: log.pressureMs,
    peakAlive: log.peakAlive,
    killedBy: result.killedBy,
    hurtBy: result.hurtBy,
  }
}

export type WavePass = {
  waves: ReadonlyArray<number>
  runs: number
  slots: number
  firstSeed: number
  // Runs to skip in the seed list, so a second batch rolls new waves.
  seedOffset: number
}

// Plays runs of every wave in the pass. Run i of a wave starts from slot
// i % slots and rolls its wave from waveSeedAt(seedOffset + i). ownsSlot picks the slots
// this process plays, so workers can split a pass by slot.
export const playWavePass = (
  pass: WavePass,
  options: BotOptions,
  ownsSlot: (slot: number) => boolean = () => true,
): Array<WaveRun> => {
  const untilWave = Math.max(...pass.waves)
  return pass.waves.flatMap(wave =>
    EffectArray.makeBy(pass.runs, index => index).flatMap(index => {
      const slot = index % pass.slots
      if (!ownsSlot(slot)) {
        return []
      }
      const snapshot = snapshotFor(
        wave,
        slot,
        pass.slots,
        options,
        pass.firstSeed,
        untilWave,
      )
      return snapshot === undefined
        ? []
        : [
            playSnapshot(
              snapshot,
              waveSeedAt(pass.firstSeed, pass.seedOffset + index),
              options,
            ),
          ]
    }),
  )
}
