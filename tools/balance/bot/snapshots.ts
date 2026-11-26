import { Array as EffectArray, Function, Option } from 'effect'

import { UiStruct } from '@effect/ui'

import { withWorld } from '../../../src/world/schema/world'
import { beginPreparation } from '../../../src/world/waves/waves'
import { play, seedAt, startedRun, waveSeedAt } from '../bot'
import { type BotOptions, type Model } from './basics'
import { emptyWaveLog } from './logs'
import type { WaveOutcome, WaveRun } from './results'

export type WaveSnapshot = { wave: number; seed: number; model: Model }

type DerivedStarts = { untilWave: number; starts: ReadonlyMap<number, Model> }

const derivedStarts = new Map<string, DerivedStarts>()

const startsKey = (seed: number, options: BotOptions) =>
  `${options.difficulty}:${options.swapsBack}:${options.noUpgrades}:${seed}`

export const waveStarts: {
  (
    options: BotOptions,
    untilWave: number,
  ): (seed: number) => ReadonlyMap<number, Model>
  (
    seed: number,
    options: BotOptions,
    untilWave: number,
  ): ReadonlyMap<number, Model>
} = Function.dual(
  3,
  (
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
  },
)

const SNAPSHOT_TRIES = 12

export const snapshotFor: {
  (
    slot: number,
    slots: number,
    options: BotOptions,
    firstSeed: number,
    untilWave: number,
  ): (wave: number) => WaveSnapshot | undefined
  (
    wave: number,
    slot: number,
    slots: number,
    options: BotOptions,
    firstSeed: number,
    untilWave: number,
  ): WaveSnapshot | undefined
} = Function.dual(
  6,
  (
    wave: number,
    slot: number,
    slots: number,
    options: BotOptions,
    firstSeed: number,
    untilWave: number,
  ): WaveSnapshot | undefined =>
    Option.getOrUndefined(
      EffectArray.findFirst(
        EffectArray.makeBy(SNAPSHOT_TRIES, attempt =>
          seedAt(firstSeed, slot + attempt * slots),
        ),
        (seed): Option.Option<WaveSnapshot> =>
          Option.map(
            Option.fromNullishOr(
              waveStarts(seed, options, untilWave).get(wave),
            ),
            model => ({ wave, seed, model }),
          ),
      ),
    ),
)

export const rerolled: {
  (waveSeed: number): (model: Model) => Model
  (model: Model, waveSeed: number): Model
} = Function.dual(2, (model: Model, waveSeed: number): Model => {
  const { phase } = model
  return phase._tag === 'Preparation'
    ? withWorld(UiStruct.evolve(model, { rngState: () => waveSeed }), world =>
        beginPreparation(world, phase.wave, phase.durationMs, phase.clock),
      )
    : model
})

export const playSnapshot: {
  (waveSeed: number, options: BotOptions): (snapshot: WaveSnapshot) => WaveRun
  (snapshot: WaveSnapshot, waveSeed: number, options: BotOptions): WaveRun
} = Function.dual(
  3,
  (snapshot: WaveSnapshot, waveSeed: number, options: BotOptions): WaveRun => {
    const result = play(
      rerolled(snapshot.model, waveSeed),
      waveSeed,
      { ...options, mode: 'Campaign' },
      { _tag: 'WaveEnd' },
      Function.constVoid,
    )
    const log = result.waves[snapshot.wave - 1] ?? emptyWaveLog()
    const outcome: WaveOutcome =
      result.escaped || result.cleared >= snapshot.wave
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
      boss: Option.getOrUndefined(
        EffectArray.findFirst(
          result.boss,
          fight => fight.wave === snapshot.wave,
        ),
      ),
    }
  },
)

export type WavePass = {
  waves: ReadonlyArray<number>
  runs: number
  slots: number
  firstSeed: number
  seedOffset: number
}

export const playWavePass: {
  (
    options: BotOptions,
    ownsSlot: (slot: number) => boolean,
  ): (pass: WavePass) => Array<WaveRun>
  (
    pass: WavePass,
    options: BotOptions,
    ownsSlot: (slot: number) => boolean,
  ): Array<WaveRun>
} = Function.dual(
  3,
  (
    pass: WavePass,
    options: BotOptions,
    ownsSlot: (slot: number) => boolean,
  ): Array<WaveRun> => {
    const untilWave = Math.max(...pass.waves)
    return EffectArray.flatMap(pass.waves, wave =>
      EffectArray.flatMap(
        EffectArray.makeBy(pass.runs, index => index),
        index => {
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
        },
      ),
    )
  },
)
