// One engine's side of the harness, shared by every runtime: Bun and Node
// (cli.ts), headless Chrome (page.ts), and workerd (worker.ts). It reads the
// request as plain parameters and answers with JSON text, so every engine
// prints the same thing.
//
// - A run: the checkpoints of the script, every N frames.
// - A dump (`dump` set): the gameplay state after that frame, with each
//   field's hash, as exact JSON, for the orchestrator to diff.

import { Function } from 'effect'

import { installDeterministicMath } from './detMath'
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
  if (request.detMath) {
    installDeterministicMath()
  }
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
