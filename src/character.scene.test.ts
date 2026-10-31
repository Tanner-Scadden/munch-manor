import { Array } from 'effect'
import {
  Command,
  Subscription,
  click,
  expect,
  given,
  keydown,
  role,
  scene,
  selector,
  within,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'

import { Dialog, DialogBlock, RadioGroup } from '@foldkit/ui'

import { PartRadioGroupBlock } from './lookRadios'
import { Message } from './message'
import { Phase } from './model'
import { home } from './model.fixture'
import {
  ROOT,
  SCENE_SUBSCRIPTIONS,
  closeButton,
  measureSurface,
  openHandInScene,
  pickCardInScene,
  profileDialog,
  shareMountSettles,
} from './testing'

const characterButton = role('button', {
  name: 'Your character: change how you look',
})
const characterCard = role('button', {
  name: 'Character: change how you look',
})
const randomizeButton = role('button', { name: 'Roll a random look' })

const group = (name: string) => role('radiogroup', { name })
const optionIn = (groupName: string, name: string) =>
  within(group(groupName), role('radio', { name }))

const preview = (description: string) =>
  role('img', { name: `Preview: ${description}` })

const DEFAULT_LOOK = 'broad build, light skin, brown short hair, blue tee'

const beardButton = role('button', { name: 'Beard' })
const glassesButton = role('button', { name: 'Glasses' })

const section = (name: string) =>
  within(group('Parts'), role('radio', { name }))

const openSection = (name: string) => [
  click(section(name)),
  resolveFocusOption(),
]

const showPicker = () => [
  Command.resolve(
    Dialog.test.ShowDialog,
    DialogBlock.Message.SucceededShowDialog(),
  ),
]

const closePicker = () => [
  Command.resolve(
    Dialog.test.CloseDialog,
    DialogBlock.Message.CompletedCloseDialog(),
  ),
]

const resolveFocusOption = () =>
  Command.resolve(
    RadioGroup.test.FocusOption,
    PartRadioGroupBlock.Message.CompletedFocusOption(),
  )

const pick = (groupName: string, name: string) => [
  click(optionIn(groupName, name)),
  resolveFocusOption(),
]

describe('Character picker', () => {
  test('the MANOR hand deals a Character card with the C key badge, and the player on stage opens it too', () => {
    scene(
      ROOT,
      given(home),
      measureSurface,
      expect(characterButton).toExist(),
      ...openHandInScene(),
      expect(characterCard).toHaveAttr('aria-keyshortcuts', 'C'),
      expect(within(characterCard, selector('.home-key'))).toHaveText('C'),
      expect(profileDialog).toBeAbsent(),
      ...pickCardInScene('Character: change how you look'),
      expect(profileDialog).toExist(),
      click(closeButton),
      ...closePicker(),
    )
  })

  test('opens as a labelled dialog with little tabs over the parts and a preview', () => {
    scene(
      ROOT,
      given(home),
      measureSurface,
      click(characterButton),
      ...showPicker(),
      expect(profileDialog).toExist(),
      expect(role('tab', { name: 'Look' })).toHaveAttr('aria-selected', 'true'),
      ...Array.map(['Body', 'Hair', 'Outfit'], name =>
        expect(section(name)).toExist(),
      ),
      expect(section('Body')).toHaveAttr('aria-checked', 'true'),
      expect(group('Body shape')).toExist(),
      expect(group('Skin')).toExist(),
      expect(group('Hair')).toBeAbsent(),
      expect(optionIn('Body shape', 'Broad')).toHaveAttr(
        'aria-checked',
        'true',
      ),
      expect(optionIn('Body shape', 'Slim')).toHaveAttr(
        'aria-checked',
        'false',
      ),
      expect(optionIn('Skin', 'Light')).toHaveAttr('aria-checked', 'true'),
      expect(beardButton).toHaveAttr('aria-pressed', 'false'),
      expect(glassesButton).toHaveAttr('aria-pressed', 'false'),
      ...openSection('Hair'),
      expect(group('Body shape')).toBeAbsent(),
      expect(optionIn('Hair', 'Short')).toHaveAttr('aria-checked', 'true'),
      expect(optionIn('Hair color', 'Brown')).toHaveAttr(
        'aria-checked',
        'true',
      ),
      ...openSection('Outfit'),
      expect(optionIn('Outfit', 'Tee')).toHaveAttr('aria-checked', 'true'),
      expect(optionIn('Outfit color', 'Blue')).toHaveAttr(
        'aria-checked',
        'true',
      ),
      expect(optionIn('Print', 'Plain')).toHaveAttr('aria-checked', 'true'),
      expect(optionIn('Print', 'Rainbow')).toExist(),
      expect(preview(DEFAULT_LOOK)).toExist(),
      expect(randomizeButton).toExist(),
      click(closeButton),
      ...closePicker(),
    )
  })

  test('picking a part on every little tab changes the look and the preview', () => {
    scene(
      ROOT,
      given(home),
      measureSurface,
      click(characterButton),
      ...showPicker(),
      ...pick('Body shape', 'Slim'),
      expect(optionIn('Body shape', 'Slim')).toHaveAttr('aria-checked', 'true'),
      ...pick('Skin', 'Deep'),
      click(beardButton),
      click(glassesButton),
      expect(beardButton).toHaveAttr('aria-pressed', 'true'),
      ...openSection('Hair'),
      ...pick('Hair', 'Mohawk'),
      ...pick('Hair color', 'Pink'),
      ...openSection('Outfit'),
      ...pick('Outfit', 'Dress'),
      ...pick('Outfit color', 'Purple'),
      ...pick('Print', 'Rainbow'),
      expect(
        preview(
          'slim build, deep skin, pink mohawk hair, beard, glasses, purple dress, rainbow print',
        ),
      ).toExist(),
      click(closeButton),
      ...closePicker(),
      expect(profileDialog).toBeAbsent(),
    )
  })

  test('the same name in two groups picks only its own part', () => {
    scene(
      ROOT,
      given(home),
      measureSurface,
      click(characterButton),
      ...showPicker(),
      ...openSection('Hair'),
      ...pick('Hair color', 'Pink'),
      ...openSection('Outfit'),
      expect(optionIn('Outfit color', 'Pink')).toHaveAttr(
        'aria-checked',
        'false',
      ),
      ...pick('Outfit color', 'Purple'),
      ...openSection('Hair'),
      expect(optionIn('Hair color', 'Pink')).toHaveAttr('aria-checked', 'true'),
      click(closeButton),
      ...closePicker(),
    )
  })

  test('works from the keyboard: C opens it and the arrow keys pick within a group', () => {
    scene(
      ROOT,
      given(home),
      measureSurface,
      Subscription.emit(
        SCENE_SUBSCRIPTIONS.keyboard,
        Message.PressedKey({ code: 'KeyC' }),
      ),
      ...showPicker(),
      expect(profileDialog).toExist(),
      keydown(optionIn('Body shape', 'Broad'), 'ArrowLeft'),
      resolveFocusOption(),
      expect(optionIn('Body shape', 'Slim')).toHaveAttr('aria-checked', 'true'),
      keydown(section('Body'), 'ArrowRight'),
      resolveFocusOption(),
      expect(section('Hair')).toHaveAttr('aria-checked', 'true'),
      keydown(optionIn('Hair', 'Short'), 'End'),
      resolveFocusOption(),
      expect(optionIn('Hair', 'Bald')).toHaveAttr('aria-checked', 'true'),
      expect(preview('slim build, light skin, bald, blue tee')).toExist(),
      click(closeButton),
      ...closePicker(),
    )
  })

  test('works by touch: no key badges, taps open it, pick, and close it', () => {
    scene(
      ROOT,
      given(modifyFields(home, { lastDevice: () => 'Touch' })),
      measureSurface,
      expect(
        within(characterButton, selector('.home-button-key')),
      ).toBeAbsent(),
      click(characterButton),
      ...showPicker(),
      ...openSection('Hair'),
      ...pick('Hair', 'Long'),
      ...pick('Hair color', 'Grey'),
      click(closeButton),
      ...closePicker(),
      expect(profileDialog).toBeAbsent(),
    )
  })

  test('the dice rolls a new look from the seed', () => {
    scene(
      ROOT,
      given(modifyFields(home, { rngState: () => 7 })),
      measureSurface,
      click(characterButton),
      ...showPicker(),
      click(randomizeButton),
      expect(preview(DEFAULT_LOOK)).toBeAbsent(),
      click(closeButton),
      ...closePicker(),
    )
  })

  test('lives on the home menu: Game Over offers Menu instead, and a wave offers neither', () => {
    scene(
      ROOT,
      given(
        modifyFields(home, {
          phase: () => Phase.GameOver({ wave: 3 }),
          screenMs: () => 99_999,
        }),
      ),
      measureSurface,
      expect(characterButton).toBeAbsent(),
      expect(
        role('button', { name: 'Menu: back to the home screen' }),
      ).toExist(),
      shareMountSettles('Cancelled'),
    )
    scene(
      ROOT,
      given(
        modifyFields(home, {
          phase: () => Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [] }),
        }),
      ),
      measureSurface,
      expect(characterButton).toBeAbsent(),
      Subscription.emit(
        SCENE_SUBSCRIPTIONS.keyboard,
        Message.PressedKey({ code: 'KeyC' }),
      ),
      expect(profileDialog).toBeAbsent(),
    )
  })
})
