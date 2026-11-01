import { Array, Option, pipe } from 'effect'
import { Command, given, message, model, steps, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { toParentMessage } from 'foldkit/test'
import { describe, expect, test } from 'vitest'

import { DialogBlock, RadioGroup, Tabs } from '@foldkit/ui'

import {
  CharacterBinding,
  ProfileDialogBinding,
  ProfileTabsBinding,
} from './bindings'
import * as Character from './character'
import { PartRadioGroupBlock } from './lookRadios'
import { update } from './main'
import { Message } from './message'
import { AudioState, type Model, Phase, type ProfileTab } from './model'
import { readyAfterRead } from './model.fixture'
import { changesBetween } from './playerSync'
import {
  DEFAULT_NAME,
  GOOFY_NAMES,
  MAX_NAME_LENGTH,
  PROFILE_TABS,
  ProfileTabsBlock,
  cleanName,
  draftName,
  joinName,
  nameLength,
  rollName,
  shownName,
} from './profile'
import { saveOf } from './save'
import { closeDialog, press, showDialog, writeSave } from './testing'
import { WriteSave } from './update/save'
import { PlaySound } from './update/sound'

const closeProfile = () =>
  steps(
    message(
      toParentMessage(
        ProfileDialogBinding,
        DialogBlock.Message.RequestedClose(),
      ),
    ),
    closeDialog(),
  )

const tabIndex = (tab: ProfileTab): number =>
  pipe(
    Array.findFirstIndex(PROFILE_TABS, each => each === tab),
    Option.getOrElse(() => 0),
  )

const selectTab = (tab: ProfileTab) =>
  steps(
    message(
      toParentMessage(
        ProfileTabsBinding,
        ProfileTabsBlock.Message.SelectedTab({
          index: tabIndex(tab),
          value: tab,
        }),
      ),
    ),
    Command.resolve(
      Tabs.test.FocusTab({ id: 'profile-tabs', index: tabIndex(tab) }),
      ProfileTabsBlock.Message.CompletedFocusTab(),
    ),
  )

const expectOpenOn = (tab: ProfileTab) =>
  model((current: Model) => {
    expect(current.profileDialog.isOpen).toBe(true)
    expect(current.profile.tab).toBe(tab)
    expect(current.panelDialog.isOpen).toBe(false)
  })

const openOn = (tab: ProfileTab): Model =>
  modifyFields(readyAfterRead, {
    profile: profile => modifyFields(profile, { tab: () => tab }),
    profileDialog: dialog => modifyFields(dialog, { isOpen: () => true }),
  })

describe('the Profile', () => {
  test('the gear and O open it on Settings; the Character card, the player, and C open it on Look', () => {
    story(
      update,
      given(readyAfterRead),
      message(Message.ClickedSettingsButton()),
      showDialog(),
      expectOpenOn('Settings'),
    )
    story(
      update,
      given(readyAfterRead),
      press('KeyO'),
      showDialog(),
      expectOpenOn('Settings'),
    )
    story(
      update,
      given(readyAfterRead),
      message(Message.ClickedCharacterButton()),
      showDialog(),
      expectOpenOn('Look'),
    )
    story(
      update,
      given(readyAfterRead),
      press('KeyC'),
      showDialog(),
      expectOpenOn('Look'),
    )
  })

  test('the tabs are data, in order: Look, Closet, Name, Account, Settings', () => {
    expect(PROFILE_TABS).toEqual([
      'Look',
      'Closet',
      'Name',
      'Account',
      'Settings',
    ])
  })

  test('never opens mid-run, and the gear only from the menu itself', () => {
    const fighting = modifyFields(readyAfterRead, {
      phase: () => Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [] }),
    })
    Array.forEach(
      [
        Message.ClickedSettingsButton(),
        Message.ClickedCharacterButton(),
        Message.PressedKey({ code: 'KeyC' }),
        Message.PressedKey({ code: 'KeyO' }),
      ],
      sent =>
        story(
          update,
          given(fighting),
          message(sent),
          model(current => {
            expect(current.profileDialog.isOpen).toBe(false)
          }),
        ),
    )
  })

  test('a tab switch shows that tab and asks the tutorial reset again', () => {
    story(
      update,
      given(
        modifyFields(openOn('Settings'), { tutorialReset: () => 'Asking' }),
      ),
      selectTab('Account'),
      model(current => {
        expect(current.profile.tab).toBe('Account')
        expect(current.tutorialReset).toBe('Idle')
      }),
      selectTab('Name'),
      model(current => {
        expect(current.profile.tab).toBe('Name')
      }),
    )
  })

  test('a tab switch plays a page flip once sound is on', () => {
    story(
      update,
      given(modifyFields(openOn('Look'), { audio: () => AudioState.Ready() })),
      message(
        toParentMessage(
          ProfileTabsBinding,
          ProfileTabsBlock.Message.SelectedTab({ index: 1, value: 'Name' }),
        ),
      ),
      Command.expectExact(
        Tabs.test.FocusTab({ id: 'profile-tabs', index: 1 }),
        PlaySound({ sound: 'Whoosh', variation: 0 }),
      ),
      Command.resolve(
        PlaySound({ sound: 'Whoosh', variation: 0 }),
        Message.CompletedPlaySound({ sound: 'Whoosh', outcome: 'Played' }),
      ),
      Command.resolve(
        Tabs.test.FocusTab({ id: 'profile-tabs', index: 1 }),
        ProfileTabsBlock.Message.CompletedFocusTab(),
      ),
    )
  })
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
      joinName(modifyFields(readyAfterRead, { playerName: () => 'Zed Head' })),
    ).toBe('Zed Head')
  })

  test('typing shows on the stone and is kept, saved, and synced only once the player is done', () => {
    story(
      update,
      given(openOn('Name')),
      message(Message.UpdatedNameDraft({ value: '  Sir   Nibbles of Doom' })),
      Command.expectNone(),
      model(current => {
        expect(current.profile.nameDraft).toBe('Sir Nibbles ')
        expect(current.playerName).toBe('')
      }),
      message(Message.SubmittedName()),
      Command.expectHas(WriteSave),
      model(current => {
        expect(current.playerName).toBe('Sir Nibbles')
        expect(current.profile.nameDraft).toBe('Sir Nibbles')
        expect(changesBetween(saveOf(openOn('Name')), saveOf(current))).toEqual(
          [{ _tag: 'ChangedName', name: 'Sir Nibbles' }],
        )
      }),
      writeSave(),
    )
  })

  test('leaving the field, another tab, or closing keeps what was typed', () => {
    story(
      update,
      given(openOn('Name')),
      message(Message.UpdatedNameDraft({ value: 'Hambone' })),
      message(Message.BlurredNameInput()),
      model(current => {
        expect(current.playerName).toBe('Hambone')
      }),
      writeSave(),
    )
    story(
      update,
      given(openOn('Name')),
      message(Message.UpdatedNameDraft({ value: 'Gobbler' })),
      selectTab('Account'),
      model(current => {
        expect(current.playerName).toBe('Gobbler')
      }),
      writeSave(),
    )
    story(
      update,
      given(openOn('Name')),
      message(Message.UpdatedNameDraft({ value: 'Tot Terror' })),
      closeProfile(),
      model(current => {
        expect(current.profileDialog.isOpen).toBe(false)
        expect(current.playerName).toBe('Tot Terror')
      }),
      writeSave(),
    )
  })

  test('clearing the name goes back to the placeholder', () => {
    story(
      update,
      given(modifyFields(openOn('Name'), { playerName: () => 'Hambone' })),
      message(Message.UpdatedNameDraft({ value: '   ' })),
      message(Message.SubmittedName()),
      model(current => {
        expect(current.playerName).toBe('')
        expect(shownName(current.playerName)).toBe(DEFAULT_NAME)
      }),
      writeSave(),
    )
  })

  test('opening the Profile starts the field from the saved name', () => {
    story(
      update,
      given(
        modifyFields(readyAfterRead, {
          playerName: () => 'Baron Burp',
          profile: profile => modifyFields(profile, { nameDraft: () => 'x' }),
        }),
      ),
      message(Message.ClickedSettingsButton()),
      showDialog(),
      model(current => {
        expect(current.profile.nameDraft).toBe('Baron Burp')
      }),
    )
  })
})

describe('the name dice', () => {
  const rollFrom = (seed: number, name = ''): Model => {
    const holder: { current: Model } = { current: readyAfterRead }
    story(
      update,
      given(
        modifyFields(openOn('Name'), {
          cosmeticRngState: () => seed,
          playerName: () => name,
          profile: profile => modifyFields(profile, { nameDraft: () => name }),
        }),
      ),
      message(Message.ClickedNameDiceButton()),
      model(rolled => {
        holder.current = rolled
      }),
      writeSave(),
    )
    return holder.current
  }

  test('rolls the same goofy name from the same cosmetic seed, moves it on, leaves the run seed alone, and spins', () => {
    const first = rollFrom(1234)
    const again = rollFrom(1234)
    expect(again.playerName).toBe(first.playerName)
    expect(again.cosmeticRngState).toBe(first.cosmeticRngState)
    expect(first.cosmeticRngState).not.toBe(1234)
    expect(first.rngState).toBe(readyAfterRead.rngState)
    expect(GOOFY_NAMES).toContain(first.playerName)
    expect(first.profile.nameDraft).toBe(first.playerName)
    expect(first.profile.fx).toBe('Spin')
    expect(first.profile.fxCount).toBe(1)
    const names = pipe(
      Array.range(1, 60),
      Array.map(seed => rollFrom(seed).playerName),
      Array.dedupe,
    )
    expect(names.length).toBeGreaterThan(20)
  })

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
  test('a new part puffs a poof, and the dice spins', () => {
    story(
      update,
      given(openOn('Look')),
      message(
        toParentMessage(
          CharacterBinding,
          toParentMessage(
            Character.ShirtColorBinding,
            PartRadioGroupBlock.Message.SelectedOption({
              index: 3,
              value: 'Teal',
            }),
          ),
        ),
      ),
      Command.resolve(
        RadioGroup.test.FocusOption,
        PartRadioGroupBlock.Message.CompletedFocusOption(),
      ),
      model(current => {
        expect(current.appearance.shirtColor).toBe('Teal')
        expect(current.profile.fx).toBe('Poof')
        expect(current.profile.fxCount).toBe(1)
      }),
      writeSave(),
      message(
        toParentMessage(
          CharacterBinding,
          Character.Message.ClickedDiceButton(),
        ),
      ),
      model(current => {
        expect(current.profile.fx).toBe('Spin')
        expect(current.profile.fxCount).toBe(2)
      }),
      writeSave(),
    )
  })
})
