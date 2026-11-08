// Plays the script and records the gameplay hash every N frames. Pure apart
// from the optional callback, so it runs in every engine the harness checks.

import { modifyFields } from 'foldkit/struct'

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
  // Hash after every this many frames, and always after the last.
  every: number
  cached: boolean
  noHitStop?: boolean
}>

// NOTE: a call after each frame, and a change made to the Model after each
// frame, before it is hashed, such as throwing the cosmetics away.
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
  model.phase._tag === 'GameOver'
    ? model.phase.wave
    : 0

// Frames are numbered from 0; checkpoint frame f is the state after frame f.
export const runScript = (options: RunOptions & RunHooks): RunReport => {
  const { onFrame, afterFrame = (model: Model): Model => model } = options
  const hasher = makeGameplayHasher({ cached: options.cached })
  const start = startedRun(options.seed, options.mode)
  const checkpoints: Array<Checkpoint> = [[-1, hasher.hashModel(start)]]
  // NOTE: a loop with an early exit, since a run ends at Victory or Game
  // Over before the frame budget runs out.
  let model = start
  let frame = 0
  for (; frame < options.frames && isPlaying(model); frame++) {
    const played = afterFrame(playFrame(model, frame, options.pattern))
    model =
      options.noHitStop === true
        ? modifyFields(played, { hitStop: () => initialHitStop })
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
