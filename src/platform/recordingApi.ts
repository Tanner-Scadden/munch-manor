import { type Option, Schema } from 'effect'

// The recorded runs' endpoint as the game and the API Worker
// (infra/worker/recordings.ts) both read it: the path, the size cap, the
// run id, and where a recording is kept in the bucket. It imports only
// `effect`, so the Worker bundles it as it is.

export const RECORDINGS_PATH = '/api/recordings'

// NOTE: the run's id rides in the query, so the Worker keeps the body as it
// came, gzip and all, without reading it.
export const RUN_ID_PARAM = 'run'

// NOTE: a recorded run is the World it starts from, a few KB gzipped, and
// each tick's intent: about 1 KB a second gzipped while the aim moves, less
// while it is still. An hour's run is about 4 MB.
export const MAX_RECORDING_BYTES = 8 * 1024 * 1024

// NOTE: the visit id (16 hex digits) and the run's seed at its start (8),
// so two runs of one visit differ and no clock or randomness is read.
const RUN_ID_LENGTH = 24

export const RunId = Schema.String.check(
  Schema.isPattern(new RegExp(`^[0-9a-f]{${RUN_ID_LENGTH}}$`)),
)
export type RunId = typeof RunId.Type

export const maybeRunId: (text: string) => Option.Option<RunId> =
  Schema.decodeOption(RunId)

// NOTE: gzip where the browser can make it, plain JSON where it cannot.
export const RecordingEncoding = Schema.Literals(['Gzip', 'Plain'])
export type RecordingEncoding = typeof RecordingEncoding.Type

export const GZIP_CONTENT_TYPE = 'application/gzip'
export const JSON_CONTENT_TYPE = 'application/json'

// NOTE: one folder per player, so training reads one player's runs by
// prefix. The player id is the sync scope's, from the token, never the
// body.
export const recordingKey = ({
  playerId,
  runId,
  encoding,
}: Readonly<{
  playerId: string
  runId: RunId
  encoding: RecordingEncoding
}>): string =>
  `recordings/${playerId}/${runId}.json${encoding === 'Gzip' ? '.gz' : ''}`
