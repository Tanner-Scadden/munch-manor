import { Array, Effect, Option, pipe } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'
import { RadioGroup, Tabs } from '@foldkit/ui'

import { ProfileBinding } from '../../../app/bindings'
import { Message } from '../../../app/message'
import { AudioState, type Model, Phase } from '../../../app/model'
import { WriteSave } from '../../../app/update/save'
import { PlaySound } from '../../../app/update/sound'
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
} from '../../../domain/playerName'
import { changesBetween } from '../../../platform/playerSync'
import { saveOf } from '../../../platform/save'
import { readyAfterRead } from '../../../test/model.fixture'
import {
  APPLICATION,
  closeProfile,
  press,
  showDialog,
  writeSave,
} from '../../../test/testing'
import * as Character from '../blocks/look/block'
import { PartRadioGroupBlock } from '../blocks/look/lookRadios'
import { CharacterBinding, TabsBinding } from '../composition'
import { Message as ProfileMessage } from '../message'
import { type ProfileTab, ProfileTabsBlock } from '../model'
import { PROFILE_TABS } from '../profile'

const tabIndex = (tab: ProfileTab): number =>
  pipe(
    Array.findFirstIndex(PROFILE_TABS, each => each === tab),
    Option.getOrElse(() => 0),
  )

const selectTab = (tab: ProfileTab) =>
  Story.steps(
    Story.messageIn(
      [ProfileBinding, TabsBinding],
      ProfileTabsBlock.Message.SelectedTab({
        index: tabIndex(tab),
        value: tab,
      }),
    ),
    Story.Command.resolve(
      Tabs.test.FocusTab({ id: 'profile-tabs', index: tabIndex(tab) }),
      ProfileTabsBlock.Message.CompletedFocusTab(),
    ),
  )

const expectOpenOn = (tab: ProfileTab) =>
  Story.model((current: Model) => {
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
  it.effect(
    'the gear and O open it on Settings; the Character card, the player, and C open it on Look',
    () =>
      Effect.gen(function* () {
        yield* Story.story(
          APPLICATION,
          Story.given(readyAfterRead),
          Story.message(Message.ClickedSettingsButton()),
          showDialog(),
          expectOpenOn('Settings'),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(readyAfterRead),
          press('KeyO'),
          showDialog(),
          expectOpenOn('Settings'),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(readyAfterRead),
          Story.message(Message.ClickedCharacterButton()),
          showDialog(),
          expectOpenOn('Look'),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(readyAfterRead),
          press('KeyC'),
          showDialog(),
          expectOpenOn('Look'),
        )
      }),
  )

  test('the tabs are data, in order: Look, Name, Account, Settings', () => {
    expect(PROFILE_TABS).toEqual(['Look', 'Name', 'Account', 'Settings'])
  })

  it.effect('never opens mid-run, and the gear only from the menu itself', () =>
    Effect.gen(function* () {
      const fighting = modifyFields(readyAfterRead, {
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
          Story.story(
            APPLICATION,
            Story.given(fighting),
            Story.message(sent),
            Story.model(current => {
              expect(current.profileDialog.isOpen).toBe(false)
            }),
          ),
      )
    }),
  )

  it.effect(
    'a tab switch shows that tab and asks the tutorial reset again',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          modifyFields(openOn('Settings'), {
            profile: profile =>
              modifyFields(profile, { tutorialReset: () => 'Asking' }),
          }),
        ),
        selectTab('Account'),
        Story.model(current => {
          expect(current.profile.tab).toBe('Account')
          expect(current.profile.tutorialReset).toBe('Idle')
        }),
        selectTab('Name'),
        Story.model(current => {
          expect(current.profile.tab).toBe('Name')
        }),
      ),
  )

  it.effect('a tab switch plays a page flip once sound is on', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(openOn('Look'), { audio: () => AudioState.Ready() }),
      ),
      Story.messageIn(
        [ProfileBinding, TabsBinding],
        ProfileTabsBlock.Message.SelectedTab({ index: 1, value: 'Name' }),
      ),
      Story.Command.expectExact(
        Tabs.test.FocusTab({ id: 'profile-tabs', index: 1 }),
        PlaySound({ sound: 'Whoosh', variation: 0 }),
      ),
      Story.Command.resolve(
        PlaySound({ sound: 'Whoosh', variation: 0 }),
        Message.CompletedPlaySound({ sound: 'Whoosh', outcome: 'Played' }),
      ),
      Story.Command.resolve(
        Tabs.test.FocusTab({ id: 'profile-tabs', index: 1 }),
        ProfileTabsBlock.Message.CompletedFocusTab(),
      ),
    ),
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
      joinName(modifyFields(readyAfterRead, { playerName: () => 'Zed Head' })),
    ).toBe('Zed Head')
  })

  it.effect(
    'typing shows on the stone and is kept, saved, and synced only once the player is done',
    () =>
      Story.story(
        APPLICATION,
        Story.given(openOn('Name')),
        Story.messageIn(
          ProfileBinding,
          ProfileMessage.UpdatedNameDraft({ value: '  Sir   Nibbles of Doom' }),
        ),
        Story.Command.expectNone(),
        Story.model(current => {
          expect(current.profile.nameDraft).toBe('Sir Nibbles ')
          expect(current.playerName).toBe('')
        }),
        Story.messageIn(ProfileBinding, ProfileMessage.SubmittedName()),
        Story.Command.expectHas(WriteSave),
        Story.model(current => {
          expect(current.playerName).toBe('Sir Nibbles')
          expect(current.profile.nameDraft).toBe('Sir Nibbles')
          expect(
            changesBetween(saveOf(openOn('Name')), saveOf(current)),
          ).toEqual([{ _tag: 'ChangedName', name: 'Sir Nibbles' }])
        }),
        writeSave(),
      ),
  )

  it.effect(
    'leaving the field, another tab, or closing keeps what was typed',
    () =>
      Effect.gen(function* () {
        yield* Story.story(
          APPLICATION,
          Story.given(openOn('Name')),
          Story.messageIn(
            ProfileBinding,
            ProfileMessage.UpdatedNameDraft({ value: 'Hambone' }),
          ),
          Story.messageIn(ProfileBinding, ProfileMessage.BlurredNameInput()),
          Story.model(current => {
            expect(current.playerName).toBe('Hambone')
          }),
          writeSave(),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(openOn('Name')),
          Story.messageIn(
            ProfileBinding,
            ProfileMessage.UpdatedNameDraft({ value: 'Gobbler' }),
          ),
          selectTab('Account'),
          Story.model(current => {
            expect(current.playerName).toBe('Gobbler')
          }),
          writeSave(),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(openOn('Name')),
          Story.messageIn(
            ProfileBinding,
            ProfileMessage.UpdatedNameDraft({ value: 'Tot Terror' }),
          ),
          closeProfile(),
          Story.model(current => {
            expect(current.profileDialog.isOpen).toBe(false)
            expect(current.playerName).toBe('Tot Terror')
          }),
          writeSave(),
        )
      }),
  )

  it.effect('clearing the name goes back to the placeholder', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(openOn('Name'), { playerName: () => 'Hambone' }),
      ),
      Story.messageIn(
        ProfileBinding,
        ProfileMessage.UpdatedNameDraft({ value: '   ' }),
      ),
      Story.messageIn(ProfileBinding, ProfileMessage.SubmittedName()),
      Story.model(current => {
        expect(current.playerName).toBe('')
        expect(shownName(current.playerName)).toBe(DEFAULT_NAME)
      }),
      writeSave(),
    ),
  )

  it.effect('opening the Profile starts the field from the saved name', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(readyAfterRead, {
          playerName: () => 'Baron Burp',
          profile: profile => modifyFields(profile, { nameDraft: () => 'x' }),
        }),
      ),
      Story.message(Message.ClickedSettingsButton()),
      showDialog(),
      Story.model(current => {
        expect(current.profile.nameDraft).toBe('Baron Burp')
      }),
    ),
  )
})

describe('the name dice', () => {
  // NOTE: the Model the dice leaves; its save is written last and changes
  // none of what the tests read.
  const rollFrom = (seed: number, name = '') =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(openOn('Name'), {
          cosmeticRngState: () => seed,
          playerName: () => name,
          profile: profile => modifyFields(profile, { nameDraft: () => name }),
        }),
      ),
      Story.messageIn(ProfileBinding, ProfileMessage.ClickedNameDiceButton()),
      writeSave(),
    )

  it.effect(
    'rolls the same goofy name from the same cosmetic seed, moves it on, leaves the run seed alone, and spins',
    () =>
      Effect.gen(function* () {
        const first = yield* rollFrom(1234)
        const again = yield* rollFrom(1234)
        expect(again.playerName).toBe(first.playerName)
        expect(again.cosmeticRngState).toBe(first.cosmeticRngState)
        expect(first.cosmeticRngState).not.toBe(1234)
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
    Story.story(
      APPLICATION,
      Story.given(openOn('Look')),
      Story.messageIn(
        [ProfileBinding, CharacterBinding, Character.ShirtColorBinding],
        PartRadioGroupBlock.Message.SelectedOption({ index: 3, value: 'Teal' }),
      ),
      Story.Command.resolve(
        RadioGroup.test.FocusOption,
        PartRadioGroupBlock.Message.CompletedFocusOption(),
      ),
      Story.model(current => {
        expect(current.appearance.shirtColor).toBe('Teal')
        expect(current.profile.fx).toBe('Poof')
        expect(current.profile.fxCount).toBe(1)
      }),
      writeSave(),
      Story.messageIn(
        [ProfileBinding, CharacterBinding],
        Character.Message.ClickedDiceButton(),
      ),
      Story.model(current => {
        expect(current.profile.fx).toBe('Spin')
        expect(current.profile.fxCount).toBe(2)
      }),
      writeSave(),
    ),
  )
})
