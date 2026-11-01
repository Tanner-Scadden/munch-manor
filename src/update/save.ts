import { Array, Effect, Option, Schema, pipe } from 'effect'
import { Dom } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { makeCommand } from '../definition'
import { KEEP_TUTORIAL_BUTTON_ID, RESET_TUTORIAL_BUTTON_ID } from '../home'
import { isProfileOpenOn } from '../menuState'
import { Message } from '../message'
import {
  LOAD_STEPS,
  type LoadStep,
  Loading,
  type Model,
  type TutorialReset,
} from '../model'
import {
  LastRunSync,
  LinkFlow,
  PlayerChange,
  RunSettled,
  changesBetween,
  withUnsavedChanges,
} from '../playerSync'
import { grantVeteran } from '../rankRun'
import {
  PlayerSave,
  hasSaveFieldsChanged,
  isSameSave,
  restoreSave,
  saveOf,
} from '../save'
import { hideSplash, showSplashProgress } from '../splash'
import { PlayerStore } from '../store'
import type { UpdateReturn, UpdateStep } from './step'

// COMMAND

export const ShowLoadProgress = makeCommand('ShowLoadProgress', {
  args: { loaded: Schema.Number, total: Schema.Number },
  messages: [Message.CompletedShowLoadProgress],
  handler: function* () {
    return ({ loaded, total }) =>
      pipe(
        showSplashProgress(loaded, total),
        Effect.ignore,
        Effect.as(Message.CompletedShowLoadProgress()),
      )
  },
})

export const HideSplash = makeCommand('HideSplash', {
  messages: [Message.CompletedHideSplash],
  handler: function* () {
    return () =>
      pipe(hideSplash, Effect.ignore, Effect.as(Message.CompletedHideSplash()))
  },
})

// NOTE: the whole save goes along with what changed in it: the store runs
// the changes as player scope mutations, and keeps the whole save only
// where it still writes the localStorage copy.
export const WriteSave = makeCommand('WriteSave', {
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
export const AwaitRunSettled = makeCommand('AwaitRunSettled', {
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

export const ReloadSyncedSave = makeCommand('ReloadSyncedSave', {
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
})

export const RequestLinkCode = makeCommand('RequestLinkCode', {
  messages: [Message.SucceededRequestLinkCode, Message.FailedRequestLinkCode],
  handler: function* () {
    return () =>
      pipe(
        PlayerStore.use(store => store.requestLinkCode),
        Effect.map(code => Message.SucceededRequestLinkCode({ code })),
        Effect.catch(error =>
          Effect.succeed(
            Message.FailedRequestLinkCode({ problem: error.problem }),
          ),
        ),
      )
  },
})

export const RedeemLinkCode = makeCommand('RedeemLinkCode', {
  args: { code: Schema.String },
  messages: [Message.SucceededRedeemLinkCode, Message.FailedRedeemLinkCode],
  handler: function* () {
    return ({ code }) =>
      pipe(
        PlayerStore.use(store => store.redeemLinkCode(code)),
        Effect.as(Message.SucceededRedeemLinkCode()),
        Effect.catch(error =>
          Effect.succeed(
            Message.FailedRedeemLinkCode({ problem: error.problem }),
          ),
        ),
      )
  },
})

export const FocusTutorialReset = makeCommand('FocusTutorialReset', {
  args: { id: Schema.String },
  messages: [Message.CompletedFocusTutorialReset],
  handler: function* () {
    return ({ id }) =>
      Dom.focus(`#${id}`).pipe(
        Effect.ignore,
        Effect.as(Message.CompletedFocusTutorialReset()),
      )
  },
})

// LOADING

export const finishLoading = (model: Model, step: LoadStep): UpdateReturn =>
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
  })

// SAVE

export const loadSave = (
  model: Model,
  maybeSave: Option.Option<PlayerSave>,
): UpdateReturn => {
  const restored = Option.match(maybeSave, {
    onNone: () => model,
    onSome: save => restoreSave(model, save),
  })
  const granted = modifyFields(grantVeteran(restored), {
    saveStatus: () => 'Read',
  })
  const loaded = finishLoading(granted, 'Save')
  // NOTE: a player with no save has nothing to write yet: their first write
  // seeds the store with the whole save, the grant in it. A save from before
  // rank writes the grant it was just given, as the change it is.
  return Option.isSome(maybeSave) && !restored.rank.isVeteranGranted
    ? {
        model: modifyFields(loaded.model, {
          writesInFlight: count => count + 1,
        }),
        commands: [
          ...(loaded.commands ?? []),
          WriteSave({
            save: saveOf(granted),
            changes: changesBetween(saveOf(restored), saveOf(granted)),
          }),
        ],
      }
    : loaded
}

// NOTE: a save that arrived from sync is already in the store, so taking
// it into the Model writes nothing back. Every other change to the save is
// written with the mutations that describe it.
export const writeSaveFrom =
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
  }

// NOTE: a save from another device, or from the server, replaces what this
// device shows: its look, settings, difficulty, and bests. Lessons and
// unlocks only ever move forward, as on load.
export const takeSyncedSave = (model: Model, save: PlayerSave): UpdateReturn =>
  model.writesInFlight > 0
    ? { model: modifyFields(model, { syncedSave: () => 'Stale' }) }
    : { model: restoreSave(model, save) }

// NOTE: once this device's own writes have landed, a save from sync that
// was held back is read again from the store, which by then has both.
export const finishWrite = (model: Model): UpdateReturn => {
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
export const finishWriteWithRun = (
  model: Model,
  runId: string,
): UpdateReturn => {
  const finished = finishWrite(model)
  return {
    model: modifyFields(finished.model, {
      lastRunSync: () => LastRunSync.Waiting({ id: runId }),
    }),
    commands: [...(finished.commands ?? []), AwaitRunSettled({ runId })],
  }
}

const isWaitingFor = (model: Model, runId: string): boolean =>
  model.lastRunSync._tag === 'Waiting' && model.lastRunSync.id === runId

export const settleRun = (
  model: Model,
  runId: string,
  settled: RunSettled,
): UpdateReturn =>
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
    : { model }

// NOTE: the store could not tell, so the Model stops claiming to know.
export const forgetRunWait = (model: Model, runId: string): UpdateReturn =>
  isWaitingFor(model, runId)
    ? { model: modifyFields(model, { lastRunSync: () => LastRunSync.NoRun() }) }
    : { model }

// NOTE: the store logged why. The changes it could not write wait in the
// Model and go out again with the next change to the save, so a run that
// finished during a failed write still counts once.
export const failWrite = (
  model: Model,
  changes: ReadonlyArray<PlayerChange>,
): UpdateReturn =>
  finishWrite(
    modifyFields(model, {
      unsavedChanges: unsaved => [...changes, ...unsaved],
    }),
  )

// LINKING

export const startLinking = (model: Model): UpdateReturn =>
  LinkFlow.match(model.linkFlow, {
    Requesting: () => ({ model }),
    Redeeming: () => ({ model }),
    Idle: () => requestLinkCode(model),
    Showing: () => requestLinkCode(model),
    Entering: () => requestLinkCode(model),
    Linked: () => requestLinkCode(model),
    Failed: () => requestLinkCode(model),
  })

const requestLinkCode = (model: Model): UpdateReturn => ({
  model: modifyFields(model, { linkFlow: () => LinkFlow.Requesting() }),
  commands: [RequestLinkCode()],
})

export const typeLinkCode = (model: Model, value: string): UpdateReturn =>
  LinkFlow.isAnyOf(['Entering', 'Failed'])(model.linkFlow)
    ? {
        model: modifyFields(model, {
          linkFlow: () =>
            LinkFlow.Entering({ code: value.toUpperCase().slice(0, 7) }),
        }),
      }
    : { model }

export const submitLinkCode = (model: Model): UpdateReturn =>
  LinkFlow.match(model.linkFlow, {
    Entering: ({ code }) => ({
      model: modifyFields(model, {
        linkFlow: () => LinkFlow.Redeeming({ code }),
      }),
      commands: [RedeemLinkCode({ code })],
    }),
    Idle: () => ({ model }),
    Requesting: () => ({ model }),
    Showing: () => ({ model }),
    Redeeming: () => ({ model }),
    Linked: () => ({ model }),
    Failed: () => ({ model }),
  })

// TUTORIAL RESET

export const askToResetTutorial = (model: Model): UpdateReturn =>
  isProfileOpenOn(model, 'Settings')
    ? {
        model: modifyFields(model, { tutorialReset: () => 'Asking' }),
        commands: [FocusTutorialReset({ id: KEEP_TUTORIAL_BUTTON_ID })],
      }
    : { model }

export const answerTutorialReset = (
  model: Model,
  forget: (model: Model) => Model,
  tutorialReset: TutorialReset,
): UpdateReturn =>
  model.tutorialReset === 'Asking'
    ? {
        model: modifyFields(forget(model), {
          tutorialReset: () => tutorialReset,
        }),
        commands: [FocusTutorialReset({ id: RESET_TUTORIAL_BUTTON_ID })],
      }
    : { model }
