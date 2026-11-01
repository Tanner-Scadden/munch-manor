import { Effect, Option, Random, pipe } from 'effect'

import { generateVisitId } from './analyticsBeacon'
import { spriteWarmUpSources } from './appearance'
import { makeCommand } from './definition'
import { Message } from './message'
import { type ScreenFit, defaultAppearance } from './model'
import {
  awaitFirstFrame,
  decodeImages,
  loadFonts,
  loadStyles,
  markLoadStep,
} from './splash'
import { PlayerStore } from './store'
import { startSummaryQueue } from './summaryQueue'
import { readUpdateMarker } from './version'

// NOTE: the Commands init starts, and only those. Every other Command sits
// beside the update that returns it (AGENTS.md "Code shape").

// COMMAND

const UINT32_MAX = 0xffffffff

export const GenerateSeed = makeCommand('GenerateSeed', {
  messages: [Message.CompletedGenerateSeed],
  handler: function* () {
    return () =>
      Effect.map(Random.nextIntBetween(0, UINT32_MAX), seed =>
        Message.CompletedGenerateSeed({ seed }),
      )
  },
})

const COARSE_POINTER_QUERY = '(pointer: coarse)'

// NOTE: `pointer` reads the primary pointer, so a touchscreen laptop (a
// trackpad or mouse first) reads fine and keeps keyboard and mouse, while a
// phone or a tablet reads coarse. Tablets once fell back to keyboard
// controls by a screen size check, which left an iPad with no keyboard
// unable to move. An iPad with a trackpad attached reads fine.
const isTouchScreen = (): boolean =>
  window.matchMedia(COARSE_POINTER_QUERY).matches

export const DetectInputDevice = makeCommand('DetectInputDevice', {
  messages: [Message.CompletedDetectInputDevice],
  handler: function* () {
    return () =>
      pipe(
        Effect.try(isTouchScreen),
        Effect.map(isMobile =>
          Message.CompletedDetectInputDevice({
            touchControls: isMobile ? 'Allowed' : 'Blocked',
          }),
        ),
        Effect.catch(() =>
          Effect.succeed(
            Message.CompletedDetectInputDevice({ touchControls: 'Blocked' }),
          ),
        ),
      )
  },
})

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

export const DetectScreenFit = makeCommand('DetectScreenFit', {
  messages: [Message.CompletedDetectScreenFit],
  handler: function* () {
    return () =>
      pipe(
        Effect.try(detectScreenFit),
        Effect.map(screenFit =>
          Message.CompletedDetectScreenFit({ screenFit }),
        ),
        Effect.catch(() =>
          Effect.succeed(
            Message.CompletedDetectScreenFit({ screenFit: 'Unavailable' }),
          ),
        ),
      )
  },
})

// NOTE: screen.orientation.lock exists in Chromium on every device, but only
// a phone or tablet can turn, and iPhones have no lock at all. WebKit's
// navigator.standalone marks an Apple browser.
const canLockOrientation = (): boolean =>
  Reflect.has(screen, 'orientation') &&
  typeof screen.orientation.lock === 'function' &&
  window.matchMedia(COARSE_POINTER_QUERY).matches &&
  !Reflect.has(navigator, 'standalone')

export const DetectOrientationLock = makeCommand('DetectOrientationLock', {
  messages: [Message.CompletedDetectOrientationLock],
  handler: function* () {
    return () =>
      pipe(
        Effect.try(canLockOrientation),
        Effect.map(canLock =>
          Message.CompletedDetectOrientationLock({
            orientationLock: canLock ? 'Supported' : 'Unsupported',
          }),
        ),
        Effect.catch(() =>
          Effect.succeed(
            Message.CompletedDetectOrientationLock({
              orientationLock: 'Unsupported',
            }),
          ),
        ),
      )
  },
})

// NOTE: `?local=2` to `?local=4` seats that many players at one keyboard,
// for testing co-op offline (MULTIPLAYER.md, Phase 1). Dev builds only: a
// shipped build always reads 1.
const LOCAL_PLAYERS_PARAM = 'local'

export const localPlayersIn = (search: string): number => {
  const count = Number(new URLSearchParams(search).get(LOCAL_PLAYERS_PARAM))
  return Number.isInteger(count) && count >= 1 ? Math.min(4, count) : 1
}

export const DetectLocalPlayers = makeCommand('DetectLocalPlayers', {
  messages: [Message.CompletedDetectLocalPlayers],
  handler: function* () {
    return () =>
      pipe(
        Effect.try(() =>
          import.meta.env.DEV ? localPlayersIn(location.search) : 1,
        ),
        Effect.map(count => Message.CompletedDetectLocalPlayers({ count })),
        Effect.catch(() =>
          Effect.succeed(Message.CompletedDetectLocalPlayers({ count: 1 })),
        ),
      )
  },
})

export const ReadUpdateMarker = makeCommand('ReadUpdateMarker', {
  messages: [Message.CompletedReadUpdateMarker],
  handler: function* () {
    return () =>
      pipe(
        readUpdateMarker,
        Effect.map(maybeBuild =>
          Message.CompletedReadUpdateMarker({ maybeBuild }),
        ),
        Effect.catch(() =>
          Effect.succeed(
            Message.CompletedReadUpdateMarker({ maybeBuild: Option.none() }),
          ),
        ),
      )
  },
})

export const LoadStyles = makeCommand('LoadStyles', {
  messages: [Message.CompletedLoadStyles],
  handler: function* () {
    return () =>
      pipe(
        loadStyles,
        Effect.ignore,
        Effect.andThen(markLoadStep('Styles')),
        Effect.as(Message.CompletedLoadStyles()),
      )
  },
})

export const LoadFonts = makeCommand('LoadFonts', {
  messages: [Message.CompletedLoadFonts, Message.FailedLoadFonts],
  handler: function* () {
    return () =>
      pipe(
        loadFonts,
        Effect.ensuring(markLoadStep('Fonts')),
        Effect.as(Message.CompletedLoadFonts()),
        Effect.catch(error =>
          Effect.succeed(Message.FailedLoadFonts({ reason: String(error) })),
        ),
      )
  },
})

export const AwaitFirstFrame = makeCommand('AwaitFirstFrame', {
  messages: [Message.CompletedAwaitFirstFrame],
  handler: function* () {
    return () =>
      pipe(
        awaitFirstFrame,
        Effect.andThen(markLoadStep('FirstFrame')),
        Effect.as(Message.CompletedAwaitFirstFrame()),
      )
  },
})

// NOTE: the warm-up canvases start Foldkit loading every sprite image on the
// first frame. This waits for that frame, then decodes the same sources, so
// the splash stays up until the sprites are ready to draw.
export const DecodeSprites = makeCommand('DecodeSprites', {
  messages: [Message.CompletedDecodeSprites],
  handler: function* () {
    return () =>
      pipe(
        awaitFirstFrame,
        Effect.andThen(
          Effect.suspend(() =>
            decodeImages(spriteWarmUpSources(defaultAppearance)),
          ),
        ),
        Effect.andThen(markLoadStep('Sprites')),
        Effect.as(Message.CompletedDecodeSprites()),
      )
  },
})

export const LoadSave = makeCommand('LoadSave', {
  messages: [Message.CompletedLoadSave, Message.FailedLoadSave],
  handler: function* () {
    return () =>
      pipe(
        PlayerStore.use(store => store.load),
        Effect.ensuring(markLoadStep('Save')),
        Effect.map(maybeSave => Message.CompletedLoadSave({ maybeSave })),
        Effect.catch(error =>
          Effect.succeed(Message.FailedLoadSave({ reason: error.reason })),
        ),
      )
  },
})

export const GenerateVisitId = makeCommand('GenerateVisitId', {
  messages: [Message.CompletedGenerateVisitId],
  handler: function* () {
    return () =>
      Effect.map(generateVisitId, visitId =>
        Message.CompletedGenerateVisitId({ visitId }),
      )
  },
})

// NOTE: run summaries that ended offline on an earlier visit are sent now, in
// the background, spaced out, so the Command is done at once.
export const StartSummaryQueue = makeCommand('StartSummaryQueue', {
  messages: [Message.CompletedStartSummaryQueue],
  handler: function* () {
    return () =>
      Effect.as(
        Effect.forkDetach(startSummaryQueue()),
        Message.CompletedStartSummaryQueue(),
      )
  },
})

// BOOT

// NOTE: a share sheet is there when the browser has navigator.share; only a
// touch screen uses it (src/menus.ts).
export const DetectShareSheet = makeCommand('DetectShareSheet', {
  messages: [Message.CompletedDetectShareSheet],
  handler: function* () {
    return () =>
      Effect.sync(() =>
        Message.CompletedDetectShareSheet({
          shareSheet:
            typeof navigator.share === 'function' ? 'Available' : 'Unavailable',
        }),
      )
  },
})

// NOTE: every Command init starts, in this order. A new LoadStep joins
// LOAD_STEPS with a Command here that loads it.
export const bootCommands = () => [
  LoadSave(),
  GenerateSeed(),
  GenerateVisitId(),
  StartSummaryQueue(),
  DetectInputDevice(),
  DetectShareSheet(),
  DetectScreenFit(),
  DetectOrientationLock(),
  DetectLocalPlayers(),
  ReadUpdateMarker(),
  LoadStyles(),
  LoadFonts(),
  AwaitFirstFrame(),
  DecodeSprites(),
]
