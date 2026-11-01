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

import { Dialog, DialogBlock } from '@foldkit/ui'

import { Message } from './message'
import { Phase } from './model'
import { home } from './model.fixture'
import {
  ROOT,
  SCENE_SUBSCRIPTIONS,
  closeButton,
  lookGroup,
  lookOptionIn,
  lookSection,
  measureSurface,
  openHandInScene,
  openLookSection,
  pickCardInScene,
  profileDialog,
  resolveFocusOptionInScene,
  shareMountSettles,
} from './testing'

const characterButton = role('button', {
  name: 'Your character: change how you look',
})
const characterCard = role('button', {
  name: 'Character: change how you look',
})
const randomizeButton = role('button', { name: 'Roll a random look' })

const preview = (description: string) =>
  role('img', { name: `Preview: ${description}` })

const DEFAULT_LOOK = 'broad build, light skin, brown short hair, blue tee'

const beardButton = role('button', { name: 'Beard' })
const glassesButton = role('button', { name: 'Glasses' })

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

const pick = (groupName: string, name: string) => [
  click(lookOptionIn(groupName, name)),
  resolveFocusOptionInScene(),
]

// NOTE: the rows of earned looks pick by a click of their own, with no
// focus Command, as the radio group is read only there.
const pickGear = (groupName: string, name: string) => [
  click(lookOptionIn(groupName, name)),
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
      ...Array.map(['Body', 'Hair', 'Outfit', 'Gear'], name =>
        expect(lookSection(name)).toExist(),
      ),
      expect(lookSection('Body')).toHaveAttr('aria-checked', 'true'),
      expect(lookGroup('Body shape')).toExist(),
      expect(lookGroup('Skin')).toExist(),
      expect(lookGroup('Hair')).toBeAbsent(),
      expect(lookOptionIn('Body shape', 'Broad')).toHaveAttr(
        'aria-checked',
        'true',
      ),
      expect(lookOptionIn('Body shape', 'Slim')).toHaveAttr(
        'aria-checked',
        'false',
      ),
      expect(lookOptionIn('Skin', 'Light')).toHaveAttr('aria-checked', 'true'),
      expect(beardButton).toHaveAttr('aria-pressed', 'false'),
      expect(glassesButton).toHaveAttr('aria-pressed', 'false'),
      ...openLookSection('Hair'),
      expect(lookGroup('Body shape')).toBeAbsent(),
      expect(lookOptionIn('Hair', 'Short')).toHaveAttr('aria-checked', 'true'),
      expect(lookOptionIn('Hair color', 'Brown')).toHaveAttr(
        'aria-checked',
        'true',
      ),
      ...openLookSection('Outfit'),
      expect(lookOptionIn('Outfit', 'Tee')).toHaveAttr('aria-checked', 'true'),
      expect(lookOptionIn('Outfit color', 'Blue')).toHaveAttr(
        'aria-checked',
        'true',
      ),
      expect(lookOptionIn('Print', 'Plain')).toHaveAttr('aria-checked', 'true'),
      expect(lookOptionIn('Print', 'Rainbow')).toExist(),
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
      expect(lookOptionIn('Body shape', 'Slim')).toHaveAttr(
        'aria-checked',
        'true',
      ),
      ...pick('Skin', 'Deep'),
      click(beardButton),
      click(glassesButton),
      expect(beardButton).toHaveAttr('aria-pressed', 'true'),
      ...openLookSection('Hair'),
      ...pick('Hair', 'Mohawk'),
      ...pick('Hair color', 'Pink'),
      ...openLookSection('Outfit'),
      ...pick('Outfit', 'Dress'),
      ...pickGear('Outfit color', 'Purple'),
      ...pickGear('Print', 'Rainbow'),
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
      ...openLookSection('Hair'),
      ...pick('Hair color', 'Pink'),
      ...openLookSection('Outfit'),
      expect(lookOptionIn('Outfit color', 'Pink')).toHaveAttr(
        'aria-checked',
        'false',
      ),
      ...pickGear('Outfit color', 'Purple'),
      ...openLookSection('Hair'),
      expect(lookOptionIn('Hair color', 'Pink')).toHaveAttr(
        'aria-checked',
        'true',
      ),
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
      keydown(lookOptionIn('Body shape', 'Broad'), 'ArrowLeft'),
      resolveFocusOptionInScene(),
      expect(lookOptionIn('Body shape', 'Slim')).toHaveAttr(
        'aria-checked',
        'true',
      ),
      keydown(lookSection('Body'), 'ArrowRight'),
      resolveFocusOptionInScene(),
      expect(lookSection('Hair')).toHaveAttr('aria-checked', 'true'),
      keydown(lookOptionIn('Hair', 'Short'), 'End'),
      resolveFocusOptionInScene(),
      expect(lookOptionIn('Hair', 'Bald')).toHaveAttr('aria-checked', 'true'),
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
      ...openLookSection('Hair'),
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
