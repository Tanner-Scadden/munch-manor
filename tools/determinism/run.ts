import { UiStruct } from '@effect/ui'

import { type Model, initialHitStop } from '../../src/app/model'
import type { Checkpoint } from './diff'
import { makeGameplayHasher } from './hash'
import {
  type ScriptMode,
  type StepPattern,
  isPlaying,
  playFrame,
  startedRun,
} from './script'

export type RunOptions = Readonly<{
  seed: number
  frames: number
  mode: ScriptMode
  pattern: StepPattern
  every: number
  cached: boolean
  noHitStop?: boolean
}>

type RunHooks = Readonly<{
  onFrame?: (frame: number, model: Model) => void
  afterFrame?: (model: Model) => Model
}>

export type RunReport = Readonly<{
  frames: number
  endPhase: string
  endWave: number
  checkpoints: ReadonlyArray<Checkpoint>
}>

const waveOf = (model: Model): number =>
  model.phase._tag === 'Preparation' ||
  model.phase._tag === 'Wave' ||
  model.phase._tag === 'GameOver' ||
  model.phase._tag === 'Escaped'
    ? model.phase.wave
    : 0

export const runScript = (options: RunOptions & RunHooks): RunReport => {
  const { onFrame, afterFrame = (model: Model): Model => model } = options
  const hasher = makeGameplayHasher({ cached: options.cached })
  const start = startedRun(options.seed, options.mode)
  const checkpoints: Array<Checkpoint> = [[-1, hasher.hashModel(start)]]
  let model = start
  let frame = 0
  for (; frame < options.frames && isPlaying(model); frame++) {
    const played = afterFrame(playFrame(model, frame, options.pattern))
    model =
      options.noHitStop === true
        ? UiStruct.evolve(played, { hitStop: () => initialHitStop })
        : played
    onFrame?.(frame, model)
    if (frame % options.every === options.every - 1) {
      checkpoints.push([frame, hasher.hashModel(model)])
    }
  }
  const last = checkpoints[checkpoints.length - 1]
  if (last !== undefined && last[0] !== frame - 1) {
    checkpoints.push([frame - 1, hasher.hashModel(model)])
  }
  return {
    frames: frame,
    endPhase: model.phase._tag,
    endWave: waveOf(model),
    checkpoints,
  }
}
