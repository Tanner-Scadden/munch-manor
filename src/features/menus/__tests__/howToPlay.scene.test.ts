import { Array, Effect, String } from 'effect'

import { UiStruct } from '@effect/ui'
import { HtmlLocator } from '@effect/ui/html/testing'
import { Locator } from '@effect/ui/testing'
import { describe, it, test, expect as vitestExpect } from '@effect/vitest'

import type { Model } from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { HAND_DIALOG_ID, PANEL_DIALOG_ID } from '../../../domain/clientSchema'
import type { InputDevice } from '../../../input/inputSchema'
import {
  expectAttr,
  measureSurface,
  openHandInScene,
  pickCardInScene,
  showDialog,
} from '../../../test/sceneTesting'
import { type SceneStep, sceneOf, steps } from '../../../test/testing'
import { asVeteran } from '../../../test/veteran'
import {
  CONTROL_CARDS,
  helpCardElementId,
  helpLineElementId,
  helpLineOf,
} from '../pauseHelp'

// NOTE: How to play's cards each carry one line of how to do the thing,
// from a playtester who found a picture and a word taught nothing. The
// line shows on focus with a keyboard and on a tap on touch (hover is CSS).

const homeOn = (device: InputDevice): Model =>
  UiStruct.evolve(asVeteran(initialModel), { lastDevice: () => device })

const DEVICES: ReadonlyArray<InputDevice> = ['KeyboardMouse', 'Touch']

const howToPlay = HtmlLocator.role('dialog', { name: 'How to play' })

const inHowToPlay = (locator: Locator.Locator) =>
  Locator.inside(howToPlay, locator)

const cardButton = (card: (typeof CONTROL_CARDS)[number]) =>
  inHowToPlay(Locator.attr('id', helpCardElementId(card.id)))

const lineOf = (card: (typeof CONTROL_CARDS)[number]) =>
  inHowToPlay(Locator.attr('id', helpLineElementId(card.id)))

const openHowToPlay: SceneStep = steps(
  measureSurface,
  openHandInScene,
  showDialog(HAND_DIALOG_ID),
  pickCardInScene(/^How to play:/),
  showDialog(PANEL_DIALOG_ID),
)

describe('How to play lines', () => {
  test.each(DEVICES)(
    'every card on %s has a short line that does not repeat its title',
    device => {
      Array.forEach(CONTROL_CARDS, card => {
        const line = helpLineOf(card.id, device)
        vitestExpect(String.isNonEmpty(line)).toBe(true)
        vitestExpect(line.length).toBeLessThanOrEqual(72)
        Array.forEach(
          Array.filter(
            String.split(String.toLowerCase(card.action), ' '),
            word => word.length > 1,
          ),
          word =>
            vitestExpect(String.toLowerCase(line)).not.toMatch(
              new RegExp(`\\b${word}\\b`),
            ),
        )
      })
    },
  )

  it.effect('a keyboard player focuses each card to read its line', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(homeOn('KeyboardMouse'))
      s.pipe(
        openHowToPlay,
        steps(
          ...Array.map(
            CONTROL_CARDS,
            (card): SceneStep =>
              current =>
                current
                  .pipe(expectAttr(cardButton(card), 'aria-expanded', 'false'))
                  .focus(cardButton(card))
                  .pipe(
                    expectAttr(cardButton(card), 'aria-expanded', 'true'),
                    expectAttr(cardButton(card), 'data-open', 'true'),
                  )
                  .expect(lineOf(card))
                  .toHaveText(helpLineOf(card.id, 'KeyboardMouse')),
          ),
        ),
      )
    }),
  )

  it.effect(
    'a touch player taps a card to read its line, and another to switch',
    () =>
      Effect.gen(function* () {
        const first = Array.headNonEmpty(CONTROL_CARDS)
        const second = Array.lastNonEmpty(CONTROL_CARDS)
        const s = yield* sceneOf(homeOn('Touch'))
        s.pipe(
          openHowToPlay,
          steps(
            ...Array.map(
              CONTROL_CARDS,
              (card): SceneStep =>
                current =>
                  current
                    .click(cardButton(card))
                    .pipe(expectAttr(cardButton(card), 'aria-expanded', 'true'))
                    .expect(lineOf(card))
                    .toHaveText(helpLineOf(card.id, 'Touch')),
            ),
          ),
        )
          .click(cardButton(first))
          .pipe(
            expectAttr(cardButton(first), 'aria-expanded', 'true'),
            expectAttr(cardButton(second), 'aria-expanded', 'false'),
          )
      }),
  )

  it.effect('PLAY TUTORIAL waits on How to play from home', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(homeOn('Touch'))
      s.pipe(openHowToPlay)
        .expect(
          inHowToPlay(HtmlLocator.role('button', { name: 'Play tutorial' })),
        )
        .toExist()
    }),
  )
})

// NOTE: with a controller in hand, How to play draws the pad with each
// button named beside it (owner, 2026-11-12). The panel is opened on the
// Model, since a click to open it would make the mouse the last device.
describe('the controller diagram', () => {
  const panelOpenOn = (device: InputDevice): Model =>
    UiStruct.evolve(homeOn(device), {
      panel: () => 'HowToPlay',
      panelDialog: dialog => ({ ...dialog, isOpen: true }),
    })

  const diagram = HtmlLocator.role('region', { name: 'Controller buttons' })

  it.effect('names every button a run uses beside the pad', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(panelOpenOn('Gamepad'))
      const inDiagram = (text: string, exact: boolean) =>
        Locator.inside(diagram, Locator.text(text, { exact }))
      s.pipe(measureSurface, showDialog(PANEL_DIALOG_ID))
      Array.forEach(['LT', 'LB', 'RT', 'A', 'B', 'X', 'Y'], glyph => {
        s.expect(inDiagram(glyph, true)).toExist()
      })
      s.expect(inDiagram('shoot', false))
        .toExist()
        .expect(inDiagram('next weapon', false))
        .toExist()
    }),
  )

  it.effect('is not drawn for a keyboard', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(panelOpenOn('KeyboardMouse'))
      s.pipe(measureSurface, showDialog(PANEL_DIALOG_ID))
        .expect(diagram)
        .toBeAbsent()
    }),
  )
})
