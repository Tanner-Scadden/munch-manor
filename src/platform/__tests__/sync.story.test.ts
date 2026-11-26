import { Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it, test } from '@effect/vitest'

import { Message } from '#app/message.ts'
import { Loading, type Model } from '#app/model.ts'
import { initialModel } from '#app/pureApp.ts'
import { RedeemLinkCode, RequestLinkCode } from '#app/update/profile.ts'
import { ReloadSyncedSave, WriteSave } from '#app/update/save.ts'
import { LinkFlow } from '#platform/linkFlow.ts'
import {
  PlayerChange,
  SyncState,
  changesBetween,
  syncStateText,
  withUnsavedChanges,
} from '#platform/playerSync.ts'
import { type PlayerSave, saveOf } from '#platform/save.ts'
import {
  checkModel,
  modelAfter,
  send,
  steps,
  writeSave,
} from '#test/testing.ts'

const read: Model = UiStruct.evolve(initialModel, {
  saving: UiStruct.evolve({
    loading: () => Loading.Loaded,
    saveStatus: () => 'Read',
  }),
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
      return modelAfter(
        read,
        steps(
          send(Message.UpdatedSyncedSave({ save: synced })),
          checkModel(current => {
            expect(current.appearance.shirtColor).toBe('Purple')
            expect(current.settings.musicSetting).toBe('Off')
            expect(current.bests.runsPlayed).toBe(9)
            expect(current.bests.killsByKind.Shambler).toBe(390)
            expect(current.bests.killsByKind.Tank).toBe(10)
          }),
          s => s.expectNone(),
        ),
      )
    },
  )

  it.effect('a change after it writes only that change', () => {
    const synced = fromAnotherDevice(read)
    const afterSync: Model = UiStruct.evolve(read, {
      appearance: () => synced.appearance,
      settings: UiStruct.evolve({ musicSetting: () => 'Off' }),
    })
    return modelAfter(
      read,
      steps(
        send(Message.UpdatedSyncedSave({ save: synced })),
        send(Message.ClickedMuteButton()),
        s =>
          s.expectHas(
            WriteSave.make({
              save: saveOf(
                UiStruct.evolve(afterSync, {
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
                  settings: UiStruct.evolve({ soundSetting: () => 'Muted' }),
                }),
              ),
              changes: [
                PlayerChange.ChangedSettings({
                  settings: { ...synced.settings, sound: 'Muted' },
                }),
              ],
            }),
          ),
        writeSave,
      ),
    )
  })
})

describe('a save from sync during a write', () => {
  it.effect('waits for the write, then reads the store again', () => {
    const synced = fromAnotherDevice(read)
    return modelAfter(
      UiStruct.evolve(read, {
        saving: UiStruct.evolve({ writesInFlight: () => 1 }),
        settings: UiStruct.evolve({ soundSetting: () => 'Muted' }),
      }),
      steps(
        send(Message.UpdatedSyncedSave({ save: synced })),
        checkModel(current => {
          expect(current.settings.soundSetting).toBe('Muted')
          expect(current.settings.musicSetting).toBe('On')
          expect(current.saving.syncedSave).toBe('Stale')
        }),
        send(Message.CompletedWriteSave()),
        checkModel(current => {
          expect(current.saving.writesInFlight).toBe(0)
          expect(current.saving.syncedSave).toBe('Current')
        }),
        s =>
          s.resolve(
            ReloadSyncedSave,
            Message.CompletedReloadSyncedSave({
              maybeSave: Option.some({
                ...synced,
                settings: { ...synced.settings, sound: 'Muted' },
              }),
            }),
          ),
        checkModel(current => {
          expect(current.settings.soundSetting).toBe('Muted')
          expect(current.settings.musicSetting).toBe('Off')
        }),
      ),
    )
  })
})

describe('the sync status line', () => {
  it.effect('says where the save is', () =>
    Effect.gen(function* () {
      yield* modelAfter(
        read,
        steps(
          send(
            Message.UpdatedSyncStatus({
              state: SyncState.Synced(),
            }),
          ),
          checkModel(current => {
            expect(syncStateText(current.saving.syncState)).toBe('Synced')
          }),
          send(
            Message.UpdatedSyncStatus({
              state: SyncState.Offline(),
            }),
          ),
          checkModel(current => {
            expect(syncStateText(current.saving.syncState)).toBe(
              'Offline, will sync',
            )
          }),
        ),
      )
      expect(syncStateText(SyncState.Connecting())).toBe('Connecting')
      expect(syncStateText(SyncState.LocalOnly())).toBe('Saved on this device')
    }),
  )
})

describe('linking a device', () => {
  it.effect('Link another device asks for a code and shows it', () =>
    modelAfter(
      read,
      steps(
        send(Message.ClickedLinkDevice()),
        checkModel(current => {
          expect(current.profile.linkFlow).toEqual(LinkFlow.Requesting)
        }),
        s => s.expectExact(RequestLinkCode),
        s =>
          s.resolve(
            RequestLinkCode,
            Message.SucceededRequestLinkCode({ code: 'ABC234' }),
          ),
        checkModel(current => {
          expect(current.profile.linkFlow).toEqual(
            LinkFlow.Showing({ code: 'ABC234' }),
          )
        }),
        send(Message.ClickedCancelLink()),
        checkModel(current => {
          expect(current.profile.linkFlow).toEqual(LinkFlow.Idle)
        }),
      ),
    ),
  )

  it.effect('Use a code sends what was typed, in capitals', () =>
    modelAfter(
      read,
      steps(
        send(Message.ClickedUseLinkCode()),
        send(Message.UpdatedLinkCode({ value: 'abc234' })),
        checkModel(current => {
          expect(current.profile.linkFlow).toEqual(
            LinkFlow.Entering({ code: 'ABC234' }),
          )
        }),
        send(Message.SubmittedLinkCode()),
        checkModel(current => {
          expect(current.profile.linkFlow).toEqual(
            LinkFlow.Redeeming({ code: 'ABC234' }),
          )
        }),
        s => s.expectExact(RedeemLinkCode.make({ code: 'ABC234' })),
        s =>
          s.resolve(
            RedeemLinkCode,
            Message.FailedRedeemLinkCode({ problem: 'WrongCode' }),
          ),
        checkModel(current => {
          expect(current.profile.linkFlow).toEqual(
            LinkFlow.Failed({ problem: 'WrongCode' }),
          )
        }),
        send(Message.UpdatedLinkCode({ value: 'xyz789' })),
        send(Message.SubmittedLinkCode()),
        s => s.resolve(RedeemLinkCode, Message.SucceededRedeemLinkCode()),
        checkModel(current => {
          expect(current.profile.linkFlow).toEqual(LinkFlow.Linked)
        }),
      ),
    ),
  )

  it.effect('submitting with nothing to submit does nothing', () =>
    modelAfter(
      read,
      steps(
        send(Message.SubmittedLinkCode()),
        s => s.expectNone(),
        checkModel(current => {
          expect(current.profile.linkFlow).toEqual(LinkFlow.Idle)
        }),
      ),
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
      const here = UiStruct.evolve(read, { seenPowerUps: () => ['Speed'] })
      return modelAfter(
        here,
        steps(
          send(
            Message.UpdatedSyncedSave({
              save: { ...saveOf(here), seenPowerUps: ['Damage', 'Heart'] },
            }),
          ),
          checkModel(current => {
            expect(current.seenPowerUps).toEqual(['Speed', 'Damage', 'Heart'])
          }),
          s => s.expectNone(),
        ),
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
  const muted: Model = UiStruct.evolve(read, {
    settings: UiStruct.evolve({ soundSetting: () => 'Muted' }),
  })
  const quiet = UiStruct.evolve(muted, {
    settings: UiStruct.evolve({ musicSetting: () => 'Off' }),
  })

  it.effect(
    'goes out again with the next change, with what the fields hold now',
    () =>
      modelAfter(
        read,
        steps(
          send(Message.ClickedMuteButton()),
          s =>
            s.resolve(
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
          checkModel(current => {
            expect(current.saving.writesInFlight).toBe(0)
            expect(current.saving.unsavedChanges).toHaveLength(2)
          }),
          send(Message.ClickedMusicButton()),
          s =>
            s.expectHas(
              WriteSave.make({
                save: saveOf(quiet),
                changes: [
                  PlayerChange.ChangedSettings({
                    settings: saveOf(quiet).settings,
                  }),
                  ranOne,
                ],
              }),
            ),
          checkModel(current => {
            expect(current.saving.unsavedChanges).toEqual([])
            expect(current.saving.writesInFlight).toBe(1)
          }),
          writeSave,
          checkModel(current => {
            expect(current.saving.unsavedChanges).toEqual([])
            expect(current.saving.writesInFlight).toBe(0)
          }),
        ),
      ),
  )

  it.effect('a write that worked leaves nothing to send again', () =>
    modelAfter(
      read,
      steps(
        send(Message.ClickedMuteButton()),
        writeSave,
        send(Message.ClickedMusicButton()),
        s =>
          s.expectHas(
            WriteSave.make({
              save: saveOf(quiet),
              changes: changesBetween(saveOf(muted), saveOf(quiet)),
            }),
          ),
        writeSave,
      ),
    ),
  )
})
