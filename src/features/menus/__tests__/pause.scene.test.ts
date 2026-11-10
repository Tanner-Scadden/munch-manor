import { Array, Effect } from 'effect'
import { Scene, Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, it, expect as vitestExpect } from '@effect/vitest'

import { Message } from '../../../app/message'
import { type Model, Phase } from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { MouseButton } from '../../../input/inputSchema'
import { PREPARATION_MS } from '../../../shared/constants'
import { fighting } from '../../../test/model.fixture'
import {
  APPLICATION,
  SCENE_SUBSCRIPTIONS,
  SURFACE,
  measureSurface,
} from '../../../test/testing'
import { STARTING_PISTOL, WEAPONS, tierName } from '../../../world/gear/weapons'
import { modifyFocus } from '../../../world/party/party'
import { Arsenal } from '../../../world/schema/worldSchema'
import { pause } from '../../../world/waves/waves'
import { CONTROL_CARDS, helpLineOf } from '../pauseHelp'

const pausedOn = (device: Model['lastDevice']): Model =>
  pause(modifyFields(fighting, { lastDevice: () => device }))

const keyboardHelp = Scene.role('region', {
  name: 'How to play with keyboard and mouse',
})
const touchHelp = Scene.role('region', { name: 'How to play with touch' })
const PAUSED_STATUS =
  'Paused during wave 3. Tap, click, or press Escape to resume. Press H or choose Menu to leave the run.'
const FIGHTING_STATUS = 'Fighting wave 3.'

const card = (action: string, input: string) =>
  Scene.role('listitem', { name: `${action}: ${input}` })

describe('Pause screen controls', () => {
  it.effect(
    'shows the keyboard and mouse controls as cards, with the other keys in one line',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(fighting),
        measureSurface,
        Scene.expect(keyboardHelp).toBeAbsent(),
        Scene.Subscription.emit(
          SCENE_SUBSCRIPTIONS.keyboard,
          Message.PressedKey({ code: 'Escape' }),
        ),
        Scene.expect(Scene.role('status')).toHaveText(PAUSED_STATUS),
        Scene.expect(touchHelp).toBeAbsent(),
        Scene.expect(keyboardHelp).toExist(),
        Scene.inside(
          Scene.role('list', { name: 'Controls' }),
          ...Array.map(CONTROL_CARDS, ({ id, action }) =>
            Scene.expect(
              card(action, helpLineOf(id, 'KeyboardMouse')),
            ).toExist(),
          ),
          Scene.expectAll(Scene.all.role('listitem')).toHaveCount(10),
        ),
        Scene.inside(
          Scene.role('list', { name: 'More keys' }),
          Scene.expect(
            Scene.role('listitem', { name: 'G next trap' }),
          ).toExist(),
          Scene.expect(Scene.role('listitem', { name: 'Esc pause' })).toExist(),
          Scene.expect(
            Scene.role('listitem', { name: 'Enter start' }),
          ).toExist(),
          Scene.expect(Scene.role('listitem', { name: 'H menu' })).toExist(),
          Scene.expect(Scene.role('listitem', { name: 'M sound' })).toExist(),
          Scene.expect(Scene.role('listitem', { name: 'N music' })).toExist(),
        ),
        Scene.Subscription.emit(
          SCENE_SUBSCRIPTIONS.keyboard,
          Message.PressedKey({ code: 'Escape' }),
        ),
        Scene.expect(Scene.role('status')).toHaveText(FIGHTING_STATUS),
        Scene.expect(keyboardHelp).toBeAbsent(),
      ),
  )

  it.effect('shows the touch controls as cards, with no keys', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(pausedOn('Touch')),
      measureSurface,
      Scene.expect(keyboardHelp).toBeAbsent(),
      Scene.expect(touchHelp).toExist(),
      Scene.expect(Scene.selector('kbd')).toBeAbsent(),
      Scene.expect(Scene.role('list', { name: 'More keys' })).toBeAbsent(),
      Scene.inside(
        Scene.role('list', { name: 'Controls' }),
        ...Array.map(CONTROL_CARDS, ({ id, action }) =>
          Scene.expect(card(action, helpLineOf(id, 'Touch'))).toExist(),
        ),
        Scene.expectAll(Scene.all.role('listitem')).toHaveCount(10),
      ),
    ),
  )

  it.effect('is plain text with no controls of its own to tab to', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(pausedOn('KeyboardMouse')),
      measureSurface,
      Scene.expect(keyboardHelp).toExist(),
      Scene.inside(
        keyboardHelp,
        Scene.expect(Scene.role('button')).toBeAbsent(),
      ),
      Scene.expect(
        Scene.role('heading', { name: 'How to play with keyboard and mouse' }),
      ).toExist(),
    ),
  )

  it.effect('a tap on the panel resumes and does not grab a stick', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(pausedOn('Touch')),
      measureSurface,
      Scene.pointerDown(touchHelp, {
        pointerType: 'touch',
        pointerId: 4,
        clientX: 700,
        clientY: 200,
      }),
      Scene.expect(Scene.role('status')).toHaveText(FIGHTING_STATUS),
      Scene.expect(touchHelp).toBeAbsent(),
      Scene.expect(Scene.selector('[data-stick="aim"]')).toBeAbsent(),
    ),
  )

  it.effect('a click on the panel resumes without pulling the trigger', () =>
    Effect.gen(function* () {
      yield* Scene.scene(
        APPLICATION,
        Scene.given(pausedOn('KeyboardMouse')),
        measureSurface,
        Scene.pointerDown(keyboardHelp, {
          pointerId: 1,
          clientX: 400,
          clientY: 200,
        }),
        Scene.expect(Scene.role('status')).toHaveText(FIGHTING_STATUS),
        Scene.expect(keyboardHelp).toBeAbsent(),
      )
      yield* Story.story(
        APPLICATION,
        Story.given(pausedOn('KeyboardMouse')),
        Story.message(Message.MeasuredGameSurface(SURFACE)),
        Story.message(
          Message.PressedPointer({
            pointerId: 1,
            device: 'Mouse',
            clientX: 400,
            clientY: 200,
          }),
        ),
        Story.model(resumed => {
          vitestExpect(Phase.isAnyOf(['Wave'])(resumed.phase)).toBe(true)
          vitestExpect(
            MouseButton.isAnyOf(['Released'])(resumed.input.mouseButton),
          ).toBe(true)
        }),
      )
    }),
  )
})

describe('The PAUSE button', () => {
  const pauseButton = Scene.role('button', { name: 'Pause' })

  it.effect(
    'pauses a round, hides on the pause screen, and Esc brings it back',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(fighting),
        measureSurface,
        Scene.expect(pauseButton).toHaveAttr('aria-keyshortcuts', 'Escape'),
        Scene.click(pauseButton),
        Scene.expect(Scene.role('status')).toHaveText(PAUSED_STATUS),
        Scene.expect(keyboardHelp).toExist(),
        Scene.expect(pauseButton).toBeAbsent(),
        Scene.Subscription.emit(
          SCENE_SUBSCRIPTIONS.keyboard,
          Message.PressedKey({ code: 'Escape' }),
        ),
        Scene.expect(Scene.role('status')).toHaveText(FIGHTING_STATUS),
        Scene.expect(pauseButton).toExist(),
      ),
  )

  it.effect('shows on touch between waves, and not on the title', () =>
    Effect.gen(function* () {
      yield* Scene.scene(
        APPLICATION,
        Scene.given(
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
        Scene.expect(pauseButton).toExist(),
        Scene.click(pauseButton),
        Scene.expect(touchHelp).toExist(),
      )
      yield* Scene.scene(
        APPLICATION,
        Scene.given(initialModel),
        measureSurface,
        Scene.expect(pauseButton).toBeAbsent(),
      )
    }),
  )
})

describe('Touch gun slots', () => {
  it.effect(
    'are buttons named by the upgrade tier: a tap swaps, the held one reloads',
    () => {
      const pistolName = tierName('Pistol', 1)
      const shotgunName = tierName('Shotgun', 1)
      vitestExpect(pistolName).not.toBe(WEAPONS.Pistol.name)
      vitestExpect(shotgunName).not.toBe(WEAPONS.Shotgun.name)
      return Scene.scene(
        APPLICATION,
        Scene.given(
          modifyFocus(modifyFields(fighting, { lastDevice: () => 'Touch' }), {
            player: player =>
              modifyFields(player, {
                arsenal: () =>
                  Arsenal.HoldingFirst({
                    first: { ...STARTING_PISTOL, tier: 1, kills: 40 },
                    second: { kind: 'Shotgun', loaded: 6, tier: 1, kills: 40 },
                  }),
              }),
          }),
        ),
        measureSurface,
        Scene.expect(
          Scene.role('button', { name: `Reload the ${pistolName}` }),
        ).toHaveAttr('aria-keyshortcuts', 'R'),
        Scene.expect(
          Scene.role('button', { name: `Switch to the ${shotgunName}` }),
        ).toHaveAttr('aria-keyshortcuts', 'Q'),
        Scene.expect(Scene.role('button', { name: /^Swap to/ })).toBeAbsent(),
        Scene.click(
          Scene.role('button', { name: `Switch to the ${shotgunName}` }),
        ),
        Scene.expect(
          Scene.role('button', { name: `Reload the ${shotgunName}` }),
        ).toExist(),
        Scene.expect(
          Scene.role('button', { name: `Switch to the ${pistolName}` }),
        ).toExist(),
      )
    },
  )
})
