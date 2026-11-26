import { UiStruct } from '@effect/ui'

import { bootCommands } from './boot'
import { ApplicationDef } from './definition'
import type { Message } from './message'
import { LOAD_STEPS, Loading, cosmeticSeedOf, initialModel } from './model'
import { beatMyRunHandlers } from './update/beatMyRun'
import { coopHandlers } from './update/coop'
import { orInRun } from './update/coopRun'
import { dialogHandlers } from './update/dialog'
import { endHandlers } from './update/end'
import { deviceHandlers } from './update/fullscreen'
import { homeHandlers } from './update/home'
import { inputHandlers, pageHandlers, runButtonHandlers } from './update/input'
import { lobbyHandlers } from './update/lobby'
import { missionHandlers } from './update/missions'
import { onboardingHandlers } from './update/onboarding'
import { padMenuHandlers } from './update/padMenu'
import { tickFrame } from './update/play'
import { profileHandlers } from './update/profile'
import { recordingHandlers } from './update/recording'
import { saveHandlers } from './update/save'
import { afterMessage } from './update/settle'
import { soundHandlers } from './update/sound'
import { type App$, type UpdateReturn, defineHandlers } from './update/step'
import { todayHandlers } from './update/today'
import { versionHandlers } from './update/version'

// INIT

// NOTE: every LoadStep must finish before the splash goes. A step that
// fails still counts as finished, so a missing font never holds the game.
// New assets join LOAD_STEPS with a Command that loads them.
export const init = ApplicationDef.init($ =>
  $.set(
    UiStruct.evolve(initialModel, {
      saving: UiStruct.evolve({
        loading: () => Loading.Loading({ pending: LOAD_STEPS }),
      }),
    }),
  ).run(...bootCommands()),
)

// NOTE: the root's own frame and seed handlers, beside every group's.
const frameHandlers = defineHandlers({
  TickedFrame: ($, message) =>
    orInRun(message, tickFrame(message.deltaTime))($),

  CompletedGenerateSeed: ($, { seed }) =>
    $.evolve({
      rngState: () => seed,
      cosmetics: UiStruct.evolve({
        cosmeticRngState: () => cosmeticSeedOf(seed),
      }),
    }),

  CompletedDetectLocalPlayers: ($, { count }) =>
    $.evolve({ localPlayers: () => count }),
})

// NOTE: the one exhaustive handler record. Each group of the root's
// Messages has its handlers beside the Steps they call (AGENTS.md
// "Folders"), so a Message with no handler fails here. Each handler holds
// only its own change; `update` below settles every dispatch once after it.
const handle = ApplicationDef.update({
  ...frameHandlers,
  ...dialogHandlers,
  ...inputHandlers,
  ...runButtonHandlers,
  ...pageHandlers,
  ...versionHandlers,
  ...deviceHandlers,
  ...saveHandlers,
  ...recordingHandlers,
  ...todayHandlers,
  ...soundHandlers,
  ...coopHandlers,
  ...beatMyRunHandlers,
  ...lobbyHandlers,
  ...homeHandlers,
  ...endHandlers,
  ...onboardingHandlers,
  ...missionHandlers,
  ...padMenuHandlers,
  ...profileHandlers,
})

// SETTLING

// NOTE: the after-message Steps (src/app/update/settle.ts) run once after
// every dispatch, a child's event included, against the Model from before
// it. A synced save is already in the store, so its Messages settle
// without writing it back.
const SYNCED_SAVES: ReadonlySet<Message['_tag']> = new Set([
  'UpdatedSyncedSave',
  'CompletedReloadSyncedSave',
])

// NOTE: Effect UI calls `update` with the Step and the Message, a signature
// it fixes, so it has no data-last form.
// @effect-diagnostics-next-line missingPipeableSignature:off
export const update = ($: App$, message: Message): UpdateReturn =>
  $.combine(
    handle,
    ...afterMessage(
      $.model,
      SYNCED_SAVES.has(message._tag) ? 'Synced' : 'Write',
    ),
  )
