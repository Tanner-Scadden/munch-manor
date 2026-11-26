import { Function } from 'effect'

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

export const init = ApplicationDef.init($ =>
  $.set(
    UiStruct.evolve(initialModel, {
      saving: UiStruct.evolve({
        loading: () => Loading.Loading({ pending: LOAD_STEPS }),
      }),
    }),
  ).run(...bootCommands()),
)

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

const SYNCED_SAVES: ReadonlySet<Message['_tag']> = new Set([
  'UpdatedSyncedSave',
  'CompletedReloadSyncedSave',
])

export const update: {
  (message: Message): ($: App$) => UpdateReturn
  ($: App$, message: Message): UpdateReturn
} = Function.dual(2, ($: App$, message: Message): UpdateReturn =>
  $.combine(
    handle,
    ...afterMessage(
      $.model,
      SYNCED_SAVES.has(message._tag) ? 'Synced' : 'Write',
    ),
  ),
)
