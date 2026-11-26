import { Function } from 'effect'

import { exactJson } from './diff'
import { gameplayOf, unclassifiedFieldsOf } from './fields'
import { makeGameplayHasher } from './hash'
import {
  type EngineDump,
  type EngineRequest,
  type EngineRun,
  encodeEngineDump,
  encodeEngineRun,
} from './request'
import { type RunOptions, runScript } from './run'
import { startedRun } from './script'

export const answer: {
  (request: EngineRequest): (engine: string) => string
  (engine: string, request: EngineRequest): string
} = Function.dual(2, (engine: string, request: EngineRequest): string => {
  const options: RunOptions = {
    seed: request.seed,
    frames: request.frames,
    mode: request.mode,
    pattern: request.pattern,
    every: Math.max(1, request.every),
    cached: true,
    noHitStop: request.noHitStop,
  }
  const dumpFrame = request.dump
  if (dumpFrame !== undefined) {
    const hasher = makeGameplayHasher()
    const dumps: Array<EngineDump> = []
    runScript({
      ...options,
      frames: dumpFrame + 1,
      onFrame: (frame, model) => {
        if (frame === dumpFrame) {
          dumps.push({
            engine,
            frame,
            fieldHashes: hasher.fieldHashes(model),
            state: exactJson(gameplayOf(model)),
          })
        }
      },
    })
    return encodeEngineDump(
      dumps[0] ?? { engine, frame: dumpFrame, missing: true },
    )
  }
  const report = runScript(options)
  const run: EngineRun = {
    engine,
    frames: report.frames,
    endPhase: report.endPhase,
    endWave: report.endWave,
    checkpoints: report.checkpoints,
    unclassified: unclassifiedFieldsOf(startedRun(request.seed, request.mode)),
  }
  return encodeEngineRun(run)
})
