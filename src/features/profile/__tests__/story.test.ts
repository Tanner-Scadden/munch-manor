import { Effect, Option } from 'effect'

import { Component, UiStruct } from '@effect/ui'
import { Story } from '@effect/ui/testing'
import { describe, expect, it } from '@effect/vitest'

import { Message } from '#app/message.ts'
import type { Model } from '#app/model.ts'
import {
  FocusProfileElement,
  RequestLinkCode,
  takeSyncedName,
} from '#app/update/profile.ts'
import { profilePropsOf } from '#app/views/profileView.ts'
import { Profile } from '#features/profile/block.ts'
import { TutorialReset } from '#features/profile/machines/resetFlow.ts'
import { Events, Message as ProfileMessage } from '#features/profile/message.ts'
import {
  KEEP_TUTORIAL_BUTTON_ID,
  RESET_TUTORIAL_BUTTON_ID,
} from '#features/profile/profile.ts'
import { LinkFlow } from '#platform/save/linkFlow.ts'
import { readyAfterRead } from '#test/model.fixture.ts'
import {
  type StoryStep,
  checkModel,
  closeProfile,
  send,
  settleRunCommands,
  steps,
  storyOf,
} from '#test/testing.ts'
import { noRank } from '#world/heroes/rank.ts'

import { profileOpenOn } from './profile.fixture.ts'

const PROPS = profilePropsOf(profileOpenOn('Settings'))

const focused =
  (id: string): StoryStep =>
  s =>
    s.resolve(FocusProfileElement.make({ selector: `#${id}` }), Component.noop)

describe('the Profile component', () => {
  it.effect('says what happened and keeps nothing of its own', () =>
    Effect.gen(function* () {
      const s = yield* Story.make(Profile, PROPS)
      s.send(ProfileMessage.SelectedTab({ value: 'Account' }))
        .emitted(Events.SwitchedTab({ tab: 'Account' }))
        .send(ProfileMessage.UpdatedNameDraft({ value: 'Gobbler ' }))
        .emitted(Events.UpdatedNameDraft({ value: 'Gobbler ' }))
        .send(ProfileMessage.ClickedNameDiceButton())
        .emitted(Events.RolledNameDice())
        .send(ProfileMessage.ClickedSettingTile({ setting: 'Rotation' }))
        .emitted(Events.ClickedSetting({ setting: 'Rotation' }))
        .send(ProfileMessage.ClickedConfirmResetTutorialButton())
        .emitted(Events.ConfirmedTutorialReset())
        .send(ProfileMessage.ClickedBuyLook({ part: 'Hat', value: 'Fez' }))
        .emitted(Events.ClickedBuyLook({ part: 'Hat', value: 'Fez' }))
        .send(
          ProfileMessage.SucceededReadClipboard({ text: 'KZ7QWM', typed: '' }),
        )
        .emitted(Events.ReadClipboard({ text: 'KZ7QWM', typed: '' }))
        .expectNone()
      expect(s.model).toEqual({})
    }),
  )

  it.effect('a tab it does not know says nothing', () =>
    Effect.gen(function* () {
      const s = yield* Story.make(Profile, PROPS)
      s.send(ProfileMessage.SelectedTab({ value: 'Cosmetics' }))
      expect(s.current.emitted).toEqual([])
    }),
  )
})

describe('the Profile on the root', () => {
  it.effect('opens on the tab asked for, with the saved name to edit', () =>
    Effect.gen(function* () {
      const named = UiStruct.evolve(readyAfterRead, {
        playerName: () => 'Hambone',
        profile: profile =>
          UiStruct.evolve(profile, {
            nameDraft: () => 'x',
            tutorialReset: () => TutorialReset.Done,
            fx: () => 'Spin',
          }),
      })
      yield* Effect.forEach(
        [
          { open: Message.ClickedSettingsButton(), tab: 'Settings' },
          { open: Message.ClickedCharacterButton(), tab: 'Look' },
        ],
        ({ open, tab }) =>
          Effect.gen(function* () {
            const s = yield* storyOf(named)
            s.pipe(
              send(open),
              checkModel(({ profile, rootDialog }) => {
                expect(rootDialog._tag).toBe('Profile')
                expect(profile.tab).toBe(tab)
                expect(profile.nameDraft).toBe('Hambone')
                expect(profile.fx).toBe('Still')
                expect(profile.tutorialReset._tag).toBe('Idle')
              }),
              settleRunCommands,
            )
          }),
        { discard: true },
      )
    }),
  )

  it.effect('closing keeps the name cleaned', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(profileOpenOn('Name'))
      s.pipe(
        send(Message.UpdatedProfileNameDraft({ value: '  Sir   Nibbles ' })),
        checkModel(({ playerName }) => {
          expect(playerName).toBe('')
        }),
        closeProfile,
        checkModel(({ playerName, profile }) => {
          expect(profile.nameDraft).toBe('Sir Nibbles')
          expect(playerName).toBe('Sir Nibbles')
        }),
        settleRunCommands,
      )
    }),
  )

  it.effect(
    'a name kept on another device replaces the draft, unless one is typed',
    () =>
      Effect.gen(function* () {
        const on = (name: string, draft: string): Model =>
          UiStruct.evolve(profileOpenOn('Account'), {
            playerName: () => name,
            profile: profile =>
              UiStruct.evolve(profile, { nameDraft: () => draft }),
          })
        expect(
          takeSyncedName(on('Zed', 'Hambone'), 'Hambone').profile.nameDraft,
        ).toBe('Zed')
        expect(takeSyncedName(on('Bea', 'Mo'), 'Zed').profile.nameDraft).toBe(
          'Mo',
        )
      }),
  )

  it.effect('a tab switch keeps the name', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(profileOpenOn('Name'))
      s.pipe(
        send(Message.UpdatedProfileNameDraft({ value: 'Gobbler ' })),
        send(Message.SwitchedProfileTab({ tab: 'Account' })),
        checkModel(({ playerName, profile }) => {
          expect(profile.tab).toBe('Account')
          expect(profile.nameDraft).toBe('Gobbler')
          expect(playerName).toBe('Gobbler')
        }),
        settleRunCommands,
      )
    }),
  )

  it.effect('the name dice rolls on the root, then spins to its name', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(profileOpenOn('Name'))
      s.pipe(
        checkModel(({ profile }) => {
          expect(profile.fxCount).toBe(0)
        }),
        send(Message.RolledProfileNameDice()),
        checkModel(({ playerName, profile }) => {
          expect(profile.nameDraft).toBe(playerName)
          expect(playerName).not.toBe('')
          expect(profile.fx).toBe('Spin')
          expect(profile.fxCount).toBe(1)
        }),
        settleRunCommands,
      )
    }),
  )

  it.effect(
    'the tutorial reset asks first and forgets the tips only on RESET',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(profileOpenOn('Settings'))
        s.pipe(
          send(Message.ConfirmedTutorialReset()),
          checkModel(({ profile }) => {
            expect(profile.tutorialReset._tag).toBe('Idle')
          }),
        ).expectNone()
        s.pipe(
          send(Message.ClickedResetTutorial()),
          checkModel(({ profile }) => {
            expect(profile.tutorialReset._tag).toBe('Asking')
          }),
          focused(KEEP_TUTORIAL_BUTTON_ID),
          send(Message.ConfirmedTutorialReset()),
          checkModel(({ profile }) => {
            expect(profile.tutorialReset._tag).toBe('Done')
          }),
          focused(RESET_TUTORIAL_BUTTON_ID),
          settleRunCommands,
        )
      }),
  )
})

describe("the Profile's Look tab on the root", () => {
  const withBones = (earnedBones: number) => (model: Model) =>
    UiStruct.evolve(model, { rank: () => ({ ...noRank, earnedBones }) })

  it.effect('BUY says nothing without a try-on', () =>
    Effect.gen(function* () {
      const before = profileOpenOn('Look')
      const s = yield* storyOf(before)
      s.pipe(
        send(Message.ClickedBuyProfileLook({ part: 'Hat', value: 'Fez' })),
        checkModel(current => {
          expect(current.profile).toEqual(before.profile)
          expect(current.boughtCosmetics).toEqual(before.boughtCosmetics)
        }),
      ).expectNone()
    }),
  )

  it.effect(
    'a try-on poofs, BUY short of Bones shakes, and a buy cues and focuses',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(withBones(0)(profileOpenOn('Look')))
        s.pipe(
          send(Message.ChoseProfileLook({ part: 'Hat', value: 'Fez' })),
          checkModel(({ profile }) => {
            expect(profile.maybePreview).toEqual(
              Option.some({ part: 'Hat', value: 'Fez' }),
            )
            expect(profile.fx).toBe('Poof')
          }),
          send(Message.ClickedBuyProfileLook({ part: 'Hat', value: 'Fez' })),
          checkModel(({ profile }) => {
            expect(Option.isSome(profile.maybePreview)).toBe(true)
            expect(profile.closetCue.kind).toBe('Short')
          }),
        ).expectNone()
        s.given(withBones(80)).pipe(
          send(Message.ClickedBuyProfileLook({ part: 'Hat', value: 'Fez' })),
          checkModel(({ profile }) => {
            expect(profile.maybePreview).toEqual(Option.none())
            expect(profile.closetCue).toEqual({
              part: 'Hat',
              value: 'Fez',
              kind: 'Bought',
              count: 2,
            })
            expect(profile.fx).toBe('Poof')
          }),
          story =>
            story.resolve(
              FocusProfileElement.make({
                selector: '[data-look-option="Hat.Fez"]',
              }),
              Component.noop,
            ),
          settleRunCommands,
        )
      }),
  )

  it.effect('a flip and the dice play at once', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(profileOpenOn('Look'))
      s.pipe(
        send(Message.FlippedProfileLook({ toggle: 'Beard' })),
        checkModel(({ profile }) => {
          expect(profile.fx).toBe('Poof')
        }),
        send(Message.RolledProfileLookDice()),
        checkModel(({ profile }) => {
          expect(profile.fx).toBe('Spin')
          expect(profile.fxCount).toBe(2)
        }),
        settleRunCommands,
      )
    }),
  )
})

describe("the Profile's link code", () => {
  const entering = (code: string): StoryStep =>
    steps(
      send(Message.ClickedUseLinkCode()),
      send(Message.UpdatedLinkCode({ value: code })),
    )

  const codeIs = (expected: string): StoryStep =>
    checkModel(({ profile }) => {
      expect(profile.linkFlow).toEqual(LinkFlow.Entering({ code: expected }))
    })

  it.effect(
    'a copy counts, so COPIED! flashes afresh, and a new code starts over',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(profileOpenOn('Account'))
        s.pipe(
          send(Message.ClickedLinkDevice()),
          story =>
            story.resolve(
              RequestLinkCode,
              Message.SucceededRequestLinkCode({ code: 'KZ7QWM' }),
            ),
          send(Message.CopiedLinkCode()),
          send(Message.CopiedLinkCode()),
          checkModel(({ profile }) => {
            expect(profile.linkCodeCopies).toBe(2)
          }),
          send(Message.ClickedLinkDevice()),
          story =>
            story.resolve(
              RequestLinkCode,
              Message.SucceededRequestLinkCode({ code: 'PQ23RS' }),
            ),
          checkModel(({ profile }) => {
            expect(profile.linkFlow).toEqual(
              LinkFlow.Showing({ code: 'PQ23RS' }),
            )
            expect(profile.linkCodeCopies).toBe(0)
          }),
        )
      }),
  )

  const pasted = (
    code: string,
    text: string,
    typed: string,
    expected: string,
  ) =>
    Effect.gen(function* () {
      const s = yield* storyOf(profileOpenOn('Account'))
      s.pipe(
        entering(code),
        send(Message.ReadLinkClipboard({ text, typed })),
        codeIs(expected),
      )
    })

  it.effect('a tap pastes a code from the clipboard, cleaned', () =>
    pasted('', ' kz7-qwm\n', '', 'KZ7QWM'),
  )

  it.effect('a fresh tap pastes over what the field held', () =>
    pasted('ABC', 'KZ7 QWM', 'ABC', 'KZ7QWM'),
  )

  it.effect(
    'a clipboard that holds no code leaves the field to the keyboard',
    () =>
      Effect.forEach(
        ['hello there', 'KZ7QW', 'KZ7QWMX', 'KZ7QW0', ''],
        text => pasted('', text, '', ''),
        { discard: true },
      ),
  )

  it.effect('never pastes over letters typed since the tap', () =>
    pasted('ab', 'KZ7QWM', '', 'AB'),
  )

  it.effect('a clipboard read lands nowhere once the field is gone', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(profileOpenOn('Account'))
      s.pipe(
        entering(''),
        send(Message.ClickedCancelLink()),
        send(Message.ReadLinkClipboard({ text: 'KZ7QWM', typed: '' })),
        checkModel(({ profile }) => {
          expect(profile.linkFlow).toEqual(LinkFlow.Idle)
        }),
      )
    }),
  )
})
