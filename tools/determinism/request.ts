import { type Option, Schema } from 'effect'

import { encodeJson } from '../json'

const ScriptMode = Schema.Literals(['Campaign', 'Endless'])
export type ScriptMode = typeof ScriptMode.Type

const StepPattern = Schema.Literals(['Fixed60', 'Mixed'])
export type StepPattern = typeof StepPattern.Type

export const EngineRequest = Schema.Struct({
  frames: Schema.Finite,
  seed: Schema.Finite,
  mode: ScriptMode,
  pattern: StepPattern,
  every: Schema.Finite,
  noHitStop: Schema.Boolean,
  dump: Schema.UndefinedOr(Schema.Finite),
})
export type EngineRequest = typeof EngineRequest.Type

export const DEFAULT_REQUEST: EngineRequest = {
  frames: 18_000,
  seed: 1,
  mode: 'Campaign',
  pattern: 'Fixed60',
  every: 1,
  noHitStop: false,
  dump: undefined,
}

const numberOr = (text: string | null | undefined, fallback: number) =>
  text === null || text === undefined || text === '' ? fallback : Number(text)

export const requestOf = (params: URLSearchParams): EngineRequest => ({
  frames: numberOr(params.get('frames'), DEFAULT_REQUEST.frames),
  seed: numberOr(params.get('seed'), DEFAULT_REQUEST.seed),
  mode: params.get('mode') === 'Endless' ? 'Endless' : 'Campaign',
  pattern: params.get('pattern') === 'Mixed' ? 'Mixed' : 'Fixed60',
  every: numberOr(params.get('every'), DEFAULT_REQUEST.every),
  noHitStop: params.get('noHitStop') === '1',
  dump: params.has('dump') ? Number(params.get('dump')) : undefined,
})

export const paramsOf = (request: EngineRequest): string =>
  new URLSearchParams({
    frames: String(request.frames),
    seed: String(request.seed),
    mode: request.mode,
    pattern: request.pattern,
    every: String(request.every),
    noHitStop: request.noHitStop ? '1' : '0',
    ...(request.dump === undefined ? {} : { dump: String(request.dump) }),
  }).toString()

export const EngineRun = Schema.Struct({
  engine: Schema.String,
  frames: Schema.Finite,
  endPhase: Schema.String,
  endWave: Schema.Finite,
  checkpoints: Schema.Array(Schema.Tuple([Schema.Finite, Schema.Finite])),
  unclassified: Schema.Array(Schema.String),
})
export type EngineRun = typeof EngineRun.Type

export const EngineDump = Schema.Struct({
  engine: Schema.String,
  frame: Schema.Finite,
  fieldHashes: Schema.Array(Schema.Tuple([Schema.String, Schema.Finite])),
  state: Schema.String,
})
export type EngineDump = typeof EngineDump.Type

const EngineMissing = Schema.Struct({
  engine: Schema.String,
  frame: Schema.Finite,
  missing: Schema.Literal(true),
})

const EngineError = Schema.Struct({ error: Schema.Unknown })

const encodeRun = encodeJson(EngineRun)
export const encodeEngineRun = (run: EngineRun): string => encodeRun(run)

const encodeDump = encodeJson(Schema.Union([EngineDump, EngineMissing]))
export const encodeEngineDump = (
  dump: EngineDump | typeof EngineMissing.Type,
): string => encodeDump(dump)

const encodeError = encodeJson(EngineError)
export const encodeEngineError = (error: typeof EngineError.Type): string =>
  encodeError(error)

const decodeRun = Schema.decodeUnknownOption(Schema.fromJsonString(EngineRun))
export const decodeEngineRun = (text: string): Option.Option<EngineRun> =>
  decodeRun(text)

const decodeDump = Schema.decodeUnknownOption(Schema.fromJsonString(EngineDump))
export const decodeEngineDump = (text: string): Option.Option<EngineDump> =>
  decodeDump(text)

const decodeError = Schema.decodeUnknownOption(
  Schema.fromJsonString(EngineError),
)
export const decodeEngineError = (
  text: string,
): Option.Option<typeof EngineError.Type> => decodeError(text)
