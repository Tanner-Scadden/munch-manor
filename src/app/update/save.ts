import { Array, Effect, Function, Option, Schema, pipe } from 'effect'
import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { cleanName } from '../../domain/playerName'
import { grantVeteran, payPurses } from '../../features/end/rankRun'
import {
  LastRunSync,
  PlayerChange,
  RunSettled,
  changesBetween,
  withUnsavedChanges,
} from '../../platform/playerSync'
import {
  PlayerSave,
  hasSaveFieldsChanged,
  isSameSave,
  restoreSave,
  saveOf,
} from '../../platform/save'
import { hideSplash, showSplashProgress } from '../../platform/splash'
import { PlayerStore } from '../../platform/store'
import { RUNNING_BUILD } from '../../platform/version'
import { SEEN_BASELINE } from '../../shared/playerData'
import { ProfileBinding } from '../bindings'
import { ApplicationBlock, makeStep } from '../definition'
import { Message } from '../message'
import { LOAD_STEPS, type LoadStep, Loading, type Model } from '../model'
import { askForRoomLink } from './coop'
import {
  type UpdateReturn,
  type UpdateStep,
  combine,
  defineHandlers,
  modelStep,
  unchanged,
} from './step'
import { registerServiceWorkerAfterSplash } from './version'

// COMMAND

export const ShowLoadProgress = ApplicationBlock.makeCommand(
  'ShowLoadProgress',
  {
    args: { loaded: Schema.Finite, total: Schema.Finite },
    messages: [Message.CompletedShowLoadProgress],
    handler: function* () {
      return ({ loaded, total }) =>
        pipe(
          showSplashProgress(loaded, total),
          Effect.ignore,
          Effect.as(Message.CompletedShowLoadProgress()),
        )
    },
  },
)

export const HideSplash = ApplicationBlock.makeCommand('HideSplash', {
  messages: [Message.CompletedHideSplash],
  handler: function* () {
    return () =>
      pipe(hideSplash, Effect.ignore, Effect.as(Message.CompletedHideSplash()))
  },
})

// NOTE: the whole save goes along with what changed in it: the store runs
// the changes as player scope mutations, and keeps the whole save only
// where it still writes the localStorage copy.
export const WriteSave = ApplicationBlock.makeCommand('WriteSave', {
  args: { save: PlayerSave, changes: Schema.Array(PlayerChange) },
  messages: [
    Message.CompletedWriteSave,
    Message.CompletedWriteSaveWithRun,
    Message.FailedWriteSave,
  ],
  handler: function* () {
    return ({ save, changes }) =>
      pipe(
        PlayerStore.use(store => store.write(save, changes)),
        Effect.map(maybeRunId =>
          Option.match(maybeRunId, {
            onNone: () => Message.CompletedWriteSave(),
            onSome: runId => Message.CompletedWriteSaveWithRun({ runId }),
          }),
        ),
        Effect.catch(error =>
          Effect.succeed(
            Message.FailedWriteSave({ reason: error.reason, changes }),
          ),
        ),
      )
  },
})

// NOTE: waits for the server to confirm or reject a recorded run. Offline,
// it waits until the device is back and the run goes out.
export const AwaitRunSettled = ApplicationBlock.makeCommand('AwaitRunSettled', {
  args: { runId: Schema.String },
  messages: [Message.SettledRecordedRun, Message.FailedAwaitRunSettled],
  handler: function* () {
    return ({ runId }) =>
      pipe(
        PlayerStore.use(store => store.awaitSettled(runId)),
        Effect.map(settled => Message.SettledRecordedRun({ runId, settled })),
        Effect.catch(error =>
          Effect.succeed(
            Message.FailedAwaitRunSettled({ runId, reason: error.reason }),
          ),
        ),
      )
  },
})

export const ReloadSyncedSave = ApplicationBlock.makeCommand(
  'ReloadSyncedSave',
  {
    messages: [Message.CompletedReloadSyncedSave],
    handler: function* () {
      return () =>
        pipe(
          PlayerStore.use(store => store.load),
          Effect.map(maybeSave =>
            Message.CompletedReloadSyncedSave({ maybeSave }),
          ),
          Effect.orElseSucceed(() =>
            Message.CompletedReloadSyncedSave({ maybeSave: Option.none() }),
          ),
        )
    },
  },
)

// LOADING

const finishLoading: {
  (step: LoadStep): (model: Model) => UpdateReturn
  (model: Model, step: LoadStep): UpdateReturn
} = Function.dual(2, (model: Model, step: LoadStep): UpdateReturn =>
  Loading.match(model.loading, {
    Loaded: () => ({ model }),
    Loading: ({ pending }) => {
      const remaining = Array.filter(pending, waiting => waiting !== step)
      const progress = ShowLoadProgress({
        loaded: LOAD_STEPS.length - remaining.length,
        total: LOAD_STEPS.length,
      })
      if (Array.isReadonlyArrayEmpty(remaining)) {
        return {
          model: modifyFields(model, { loading: () => Loading.Loaded() }),
          commands: [progress, HideSplash()],
        }
      } else {
        return {
          model: modifyFields(model, {
            loading: () => Loading.Loading({ pending: remaining }),
          }),
          commands: [progress],
        }
      }
    },
  }),
)

// SAVE

const loadSave: {
  (maybeSave: Option.Option<PlayerSave>): (model: Model) => UpdateReturn
  (model: Model, maybeSave: Option.Option<PlayerSave>): UpdateReturn
} = Function.dual(
  2,
  (model: Model, maybeSave: Option.Option<PlayerSave>): UpdateReturn => {
    const restored = Option.match(maybeSave, {
      onNone: () => model,
      onSome: save => restoreSave(model, save),
    })
    const granted = modifyFields(payPurses(grantVeteran(restored)), {
      saveStatus: () => 'Read',
    })
    const loaded = finishLoading(granted, 'Save')
    // NOTE: a player with no save has nothing to write yet: their first write
    // seeds the store with the whole save, the grant in it. A save from before
    // rank writes the grant it was just given, as the change it is. A row from
    // before NEW badges writes the unlocks its baseline mark stood for.
    const isBaseline = Option.exists(maybeSave, save =>
      Array.contains(save.seenUnlocks, SEEN_BASELINE),
    )
    // NOTE: RECORD MY RUNS unlocked on this device before the save was read
    // (a `?record=1` link, or a mark from before it synced) goes into the
    // save, and so to every linked device.
    const isRecordUnlockNew = Option.exists(
      maybeSave,
      save =>
        save.recordUnlock === 'Locked' && granted.recordUnlock === 'Unlocked',
    )
    // NOTE: the purses the save's rank reached unpaid (a save from before
    // the purses, or the front-loaded curve's new ranks) write as paid.
    const isPursePaid = granted.bonuses.purses !== restored.bonuses.purses
    return Option.isSome(maybeSave) &&
      (!restored.rank.isVeteranGranted ||
        isBaseline ||
        isRecordUnlockNew ||
        isPursePaid)
      ? {
          model: modifyFields(loaded.model, {
            writesInFlight: count => count + 1,
          }),
          commands: [
            ...(loaded.commands ?? []),
            WriteSave({
              save: saveOf(granted),
              changes: [
                ...changesBetween(saveOf(restored), saveOf(granted)),
                ...(isBaseline
                  ? [PlayerChange.SawUnlocks({ ids: granted.seenUnlocks })]
                  : []),
                ...(isRecordUnlockNew
                  ? [PlayerChange.UnlockedRecording()]
                  : []),
              ],
            }),
          ],
        }
      : loaded
  },
)

// NOTE: a save that arrived from sync is already in the store, so taking
// it into the Model writes nothing back. Every other change to the save is
// written with the mutations that describe it.
export const writeSaveFrom: {
  (saveWrite: 'Write' | 'Synced'): (before: Model) => UpdateStep
  (before: Model, saveWrite: 'Write' | 'Synced'): UpdateStep
} = Function.dual(
  2,
  (before: Model, saveWrite: 'Write' | 'Synced'): UpdateStep =>
    stepModel => {
      if (
        before.saveStatus === 'Unread' ||
        stepModel.saveStatus === 'Unread' ||
        saveWrite === 'Synced' ||
        !hasSaveFieldsChanged(before, stepModel)
      ) {
        return { model: stepModel }
      }

      const beforeSave = saveOf(before)
      const save = saveOf(stepModel)
      return isSameSave(beforeSave, save)
        ? { model: stepModel }
        : {
            model: modifyFields(stepModel, {
              writesInFlight: count => count + 1,
              unsavedChanges: () => [],
            }),
            commands: [
              WriteSave({
                save,
                changes: withUnsavedChanges(
                  stepModel.unsavedChanges,
                  changesBetween(beforeSave, save),
                  save,
                ),
              }),
            ],
          }
    },
)

// NOTE: a save from another device, or from the server, replaces what this
// device shows: its look, settings, difficulty, and bests. Lessons and
// unlocks only ever move forward, as on load. The Profile hears of a new
// name too, so a draft it holds from before never puts the old one back.
const takeSyncedSave = (save: PlayerSave) =>
  makeStep(model =>
    model.writesInFlight > 0
      ? modelStep(stepModel =>
          modifyFields(stepModel, { syncedSave: () => 'Stale' }),
        )
      : Update.combineSteps([
          modelStep(stepModel => restoreSave(stepModel, save)),
          ProfileBinding.informOfSyncedName({
            was: model.playerName,
            name: cleanName(save.name),
          }),
        ]),
  )

// NOTE: once this device's own writes have landed, a save from sync that
// was held back is read again from the store, which by then has both.
const finishWrite = (model: Model): UpdateReturn => {
  const next = modifyFields(model, {
    writesInFlight: count => Math.max(count - 1, 0),
  })
  return next.writesInFlight === 0 && next.syncedSave === 'Stale'
    ? {
        model: modifyFields(next, { syncedSave: () => 'Current' }),
        commands: [ReloadSyncedSave()],
      }
    : { model: next }
}

// NOTE: a write that recorded a run, on a build with a sync server, waits
// for the server to settle it, so the Model knows the run reached it.
const finishWriteWithRun: {
  (runId: string): (model: Model) => UpdateReturn
  (model: Model, runId: string): UpdateReturn
} = Function.dual(2, (model: Model, runId: string): UpdateReturn => {
  const finished = finishWrite(model)
  return {
    model: modifyFields(finished.model, {
      lastRunSync: () => LastRunSync.Waiting({ id: runId }),
    }),
    commands: [...(finished.commands ?? []), AwaitRunSettled({ runId })],
  }
})

const isWaitingFor = (model: Model, runId: string): boolean =>
  model.lastRunSync._tag === 'Waiting' && model.lastRunSync.id === runId

const settleRun: {
  (runId: string, settled: RunSettled): (model: Model) => UpdateReturn
  (model: Model, runId: string, settled: RunSettled): UpdateReturn
} = Function.dual(
  3,
  (model: Model, runId: string, settled: RunSettled): UpdateReturn =>
    isWaitingFor(model, runId)
      ? {
          model: modifyFields(model, {
            lastRunSync: () =>
              RunSettled.match(settled, {
                Confirmed: ({ seq }) => LastRunSync.Confirmed({ seq }),
                Rejected: ({ reason }) => LastRunSync.Rejected({ reason }),
              }),
          }),
        }
      : { model },
)

// NOTE: the store could not tell, so the Model stops claiming to know.
const forgetRunWait: {
  (runId: string): (model: Model) => UpdateReturn
  (model: Model, runId: string): UpdateReturn
} = Function.dual(2, (model: Model, runId: string): UpdateReturn =>
  isWaitingFor(model, runId)
    ? { model: modifyFields(model, { lastRunSync: () => LastRunSync.NoRun() }) }
    : { model },
)

// NOTE: the store logged why. The changes it could not write wait in the
// Model and go out again with the next change to the save, so a run that
// finished during a failed write still counts once.
const failWrite: {
  (changes: ReadonlyArray<PlayerChange>): (model: Model) => UpdateReturn
  (model: Model, changes: ReadonlyArray<PlayerChange>): UpdateReturn
} = Function.dual(
  2,
  (model: Model, changes: ReadonlyArray<PlayerChange>): UpdateReturn =>
    finishWrite(
      modifyFields(model, {
        unsavedChanges: unsaved => [...changes, ...unsaved],
      }),
    ),
)

// NOTE: the splash's load steps, the save and sync, and the run summaries
// (src/platform/message.ts).
export const saveHandlers = defineHandlers({
  CompletedLoadStyles: model => finishLoading(model, 'Styles'),

  CompletedLoadFonts: model => finishLoading(model, 'Fonts'),

  FailedLoadFonts: model => finishLoading(model, 'Fonts'),

  CompletedAwaitFirstFrame: model => finishLoading(model, 'FirstFrame'),

  CompletedDecodeSprites: model => finishLoading(model, 'Sprites'),

  CompletedShowLoadProgress: model => ({ model }),

  CompletedHideSplash: model =>
    combine(model, [
      stepModel => registerServiceWorkerAfterSplash(stepModel, RUNNING_BUILD),
      askForRoomLink,
    ]),

  CompletedLoadSave: (model, { maybeSave }) => loadSave(model, maybeSave),

  FailedLoadSave: model => loadSave(model, Option.none()),

  CompletedWriteSave: model => finishWrite(model),

  CompletedWriteSaveWithRun: (model, { runId }) =>
    finishWriteWithRun(model, runId),

  FailedWriteSave: (model, { changes }) => failWrite(model, changes),

  UpdatedSyncedSave: (model, { save }) => takeSyncedSave(save)(model),

  CompletedReloadSyncedSave: (model, { maybeSave }) =>
    Option.match(maybeSave, {
      onNone: () => unchanged(model),
      onSome: save => takeSyncedSave(save)(model),
    }),

  UpdatedSyncStatus: (model, { state }) => ({
    model: modifyFields(model, { syncState: () => state }),
  }),

  UpdatedPlayerScopeStatus: (model, { status }) => ({
    model: modifyFields(model, { playerScopeStatus: () => status }),
  }),

  SettledRecordedRun: (model, { runId, settled }) =>
    settleRun(model, runId, settled),

  FailedAwaitRunSettled: (model, { runId }) => forgetRunWait(model, runId),

  CompletedGenerateVisitId: (model, { visitId }) => ({
    model: modifyFields(model, { maybeVisitId: () => Option.some(visitId) }),
  }),

  CompletedStartSummaryQueue: model => ({ model }),

  CompletedSendRunSummary: model => ({ model }),

  FailedSendRunSummary: model => ({ model }),
})
