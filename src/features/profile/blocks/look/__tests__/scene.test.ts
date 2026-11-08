import { Array, Effect } from 'effect'
import { Scene } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, it } from '@effect/vitest'

import { Message } from '../../../../../app/message'
import { Phase } from '../../../../../app/model'
import { home } from '../../../../../test/model.fixture'
import {
  APPLICATION,
  SCENE_SUBSCRIPTIONS,
  closeButton,
  closeDialogInScene,
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
  showDialogInScene,
} from '../../../../../test/testing'

const characterButton = Scene.role('button', {
  name: 'Your character: change how you look',
})
const characterCard = Scene.role('button', {
  name: 'Character: change how you look',
})
const randomizeButton = Scene.role('button', { name: 'Roll a random look' })

const preview = (description: string) =>
  Scene.role('img', { name: `Preview: ${description}` })

const DEFAULT_LOOK = 'broad build, light skin, brown short hair, blue tee'

const beardButton = Scene.role('button', { name: 'Beard' })
const glassesButton = Scene.role('button', { name: 'Glasses' })

const pick = (groupName: string, name: string) => [
  Scene.click(lookOptionIn(groupName, name)),
  resolveFocusOptionInScene(),
]

// NOTE: the rows of earned looks pick by a click of their own, with no
// focus Command, as the radio group is read only there.
const pickGear = (groupName: string, name: string) => [
  Scene.click(lookOptionIn(groupName, name)),
]

describe('Character picker', () => {
  it.effect(
    'the MANOR hand deals a Character card with the C key badge, and the player on stage opens it too',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(home),
        measureSurface,
        Scene.expect(characterButton).toExist(),
        ...openHandInScene(),
        Scene.expect(characterCard).toHaveAttr('aria-keyshortcuts', 'C'),
        Scene.expect(
          Scene.within(characterCard, Scene.selector('.home-key')),
        ).toHaveText('C'),
        Scene.expect(profileDialog).toBeAbsent(),
        ...pickCardInScene('Character: change how you look'),
        Scene.expect(profileDialog).toExist(),
        Scene.click(closeButton),
        ...closeDialogInScene(),
      ),
  )

  it.effect(
    'opens as a labelled dialog with little tabs over the parts and a preview',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(home),
        measureSurface,
        Scene.click(characterButton),
        ...showDialogInScene(),
        Scene.expect(profileDialog).toExist(),
        Scene.expect(Scene.role('tab', { name: 'Look' })).toHaveAttr(
          'aria-selected',
          'true',
        ),
        ...Array.map(['Body', 'Hair', 'Outfit', 'Gear'], name =>
          Scene.expect(lookSection(name)).toExist(),
        ),
        Scene.expect(lookSection('Body')).toHaveAttr('aria-checked', 'true'),
        Scene.expect(lookGroup('Body shape')).toExist(),
        Scene.expect(lookGroup('Skin')).toExist(),
        Scene.expect(lookGroup('Hair')).toBeAbsent(),
        Scene.expect(lookOptionIn('Body shape', 'Broad')).toHaveAttr(
          'aria-checked',
          'true',
        ),
        Scene.expect(lookOptionIn('Body shape', 'Slim')).toHaveAttr(
          'aria-checked',
          'false',
        ),
        Scene.expect(lookOptionIn('Skin', 'Light')).toHaveAttr(
          'aria-checked',
          'true',
        ),
        Scene.expect(beardButton).toHaveAttr('aria-pressed', 'false'),
        Scene.expect(glassesButton).toHaveAttr('aria-pressed', 'false'),
        ...openLookSection('Hair'),
        Scene.expect(lookGroup('Body shape')).toBeAbsent(),
        Scene.expect(lookOptionIn('Hair', 'Short')).toHaveAttr(
          'aria-checked',
          'true',
        ),
        Scene.expect(lookOptionIn('Hair color', 'Brown')).toHaveAttr(
          'aria-checked',
          'true',
        ),
        ...openLookSection('Outfit'),
        Scene.expect(lookOptionIn('Outfit', 'Tee')).toHaveAttr(
          'aria-checked',
          'true',
        ),
        Scene.expect(lookOptionIn('Outfit color', 'Blue')).toHaveAttr(
          'aria-checked',
          'true',
        ),
        Scene.expect(lookOptionIn('Print', 'Plain')).toHaveAttr(
          'aria-checked',
          'true',
        ),
        Scene.expect(lookOptionIn('Print', 'Rainbow')).toExist(),
        Scene.expect(preview(DEFAULT_LOOK)).toExist(),
        Scene.expect(randomizeButton).toExist(),
        Scene.click(closeButton),
        ...closeDialogInScene(),
      ),
  )

  it.effect(
    'picking a part on every little tab changes the look and the preview',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(home),
        measureSurface,
        Scene.click(characterButton),
        ...showDialogInScene(),
        ...pick('Body shape', 'Slim'),
        Scene.expect(lookOptionIn('Body shape', 'Slim')).toHaveAttr(
          'aria-checked',
          'true',
        ),
        ...pick('Skin', 'Deep'),
        Scene.click(beardButton),
        Scene.click(glassesButton),
        Scene.expect(beardButton).toHaveAttr('aria-pressed', 'true'),
        ...openLookSection('Hair'),
        ...pick('Hair', 'Mohawk'),
        ...pick('Hair color', 'Pink'),
        ...openLookSection('Outfit'),
        ...pick('Outfit', 'Dress'),
        ...pickGear('Outfit color', 'Purple'),
        ...pickGear('Print', 'Rainbow'),
        Scene.expect(
          preview(
            'slim build, deep skin, pink mohawk hair, beard, glasses, purple dress, rainbow print',
          ),
        ).toExist(),
        Scene.click(closeButton),
        ...closeDialogInScene(),
        Scene.expect(profileDialog).toBeAbsent(),
      ),
  )

  it.effect('the same name in two groups picks only its own part', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(home),
      measureSurface,
      Scene.click(characterButton),
      ...showDialogInScene(),
      ...openLookSection('Hair'),
      ...pick('Hair color', 'Pink'),
      ...openLookSection('Outfit'),
      Scene.expect(lookOptionIn('Outfit color', 'Pink')).toHaveAttr(
        'aria-checked',
        'false',
      ),
      ...pickGear('Outfit color', 'Purple'),
      ...openLookSection('Hair'),
      Scene.expect(lookOptionIn('Hair color', 'Pink')).toHaveAttr(
        'aria-checked',
        'true',
      ),
      Scene.click(closeButton),
      ...closeDialogInScene(),
    ),
  )

  it.effect(
    'works from the keyboard: C opens it and the arrow keys pick within a group',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(home),
        measureSurface,
        Scene.Subscription.emit(
          SCENE_SUBSCRIPTIONS.keyboard,
          Message.PressedKey({ code: 'KeyC' }),
        ),
        ...showDialogInScene(),
        Scene.expect(profileDialog).toExist(),
        Scene.keydown(lookOptionIn('Body shape', 'Broad'), 'ArrowLeft'),
        resolveFocusOptionInScene(),
        Scene.expect(lookOptionIn('Body shape', 'Slim')).toHaveAttr(
          'aria-checked',
          'true',
        ),
        Scene.keydown(lookSection('Body'), 'ArrowRight'),
        resolveFocusOptionInScene(),
        Scene.expect(lookSection('Hair')).toHaveAttr('aria-checked', 'true'),
        Scene.keydown(lookOptionIn('Hair', 'Short'), 'End'),
        resolveFocusOptionInScene(),
        Scene.expect(lookOptionIn('Hair', 'Bald')).toHaveAttr(
          'aria-checked',
          'true',
        ),
        Scene.expect(
          preview('slim build, light skin, bald, blue tee'),
        ).toExist(),
        Scene.click(closeButton),
        ...closeDialogInScene(),
      ),
  )

  it.effect(
    'works by touch: no key badges, taps open it, pick, and close it',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(modifyFields(home, { lastDevice: () => 'Touch' })),
        measureSurface,
        Scene.expect(
          Scene.within(characterButton, Scene.selector('.home-button-key')),
        ).toBeAbsent(),
        Scene.click(characterButton),
        ...showDialogInScene(),
        ...openLookSection('Hair'),
        ...pick('Hair', 'Long'),
        ...pick('Hair color', 'Grey'),
        Scene.click(closeButton),
        ...closeDialogInScene(),
        Scene.expect(profileDialog).toBeAbsent(),
      ),
  )

  it.effect('the dice rolls a new look from the seed', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(modifyFields(home, { rngState: () => 7 })),
      measureSurface,
      Scene.click(characterButton),
      ...showDialogInScene(),
      Scene.click(randomizeButton),
      Scene.expect(preview(DEFAULT_LOOK)).toBeAbsent(),
      Scene.click(closeButton),
      ...closeDialogInScene(),
    ),
  )

  it.effect(
    'lives on the home menu: Game Over offers Menu instead, and a wave offers neither',
    () =>
      Effect.gen(function* () {
        yield* Scene.scene(
          APPLICATION,
          Scene.given(
            modifyFields(home, {
              phase: () => Phase.GameOver({ wave: 3 }),
              screenMs: () => 99_999,
            }),
          ),
          measureSurface,
          Scene.expect(characterButton).toBeAbsent(),
          Scene.expect(
            Scene.role('button', { name: 'Menu: back to the home screen' }),
          ).toExist(),
          shareMountSettles('Cancelled'),
        )
        yield* Scene.scene(
          APPLICATION,
          Scene.given(
            modifyFields(home, {
              phase: () => Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [] }),
            }),
          ),
          measureSurface,
          Scene.expect(characterButton).toBeAbsent(),
          Scene.Subscription.emit(
            SCENE_SUBSCRIPTIONS.keyboard,
            Message.PressedKey({ code: 'KeyC' }),
          ),
          Scene.expect(profileDialog).toBeAbsent(),
        )
      }),
  )
})
