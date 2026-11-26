import { Effect, Option, Random, pipe } from 'effect'

import { Command, Component } from '@effect/ui'

import { spriteWarmUpSources } from '#art/appearance.ts'
import { generateVisitId } from '#platform/analyticsBeacon.ts'
import type { ScreenFit } from '#platform/deviceSchema.ts'
import { startRecordingQueue } from '#platform/recordingUpload.ts'
import {
  awaitFirstFrame,
  decodeImages,
  loadFonts,
  loadStyles,
  markLoadStep,
} from '#platform/splash.ts'
import { PlayerStore } from '#platform/store.ts'
import { startSummaryQueue } from '#platform/summaryQueue.ts'
import { readUpdateMarker } from '#platform/version.ts'
import { awaitWorldReady } from '#render/iso/element.ts'
import { toBrowserError } from '#shared/describeError.ts'

import { Message } from './message.ts'
import { defaultAppearance } from './model.ts'

const UINT32_MAX = 0xffffffff

export const GenerateSeed = Command.make('GenerateSeed', { args: {} }, () =>
  Effect.map(Random.nextIntBetween(0, UINT32_MAX), seed =>
    Message.CompletedGenerateSeed({ seed }),
  ),
)

const COARSE_POINTER_QUERY = '(pointer: coarse)'

const isTouchScreen = (): boolean =>
  window.matchMedia(COARSE_POINTER_QUERY).matches

export const DetectInputDevice = Command.make(
  'DetectInputDevice',
  { args: {} },
  () =>
    pipe(
      Effect.try({ try: isTouchScreen, catch: toBrowserError }),
      Effect.map(isMobile =>
        Message.CompletedDetectInputDevice({
          touchControls: isMobile ? 'Allowed' : 'Blocked',
        }),
      ),
      Effect.orElseSucceed(() =>
        Message.CompletedDetectInputDevice({ touchControls: 'Blocked' }),
      ),
    ),
)

const isInstalledApp = (): boolean =>
  window.matchMedia('(display-mode: fullscreen)').matches ||
  window.matchMedia('(display-mode: standalone)').matches ||
  Reflect.get(navigator, 'standalone') === true

const canAddToHomeScreen = (): boolean =>
  Reflect.has(navigator, 'standalone') &&
  window.matchMedia(COARSE_POINTER_QUERY).matches

const detectScreenFit = (): ScreenFit => {
  if (isInstalledApp()) {
    return 'Installed'
  } else if (document.fullscreenEnabled) {
    return 'Fullscreen'
  } else if (canAddToHomeScreen()) {
    return 'HomeScreen'
  } else {
    return 'Unavailable'
  }
}

export const DetectScreenFit = Command.make(
  'DetectScreenFit',
  { args: {} },
  () =>
    pipe(
      Effect.try({ try: detectScreenFit, catch: toBrowserError }),
      Effect.map(screenFit => Message.CompletedDetectScreenFit({ screenFit })),
      Effect.orElseSucceed(() =>
        Message.CompletedDetectScreenFit({ screenFit: 'Unavailable' }),
      ),
    ),
)

const canLockOrientation = (): boolean =>
  Reflect.has(screen, 'orientation') &&
  typeof screen.orientation.lock === 'function' &&
  window.matchMedia(COARSE_POINTER_QUERY).matches &&
  !Reflect.has(navigator, 'standalone')

export const DetectOrientationLock = Command.make(
  'DetectOrientationLock',
  { args: {} },
  () =>
    pipe(
      Effect.try({ try: canLockOrientation, catch: toBrowserError }),
      Effect.map(canLock =>
        Message.CompletedDetectOrientationLock({
          orientationLock: canLock ? 'Supported' : 'Unsupported',
        }),
      ),
      Effect.orElseSucceed(() =>
        Message.CompletedDetectOrientationLock({
          orientationLock: 'Unsupported',
        }),
      ),
    ),
)

const LOCAL_PLAYERS_PARAM = 'local'

export const localPlayersIn = (search: string): number => {
  const count = Number(new URLSearchParams(search).get(LOCAL_PLAYERS_PARAM))
  return Number.isInteger(count) && count >= 1 ? Math.min(4, count) : 1
}

export const DetectLocalPlayers = Command.make(
  'DetectLocalPlayers',
  { args: {} },
  () =>
    pipe(
      Effect.try({
        try: () => (import.meta.env.DEV ? localPlayersIn(location.search) : 1),
        catch: toBrowserError,
      }),
      Effect.map(count => Message.CompletedDetectLocalPlayers({ count })),
      Effect.orElseSucceed(() =>
        Message.CompletedDetectLocalPlayers({ count: 1 }),
      ),
    ),
)

export const ReadUpdateMarker = Command.make(
  'ReadUpdateMarker',
  { args: {} },
  () =>
    pipe(
      readUpdateMarker,
      Effect.map(maybeBuild =>
        Message.CompletedReadUpdateMarker({ maybeBuild }),
      ),
      Effect.orElseSucceed(() =>
        Message.CompletedReadUpdateMarker({ maybeBuild: Option.none() }),
      ),
    ),
)

export const LoadStyles = Command.make('LoadStyles', { args: {} }, () =>
  pipe(
    loadStyles,
    Effect.ignore,
    Effect.andThen(markLoadStep('Styles')),
    Effect.as(Message.CompletedLoadStyles()),
  ),
)

export const LoadFonts = Command.make('LoadFonts', { args: {} }, () =>
  pipe(
    loadFonts,
    Effect.ensuring(markLoadStep('Fonts')),
    Effect.as(Message.CompletedLoadFonts()),
    Effect.catch(error =>
      Effect.succeed(Message.FailedLoadFonts({ reason: String(error) })),
    ),
  ),
)

export const AwaitFirstFrame = Command.make(
  'AwaitFirstFrame',
  { args: {} },
  () =>
    pipe(
      awaitFirstFrame,
      Effect.andThen(awaitWorldReady),
      Effect.andThen(markLoadStep('FirstFrame')),
      Effect.as(Message.CompletedAwaitFirstFrame()),
    ),
)

export const DecodeSprites = Command.make('DecodeSprites', { args: {} }, () =>
  pipe(
    awaitFirstFrame,
    Effect.andThen(
      Effect.suspend(() =>
        decodeImages(spriteWarmUpSources(defaultAppearance)),
      ),
    ),
    Effect.andThen(markLoadStep('Sprites')),
    Effect.as(Message.CompletedDecodeSprites()),
  ),
)

export class LoadSave extends Command.Service<LoadSave>()('app/LoadSave', {
  args: {},
  success: Message,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const store = yield* PlayerStore
      return () =>
        pipe(
          store.load,
          Effect.ensuring(markLoadStep('Save')),
          Effect.map(maybeSave => Message.CompletedLoadSave({ maybeSave })),
          Effect.catch(error =>
            Effect.succeed(Message.FailedLoadSave({ reason: error.reason })),
          ),
        )
    }),
  )
}

export const GenerateVisitId = Command.make(
  'GenerateVisitId',
  { args: {} },
  () =>
    Effect.map(generateVisitId, visitId =>
      Message.CompletedGenerateVisitId({ visitId }),
    ),
)

export class StartSummaryQueue extends Command.Service<StartSummaryQueue>()(
  'app/StartSummaryQueue',
  { args: {}, success: Component.Noop },
) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const store = yield* PlayerStore
      return () =>
        Effect.as(
          Effect.forkDetach(
            Effect.provideService(startSummaryQueue(), PlayerStore, store),
          ),
          Component.noop,
        )
    }),
  )
}

const RECORD_PARAM = 'record'

const isRecordAsked: Effect.Effect<boolean> = Effect.orElseSucceed(
  Effect.try({
    try: () => new URLSearchParams(location.search).get(RECORD_PARAM) === '1',
    catch: toBrowserError,
  }),
  () => false,
)

export class ReadRecordUnlock extends Command.Service<ReadRecordUnlock>()(
  'app/ReadRecordUnlock',
  { args: {}, success: Message },
) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const store = yield* PlayerStore
      return () =>
        Effect.gen(function* () {
          const isAsked = yield* isRecordAsked
          const isKept = yield* Effect.orElseSucceed(
            store.isRecordUnlocked,
            () => false,
          )
          return Message.CompletedReadRecordUnlock({
            unlock: isAsked || isKept ? 'Unlocked' : 'Locked',
          })
        })
    }),
  )
}

export class StartRecordingQueue extends Command.Service<StartRecordingQueue>()(
  'app/StartRecordingQueue',
  { args: {}, success: Component.Noop },
) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const store = yield* PlayerStore
      return () =>
        Effect.as(
          Effect.forkDetach(
            Effect.provideService(startRecordingQueue(), PlayerStore, store),
          ),
          Component.noop,
        )
    }),
  )
}

export const DetectShareSheet = Command.make(
  'DetectShareSheet',
  { args: {} },
  () =>
    Effect.sync(() =>
      Message.CompletedDetectShareSheet({
        shareSheet:
          typeof navigator.share === 'function' ? 'Available' : 'Unavailable',
      }),
    ),
)

export const bootCommands = () => [
  LoadSave.make(),
  GenerateSeed.make(),
  GenerateVisitId.make(),
  StartSummaryQueue.make(),
  ReadRecordUnlock.make(),
  StartRecordingQueue.make(),
  DetectInputDevice.make(),
  DetectShareSheet.make(),
  DetectScreenFit.make(),
  DetectOrientationLock.make(),
  DetectLocalPlayers.make(),
  ReadUpdateMarker.make(),
  LoadStyles.make(),
  LoadFonts.make(),
  AwaitFirstFrame.make(),
  DecodeSprites.make(),
]
