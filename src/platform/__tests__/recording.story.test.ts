import { Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { ProfileBinding } from '../../app/bindings'
import { Message } from '../../app/message'
import { type Model, Phase } from '../../app/model'
import { UploadRecording } from '../../app/update/recording'
import { WriteSave } from '../../app/update/save'
import { SendRunSummary } from '../../app/update/settle'
import { Message as ProfileMessage } from '../../features/profile/message'
import { FIXED_STEP_MS } from '../../shared/constants'
import {
  homeAfterRead,
  lastHeart,
  veteranFighting,
} from '../../test/model.fixture'
import {
  APPLICATION,
  SURFACE,
  checkPendingArgs,
  settleRunCommands,
  writeSave,
} from '../../test/testing'
import { focusOf } from '../../world/party/party'
import { PlayerChange } from '../playerSync'
import { RunRecorder, beginRecording } from '../recording'
import { saveOf } from '../save'

const VISIT_ID = '0123456789abcdef'

// NOTE: a run one bite from Game Over, recording since its first tick.
const recordingLastHeart = (recordRuns: 'On' | 'Off'): Model => {
  const run = lastHeart(
    modifyFields(veteranFighting, {
      maybeSurface: () => Option.some(SURFACE),
      maybeVisitId: () => Option.some(VISIT_ID),
      recordUnlock: () => 'Unlocked',
      recordRuns: () => recordRuns,
    }),
  )
  return modifyFields(run, {
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
  it.effect('opening with ?record=1 unlocks the tile on this device', () =>
    Story.story(
      APPLICATION,
      Story.given(homeAfterRead),
      Story.model(({ recordUnlock }) => {
        expect(recordUnlock).toBe('Locked')
      }),
      Story.message(Message.CompletedReadRecordUnlock({ unlock: 'Unlocked' })),
      Story.model(({ recordUnlock, recordRuns }) => {
        expect(recordUnlock).toBe('Unlocked')
        expect(recordRuns).toBe('Off')
      }),
      Story.Command.expectNone(),
    ),
  )

  it.effect('the tile turns recording on, saved and synced', () => {
    const unlocked = modifyFields(homeAfterRead, {
      recordUnlock: () => 'Unlocked',
    })
    const on = modifyFields(unlocked, { recordRuns: () => 'On' })
    return Story.story(
      APPLICATION,
      Story.given(unlocked),
      Story.messageIn(
        ProfileBinding,
        ProfileMessage.ClickedSettingTile({ setting: 'RecordRuns' }),
      ),
      Story.model(({ recordRuns }) => {
        expect(recordRuns).toBe('On')
      }),
      Story.Command.expectExact(
        WriteSave({
          save: saveOf(on),
          changes: [PlayerChange.ChangedRecordRuns({ recordRuns: 'On' })],
        }),
      ),
      writeSave(),
    )
  })

  it.effect('a run starts no recording while the setting is off', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(recordingLastHeart('Off'), {
          recorder: () => RunRecorder.Idle(),
        }),
      ),
      Story.message(Message.TickedFrame({ deltaTime: FIXED_STEP_MS })),
      Story.model(({ phase, recorder }) => {
        expect(Phase.guards.GameOver(phase)).toBe(true)
        expect(recorder).toEqual(RunRecorder.Idle())
      }),
      settleRunCommands,
      Story.Command.resolve(SendRunSummary, Message.CompletedSendRunSummary()),
    ),
  )

  it.effect('a recorded run that ends goes up with how it ended', () =>
    Story.story(
      APPLICATION,
      Story.given(recordingLastHeart('On')),
      Story.message(Message.TickedFrame({ deltaTime: FIXED_STEP_MS })),
      Story.model(({ phase, recorder }) => {
        expect(phase).toEqual(Phase.GameOver({ wave: 3 }))
        expect(recorder).toEqual(RunRecorder.Idle())
      }),
      settleRunCommands,
      checkPendingArgs(Story.Command.argsOf(UploadRecording))(uploads => {
        expect(uploads).toHaveLength(1)
        const [upload] = uploads
        expect(upload?.recording.runId).toMatch(/^0123456789abcdef[0-9a-f]{8}$/)
        expect(upload?.recording.end.outcome).toBe('GameOver')
        expect(upload?.recording.end.wave).toBe(3)
        expect(upload?.recording.end.ticks).toBeGreaterThan(0)
      }),
      Story.Command.resolve(SendRunSummary, Message.CompletedSendRunSummary()),
      Story.Command.resolve(
        UploadRecording,
        Message.CompletedUploadRecording(),
      ),
    ),
  )

  it.effect(
    'a recorded run ends with nothing sent once the setting is off',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          modifyFields(recordingLastHeart('On'), { recordRuns: () => 'Off' }),
        ),
        Story.message(Message.TickedFrame({ deltaTime: FIXED_STEP_MS })),
        Story.model(({ recorder }) => {
          expect(recorder).toEqual(RunRecorder.Idle())
        }),
        settleRunCommands,
        Story.Command.resolve(
          SendRunSummary,
          Message.CompletedSendRunSummary(),
        ),
      ),
  )
})
