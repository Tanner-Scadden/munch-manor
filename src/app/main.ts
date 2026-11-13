import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { bootCommands } from './boot'
import { ApplicationComposition } from './composition'
import { makeStep } from './definition'
import { LOAD_STEPS, Loading, cosmeticSeedOf, initialModel } from './model'
import { coopHandlers } from './update/coop'
import { orInRun } from './update/coopRun'
import { endHandlers } from './update/end'
import { deviceHandlers } from './update/fullscreen'
import { homeHandlers } from './update/home'
import { inputHandlers, pageHandlers, runButtonHandlers } from './update/input'
import { lobbyHandlers } from './update/lobby'
import { onboardingHandlers } from './update/onboarding'
import { padMenuHandlers } from './update/padMenu'
import { tickFrame } from './update/play'
import { recordingHandlers } from './update/recording'
import { saveHandlers } from './update/save'
import { afterMessage } from './update/settle'
import { soundHandlers } from './update/sound'
import { combine } from './update/step'
import { todayHandlers } from './update/today'
import { versionHandlers } from './update/version'
// INIT

// NOTE: every LoadStep must finish before the splash goes. A step that
// fails still counts as finished, so a missing font never holds the game.
// New assets, such as images for Canvas.Image, join LOAD_STEPS with a
// Command that loads them.
export const init = ApplicationComposition.makeInit(() => ({
  model: modifyFields(initialModel, {
    loading: () => Loading.Loading({ pending: LOAD_STEPS }),
  }),
  commands: bootCommands(),
}))

const { makeUpdate } = ApplicationComposition

// NOTE: the one exhaustive handler record. Each group of the root's
// Messages has its handlers beside the Steps they call (AGENTS.md
// "Folders"), so a Message with no handler fails here. Each handler holds
// only its own change; `update` below settles every dispatch once after it.
const handlers = makeUpdate({
  TickedFrame: (model, message) =>
    Update.combineSteps(model, [
      makeStep(orInRun(message, tickFrame(message.deltaTime))),
    ]),

  CompletedGenerateSeed: (model, { seed }) => ({
    model: modifyFields(model, {
      rngState: () => seed,
      cosmeticRngState: () => cosmeticSeedOf(seed),
    }),
  }),

  CompletedDetectLocalPlayers: (model, { count }) => ({
    model: modifyFields(model, { localPlayers: () => count }),
  }),

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
  ...lobbyHandlers,
  ...homeHandlers,
  ...endHandlers,
  ...onboardingHandlers,
  ...padMenuHandlers,
})

// SETTLING

// NOTE: the after-message Steps (src/app/update/settle.ts) run once after every
// dispatch, a child's delivery and its OutMessage fold included, against
// the Model from before it. A synced save is already in the store, so its
// Messages settle without writing it back.
const SYNCED_SAVES = ['UpdatedSyncedSave', 'CompletedReloadSyncedSave'] as const

const settleWritten = makeUpdate.except(SYNCED_SAVES)(
  (model, _message, { before }) =>
    combine(model, afterMessage(before, 'Write')),
)

const settleSynced = makeUpdate.on(SYNCED_SAVES)(
  (model, _message, { before }) =>
    combine(model, afterMessage(before, 'Synced')),
)

export const update = makeUpdate.compose(handlers, settleWritten, settleSynced)
