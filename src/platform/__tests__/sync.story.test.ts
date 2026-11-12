import { Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import { ProfileBinding } from '../../app/bindings'
import { Message } from '../../app/message'
import { Loading, type Model } from '../../app/model'
import { initialModel } from '../../app/pureApp'
import {
  AwaitRunSettled,
  ReloadSyncedSave,
  WriteSave,
} from '../../app/update/save'
import { Message as ProfileMessage } from '../../features/profile/message'
import { RedeemLinkCode, RequestLinkCode } from '../../features/profile/update'
import { APPLICATION, writeSave } from '../../test/testing'
import {
  LastRunSync,
  LinkFlow,
  PlayerChange,
  PlayerScopeStatus,
  RunSettled,
  SyncState,
  changesBetween,
  devicesStatusText,
  syncStateText,
  withUnsavedChanges,
} from '../playerSync'
import { type PlayerSave, saveOf } from '../save'

const read: Model = modifyFields(initialModel, {
  loading: () => Loading.Loaded(),
  saveStatus: () => 'Read',
})

const fromAnotherDevice = (base: Model): PlayerSave => {
  const save = saveOf(base)
  return {
    ...save,
    appearance: { ...save.appearance, shirtColor: 'Purple', hairColor: 'Pink' },
    settings: { ...save.settings, music: 'Off' },
    bests: {
      ...save.bests,
      runsPlayed: 9,
      totalKills: 400,
      killsByKind: { Shambler: 390, Tank: 10 },
    },
  }
}

describe('a save from another device', () => {
  it.effect(
    'replaces the look, settings, and bests, and writes nothing back',
    () => {
      const synced = fromAnotherDevice(read)
      return Story.story(
        APPLICATION,
        Story.given(read),
        Story.message(Message.UpdatedSyncedSave({ save: synced })),
        Story.model(current => {
          expect(current.appearance.shirtColor).toBe('Purple')
          expect(current.musicSetting).toBe('Off')
          expect(current.bests.runsPlayed).toBe(9)
          expect(current.bests.killsByKind.Shambler).toBe(390)
          expect(current.bests.killsByKind.Tank).toBe(10)
        }),
        Story.Command.expectNone(),
      )
    },
  )

  it.effect('a change after it writes only that change', () => {
    const synced = fromAnotherDevice(read)
    const afterSync = modifyFields(read, {
      appearance: () => synced.appearance,
      musicSetting: () => 'Off',
    })
    return Story.story(
      APPLICATION,
      Story.given(read),
      Story.message(Message.UpdatedSyncedSave({ save: synced })),
      Story.message(Message.ClickedMuteButton()),
      Story.Command.expectHas(
        WriteSave({
          save: saveOf(
            modifyFields(afterSync, {
              soundSetting: () => 'Muted',
              bests: () => ({
                ...read.bests,
                runsPlayed: 9,
                totalKills: 400,
                killsByKind: {
                  ...read.bests.killsByKind,
                  Shambler: 390,
                  Tank: 10,
                },
              }),
            }),
          ),
          changes: [
            PlayerChange.ChangedSettings({
              settings: { ...synced.settings, sound: 'Muted' },
            }),
          ],
        }),
      ),
      writeSave(),
    )
  })
})

describe('a save from sync during a write', () => {
  it.effect('waits for the write, then reads the store again', () => {
    const synced = fromAnotherDevice(read)
    return Story.story(
      APPLICATION,
      Story.given(
        modifyFields(read, {
          soundSetting: () => 'Muted',
          writesInFlight: () => 1,
        }),
      ),
      Story.message(Message.UpdatedSyncedSave({ save: synced })),
      Story.model(current => {
        expect(current.soundSetting).toBe('Muted')
        expect(current.musicSetting).toBe('On')
        expect(current.syncedSave).toBe('Stale')
      }),
      Story.message(Message.CompletedWriteSave()),
      Story.model(current => {
        expect(current.writesInFlight).toBe(0)
        expect(current.syncedSave).toBe('Current')
      }),
      Story.Command.resolve(
        ReloadSyncedSave,
        Message.CompletedReloadSyncedSave({
          maybeSave: Option.some({
            ...synced,
            settings: { ...synced.settings, sound: 'Muted' },
          }),
        }),
      ),
      Story.model(current => {
        expect(current.soundSetting).toBe('Muted')
        expect(current.musicSetting).toBe('Off')
      }),
    )
  })
})

describe('the sync status line', () => {
  it.effect('says where the save is', () =>
    Effect.gen(function* () {
      yield* Story.story(
        APPLICATION,
        Story.given(read),
        Story.message(
          Message.UpdatedSyncStatus({
            state: SyncState.Synced({ devices: 2 }),
          }),
        ),
        Story.model(current => {
          expect(syncStateText(current.syncState)).toBe(
            'Synced. Linked to 2 devices',
          )
        }),
        Story.message(
          Message.UpdatedSyncStatus({
            state: SyncState.Offline({ devices: 2 }),
          }),
        ),
        Story.model(current => {
          expect(syncStateText(current.syncState)).toBe('Offline, will sync')
        }),
      )
      expect(syncStateText(SyncState.Synced({ devices: 1 }))).toBe('Synced')
      expect(syncStateText(SyncState.LocalOnly())).toBe('Saved on this device')
    }),
  )
})

describe('the player scope status', () => {
  it.effect(
    'cached progress shows while connecting, and a refused scope says so',
    () =>
      Effect.gen(function* () {
        const cached = PlayerScopeStatus.Ready({ seq: 7, fresh: false })
        yield* Story.story(
          APPLICATION,
          Story.given(read),
          Story.message(
            Message.UpdatedSyncStatus({ state: SyncState.Connecting() }),
          ),
          Story.message(Message.UpdatedPlayerScopeStatus({ status: cached })),
          Story.model(current => {
            expect(current.playerScopeStatus).toEqual(cached)
            expect(
              devicesStatusText(current.syncState, current.playerScopeStatus),
            ).toBe('Connecting. Showing saved progress')
          }),
          Story.message(
            Message.UpdatedPlayerScopeStatus({
              status: PlayerScopeStatus.Ready({ seq: 8, fresh: true }),
            }),
          ),
          Story.message(
            Message.UpdatedSyncStatus({
              state: SyncState.Synced({ devices: 1 }),
            }),
          ),
          Story.model(current => {
            expect(
              devicesStatusText(current.syncState, current.playerScopeStatus),
            ).toBe('Synced')
          }),
          Story.Command.expectNone(),
        )
        expect(
          devicesStatusText(
            SyncState.Offline({ devices: 1 }),
            PlayerScopeStatus.Failed({ reason: 'Forbidden: no' }),
          ),
        ).toBe('Sync is not working on this device')
        expect(
          devicesStatusText(SyncState.LocalOnly(), PlayerScopeStatus.Idle()),
        ).toBe('Saved on this device')
      }),
  )
})

describe('a recorded run reaching the server', () => {
  it.effect(
    'waits on the run the write recorded, then knows it was confirmed',
    () =>
      Story.story(
        APPLICATION,
        Story.given(read),
        Story.message(Message.ClickedMuteButton()),
        Story.Command.resolve(
          WriteSave,
          Message.CompletedWriteSaveWithRun({ runId: 'run-0001' }),
        ),
        Story.model(current => {
          expect(current.writesInFlight).toBe(0)
          expect(current.lastRunSync).toEqual(
            LastRunSync.Waiting({ id: 'run-0001' }),
          )
        }),
        Story.Command.expectHas(AwaitRunSettled({ runId: 'run-0001' })),
        Story.Command.resolve(
          AwaitRunSettled,
          Message.SettledRecordedRun({
            runId: 'run-0001',
            settled: RunSettled.Confirmed({ seq: 12 }),
          }),
        ),
        Story.model(current => {
          expect(current.lastRunSync).toEqual(
            LastRunSync.Confirmed({ seq: 12 }),
          )
        }),
      ),
  )

  it.effect(
    'a rejected run says why, and an older run never overwrites a newer one',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          modifyFields(read, {
            lastRunSync: () => LastRunSync.Waiting({ id: 'run-0002' }),
          }),
        ),
        Story.message(
          Message.SettledRecordedRun({
            runId: 'run-0001',
            settled: RunSettled.Confirmed({ seq: 3 }),
          }),
        ),
        Story.model(current => {
          expect(current.lastRunSync).toEqual(
            LastRunSync.Waiting({ id: 'run-0002' }),
          )
        }),
        Story.message(
          Message.SettledRecordedRun({
            runId: 'run-0002',
            settled: RunSettled.Rejected({ reason: 'Precondition: too many' }),
          }),
        ),
        Story.model(current => {
          expect(current.lastRunSync).toEqual(
            LastRunSync.Rejected({ reason: 'Precondition: too many' }),
          )
        }),
        Story.Command.expectNone(),
      ),
  )

  it.effect('a wait the store could not finish stops claiming to know', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(read, {
          lastRunSync: () => LastRunSync.Waiting({ id: 'run-0003' }),
        }),
      ),
      Story.message(
        Message.FailedAwaitRunSettled({ runId: 'run-0003', reason: 'closed' }),
      ),
      Story.model(current => {
        expect(current.lastRunSync).toEqual(LastRunSync.NoRun())
      }),
    ),
  )
})

describe('linking a device', () => {
  it.effect('Link another device asks for a code and shows it', () =>
    Story.story(
      APPLICATION,
      Story.given(read),
      Story.messageIn(ProfileBinding, ProfileMessage.ClickedLinkDeviceButton()),
      Story.model(current => {
        expect(current.profile.linkFlow).toEqual(LinkFlow.Requesting())
      }),
      Story.Command.expectExact(RequestLinkCode()),
      Story.Command.resolve(
        RequestLinkCode,
        ProfileMessage.SucceededRequestLinkCode({ code: 'ABC234' }),
      ),
      Story.model(current => {
        expect(current.profile.linkFlow).toEqual(
          LinkFlow.Showing({ code: 'ABC234' }),
        )
      }),
      Story.messageIn(ProfileBinding, ProfileMessage.ClickedCancelLinkButton()),
      Story.model(current => {
        expect(current.profile.linkFlow).toEqual(LinkFlow.Idle())
      }),
    ),
  )

  it.effect('Use a code sends what was typed, in capitals', () =>
    Story.story(
      APPLICATION,
      Story.given(read),
      Story.messageIn(ProfileBinding, ProfileMessage.ClickedUseCodeButton()),
      Story.messageIn(
        ProfileBinding,
        ProfileMessage.UpdatedLinkCode({ value: 'abc234' }),
      ),
      Story.model(current => {
        expect(current.profile.linkFlow).toEqual(
          LinkFlow.Entering({ code: 'ABC234' }),
        )
      }),
      Story.messageIn(ProfileBinding, ProfileMessage.SubmittedLinkCode()),
      Story.model(current => {
        expect(current.profile.linkFlow).toEqual(
          LinkFlow.Redeeming({ code: 'ABC234' }),
        )
      }),
      Story.Command.expectExact(RedeemLinkCode({ code: 'ABC234' })),
      Story.Command.resolve(
        RedeemLinkCode,
        ProfileMessage.FailedRedeemLinkCode({ problem: 'WrongCode' }),
      ),
      Story.model(current => {
        expect(current.profile.linkFlow).toEqual(
          LinkFlow.Failed({ problem: 'WrongCode' }),
        )
      }),
      Story.messageIn(
        ProfileBinding,
        ProfileMessage.UpdatedLinkCode({ value: 'xyz789' }),
      ),
      Story.messageIn(ProfileBinding, ProfileMessage.SubmittedLinkCode()),
      Story.Command.resolve(
        RedeemLinkCode,
        ProfileMessage.SucceededRedeemLinkCode(),
      ),
      Story.model(current => {
        expect(current.profile.linkFlow).toEqual(LinkFlow.Linked())
      }),
    ),
  )

  it.effect('submitting with nothing to submit does nothing', () =>
    Story.story(
      APPLICATION,
      Story.given(read),
      Story.messageIn(ProfileBinding, ProfileMessage.SubmittedLinkCode()),
      Story.Command.expectNone(),
      Story.model(current => {
        expect(current.profile.linkFlow).toEqual(LinkFlow.Idle())
      }),
    ),
  )
})

describe('changes as mutations', () => {
  test('a run, a new look, and an unlock become their own mutations, in order', () => {
    const before = saveOf(read)
    const after: PlayerSave = {
      ...before,
      appearance: {
        ...before.appearance,
        body: before.appearance.body === 'Slim' ? 'Broad' : 'Slim',
      },
      difficulty: { chosen: 'Nightmare', card: 'Seen', nightmare: 'Unlocked' },
      bests: {
        ...before.bests,
        runsPlayed: before.bests.runsPlayed + 1,
        totalKills: before.bests.totalKills + 5,
        killsByKind: { Runner: 5 },
        byDifficulty: {
          ...before.bests.byDifficulty,
          Hard: { fastestWinMs: 500_000, bestEndlessWave: null },
        },
      },
    }
    expect(
      Array.from(changesBetween(before, after), change => change._tag),
    ).toEqual([
      'ChangedAppearance',
      'UnlockedNightmare',
      'ChangedDifficulty',
      'RecordedRun',
    ])
    expect(changesBetween(before, before)).toEqual([])
    expect(Option.isNone(Option.none())).toBe(true)
  })
})

describe('the RECORD MY RUNS unlock across devices', () => {
  test('is sent once, as it unlocks, and never as a lock', () => {
    const before = saveOf(read)
    const after: PlayerSave = { ...before, recordUnlock: 'Unlocked' }
    expect(changesBetween(before, after)).toEqual([
      PlayerChange.UnlockedRecording(),
    ])
    expect(changesBetween(after, after)).toEqual([])
    expect(changesBetween(after, before)).toEqual([])
  })
})

describe('the power-ups seen across devices', () => {
  test('a new kind is sent as an addition, never the whole list', () => {
    const before: PlayerSave = { ...saveOf(read), seenPowerUps: ['RapidFire'] }
    const after: PlayerSave = {
      ...before,
      seenPowerUps: ['RapidFire', 'Burp'],
    }
    expect(changesBetween(before, after)).toEqual([
      PlayerChange.SawPowerUps({ kinds: ['Burp'] }),
    ])
    expect(changesBetween(after, after)).toEqual([])
    expect(changesBetween(after, { ...after, seenPowerUps: [] })).toEqual([
      PlayerChange.ForgotPowerUps(),
    ])
  })

  it.effect(
    'a save from another device adds its kinds to the ones seen here',
    () => {
      const here = modifyFields(read, { seenPowerUps: () => ['Speed'] })
      return Story.story(
        APPLICATION,
        Story.given(here),
        Story.message(
          Message.UpdatedSyncedSave({
            save: { ...saveOf(here), seenPowerUps: ['Damage', 'Heart'] },
          }),
        ),
        Story.model(current => {
          expect(current.seenPowerUps).toEqual(['Speed', 'Damage', 'Heart'])
        }),
        Story.Command.expectNone(),
      )
    },
  )

  test('a failed write keeps the kinds seen and the reset in order', () => {
    const seen = PlayerChange.SawPowerUps({ kinds: ['Pierce'] })
    const forgot = PlayerChange.ForgotPowerUps()
    const save: PlayerSave = { ...saveOf(read), seenPowerUps: ['Speed'] }
    expect(
      withUnsavedChanges(
        [seen],
        [forgot, PlayerChange.SawPowerUps({ kinds: ['Speed'] })],
        save,
      ),
    ).toEqual([
      PlayerChange.SawPowerUps({ kinds: ['Speed'] }),
      forgot,
      PlayerChange.SawPowerUps({ kinds: ['Speed'] }),
    ])
  })
})

describe('a write the store could not make', () => {
  const ranOne: PlayerChange = PlayerChange.RecordedRun({
    runs: 1,
    totalKills: 12,
    kills: { Shambler: 12 },
    bests: saveOf(read).bests.byDifficulty,
  })
  const muted = modifyFields(read, { soundSetting: () => 'Muted' })
  const quiet = modifyFields(muted, { musicSetting: () => 'Off' })

  it.effect(
    'goes out again with the next change, with what the fields hold now',
    () =>
      Story.story(
        APPLICATION,
        Story.given(read),
        Story.message(Message.ClickedMuteButton()),
        Story.Command.resolve(
          WriteSave,
          Message.FailedWriteSave({
            reason: 'disk full',
            changes: [
              PlayerChange.ChangedSettings({
                settings: saveOf(muted).settings,
              }),
              ranOne,
            ],
          }),
        ),
        Story.model(current => {
          expect(current.writesInFlight).toBe(0)
          expect(current.unsavedChanges).toHaveLength(2)
        }),
        Story.message(Message.ClickedMusicButton()),
        Story.Command.expectHas(
          WriteSave({
            save: saveOf(quiet),
            changes: [
              PlayerChange.ChangedSettings({
                settings: saveOf(quiet).settings,
              }),
              ranOne,
            ],
          }),
        ),
        Story.model(current => {
          expect(current.unsavedChanges).toEqual([])
          expect(current.writesInFlight).toBe(1)
        }),
        writeSave(),
        Story.model(current => {
          expect(current.unsavedChanges).toEqual([])
          expect(current.writesInFlight).toBe(0)
        }),
      ),
  )

  it.effect('a write that worked leaves nothing to send again', () =>
    Story.story(
      APPLICATION,
      Story.given(read),
      Story.message(Message.ClickedMuteButton()),
      writeSave(),
      Story.message(Message.ClickedMusicButton()),
      Story.Command.expectHas(
        WriteSave({
          save: saveOf(quiet),
          changes: changesBetween(saveOf(muted), saveOf(quiet)),
        }),
      ),
      writeSave(),
    ),
  )
})
