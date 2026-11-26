import { Array, Effect, Function, Option, Schema, pipe } from 'effect'

import { Command, Component, UiStruct } from '@effect/ui'

import { grantVeteran, payPurses } from '../../features/end/rankRun'
import { LoadMessage, SaveMessage } from '../../platform/message'
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
import { LOAD_STEPS, type LoadStep, Loading, type Model } from '../model'
import { askForBeatLink } from './beatMyRun'
import { askForRoomLink } from './coop'
import { takeSyncedName } from './profile'
import {
  type UpdateStep,
  combine,
  defineHandlers,
  modelStep,
  toModel,
} from './step'
import { registerServiceWorkerAfterSplash } from './version'

export const ShowLoadProgress = Command.make(
  'ShowLoadProgress',
  { args: { loaded: Schema.Finite, total: Schema.Finite } },
  ({ loaded, total }) =>
    pipe(
      showSplashProgress(loaded, total),
      Effect.ignore,
      Effect.as(Component.noop),
    ),
)

export const HideSplash = Command.make('HideSplash', { args: {} }, () =>
  pipe(hideSplash, Effect.ignore, Effect.as(LoadMessage.CompletedHideSplash())),
)

export class WriteSave extends Command.Service<WriteSave>()('app/WriteSave', {
  args: { save: PlayerSave, changes: Schema.Array(PlayerChange) },
  success: SaveMessage,
  mode: 'queue',
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const store = yield* PlayerStore
      return ({ save, changes }) =>
        store.write(save, changes).pipe(
          Effect.match({
            onSuccess: maybeRunId =>
              Option.match(maybeRunId, {
                onNone: () => SaveMessage.CompletedWriteSave(),
                onSome: runId =>
                  SaveMessage.CompletedWriteSaveWithRun({ runId }),
              }),
            onFailure: error =>
              SaveMessage.FailedWriteSave({ reason: error.reason, changes }),
          }),
        )
    }),
  )
}

export class AwaitRunSettled extends Command.Service<AwaitRunSettled>()(
  'app/AwaitRunSettled',
  { args: { runId: Schema.String }, success: SaveMessage },
) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const store = yield* PlayerStore
      return ({ runId }) =>
        store.awaitSettled(runId).pipe(
          Effect.match({
            onSuccess: settled =>
              SaveMessage.SettledRecordedRun({ runId, settled }),
            onFailure: error =>
              SaveMessage.FailedAwaitRunSettled({
                runId,
                reason: error.reason,
              }),
          }),
        )
    }),
  )
}

export class ReloadSyncedSave extends Command.Service<ReloadSyncedSave>()(
  'app/ReloadSyncedSave',
  { args: {}, success: SaveMessage },
) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const store = yield* PlayerStore
      return () =>
        store.load.pipe(
          Effect.map(maybeSave =>
            SaveMessage.CompletedReloadSyncedSave({ maybeSave }),
          ),
          Effect.orElseSucceed(() =>
            SaveMessage.CompletedReloadSyncedSave({ maybeSave: Option.none() }),
          ),
        )
    }),
  )
}

const finishLoading =
  (step: LoadStep): UpdateStep =>
  $ =>
    Loading.match($.model.saving.loading, {
      Loaded: () => $.model,
      Loading: ({ pending }) => {
        const remaining = Array.filter(pending, waiting => waiting !== step)
        const progress = ShowLoadProgress.make({
          loaded: LOAD_STEPS.length - remaining.length,
          total: LOAD_STEPS.length,
        })
        return Array.isReadonlyArrayEmpty(remaining)
          ? $.evolve({
              saving: UiStruct.evolve({ loading: Loading.Loaded() }),
            }).run(progress, HideSplash.make())
          : $.evolve({
              saving: UiStruct.evolve({
                loading: Loading.Loading({ pending: remaining }),
              }),
            }).run(progress)
      },
    })

const loadSave =
  (maybeSave: Option.Option<PlayerSave>): UpdateStep =>
  $ => {
    const restored = Option.match(maybeSave, {
      onNone: () => $.model,
      onSome: save => restoreSave($.model, save),
    })
    const granted = UiStruct.evolve(payPurses(grantVeteran(restored)), {
      saving: UiStruct.evolve({ saveStatus: () => 'Read' }),
    })
    const loaded = $.combine(toModel(granted), finishLoading('Save'))
    const isBaseline = Option.exists(maybeSave, save =>
      Array.contains(save.seenUnlocks, SEEN_BASELINE),
    )
    const isRecordUnlockNew = Option.exists(
      maybeSave,
      save =>
        save.recordUnlock === 'Locked' && granted.recordUnlock === 'Unlocked',
    )
    const isPursePaid = granted.bonuses.purses !== restored.bonuses.purses
    return Option.isSome(maybeSave) &&
      (!restored.rank.isVeteranGranted ||
        isBaseline ||
        isRecordUnlockNew ||
        isPursePaid)
      ? loaded
          .evolve({
            saving: UiStruct.evolve({ writesInFlight: count => count + 1 }),
          })
          .run(
            WriteSave.make({
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
          )
      : loaded
  }

export const writeSaveFrom: {
  (saveWrite: 'Write' | 'Synced'): (before: Model) => UpdateStep
  (before: Model, saveWrite: 'Write' | 'Synced'): UpdateStep
} = Function.dual(
  2,
  (before: Model, saveWrite: 'Write' | 'Synced'): UpdateStep =>
    $ => {
      const stepModel = $.model
      if (
        before.saving.saveStatus === 'Unread' ||
        stepModel.saving.saveStatus === 'Unread' ||
        saveWrite === 'Synced' ||
        !hasSaveFieldsChanged(before, stepModel)
      ) {
        return $.model
      }

      const beforeSave = saveOf(before)
      const save = saveOf(stepModel)
      return isSameSave(beforeSave, save)
        ? $.model
        : $.evolve({
            saving: UiStruct.evolve({
              writesInFlight: count => count + 1,
              unsavedChanges: [],
            }),
          }).run(
            WriteSave.make({
              save,
              changes: withUnsavedChanges(
                stepModel.saving.unsavedChanges,
                changesBetween(beforeSave, save),
                save,
              ),
            }),
          )
    },
)

const takeSyncedSave =
  (save: PlayerSave): UpdateStep =>
  $ =>
    $.model.saving.writesInFlight > 0
      ? $.evolve({ saving: UiStruct.evolve({ syncedSave: 'Stale' }) })
      : takeSyncedName(restoreSave($.model, save), $.model.playerName)

const finishWrite: UpdateStep = $ => {
  const next: Model = UiStruct.evolve($.model, {
    saving: UiStruct.evolve({
      writesInFlight: count => Math.max(count - 1, 0),
    }),
  })
  return next.saving.writesInFlight === 0 && next.saving.syncedSave === 'Stale'
    ? $.set(
        UiStruct.evolve(next, {
          saving: UiStruct.evolve({ syncedSave: () => 'Current' }),
        }),
      ).run(ReloadSyncedSave.make())
    : next
}

const finishWriteWithRun =
  (runId: string): UpdateStep =>
  $ =>
    $.combine(finishWrite, waited =>
      waited
        .evolve({
          saving: UiStruct.evolve({
            lastRunSync: LastRunSync.Waiting({ id: runId }),
          }),
        })
        .run(AwaitRunSettled.make({ runId })),
    )

const isWaitingFor = (model: Model, runId: string): boolean =>
  model.saving.lastRunSync._tag === 'Waiting' &&
  model.saving.lastRunSync.id === runId

const settleRun =
  (runId: string, settled: RunSettled): UpdateStep =>
  $ =>
    isWaitingFor($.model, runId)
      ? $.evolve({
          saving: UiStruct.evolve({
            lastRunSync: RunSettled.match(settled, {
              Confirmed: ({ seq }) => LastRunSync.Confirmed({ seq }),
              Rejected: ({ reason }) => LastRunSync.Rejected({ reason }),
            }),
          }),
        })
      : $.model

const forgetRunWait =
  (runId: string): UpdateStep =>
  $ =>
    isWaitingFor($.model, runId)
      ? $.evolve({
          saving: UiStruct.evolve({ lastRunSync: LastRunSync.NoRun() }),
        })
      : $.model

const failWrite = (changes: ReadonlyArray<PlayerChange>): UpdateStep =>
  combine([
    modelStep(model =>
      UiStruct.evolve(model, {
        saving: UiStruct.evolve({
          unsavedChanges: unsaved => [...changes, ...unsaved],
        }),
      }),
    ),
    finishWrite,
  ])

export const saveHandlers = defineHandlers({
  CompletedLoadStyles: finishLoading('Styles'),

  CompletedLoadFonts: finishLoading('Fonts'),

  FailedLoadFonts: finishLoading('Fonts'),

  CompletedAwaitFirstFrame: finishLoading('FirstFrame'),

  CompletedDecodeSprites: finishLoading('Sprites'),

  CompletedHideSplash: combine([
    registerServiceWorkerAfterSplash(RUNNING_BUILD),
    askForRoomLink,
    askForBeatLink,
  ]),

  CompletedLoadSave: ($, { maybeSave }) => loadSave(maybeSave)($),

  FailedLoadSave: loadSave(Option.none()),

  CompletedWriteSave: finishWrite,

  CompletedWriteSaveWithRun: ($, { runId }) => finishWriteWithRun(runId)($),

  FailedWriteSave: ($, { changes }) => failWrite(changes)($),

  UpdatedSyncedSave: ($, { save }) => takeSyncedSave(save)($),

  CompletedReloadSyncedSave: ($, { maybeSave }) =>
    Option.match(maybeSave, {
      onNone: () => $.model,
      onSome: save => takeSyncedSave(save)($),
    }),

  UpdatedSyncStatus: ($, { state }) =>
    $.evolve({ saving: UiStruct.evolve({ syncState: state }) }),

  UpdatedPlayerScopeStatus: ($, { status }) =>
    $.evolve({ saving: UiStruct.evolve({ playerScopeStatus: status }) }),

  SettledRecordedRun: ($, { runId, settled }) => settleRun(runId, settled)($),

  FailedAwaitRunSettled: ($, { runId }) => forgetRunWait(runId)($),

  CompletedGenerateVisitId: ($, { visitId }) =>
    $.evolve({ maybeVisitId: Option.some(visitId) }),
})
