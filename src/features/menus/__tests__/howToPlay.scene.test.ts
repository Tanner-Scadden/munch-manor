import { Array, String } from 'effect'
import {
  click,
  expect,
  focus,
  given,
  inside,
  role,
  scene,
  selector,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test, expect as vitestExpect } from 'vitest'

import type { Model } from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import type { InputDevice } from '../../../input/inputSchema'
import {
  ROOT,
  measureSurface,
  openHandInScene,
  pickCardInScene,
} from '../../../test/testing'
import { asVeteran } from '../../../test/veteran'
import {
  CONTROL_CARDS,
  helpCardElementId,
  helpLineElementId,
  helpLineOf,
} from '../pauseHelp'

// NOTE: How to play's cards each carry one line of how to do the thing,
// from a playtester who found "Leftovers" and "Charge" taught nothing. The
// line shows on focus with a keyboard and on a tap on touch (hover is CSS).

const homeOn = (device: InputDevice): Model =>
  modifyFields(asVeteran(initialModel), { lastDevice: () => device })

const DEVICES: ReadonlyArray<InputDevice> = ['KeyboardMouse', 'Touch']

const howToPlay = role('dialog', { name: 'How to play' })

const cardButton = (card: (typeof CONTROL_CARDS)[number]) =>
  selector(`#${helpCardElementId(card.id)}`)

const lineOf = (card: (typeof CONTROL_CARDS)[number]) =>
  selector(`#${helpLineElementId(card.id)}`)

const openHowToPlay = (device: InputDevice) => [
  given(homeOn(device)),
  measureSurface,
  ...openHandInScene(),
  ...pickCardInScene(/^How to play:/),
]

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

  test('a keyboard player focuses each card to read its line', () => {
    scene(
      ROOT,
      ...openHowToPlay('KeyboardMouse'),
      inside(
        howToPlay,
        ...Array.flatMap(CONTROL_CARDS, card => [
          expect(cardButton(card)).toHaveAttr('aria-expanded', 'false'),
          focus(cardButton(card)),
          expect(cardButton(card)).toHaveAttr('aria-expanded', 'true'),
          expect(cardButton(card)).toHaveAttr('data-open', 'true'),
          expect(lineOf(card)).toHaveText(helpLineOf(card.id, 'KeyboardMouse')),
        ]),
      ),
    )
  })

  test('a touch player taps a card to read its line, and another to switch', () => {
    const first = Array.headNonEmpty(CONTROL_CARDS)
    const second = Array.lastNonEmpty(CONTROL_CARDS)
    scene(
      ROOT,
      ...openHowToPlay('Touch'),
      inside(
        howToPlay,
        ...Array.flatMap(CONTROL_CARDS, card => [
          click(cardButton(card)),
          expect(cardButton(card)).toHaveAttr('aria-expanded', 'true'),
          expect(lineOf(card)).toHaveText(helpLineOf(card.id, 'Touch')),
        ]),
        click(cardButton(first)),
        expect(cardButton(first)).toHaveAttr('aria-expanded', 'true'),
        expect(cardButton(second)).toHaveAttr('aria-expanded', 'false'),
      ),
    )
  })
})
