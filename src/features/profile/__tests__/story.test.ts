import { Option } from 'effect'
import { Story } from 'foldkit'

import { describe, expect, it } from '@effect/vitest'
import { Tabs } from '@foldkit/ui'

import { ProfileBlock } from '../block'
import * as Character from '../blocks/look/block'
import { CharacterBinding, TabsBinding } from '../composition'
import { InMessage } from '../inMessage'
import { FocusLookOption } from '../inMessageUpdate'
import { ProfileLayer } from '../layer'
import { Message, OutMessage } from '../message'
import { ProfileTabsBlock } from '../model'
import { KEEP_TUTORIAL_BUTTON_ID, RESET_TUTORIAL_BUTTON_ID } from '../profile'
import { FocusTutorialReset } from '../update'

// The Profile Block on its own: what it keeps, what it tells the root, and
// what it does with the root's answers. The root's side (the name saved,
// the dice's generator, the look and the Bones) is in profile.story.test.ts.

const PROFILE = { block: ProfileBlock, layer: ProfileLayer }

const openOn = (tab: (typeof InMessage.RequestedOpen.Type)['tab']) =>
  Story.inMessage(InMessage.RequestedOpen({ tab, name: 'Hambone' }))

describe('the Profile Block', () => {
  it.effect('opens on the tab asked for, with the saved name to edit', () =>
    Story.story(
      PROFILE,
      Story.init(),
      openOn('Name'),
      Story.model(model => {
        expect(model.tab).toBe('Name')
        expect(model.nameDraft).toBe('Hambone')
        expect(model.fx).toBe('Still')
        expect(model.tutorialReset).toBe('Idle')
      }),
      Story.expectNoOutMessage(),
    ),
  )

  it.effect('keeps the name cleaned when the root asks, and says so', () =>
    Story.story(
      PROFILE,
      Story.init(),
      openOn('Name'),
      Story.message(Message.UpdatedNameDraft({ value: '  Sir   Nibbles ' })),
      Story.expectNoOutMessage(),
      Story.inMessage(InMessage.RequestedKeepName()),
      Story.model(model => {
        expect(model.nameDraft).toBe('Sir Nibbles')
      }),
      Story.expectOutMessage(OutMessage.KeptName({ name: 'Sir Nibbles' })),
    ),
  )

  it.effect('a tab switch keeps the name and tells the root both', () =>
    Story.story(
      PROFILE,
      Story.init(),
      openOn('Name'),
      Story.message(Message.UpdatedNameDraft({ value: 'Gobbler ' })),
      Story.messageIn(
        TabsBinding,
        ProfileTabsBlock.Message.SelectedTab({ index: 2, value: 'Account' }),
      ),
      Story.expectOutMessage(
        OutMessage.SwitchedTab({ tab: 'Account', name: 'Gobbler' }),
      ),
      Story.Command.resolve(
        Tabs.test.FocusTab({ id: 'profile-tabs', index: 2 }),
        ProfileTabsBlock.Message.CompletedFocusTab(),
      ),
      Story.model(model => {
        expect(model.tab).toBe('Account')
        expect(model.nameDraft).toBe('Gobbler')
      }),
    ),
  )

  it.effect('the name dice asks the root to roll, then spins to its name', () =>
    Story.story(
      PROFILE,
      Story.init(),
      Story.inMessage(InMessage.RequestedOpen({ tab: 'Name', name: '' })),
      Story.message(Message.ClickedNameDiceButton()),
      Story.expectOutMessage(
        OutMessage.RolledNameDice({ current: 'Survivor' }),
      ),
      Story.model(model => {
        expect(model.fxCount).toBe(0)
      }),
      Story.inMessage(InMessage.InformedOfRolledName({ name: 'Gravy Dave' })),
      Story.model(model => {
        expect(model.nameDraft).toBe('Gravy Dave')
        expect(model.fx).toBe('Spin')
        expect(model.fxCount).toBe(1)
      }),
    ),
  )

  it.effect('a settings tile only says which one was clicked', () =>
    Story.story(
      PROFILE,
      Story.init(),
      openOn('Settings'),
      Story.message(Message.ClickedSettingTile({ setting: 'Rotation' })),
      Story.expectOutMessage(
        OutMessage.ClickedSetting({ setting: 'Rotation' }),
      ),
      Story.Command.expectNone(),
    ),
  )

  it.effect(
    'the tutorial reset asks first and tells the root only on RESET',
    () =>
      Story.story(
        PROFILE,
        Story.init(),
        openOn('Settings'),
        Story.message(Message.ClickedConfirmResetTutorialButton()),
        Story.expectNoOutMessage(),
        Story.message(Message.ClickedResetTutorialButton()),
        Story.Command.resolve(
          FocusTutorialReset({ id: KEEP_TUTORIAL_BUTTON_ID }),
          Message.CompletedFocusTutorialReset(),
        ),
        Story.message(Message.ClickedConfirmResetTutorialButton()),
        Story.expectOutMessage(OutMessage.ConfirmedTutorialReset()),
        Story.model(model => {
          expect(model.tutorialReset).toBe('Done')
        }),
        Story.Command.resolve(
          FocusTutorialReset({ id: RESET_TUTORIAL_BUTTON_ID }),
          Message.CompletedFocusTutorialReset(),
        ),
      ),
  )
})

describe("the Profile's Look tab", () => {
  it.effect('BUY says nothing without a try-on', () =>
    Story.story(
      PROFILE,
      Story.init(),
      openOn('Look'),
      Story.messageIn(CharacterBinding, Character.Message.ClickedBuyButton()),
      Story.expectNoOutMessage(),
    ),
  )

  it.effect(
    'a try-on poofs, BUY asks the root, and a buy cues and focuses',
    () =>
      Story.story(
        PROFILE,
        Story.init(),
        openOn('Look'),
        Story.messageIn(
          CharacterBinding,
          Character.Message.ClickedGearOption({ part: 'Hat', value: 'Crown' }),
        ),
        Story.expectOutMessage(
          OutMessage.ChoseLook({ part: 'Hat', value: 'Crown' }),
        ),
        Story.inMessage(
          InMessage.InformedOfLookOutcome({
            part: 'Hat',
            value: 'Crown',
            outcome: 'Preview',
          }),
        ),
        Story.model(model => {
          expect(model.maybePreview).toEqual(
            Option.some({ part: 'Hat', value: 'Crown' }),
          )
          expect(model.fx).toBe('Poof')
        }),
        Story.messageIn(CharacterBinding, Character.Message.ClickedBuyButton()),
        Story.expectOutMessage(
          OutMessage.ClickedBuyLook({ part: 'Hat', value: 'Crown' }),
        ),
        Story.inMessage(
          InMessage.InformedOfLookOutcome({
            part: 'Hat',
            value: 'Crown',
            outcome: 'Short',
          }),
        ),
        Story.model(model => {
          expect(Option.isSome(model.maybePreview)).toBe(true)
          expect(model.closetCue.kind).toBe('Short')
        }),
        Story.Command.expectNone(),
        Story.inMessage(
          InMessage.InformedOfLookOutcome({
            part: 'Hat',
            value: 'Crown',
            outcome: 'Bought',
          }),
        ),
        Story.model(model => {
          expect(model.maybePreview).toEqual(Option.none())
          expect(model.closetCue).toEqual({
            part: 'Hat',
            value: 'Crown',
            kind: 'Bought',
            count: 2,
          })
          expect(model.fx).toBe('Poof')
        }),
        Story.Command.resolve(
          FocusLookOption({ part: 'Hat', value: 'Crown' }),
          Message.CompletedFocusLookOption(),
        ),
      ),
  )

  it.effect('a flip and the dice play at once and tell the root', () =>
    Story.story(
      PROFILE,
      Story.init(),
      openOn('Look'),
      Story.messageIn(
        CharacterBinding,
        Character.Message.ClickedToggle({ toggle: 'Beard' }),
      ),
      Story.expectOutMessage(OutMessage.FlippedLook({ toggle: 'Beard' })),
      Story.model(model => {
        expect(model.fx).toBe('Poof')
      }),
      Story.messageIn(CharacterBinding, Character.Message.ClickedDiceButton()),
      Story.expectOutMessage(OutMessage.RolledLookDice()),
      Story.model(model => {
        expect(model.fx).toBe('Spin')
        expect(model.fxCount).toBe(2)
      }),
    ),
  )
})
