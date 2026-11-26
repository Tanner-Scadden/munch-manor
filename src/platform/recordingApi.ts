import { type Option, Schema } from 'effect'

export const RECORDINGS_PATH = '/api/recordings'

export const RUN_ID_PARAM = 'run'

export const MAX_RECORDING_BYTES = 8 * 1024 * 1024

const RUN_ID_LENGTH = 24

export const RunId = Schema.String.check(
  Schema.isPattern(new RegExp(`^[0-9a-f]{${RUN_ID_LENGTH}}$`)),
)
export type RunId = typeof RunId.Type

export const maybeRunId: (text: string) => Option.Option<RunId> =
  Schema.decodeOption(RunId)

export const RecordingEncoding = Schema.Literals(['Gzip', 'Plain'])
export type RecordingEncoding = typeof RecordingEncoding.Type

export const GZIP_CONTENT_TYPE = 'application/gzip'
export const JSON_CONTENT_TYPE = 'application/json'

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
