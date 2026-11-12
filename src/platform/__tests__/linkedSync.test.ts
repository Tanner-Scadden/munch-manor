// @vitest-environment happy-dom
import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { ProfileBinding } from '../../app/bindings'
import { Message } from '../../app/message'
import { AudioState, type Model } from '../../app/model'
import { CueMusic } from '../../app/update/music'
import { WriteSave } from '../../app/update/save'
import { SoundMessage } from '../../audio/message'
import { Message as ProfileMessage } from '../../features/profile/message'
import { readyAfterRead } from '../../test/model.fixture'
import {
  linkedPair,
  muted,
  synced,
  until,
  write,
} from '../../test/store.fixture'
import { APPLICATION, checkPendingArgs, closeProfile } from '../../test/testing'
import { PlayerChange } from '../playerSync'
import { type PlayerSave, restoreSave } from '../save'
import type { PlayerDatabase } from '../storeSqlite'

// Two linked devices on one in-process server, the laptop's Model over its
// own database: a change made on the phone reaches the laptop's store, the
// laptop's Model takes it as a synced save, live, and nothing the laptop
// does next puts the old value back.

const loaded = (database: PlayerDatabase) =>
  Effect.map(database.load, Option.getOrThrow)

const seesOn = (
  database: PlayerDatabase,
  isThere: (save: PlayerSave) => boolean,
) =>
  Effect.map(
    until(database.load, maybeSave => Option.exists(maybeSave, isThere)),
    Option.getOrThrow,
  )

// NOTE: the laptop with its Profile open, as it is while a player links it
// from the Account tab, its Model read from its own store, sound on.
const laptopModel = (save: PlayerSave): Model =>
  modifyFields(restoreSave(readyAfterRead, save), {
    audio: () => AudioState.Ready(),
    profile: profile =>
      modifyFields(profile, {
        tab: () => 'Account',
        nameDraft: () => save.name,
      }),
    profileDialog: dialog => modifyFields(dialog, { isOpen: () => true }),
  })

// NOTE: the laptop's Story ends with whatever it writes back resolved and
// handed out, as its store would get it.
const writtenBack = (written: Array<ReadonlyArray<PlayerChange>>) =>
  Story.steps(
    checkPendingArgs(Story.Command.argsOf(WriteSave))(writes => {
      Array.forEach(writes, ({ changes }) => {
        written.push(changes)
      })
    }),
    Story.Command.resolveAll([WriteSave, Message.CompletedWriteSave()]),
  )

// NOTE: the phone keeps a change; the laptop's store has it once sync
// brings it over. Sound is on first, so the laptop can hear a change.
const phoneKeeps = (
  change: (save: PlayerSave) => PlayerSave,
  isThere: (save: PlayerSave) => boolean,
) =>
  Effect.gen(function* () {
    const { phone, laptop } = yield* linkedPair
    const first = yield* loaded(phone)
    const before = muted(first)
    yield* write(phone, first, before)
    const laptopSave = yield* seesOn(
      laptop,
      save => save.settings.sound === 'On',
    )
    const start = laptopModel(laptopSave)
    yield* write(phone, before, change(before))
    const arrived = yield* seesOn(laptop, isThere)
    return { phone, laptop, start, arrived }
  })

const named = (name: string) => ({
  change: (save: PlayerSave): PlayerSave => ({ ...save, name }),
  isThere: (save: PlayerSave): boolean => save.name === name,
})

describe('the name on two linked devices', () => {
  it.effect(
    'set on the phone, shows on the laptop, and closing its Profile keeps it',
    () =>
      Effect.gen(function* () {
        const { phone, laptop, start, arrived } = yield* phoneKeeps(
          named('Zed').change,
          named('Zed').isThere,
        )
        const written: Array<ReadonlyArray<PlayerChange>> = []
        const model = yield* Story.story(
          APPLICATION,
          Story.given(start),
          Story.message(Message.UpdatedSyncedSave({ save: arrived })),
          Story.model(current => {
            expect(current.playerName).toBe('Zed')
            expect(current.profile.nameDraft).toBe('Zed')
          }),
          closeProfile(),
          writtenBack(written),
        )
        expect(model.playerName).toBe('Zed')
        expect(written).toEqual([])

        const onPhone = yield* seesOn(phone, save => save.name === 'Zed')
        expect(onPhone.name).toBe('Zed')
        const onLaptop = yield* loaded(laptop)
        expect(onLaptop.name).toBe('Zed')
      }).pipe(synced),
  )

  it.effect(
    'a name the laptop is typing stays, and closing keeps it as the newest',
    () =>
      Effect.gen(function* () {
        const { phone, laptop, start, arrived } = yield* phoneKeeps(
          named('Zed').change,
          named('Zed').isThere,
        )
        const written: Array<ReadonlyArray<PlayerChange>> = []
        const model = yield* Story.story(
          APPLICATION,
          Story.given(start),
          Story.messageIn(
            ProfileBinding,
            ProfileMessage.UpdatedNameDraft({ value: 'Mo' }),
          ),
          Story.message(Message.UpdatedSyncedSave({ save: arrived })),
          Story.model(current => {
            expect(current.playerName).toBe('Zed')
            expect(current.profile.nameDraft).toBe('Mo')
          }),
          closeProfile(),
          writtenBack(written),
        )
        expect(model.playerName).toBe('Mo')
        expect(written).toEqual([[PlayerChange.ChangedName({ name: 'Mo' })]])
        yield* Effect.forEach(written, changes =>
          laptop.write(arrived, changes),
        )
        const onPhone = yield* seesOn(phone, save => save.name === 'Mo')
        expect(onPhone.name).toBe('Mo')
      }).pipe(synced),
  )
})

describe('a setting on two linked devices', () => {
  it.effect('music turned off on the phone goes quiet on the laptop', () =>
    Effect.gen(function* () {
      const { start, arrived } = yield* phoneKeeps(
        save => ({ ...save, settings: { ...save.settings, music: 'Off' } }),
        save => save.settings.music === 'Off',
      )
      expect(start.musicSetting).toBe('On')
      const written: Array<ReadonlyArray<PlayerChange>> = []
      const model = yield* Story.story(
        APPLICATION,
        Story.given(start),
        Story.message(Message.UpdatedSyncedSave({ save: arrived })),
        Story.Command.expectExact(
          CueMusic({ mood: 'Silence', level: 'Full', stinger: 'None' }),
        ),
        Story.Command.resolve(
          CueMusic,
          SoundMessage.CompletedCueMusic({ mood: 'Silence' }),
        ),
        writtenBack(written),
      )
      expect(model.musicSetting).toBe('Off')
      expect(written).toEqual([])
    }).pipe(synced),
  )
})

describe('RECORD MY RUNS on two linked devices', () => {
  it.effect('unlocked on the phone shows on the laptop', () =>
    Effect.gen(function* () {
      const { start, arrived } = yield* phoneKeeps(
        save => ({ ...save, recordUnlock: 'Unlocked' }),
        save => save.recordUnlock === 'Unlocked',
      )
      expect(start.recordUnlock).toBe('Locked')
      const model = yield* Story.story(
        APPLICATION,
        Story.given(start),
        Story.message(Message.UpdatedSyncedSave({ save: arrived })),
        Story.Command.expectNone(),
      )
      expect(model.recordUnlock).toBe('Unlocked')
    }).pipe(synced),
  )
})
