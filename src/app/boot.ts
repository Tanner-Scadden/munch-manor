import { Effect, Option, Random, pipe } from 'effect'

import { Command, Component } from '@effect/ui'

import { spriteWarmUpSources } from '../art/appearance'
import { generateVisitId } from '../platform/analyticsBeacon'
import type { ScreenFit } from '../platform/deviceSchema'
import { startRecordingQueue } from '../platform/recordingUpload'
import {
  awaitFirstFrame,
  decodeImages,
  loadFonts,
  loadStyles,
  markLoadStep,
} from '../platform/splash'
import { PlayerStore } from '../platform/store'
import { startSummaryQueue } from '../platform/summaryQueue'
import { readUpdateMarker } from '../platform/version'
import { awaitWorldReady } from '../render/iso/element'
import { toBrowserError } from '../shared/describeError'
import { Message } from './message'
import { defaultAppearance } from './model'

// NOTE: the Commands init starts, and only those. Every other Command sits
// beside the update that returns it (AGENTS.md "Code shape").

// COMMAND

const UINT32_MAX = 0xffffffff

export const GenerateSeed = Command.make('GenerateSeed', { args: {} }, () =>
  Effect.map(Random.nextIntBetween(0, UINT32_MAX), seed =>
    Message.CompletedGenerateSeed({ seed }),
  ),
)

const COARSE_POINTER_QUERY = '(pointer: coarse)'

// NOTE: `pointer` reads the primary pointer, so a touchscreen laptop (a
// trackpad or mouse first) reads fine and keeps keyboard and mouse, while a
// phone or a tablet reads coarse. Tablets once fell back to keyboard
// controls by a screen size check, which left an iPad with no keyboard
// unable to move. An iPad with a trackpad attached reads fine.
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

// NOTE: no feature check tells whether a browser offers Add to Home Screen.
// `navigator.standalone` exists only in Apple's WebKit, and every iPhone
// browser runs on it and can add to the Home Screen from iOS 16.4, so its
// presence is the narrowest honest check. Element full screen comes first, so
// an iPad or an Android phone gets the full screen button instead.
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

// NOTE: screen.orientation.lock exists in Chromium on every device, but only
// a phone or tablet can turn, and iPhones have no lock at all. WebKit's
// navigator.standalone marks an Apple browser.
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

// NOTE: `?local=2` to `?local=4` seats that many players at one keyboard,
// for testing co-op offline (MULTIPLAYER.md, Phase 1). Dev builds only: a
// shipped build always reads 1.
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

// NOTE: the world's renderer starts loading every sprite image on the
// first frame (its `preload` list). This waits for that frame, then decodes the same sources, so
// the splash stays up until the sprites are ready to draw.
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

// NOTE: run summaries that ended offline on an earlier visit are sent now, in
// the background, spaced out, so the Command is done at once, and sends
// nothing.
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

// NOTE: a device opened once with `?record=1` unlocks RECORD MY RUNS for
// the player: the unlock goes into the save, which syncs it to every linked
// device. A device that unlocked it before the unlock synced still holds
// its own mark in the store, read here once more to carry it into the save.
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

// NOTE: recorded runs that ended offline are sent now, in the background,
// like the summaries.
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

// BOOT

// NOTE: a share sheet is there when the browser has navigator.share; only a
// touch screen uses it (src/screens/game/menus.ts).
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

// NOTE: every Command init starts, in this order. A new LoadStep joins
// LOAD_STEPS with a Command here that loads it.
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
