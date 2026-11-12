import { Array, String } from 'effect'
import { Scene } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, it, test, expect as vitestExpect } from '@effect/vitest'
import { Dialog, DialogBlock } from '@foldkit/ui'

import type { Model } from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import type { InputDevice } from '../../../input/inputSchema'
import {
  APPLICATION,
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
// from a playtester who found a picture and a word taught nothing. The
// line shows on focus with a keyboard and on a tap on touch (hover is CSS).

const homeOn = (device: InputDevice): Model =>
  modifyFields(asVeteran(initialModel), { lastDevice: () => device })

const DEVICES: ReadonlyArray<InputDevice> = ['KeyboardMouse', 'Touch']

const howToPlay = Scene.role('dialog', { name: 'How to play' })

const cardButton = (card: (typeof CONTROL_CARDS)[number]) =>
  Scene.selector(`#${helpCardElementId(card.id)}`)

const lineOf = (card: (typeof CONTROL_CARDS)[number]) =>
  Scene.selector(`#${helpLineElementId(card.id)}`)

const openHowToPlay = [
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

  it.effect('a keyboard player focuses each card to read its line', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(homeOn('KeyboardMouse')),
      ...openHowToPlay,
      Scene.inside(
        howToPlay,
        ...Array.flatMap(CONTROL_CARDS, card => [
          Scene.expect(cardButton(card)).toHaveAttr('aria-expanded', 'false'),
          Scene.focus(cardButton(card)),
          Scene.expect(cardButton(card)).toHaveAttr('aria-expanded', 'true'),
          Scene.expect(cardButton(card)).toHaveAttr('data-open', 'true'),
          Scene.expect(lineOf(card)).toHaveText(
            helpLineOf(card.id, 'KeyboardMouse'),
          ),
        ]),
      ),
    ),
  )

  it.effect(
    'a touch player taps a card to read its line, and another to switch',
    () => {
      const first = Array.headNonEmpty(CONTROL_CARDS)
      const second = Array.lastNonEmpty(CONTROL_CARDS)
      return Scene.scene(
        APPLICATION,
        Scene.given(homeOn('Touch')),
        ...openHowToPlay,
        Scene.inside(
          howToPlay,
          ...Array.flatMap(CONTROL_CARDS, card => [
            Scene.click(cardButton(card)),
            Scene.expect(cardButton(card)).toHaveAttr('aria-expanded', 'true'),
            Scene.expect(lineOf(card)).toHaveText(helpLineOf(card.id, 'Touch')),
          ]),
          Scene.click(cardButton(first)),
          Scene.expect(cardButton(first)).toHaveAttr('aria-expanded', 'true'),
          Scene.expect(cardButton(second)).toHaveAttr('aria-expanded', 'false'),
        ),
      )
    },
  )

  it.effect('PLAY TUTORIAL waits on How to play from home', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(homeOn('Touch')),
      ...openHowToPlay,
      Scene.inside(
        howToPlay,
        Scene.expect(Scene.role('button', { name: 'Play tutorial' })).toExist(),
      ),
    ),
  )
})

// NOTE: with a controller in hand, How to play draws the pad with each
// button named beside it (owner, 2026-11-12). The panel is opened on the
// Model, since a click to open it would make the mouse the last device.
describe('the controller diagram', () => {
  const panelOpenOn = (device: InputDevice): Model =>
    modifyFields(homeOn(device), {
      panel: () => 'HowToPlay',
      panelDialog: dialog => ({ ...dialog, isOpen: true }),
    })

  const diagram = Scene.role('region', { name: 'Controller buttons' })

  it.effect('names every button a run uses beside the pad', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(panelOpenOn('Gamepad')),
      measureSurface,
      Scene.Mount.resolve(
        Dialog.test.AcquireResources,
        DialogBlock.Message.SucceededAcquireResources(),
      ),
      Scene.inside(
        diagram,
        ...Array.map(['LT', 'LB', 'RT', 'A', 'B', 'X', 'Y'], glyph =>
          Scene.expect(Scene.text(glyph, { exact: true })).toExist(),
        ),
        Scene.expect(Scene.text('shoot')).toExist(),
        Scene.expect(Scene.text('next weapon')).toExist(),
      ),
    ),
  )

  it.effect('is not drawn for a keyboard', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(panelOpenOn('KeyboardMouse')),
      measureSurface,
      Scene.Mount.resolve(
        Dialog.test.AcquireResources,
        DialogBlock.Message.SucceededAcquireResources(),
      ),
      Scene.expect(diagram).toBeAbsent(),
    ),
  )
})
