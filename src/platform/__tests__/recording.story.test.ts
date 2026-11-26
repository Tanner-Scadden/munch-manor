import { Array, Option } from 'effect'

import { Component, UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { Message } from '#app/message.ts'
import { type Model, Phase } from '#app/model.ts'
import { UploadRecording } from '#app/update/recording.ts'
import { WriteSave } from '#app/update/save.ts'
import { SendRunSummary } from '#app/update/settle.ts'
import { PlayerChange } from '#platform/playerSync.ts'
import { RunRecorder, beginRecording } from '#platform/recording.ts'
import { saveOf } from '#platform/save.ts'
import { FIXED_STEP_MS } from '#shared/constants.ts'
import {
  homeAfterRead,
  lastHeart,
  loadingSave,
  veteranFighting,
} from '#test/model.fixture.ts'
import {
  SURFACE,
  checkModel,
  checkPendingArgs,
  finishSplash,
  modelAfter,
  send,
  settleRunCommands,
  steps,
  writeSave,
} from '#test/testing.ts'
import { focusOf } from '#world/party/party.ts'

import { learnedSave } from './save.fixture.ts'

const VISIT_ID = '0123456789abcdef'

const recordingLastHeart = (recordRuns: 'On' | 'Off'): Model => {
  const run = lastHeart(
    UiStruct.evolve(veteranFighting, {
      maybeSurface: () => Option.some(SURFACE),
      maybeVisitId: () => Option.some(VISIT_ID),
      recordUnlock: () => 'Unlocked',
      settings: UiStruct.evolve({ recordRuns: () => recordRuns }),
    }),
  )
  return UiStruct.evolve(run, {
    recorder: () =>
      beginRecording({
        world: run,
        maybeVisitId: run.maybeVisitId,
        build: 'test',
        device: run.lastDevice,
        localPlayers: 1,
        botSlots: [],
        focusSlot: focusOf(run).seat.slot,
      }),
  })
}

describe('RECORD MY RUNS', () => {
  it.effect(
    'opening with ?record=1 unlocks the tile, saved and synced to every device',
    () =>
      modelAfter(
        homeAfterRead,
        steps(
          checkModel(({ recordUnlock }) => {
            expect(recordUnlock).toBe('Locked')
          }),
          send(Message.CompletedReadRecordUnlock({ unlock: 'Unlocked' })),
          checkModel(({ recordUnlock, settings: { recordRuns } }) => {
            expect(recordUnlock).toBe('Unlocked')
            expect(recordRuns).toBe('Off')
          }),
          s =>
            s.expectExact(
              WriteSave.make({
                save: saveOf(
                  UiStruct.evolve(homeAfterRead, {
                    recordUnlock: () => 'Unlocked',
                  }),
                ),
                changes: [PlayerChange.UnlockedRecording()],
              }),
            ),
          writeSave,
        ),
      ),
  )

  it.effect('a device with no mark keeps an unlock its save holds', () =>
    modelAfter(
      UiStruct.evolve(homeAfterRead, { recordUnlock: () => 'Unlocked' }),
      steps(
        send(Message.CompletedReadRecordUnlock({ unlock: 'Locked' })),
        checkModel(({ recordUnlock }) => {
          expect(recordUnlock).toBe('Unlocked')
        }),
        s => s.expectNone(),
      ),
    ),
  )

  it.effect(
    'an unlock read before the save is written into it once the save loads',
    () =>
      modelAfter(
        loadingSave,
        steps(
          send(Message.CompletedReadRecordUnlock({ unlock: 'Unlocked' })),
          s => s.expectNone(),
          send(
            Message.CompletedLoadSave({ maybeSave: Option.some(learnedSave) }),
          ),
          finishSplash,
          checkModel(({ recordUnlock }) => {
            expect(recordUnlock).toBe('Unlocked')
          }),
          checkPendingArgs(WriteSave)(writes => {
            expect(Array.map(writes, ({ changes }) => changes)).toEqual([
              [PlayerChange.UnlockedRecording()],
            ])
          }),
          writeSave,
        ),
      ),
  )

  it.effect('the tile turns recording on, saved and synced', () => {
    const unlocked = UiStruct.evolve(homeAfterRead, {
      recordUnlock: () => 'Unlocked',
    })
    const on = UiStruct.evolve(unlocked, {
      settings: UiStruct.evolve({ recordRuns: () => 'On' }),
    })
    return modelAfter(
      unlocked,
      steps(
        send(Message.ClickedProfileSetting({ setting: 'RecordRuns' })),
        checkModel(({ settings: { recordRuns } }) => {
          expect(recordRuns).toBe('On')
        }),
        s =>
          s.expectExact(
            WriteSave.make({
              save: saveOf(on),
              changes: [PlayerChange.ChangedRecordRuns({ recordRuns: 'On' })],
            }),
          ),
        writeSave,
      ),
    )
  })

  it.effect('a run starts no recording while the setting is off', () =>
    modelAfter(
      UiStruct.evolve(recordingLastHeart('Off'), {
        recorder: () => RunRecorder.Idle(),
      }),
      steps(
        send(Message.TickedFrame({ deltaTime: FIXED_STEP_MS })),
        checkModel(({ phase, recorder }) => {
          expect(Phase.guards.GameOver(phase)).toBe(true)
          expect(recorder).toEqual(RunRecorder.Idle())
        }),
        settleRunCommands,
        s => s.resolve(SendRunSummary, Component.noop),
      ),
    ),
  )

  it.effect('a recorded run that ends goes up with how it ended', () =>
    modelAfter(
      recordingLastHeart('On'),
      steps(
        send(Message.TickedFrame({ deltaTime: FIXED_STEP_MS })),
        checkModel(({ phase, recorder }) => {
          expect(phase).toEqual(Phase.GameOver({ wave: 3 }))
          expect(recorder).toEqual(RunRecorder.Idle())
        }),
        settleRunCommands,
        checkPendingArgs(UploadRecording)(uploads => {
          expect(uploads).toHaveLength(1)
          const [upload] = uploads
          expect(upload?.recording.runId).toMatch(
            /^0123456789abcdef[0-9a-f]{8}$/,
          )
          expect(upload?.recording.end.outcome).toBe('GameOver')
          expect(upload?.recording.end.wave).toBe(3)
          expect(upload?.recording.end.ticks).toBeGreaterThan(0)
        }),
        s => s.resolve(SendRunSummary, Component.noop),
        s => s.resolve(UploadRecording, Component.noop),
      ),
    ),
  )

  it.effect(
    'a recorded run ends with nothing sent once the setting is off',
    () =>
      modelAfter(
        UiStruct.evolve(recordingLastHeart('On'), {
          settings: UiStruct.evolve({ recordRuns: () => 'Off' }),
        }),
        steps(
          send(Message.TickedFrame({ deltaTime: FIXED_STEP_MS })),
          checkModel(({ recorder }) => {
            expect(recorder).toEqual(RunRecorder.Idle())
          }),
          settleRunCommands,
          s => s.resolve(SendRunSummary, Component.noop),
        ),
      ),
  )
})
