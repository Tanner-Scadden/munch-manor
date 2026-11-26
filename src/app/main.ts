import { Function } from 'effect'

import { UiStruct } from '@effect/ui'

import { bootCommands } from './boot.ts'
import { ApplicationDef } from './definition.ts'
import type { Message } from './message.ts'
import { LOAD_STEPS, Loading, cosmeticSeedOf, initialModel } from './model.ts'
import { beatMyRunHandlers } from './update/beatMyRun.ts'
import { coopHandlers } from './update/coop.ts'
import { orInRun } from './update/coopRun.ts'
import { dialogHandlers } from './update/dialog.ts'
import { endHandlers } from './update/end.ts'
import { deviceHandlers } from './update/fullscreen.ts'
import { homeHandlers } from './update/home.ts'
import {
  inputHandlers,
  pageHandlers,
  runButtonHandlers,
} from './update/input.ts'
import { lobbyHandlers } from './update/lobby.ts'
import { missionHandlers } from './update/missions.ts'
import { onboardingHandlers } from './update/onboarding.ts'
import { padMenuHandlers } from './update/padMenu.ts'
import { tickFrame } from './update/play.ts'
import { profileHandlers } from './update/profile.ts'
import { recordingHandlers } from './update/recording.ts'
import { saveHandlers } from './update/save.ts'
import { afterMessage } from './update/settle.ts'
import { soundHandlers } from './update/sound.ts'
import { type App$, type UpdateReturn, defineHandlers } from './update/step.ts'
import { todayHandlers } from './update/today.ts'
import { versionHandlers } from './update/version.ts'

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
