import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { Message } from './message'
import { Loading, type Model } from './model'
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
} from './playerSync'
import { initialModel, update } from './pureApp'
import { type PlayerSave, saveOf } from './save'
import {
  AwaitRunSettled,
  RedeemLinkCode,
  ReloadSyncedSave,
  RequestLinkCode,
  WriteSave,
} from './update/save'

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
  test('replaces the look, settings, and bests, and writes nothing back', () => {
    const synced = fromAnotherDevice(read)
    story(
      update,
      given(read),
      message(Message.UpdatedSyncedSave({ save: synced })),
      model(current => {
        expect(current.appearance.shirtColor).toBe('Purple')
        expect(current.musicSetting).toBe('Off')
        expect(current.bests.runsPlayed).toBe(9)
        expect(current.bests.killsByKind.Shambler).toBe(390)
        expect(current.bests.killsByKind.Tank).toBe(10)
      }),
      Command.expectNone(),
    )
  })

  test('a change after it writes only that change', () => {
    const synced = fromAnotherDevice(read)
    const afterSync = modifyFields(read, {
      appearance: () => synced.appearance,
      musicSetting: () => 'Off',
    })
    story(
      update,
      given(read),
      message(Message.UpdatedSyncedSave({ save: synced })),
      message(Message.ClickedMuteButton()),
      Command.expectHas(
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
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
    )
  })
})

describe('a save from sync during a write', () => {
  test('waits for the write, then reads the store again', () => {
    const synced = fromAnotherDevice(read)
    story(
      update,
      given(
        modifyFields(read, {
          soundSetting: () => 'Muted',
          writesInFlight: () => 1,
        }),
      ),
      message(Message.UpdatedSyncedSave({ save: synced })),
      model(current => {
        expect(current.soundSetting).toBe('Muted')
        expect(current.musicSetting).toBe('On')
        expect(current.syncedSave).toBe('Stale')
      }),
      message(Message.CompletedWriteSave()),
      model(current => {
        expect(current.writesInFlight).toBe(0)
        expect(current.syncedSave).toBe('Current')
      }),
      Command.resolve(
        ReloadSyncedSave,
        Message.CompletedReloadSyncedSave({
          maybeSave: Option.some({
            ...synced,
            settings: { ...synced.settings, sound: 'Muted' },
          }),
        }),
      ),
      model(current => {
        expect(current.soundSetting).toBe('Muted')
        expect(current.musicSetting).toBe('Off')
      }),
    )
  })
})

describe('the sync status line', () => {
  test('says where the save is', () => {
    story(
      update,
      given(read),
      message(
        Message.UpdatedSyncStatus({ state: SyncState.Synced({ devices: 2 }) }),
      ),
      model(current => {
        expect(syncStateText(current.syncState)).toBe(
          'Synced. Linked to 2 devices',
        )
      }),
      message(
        Message.UpdatedSyncStatus({ state: SyncState.Offline({ devices: 2 }) }),
      ),
      model(current => {
        expect(syncStateText(current.syncState)).toBe('Offline, will sync')
      }),
    )
    expect(syncStateText(SyncState.Synced({ devices: 1 }))).toBe('Synced')
    expect(syncStateText(SyncState.LocalOnly())).toBe('Saved on this device')
  })
})

describe('the player scope status', () => {
  test('cached progress shows while connecting, and a refused scope says so', () => {
    const cached = PlayerScopeStatus.Ready({ seq: 7, fresh: false })
    story(
      update,
      given(read),
      message(Message.UpdatedSyncStatus({ state: SyncState.Connecting() })),
      message(Message.UpdatedPlayerScopeStatus({ status: cached })),
      model(current => {
        expect(current.playerScopeStatus).toEqual(cached)
        expect(
          devicesStatusText(current.syncState, current.playerScopeStatus),
        ).toBe('Connecting. Showing saved progress')
      }),
      message(
        Message.UpdatedPlayerScopeStatus({
          status: PlayerScopeStatus.Ready({ seq: 8, fresh: true }),
        }),
      ),
      message(
        Message.UpdatedSyncStatus({ state: SyncState.Synced({ devices: 1 }) }),
      ),
      model(current => {
        expect(
          devicesStatusText(current.syncState, current.playerScopeStatus),
        ).toBe('Synced')
      }),
      Command.expectNone(),
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
  })
})

describe('a recorded run reaching the server', () => {
  test('waits on the run the write recorded, then knows it was confirmed', () => {
    story(
      update,
      given(read),
      message(Message.ClickedMuteButton()),
      Command.resolve(
        WriteSave,
        Message.CompletedWriteSaveWithRun({ runId: 'run-0001' }),
      ),
      model(current => {
        expect(current.writesInFlight).toBe(0)
        expect(current.lastRunSync).toEqual(
          LastRunSync.Waiting({ id: 'run-0001' }),
        )
      }),
      Command.expectHas(AwaitRunSettled({ runId: 'run-0001' })),
      Command.resolve(
        AwaitRunSettled,
        Message.SettledRecordedRun({
          runId: 'run-0001',
          settled: RunSettled.Confirmed({ seq: 12 }),
        }),
      ),
      model(current => {
        expect(current.lastRunSync).toEqual(LastRunSync.Confirmed({ seq: 12 }))
      }),
    )
  })

  test('a rejected run says why, and an older run never overwrites a newer one', () => {
    story(
      update,
      given(
        modifyFields(read, {
          lastRunSync: () => LastRunSync.Waiting({ id: 'run-0002' }),
        }),
      ),
      message(
        Message.SettledRecordedRun({
          runId: 'run-0001',
          settled: RunSettled.Confirmed({ seq: 3 }),
        }),
      ),
      model(current => {
        expect(current.lastRunSync).toEqual(
          LastRunSync.Waiting({ id: 'run-0002' }),
        )
      }),
      message(
        Message.SettledRecordedRun({
          runId: 'run-0002',
          settled: RunSettled.Rejected({ reason: 'Precondition: too many' }),
        }),
      ),
      model(current => {
        expect(current.lastRunSync).toEqual(
          LastRunSync.Rejected({ reason: 'Precondition: too many' }),
        )
      }),
      Command.expectNone(),
    )
  })

  test('a wait the store could not finish stops claiming to know', () => {
    story(
      update,
      given(
        modifyFields(read, {
          lastRunSync: () => LastRunSync.Waiting({ id: 'run-0003' }),
        }),
      ),
      message(
        Message.FailedAwaitRunSettled({ runId: 'run-0003', reason: 'closed' }),
      ),
      model(current => {
        expect(current.lastRunSync).toEqual(LastRunSync.NoRun())
      }),
    )
  })
})

describe('linking a device', () => {
  test('Link another device asks for a code and shows it', () => {
    story(
      update,
      given(read),
      message(Message.ClickedLinkDeviceButton()),
      model(current => {
        expect(current.linkFlow).toEqual(LinkFlow.Requesting())
      }),
      Command.expectExact(RequestLinkCode()),
      Command.resolve(
        RequestLinkCode,
        Message.SucceededRequestLinkCode({ code: 'ABC234' }),
      ),
      model(current => {
        expect(current.linkFlow).toEqual(LinkFlow.Showing({ code: 'ABC234' }))
      }),
      message(Message.ClickedCancelLinkButton()),
      model(current => {
        expect(current.linkFlow).toEqual(LinkFlow.Idle())
      }),
    )
  })

  test('Use a code sends what was typed, in capitals', () => {
    story(
      update,
      given(read),
      message(Message.ClickedUseCodeButton()),
      message(Message.UpdatedLinkCode({ value: 'abc234' })),
      model(current => {
        expect(current.linkFlow).toEqual(LinkFlow.Entering({ code: 'ABC234' }))
      }),
      message(Message.SubmittedLinkCode()),
      model(current => {
        expect(current.linkFlow).toEqual(LinkFlow.Redeeming({ code: 'ABC234' }))
      }),
      Command.expectExact(RedeemLinkCode({ code: 'ABC234' })),
      Command.resolve(
        RedeemLinkCode,
        Message.FailedRedeemLinkCode({ problem: 'WrongCode' }),
      ),
      model(current => {
        expect(current.linkFlow).toEqual(
          LinkFlow.Failed({ problem: 'WrongCode' }),
        )
      }),
      message(Message.UpdatedLinkCode({ value: 'xyz789' })),
      message(Message.SubmittedLinkCode()),
      Command.resolve(RedeemLinkCode, Message.SucceededRedeemLinkCode()),
      model(current => {
        expect(current.linkFlow).toEqual(LinkFlow.Linked())
      }),
    )
  })

  test('submitting with nothing to submit does nothing', () => {
    story(
      update,
      given(read),
      message(Message.SubmittedLinkCode()),
      Command.expectNone(),
      model(current => {
        expect(current.linkFlow).toEqual(LinkFlow.Idle())
      }),
    )
  })
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

  test('a save from another device adds its kinds to the ones seen here', () => {
    const here = modifyFields(read, { seenPowerUps: () => ['Speed'] })
    story(
      update,
      given(here),
      message(
        Message.UpdatedSyncedSave({
          save: { ...saveOf(here), seenPowerUps: ['Damage', 'Heart'] },
        }),
      ),
      model(current => {
        expect(current.seenPowerUps).toEqual(['Speed', 'Damage', 'Heart'])
      }),
      Command.expectNone(),
    )
  })

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

  test('goes out again with the next change, with what the fields hold now', () => {
    story(
      update,
      given(read),
      message(Message.ClickedMuteButton()),
      Command.resolve(
        WriteSave,
        Message.FailedWriteSave({
          reason: 'disk full',
          changes: [
            PlayerChange.ChangedSettings({ settings: saveOf(muted).settings }),
            ranOne,
          ],
        }),
      ),
      model(current => {
        expect(current.writesInFlight).toBe(0)
        expect(current.unsavedChanges).toHaveLength(2)
      }),
      message(Message.ClickedMusicButton()),
      Command.expectHas(
        WriteSave({
          save: saveOf(quiet),
          changes: [
            PlayerChange.ChangedSettings({ settings: saveOf(quiet).settings }),
            ranOne,
          ],
        }),
      ),
      model(current => {
        expect(current.unsavedChanges).toEqual([])
        expect(current.writesInFlight).toBe(1)
      }),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
      model(current => {
        expect(current.unsavedChanges).toEqual([])
        expect(current.writesInFlight).toBe(0)
      }),
    )
  })

  test('a write that worked leaves nothing to send again', () => {
    story(
      update,
      given(read),
      message(Message.ClickedMuteButton()),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
      message(Message.ClickedMusicButton()),
      Command.expectHas(
        WriteSave({
          save: saveOf(quiet),
          changes: changesBetween(saveOf(muted), saveOf(quiet)),
        }),
      ),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
    )
  })
})
