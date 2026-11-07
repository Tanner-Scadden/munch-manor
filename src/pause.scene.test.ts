import { Array } from 'effect'
import {
  Subscription,
  all,
  click,
  expect,
  expectAll,
  given,
  inside,
  pointerDown,
  role,
  scene,
  selector,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test, expect as vitestExpect } from 'vitest'

import { PREPARATION_MS } from './constants'
import { update } from './main'
import { Message } from './message'
import { type Model, MouseButton, Phase, initialModel } from './model'
import { fighting } from './model.fixture'
import { modifyFocus } from './party'
import { CONTROL_CARDS, helpLineOf } from './pauseHelp'
import { ROOT, SCENE_SUBSCRIPTIONS, measureSurface } from './testing'
import { pause } from './waves'
import { STARTING_PISTOL, WEAPONS, tierName } from './weapons'
import { Arsenal } from './worldSchema'

const pausedOn = (device: Model['lastDevice']): Model =>
  pause(modifyFields(fighting, { lastDevice: () => device }))

const keyboardHelp = role('region', {
  name: 'How to play with keyboard and mouse',
})
const touchHelp = role('region', { name: 'How to play with touch' })
const PAUSED_STATUS =
  'Paused during wave 3 of 10. Tap, click, or press Escape to resume. Press H or choose Menu to leave the run.'
const FIGHTING_STATUS = 'Fighting wave 3 of 10.'

const card = (action: string, input: string) =>
  role('listitem', { name: `${action}: ${input}` })

describe('Pause screen controls', () => {
  test('shows the keyboard and mouse controls as cards, with the other keys in one line', () => {
    scene(
      ROOT,
      given(fighting),
      measureSurface,
      expect(keyboardHelp).toBeAbsent(),
      Subscription.emit(
        SCENE_SUBSCRIPTIONS.keyboard,
        Message.PressedKey({ code: 'Escape' }),
      ),
      expect(role('status')).toHaveText(PAUSED_STATUS),
      expect(touchHelp).toBeAbsent(),
      expect(keyboardHelp).toExist(),
      inside(
        role('list', { name: 'Controls' }),
        ...Array.map(CONTROL_CARDS, ({ id, action }) =>
          expect(card(action, helpLineOf(id, 'KeyboardMouse'))).toExist(),
        ),
        expectAll(all.role('listitem')).toHaveCount(10),
      ),
      inside(
        role('list', { name: 'More keys' }),
        expect(role('listitem', { name: 'G next trap' })).toExist(),
        expect(role('listitem', { name: 'Esc pause' })).toExist(),
        expect(role('listitem', { name: 'Enter start' })).toExist(),
        expect(role('listitem', { name: 'H menu' })).toExist(),
        expect(role('listitem', { name: 'M sound' })).toExist(),
        expect(role('listitem', { name: 'N music' })).toExist(),
      ),
      Subscription.emit(
        SCENE_SUBSCRIPTIONS.keyboard,
        Message.PressedKey({ code: 'Escape' }),
      ),
      expect(role('status')).toHaveText(FIGHTING_STATUS),
      expect(keyboardHelp).toBeAbsent(),
    )
  })

  test('shows the touch controls as cards, with no keys', () => {
    scene(
      ROOT,
      given(pausedOn('Touch')),
      measureSurface,
      expect(keyboardHelp).toBeAbsent(),
      expect(touchHelp).toExist(),
      expect(selector('kbd')).toBeAbsent(),
      expect(role('list', { name: 'More keys' })).toBeAbsent(),
      inside(
        role('list', { name: 'Controls' }),
        ...Array.map(CONTROL_CARDS, ({ id, action }) =>
          expect(card(action, helpLineOf(id, 'Touch'))).toExist(),
        ),
        expectAll(all.role('listitem')).toHaveCount(10),
      ),
    )
  })

  test('is plain text with no controls of its own to tab to', () => {
    scene(
      ROOT,
      given(pausedOn('KeyboardMouse')),
      measureSurface,
      expect(keyboardHelp).toExist(),
      inside(keyboardHelp, expect(role('button')).toBeAbsent()),
      expect(
        role('heading', { name: 'How to play with keyboard and mouse' }),
      ).toExist(),
    )
  })

  test('a tap on the panel resumes and does not grab a stick', () => {
    scene(
      ROOT,
      given(pausedOn('Touch')),
      measureSurface,
      pointerDown(touchHelp, {
        pointerType: 'touch',
        pointerId: 4,
        clientX: 700,
        clientY: 200,
      }),
      expect(role('status')).toHaveText(FIGHTING_STATUS),
      expect(touchHelp).toBeAbsent(),
      expect(selector('[data-stick="aim"]')).toBeAbsent(),
    )
  })

  test('a click on the panel resumes without pulling the trigger', () => {
    scene(
      ROOT,
      given(pausedOn('KeyboardMouse')),
      measureSurface,
      pointerDown(keyboardHelp, { pointerId: 1, clientX: 400, clientY: 200 }),
      expect(role('status')).toHaveText(FIGHTING_STATUS),
      expect(keyboardHelp).toBeAbsent(),
    )
    const measured = update(
      pausedOn('KeyboardMouse'),
      Message.MeasuredGameSurface({ left: 0, top: 0, width: 800, height: 400 }),
    ).model
    const resumed = update(
      measured,
      Message.PressedPointer({
        pointerId: 1,
        device: 'Mouse',
        clientX: 400,
        clientY: 200,
      }),
    ).model
    vitestExpect(Phase.isAnyOf(['Wave'])(resumed.phase)).toBe(true)
    vitestExpect(
      MouseButton.isAnyOf(['Released'])(resumed.input.mouseButton),
    ).toBe(true)
  })
})

describe('The PAUSE button', () => {
  const pauseButton = role('button', { name: 'Pause' })

  test('pauses a round, hides on the pause screen, and Esc brings it back', () => {
    scene(
      ROOT,
      given(fighting),
      measureSurface,
      expect(pauseButton).toHaveAttr('aria-keyshortcuts', 'Escape'),
      click(pauseButton),
      expect(role('status')).toHaveText(PAUSED_STATUS),
      expect(keyboardHelp).toExist(),
      expect(pauseButton).toBeAbsent(),
      Subscription.emit(
        SCENE_SUBSCRIPTIONS.keyboard,
        Message.PressedKey({ code: 'Escape' }),
      ),
      expect(role('status')).toHaveText(FIGHTING_STATUS),
      expect(pauseButton).toExist(),
    )
  })

  test('shows on touch between waves, and not on the title', () => {
    scene(
      ROOT,
      given(
        modifyFields(fighting, {
          lastDevice: () => 'Touch',
          phase: () =>
            Phase.Preparation({
              wave: 3,
              remainingMs: 15_000,
              durationMs: PREPARATION_MS,
              spawns: [],
            }),
        }),
      ),
      measureSurface,
      expect(pauseButton).toExist(),
      click(pauseButton),
      expect(touchHelp).toExist(),
    )
    scene(
      ROOT,
      given(initialModel),
      measureSurface,
      expect(pauseButton).toBeAbsent(),
    )
  })
})

describe('Touch gun slots', () => {
  test('are buttons named by the upgrade tier: a tap swaps, the held one reloads', () => {
    const pistolName = tierName('Pistol', 1)
    const shotgunName = tierName('Shotgun', 1)
    vitestExpect(pistolName).not.toBe(WEAPONS.Pistol.name)
    vitestExpect(shotgunName).not.toBe(WEAPONS.Shotgun.name)
    scene(
      ROOT,
      given(
        modifyFocus(modifyFields(fighting, { lastDevice: () => 'Touch' }), {
          player: player =>
            modifyFields(player, {
              arsenal: () =>
                Arsenal.HoldingFirst({
                  first: { ...STARTING_PISTOL, tier: 1 },
                  second: { kind: 'Shotgun', rounds: 16, loaded: 6, tier: 1 },
                }),
            }),
        }),
      ),
      measureSurface,
      expect(role('button', { name: `Reload the ${pistolName}` })).toHaveAttr(
        'aria-keyshortcuts',
        'R',
      ),
      expect(
        role('button', { name: `Switch to the ${shotgunName}` }),
      ).toHaveAttr('aria-keyshortcuts', 'Q'),
      expect(role('button', { name: /^Swap to/ })).toBeAbsent(),
      click(role('button', { name: `Switch to the ${shotgunName}` })),
      expect(role('button', { name: `Reload the ${shotgunName}` })).toExist(),
      expect(role('button', { name: `Switch to the ${pistolName}` })).toExist(),
    )
  })
})
