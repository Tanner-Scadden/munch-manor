import { Array, Effect } from 'effect'

import { Component, UiStruct } from '@effect/ui'
import { describe, expect, it, test } from '@effect/vitest'

import { Message } from '#app/message.ts'
import { AudioState, type Model, Phase } from '#app/model.ts'
import { WriteSave } from '#app/update/save.ts'
import { PlaySound } from '#app/update/sound.ts'
import {
  DEFAULT_NAME,
  GOOFY_NAMES,
  MAX_NAME_LENGTH,
  cleanName,
  draftName,
  joinName,
  nameLength,
  rollName,
  shownName,
} from '#domain/playerName.ts'
import { TutorialReset } from '#features/profile/machines/resetFlow.ts'
import { type ProfileTab } from '#features/profile/model.ts'
import { PROFILE_TABS } from '#features/profile/profile.ts'
import { changesBetween } from '#platform/save/playerSync.ts'
import { saveOf } from '#platform/save/save.ts'
import { readyAfterRead } from '#test/model.fixture.ts'
import {
  type StoryStep,
  checkModel,
  closeProfile,
  exactStoryOf,
  modelAfter,
  press,
  send,
  settleRunCommands,
  steps,
  storyOf,
  writeSave,
} from '#test/testing.ts'

import { profileOpenOn } from './profile.fixture.ts'

const selectTab = (tab: ProfileTab): StoryStep =>
  send(Message.SwitchedProfileTab({ tab }))

const expectOpenOn = (tab: ProfileTab): StoryStep =>
  checkModel((current: Model) => {
    expect(current.rootDialog._tag).toBe('Profile')
    expect(current.profile.tab).toBe(tab)
    expect(current.rootDialog._tag).not.toBe('Panel')
  })

const typed = (value: string): StoryStep =>
  send(Message.UpdatedProfileNameDraft({ value }))

describe('the Profile', () => {
  it.effect(
    'the gear and O open it on Settings; the Character card, the player, and C open it on Look',
    () =>
      Effect.forEach(
        [
          { open: send(Message.ClickedSettingsButton()), tab: 'Settings' },
          { open: press('KeyO'), tab: 'Settings' },
          { open: send(Message.ClickedCharacterButton()), tab: 'Look' },
          { open: press('KeyC'), tab: 'Look' },
        ] as const,
        ({ open, tab }) =>
          Effect.gen(function* () {
            const s = yield* storyOf(readyAfterRead)
            s.pipe(open, expectOpenOn(tab), settleRunCommands)
          }),
        { discard: true },
      ),
  )

  test('the tabs are data, in order: Look, Name, Account, Settings, Mastery', () => {
    expect(PROFILE_TABS).toEqual([
      'Look',
      'Name',
      'Account',
      'Settings',
      'Mastery',
    ])
  })

  it.effect('never opens mid-run, and the gear only from the menu itself', () =>
    Effect.gen(function* () {
      const fighting = UiStruct.evolve(readyAfterRead, {
        phase: () => Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [] }),
      })
      yield* Effect.forEach(
        [
          Message.ClickedSettingsButton(),
          Message.ClickedCharacterButton(),
          Message.PressedKey({ code: 'KeyC' }),
          Message.PressedKey({ code: 'KeyO' }),
        ],
        sent =>
          Effect.gen(function* () {
            const s = yield* storyOf(fighting)
            s.pipe(
              send(sent),
              checkModel(current => {
                expect(current.rootDialog._tag).not.toBe('Profile')
              }),
              settleRunCommands,
            )
          }),
        { discard: true },
      )
    }),
  )

  it.effect(
    'a tab switch shows that tab and asks the tutorial reset again',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(
          UiStruct.evolve(profileOpenOn('Settings'), {
            profile: profile =>
              UiStruct.evolve(profile, {
                tutorialReset: () => TutorialReset.Asking,
              }),
          }),
        )
        s.pipe(
          selectTab('Account'),
          checkModel(current => {
            expect(current.profile.tab).toBe('Account')
            expect(current.profile.tutorialReset._tag).toBe('Idle')
          }),
          selectTab('Name'),
          checkModel(current => {
            expect(current.profile.tab).toBe('Name')
          }),
          settleRunCommands,
        )
      }),
  )

  it.effect('a tab switch plays a page flip once sound is on', () =>
    Effect.gen(function* () {
      const s = yield* exactStoryOf(
        UiStruct.evolve(profileOpenOn('Look'), {
          audio: () => AudioState.Ready,
        }),
      )
      s.pipe(selectTab('Name'))
        .expectExact(PlaySound.make({ sound: 'Whoosh', variation: 0 }))
        .resolve(
          PlaySound.make({ sound: 'Whoosh', variation: 0 }),
          Component.noop,
        )
    }),
  )
})

describe('the name', () => {
  test('is cleaned: control characters out, spaces collapsed and trimmed, at most 12 characters', () => {
    expect(cleanName('  Dr.   Chomp  ')).toBe('Dr. Chomp')
    expect(cleanName('Lil\u0007 Gnaw​')).toBe('Lil Gnaw')
    expect(cleanName('Snackula the Great')).toBe('Snackula the')
    expect(cleanName('Tab\there')).toBe('Tab here')
    expect(cleanName('🧟🧟🧟🧟🧟🧟🧟🧟🧟🧟🧟🧟🧟')).toBe(
      '🧟🧟🧟🧟🧟🧟🧟🧟🧟🧟🧟🧟',
    )
    expect(nameLength(cleanName('🧟🧟🧟🧟🧟🧟🧟🧟🧟🧟🧟🧟🧟'))).toBe(
      MAX_NAME_LENGTH,
    )
    expect(cleanName('   ')).toBe('')
  })

  test('keeps one space at the end while typing, so a second word can follow', () => {
    expect(draftName('Dr ')).toBe('Dr ')
    expect(draftName('  Dr  ')).toBe('Dr ')
  })

  test('falls back to the default when empty, and the join request carries the saved name', () => {
    expect(shownName('')).toBe(DEFAULT_NAME)
    expect(shownName('Gravy Dave')).toBe('Gravy Dave')
    expect(
      joinName(
        UiStruct.evolve(readyAfterRead, { playerName: () => 'Zed Head' }),
      ),
    ).toBe('Zed Head')
  })

  it.effect(
    'typing shows on the stone and is kept, saved, and synced only once the player is done',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(profileOpenOn('Name'))
        s.pipe(
          typed('  Sir   Nibbles of Doom'),
          checkModel(current => {
            expect(current.profile.nameDraft).toBe('Sir Nibbles ')
            expect(current.playerName).toBe('')
          }),
        ).expectNone()
        s.pipe(send(Message.SubmittedProfileName()))
          .expectHas(WriteSave)
          .pipe(
            checkModel(current => {
              expect(current.playerName).toBe('Sir Nibbles')
              expect(current.profile.nameDraft).toBe('Sir Nibbles')
              expect(
                changesBetween(saveOf(profileOpenOn('Name')), saveOf(current)),
              ).toEqual([{ _tag: 'ChangedName', name: 'Sir Nibbles' }])
            }),
            writeSave,
          )
      }),
  )

  it.effect(
    'leaving the field, another tab, or closing keeps what was typed',
    () =>
      Effect.forEach(
        [
          { name: 'Hambone', done: send(Message.BlurredProfileName()) },
          { name: 'Gobbler', done: selectTab('Account') },
          { name: 'Tot Terror', done: closeProfile },
        ],
        ({ name, done }) =>
          Effect.gen(function* () {
            const s = yield* storyOf(profileOpenOn('Name'))
            s.pipe(
              typed(name),
              done,
              checkModel(current => {
                expect(current.playerName).toBe(name)
              }),
              settleRunCommands,
            )
          }),
        { discard: true },
      ),
  )

  it.effect('closing the Profile shuts it', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(profileOpenOn('Name'))
      s.pipe(
        typed('Tot Terror'),
        closeProfile,
        checkModel(current => {
          expect(current.rootDialog._tag).not.toBe('Profile')
          expect(current.playerName).toBe('Tot Terror')
        }),
        writeSave,
      )
    }),
  )

  it.effect('clearing the name goes back to the placeholder', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        UiStruct.evolve(profileOpenOn('Name'), { playerName: () => 'Hambone' }),
      )
      s.pipe(
        typed('   '),
        send(Message.SubmittedProfileName()),
        checkModel(current => {
          expect(current.playerName).toBe('')
          expect(shownName(current.playerName)).toBe(DEFAULT_NAME)
        }),
        writeSave,
      )
    }),
  )

  it.effect('opening the Profile starts the field from the saved name', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        UiStruct.evolve(readyAfterRead, {
          playerName: () => 'Baron Burp',
          profile: profile =>
            UiStruct.evolve(profile, { nameDraft: () => 'x' }),
        }),
      )
      s.pipe(
        send(Message.ClickedSettingsButton()),
        checkModel(current => {
          expect(current.profile.nameDraft).toBe('Baron Burp')
        }),
        settleRunCommands,
      )
    }),
  )
})

describe('the name dice', () => {
  const rollFrom = (seed: number, name = '') =>
    modelAfter(
      UiStruct.evolve(profileOpenOn('Name'), {
        playerName: () => name,
        profile: profile => UiStruct.evolve(profile, { nameDraft: () => name }),
        cosmetics: cosmetics =>
          UiStruct.evolve(cosmetics, { cosmeticRngState: () => seed }),
      }),
      steps(send(Message.RolledProfileNameDice()), writeSave),
    )

  it.effect(
    'rolls the same goofy name from the same cosmetic seed, moves it on, leaves the run seed alone, and spins',
    () =>
      Effect.gen(function* () {
        const first = yield* rollFrom(1234)
        const again = yield* rollFrom(1234)
        expect(again.playerName).toBe(first.playerName)
        expect(again.cosmetics.cosmeticRngState).toBe(
          first.cosmetics.cosmeticRngState,
        )
        expect(first.cosmetics.cosmeticRngState).not.toBe(1234)
        expect(first.rngState).toBe(readyAfterRead.rngState)
        expect(GOOFY_NAMES).toContain(first.playerName)
        expect(first.profile.nameDraft).toBe(first.playerName)
        expect(first.profile.fx).toBe('Spin')
        expect(first.profile.fxCount).toBe(1)
        const rolled = yield* Effect.forEach(Array.range(1, 60), seed =>
          rollFrom(seed),
        )
        const names = Array.dedupe(
          Array.map(rolled, ({ playerName }) => playerName),
        )
        expect(names.length).toBeGreaterThan(20)
      }),
  )

  test('never lands on the name already showing', () => {
    Array.forEach(Array.range(0, 300), seed => {
      const [, first] = rollName(seed, DEFAULT_NAME)
      const [, reroll] = rollName(seed, first)
      expect(reroll).not.toBe(first)
    })
  })

  test('every goofy name fits and is clean', () => {
    Array.forEach(GOOFY_NAMES, name => {
      expect(cleanName(name)).toBe(name)
      expect(nameLength(name)).toBeLessThanOrEqual(MAX_NAME_LENGTH)
    })
    expect(Array.dedupe(GOOFY_NAMES).length).toBe(GOOFY_NAMES.length)
    expect(GOOFY_NAMES.length).toBeGreaterThanOrEqual(40)
  })
})

describe('the Look tab', () => {
  it.effect('a new part puffs a poof, and the dice spins', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(profileOpenOn('Look'))
      s.pipe(
        send(Message.ChoseProfileLook({ part: 'ShirtColor', value: 'Teal' })),
        checkModel(current => {
          expect(current.appearance.shirtColor).toBe('Teal')
          expect(current.profile.fx).toBe('Poof')
          expect(current.profile.fxCount).toBe(1)
        }),
        writeSave,
        send(Message.RolledProfileLookDice()),
        checkModel(current => {
          expect(current.profile.fx).toBe('Spin')
          expect(current.profile.fxCount).toBe(2)
        }),
        writeSave,
      )
    }),
  )
})
