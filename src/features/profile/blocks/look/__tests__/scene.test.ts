import { Array, Effect } from 'effect'

import { UiStruct } from '@effect/ui'
import { RadioGroup, RadioGroupEvents } from '@effect/ui-kit'
import { HtmlLocator } from '@effect/ui/html/testing'
import { Locator } from '@effect/ui/testing'
import { describe, it } from '@effect/vitest'

import { Message } from '../../../../../app/message'
import { type Model, Phase } from '../../../../../app/model'
import {
  HAND_DIALOG_ID,
  PROFILE_DIALOG_ID,
} from '../../../../../domain/clientSchema'
import type { LookPart } from '../../../../../domain/looks'
import { home } from '../../../../../test/model.fixture'
import {
  button,
  byClass,
  emitPressedKey,
  lookGroup,
  lookOptionIn,
  lookSection,
  measureHud,
  measureSurface,
  openHandInScene,
  pickCardInScene,
  profileDialog,
  requestDialogClose,
  shareMountSettles,
  showDialog,
  withAttrs,
} from '../../../../../test/sceneTesting'
import {
  type StoryStep,
  sceneOf,
  send,
  steps,
} from '../../../../../test/testing'
import {
  type LookDesk,
  atLookRoot,
  characterButton,
  inLook,
  lookDeskOf,
  lookOption,
  openLookSection,
  seeLook,
  settleLook,
} from '../../../__tests__/profile.fixture'

// The Look tab as a player meets it. The root's Scene opens the Profile on
// it; the Look tab is a child there (of the Profile, of the root), so its
// little tabs, rows, and preview are drawn in a Scene of their own, each
// event taken up to a Story of the root and the props it then hands down
// (profile.fixture.ts).

const characterCard = button('Character: change how you look')
const randomizeButton = button('Roll a random look')
const beardButton = button('Beard')
const glassesButton = button('Glasses')

const preview = (description: string) =>
  HtmlLocator.role('img', { name: `Preview: ${description}` })

const DEFAULT_LOOK = 'broad build, light skin, brown short hair, blue tee'

const checked = (locator: Locator.Locator, isChecked: boolean) =>
  seeLook(s =>
    s
      .expect(
        withAttrs({ 'aria-checked': isChecked ? 'true' : 'false' })(locator),
      )
      .toExist(),
  )

const pressed = (locator: Locator.Locator, isPressed: boolean) =>
  seeLook(s =>
    s
      .expect(
        withAttrs({ 'aria-pressed': isPressed ? 'true' : 'false' })(locator),
      )
      .toExist(),
  )

// NOTE: a free part picked in its radio group, by a click or an arrow key,
// as the kit's RadioGroup says it: a Scene runs no child's update, so the
// group's own press is the kit's to test.
const pick = (part: LookPart, value: string) =>
  inLook(s =>
    s.childEmit(RadioGroup, `look-${part}`, RadioGroupEvents.Picked({ value })),
  )

// NOTE: the rows of earned looks pick by a click of their own, as the
// radio group is read only there.
const pickGear = (part: LookPart, value: string) =>
  inLook(s => s.click(lookOption(part, value)))

// NOTE: the Look tab of the Profile opened from `model` by `open`.
const lookOpenedBy = (model: Model, open: StoryStep) =>
  Effect.map(lookDeskOf(model), atLookRoot(open))

const openedFromHome = lookOpenedBy(
  home,
  send(Message.ClickedCharacterButton()),
)

describe('Character picker', () => {
  it.effect(
    'the MANOR hand deals a Character card with the C key badge, and the player on stage opens it too',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(home)
        s.pipe(measureSurface)
          .expect(characterButton)
          .toExist()
          .pipe(openHandInScene, showDialog(HAND_DIALOG_ID))
          .expect(withAttrs({ 'aria-keyshortcuts': 'C' })(characterCard))
          .toExist()
          .expect(Locator.inside(characterCard, byClass('home-key')))
          .toHaveText('C')
          .expect(profileDialog)
          .toBeAbsent()
          .pipe(
            pickCardInScene('Character: change how you look'),
            showDialog(PROFILE_DIALOG_ID),
          )
          .expect(profileDialog)
          .toExist()
          .pipe(requestDialogClose(PROFILE_DIALOG_ID, 'close-press'))
          .expect(profileDialog)
          .toBeAbsent()
        const t = yield* sceneOf(home)
        t.pipe(
          measureSurface,
          scene => scene.click(characterButton),
          showDialog(PROFILE_DIALOG_ID),
        )
          .expect(profileDialog)
          .toExist()
      }),
  )

  it.effect('opens with little tabs over the parts and a preview', () =>
    Effect.gen(function* () {
      const desk = yield* openedFromHome
      steps<LookDesk>(
        seeLook(s =>
          Array.reduce(['Body', 'Hair', 'Outfit', 'Gear'], s, (scene, name) =>
            scene.expect(lookSection(name)).toExist(),
          ),
        ),
        checked(lookSection('Body'), true),
        seeLook(s =>
          s
            .expect(lookGroup('Body shape'))
            .toExist()
            .expect(lookGroup('Skin'))
            .toExist()
            .expect(lookGroup('Hair'))
            .toBeAbsent(),
        ),
        checked(lookOptionIn('Body shape', 'Broad'), true),
        checked(lookOptionIn('Body shape', 'Slim'), false),
        checked(lookOptionIn('Skin', 'Light'), true),
        pressed(beardButton, false),
        pressed(glassesButton, false),
        openLookSection('Hair'),
        seeLook(s => s.expect(lookGroup('Body shape')).toBeAbsent()),
        checked(lookOptionIn('Hair', 'Short'), true),
        checked(lookOptionIn('Hair color', 'Brown'), true),
        openLookSection('Outfit'),
        checked(lookOptionIn('Outfit', 'Tee'), true),
        checked(lookOption('ShirtColor', 'Blue'), true),
        checked(lookOption('Print', 'Plain'), true),
        seeLook(s =>
          s
            .expect(lookOption('Print', 'Rainbow'))
            .toExist()
            .expect(preview(DEFAULT_LOOK))
            .toExist()
            .expect(randomizeButton)
            .toExist(),
        ),
        settleLook,
      )(desk)
    }),
  )

  it.effect(
    'picking a part on every little tab changes the look and the preview',
    () =>
      Effect.gen(function* () {
        const desk = yield* openedFromHome
        steps<LookDesk>(
          pick('Body', 'Slim'),
          checked(lookOptionIn('Body shape', 'Slim'), true),
          pick('SkinTone', 'Deep'),
          seeLook(s => s.click(beardButton)),
          seeLook(s => s.click(glassesButton)),
          pressed(beardButton, true),
          openLookSection('Hair'),
          pick('HairStyle', 'Mohawk'),
          pick('HairColor', 'Pink'),
          openLookSection('Outfit'),
          pick('Outfit', 'Dress'),
          pickGear('ShirtColor', 'Purple'),
          pickGear('Print', 'Rainbow'),
          seeLook(s =>
            s
              .expect(
                preview(
                  'slim build, deep skin, pink mohawk hair, beard, glasses, purple dress, rainbow print',
                ),
              )
              .toExist(),
          ),
          settleLook,
        )(desk)
      }),
  )

  it.effect('the same name in two groups picks only its own part', () =>
    Effect.gen(function* () {
      const desk = yield* openedFromHome
      steps<LookDesk>(
        openLookSection('Hair'),
        pick('HairColor', 'Pink'),
        openLookSection('Outfit'),
        checked(lookOption('ShirtColor', 'Pink'), false),
        pickGear('ShirtColor', 'Purple'),
        openLookSection('Hair'),
        checked(lookOptionIn('Hair color', 'Pink'), true),
        settleLook,
      )(desk)
    }),
  )

  it.effect('C opens it, and a pick within a group shows on the preview', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(home)
      s.pipe(
        measureSurface,
        emitPressedKey('KeyC'),
        showDialog(PROFILE_DIALOG_ID),
      )
        .expect(profileDialog)
        .toExist()
      const desk = yield* lookOpenedBy(
        home,
        send(Message.PressedKey({ code: 'KeyC' })),
      )
      steps<LookDesk>(
        pick('Body', 'Slim'),
        checked(lookOptionIn('Body shape', 'Slim'), true),
        openLookSection('Hair'),
        checked(lookSection('Hair'), true),
        pick('HairStyle', 'Bald'),
        checked(lookOptionIn('Hair', 'Bald'), true),
        seeLook(look =>
          look
            .expect(preview('slim build, light skin, bald, blue tee'))
            .toExist(),
        ),
        settleLook,
      )(desk)
    }),
  )

  it.effect(
    'works by touch: no key badges, taps open it, pick, and close it',
    () =>
      Effect.gen(function* () {
        const onTouch = UiStruct.evolve(home, { lastDevice: () => 'Touch' })
        const s = yield* sceneOf(onTouch)
        s.pipe(measureSurface)
          .expect(Locator.inside(characterButton, byClass('home-button-key')))
          .toBeAbsent()
          .pipe(
            scene => scene.click(characterButton),
            showDialog(PROFILE_DIALOG_ID),
          )
          .expect(profileDialog)
          .toExist()
          .pipe(requestDialogClose(PROFILE_DIALOG_ID, 'close-press'))
          .expect(profileDialog)
          .toBeAbsent()
        const desk = yield* lookOpenedBy(
          onTouch,
          send(Message.ClickedCharacterButton()),
        )
        steps<LookDesk>(
          openLookSection('Hair'),
          pick('HairStyle', 'Long'),
          pick('HairColor', 'Grey'),
          checked(lookOptionIn('Hair', 'Long'), true),
          checked(lookOptionIn('Hair color', 'Grey'), true),
          settleLook,
        )(desk)
      }),
  )

  it.effect('the dice rolls a new look from the seed', () =>
    Effect.gen(function* () {
      const desk = yield* lookOpenedBy(
        UiStruct.evolve(home, { rngState: () => 7 }),
        send(Message.ClickedCharacterButton()),
      )
      steps<LookDesk>(
        seeLook(s => s.expect(preview(DEFAULT_LOOK)).toExist()),
        seeLook(s => s.click(randomizeButton)),
        seeLook(s => s.expect(preview(DEFAULT_LOOK)).toBeAbsent()),
        settleLook,
      )(desk)
    }),
  )

  it.effect(
    'lives on the home menu: Game Over offers Menu instead, and a wave offers neither',
    () =>
      Effect.gen(function* () {
        const gameOver = yield* sceneOf(
          UiStruct.evolve(home, {
            phase: () => Phase.GameOver({ wave: 3 }),
            screenMs: () => 99_999,
          }),
        )
        gameOver
          .pipe(measureSurface)
          .expect(characterButton)
          .toBeAbsent()
          .expect(button('Menu: back to the home screen'))
          .toExist()
          .pipe(shareMountSettles('Cancelled'))
        const wave = yield* sceneOf(
          UiStruct.evolve(home, {
            phase: () => Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [] }),
          }),
        )
        wave
          .pipe(measureHud)
          .expect(characterButton)
          .toBeAbsent()
          .pipe(emitPressedKey('KeyC'))
          .expect(profileDialog)
          .toBeAbsent()
      }),
  )
})
