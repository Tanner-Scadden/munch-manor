import { Array, Effect } from 'effect'

import { UiStruct } from '@effect/ui'
import { HtmlLocator } from '@effect/ui/html/testing'
import { Locator } from '@effect/ui/testing'
import { describe, it, expect as vitestExpect } from '@effect/vitest'

import { Message } from '../../../app/message'
import { BreakClock, type Model, Phase } from '../../../app/model'
import { PressGameSurface } from '../../../app/mount'
import { initialModel } from '../../../app/pureApp'
import { MouseButton } from '../../../input/inputSchema'
import { PREPARATION_MS } from '../../../shared/constants'
import { fighting } from '../../../test/model.fixture'
import {
  ackHudSlots,
  byClass,
  emitPressedKey,
  expectAttr,
  measureHud,
  measureSurface,
  pauseButton,
  pausePressRuns,
  statusLine,
} from '../../../test/sceneTesting'
import {
  SURFACE,
  type SceneStep,
  checkModel,
  sceneOf,
  send,
  storyOf,
} from '../../../test/testing'
import { STARTING_PISTOL, WEAPONS, tierName } from '../../../world/gear/weapons'
import { modifyFocus } from '../../../world/party/party'
import { Arsenal } from '../../../world/schema/worldSchema'
import { pause } from '../../../world/waves/waves'
import { CONTROL_CARDS, helpLineOf } from '../pauseHelp'

const pausedOn = (device: Model['lastDevice']): Model =>
  pause(UiStruct.evolve(fighting, { lastDevice: () => device }))

const keyboardHelp = HtmlLocator.role('region', {
  name: 'How to play with keyboard and mouse',
})
const touchHelp = HtmlLocator.role('region', { name: 'How to play with touch' })
const PAUSED_STATUS =
  'Paused during wave 3. Tap, click, or press Escape to resume. Press H or choose Menu to leave the run.'
const FIGHTING_STATUS = 'Fighting wave 3.'

const card = (action: string, input: string) =>
  HtmlLocator.role('listitem', { name: `${action}: ${input}` })

const controls = HtmlLocator.role('list', { name: 'Controls' })
const moreKeys = HtmlLocator.role('list', { name: 'More keys' })
const inControls = (locator: Locator.Locator) =>
  Locator.inside(controls, locator)
// NOTE: a key in the line under the cards, a list item read by its text
// (a list item takes no name from what it holds).
const moreKey = (text: string) =>
  Locator.inside(moreKeys, Locator.text(text, { exact: true }))

const pressPanel =
  (
    press: Readonly<{ pointerId: number; device: 'Touch' | 'Mouse' }>,
  ): SceneStep =>
  s =>
    s.mounted(
      PressGameSurface,
      Message.PressedPointer({ ...press, clientX: 400, clientY: 200 }),
    )

const expectStatus =
  (text: string): SceneStep =>
  s =>
    s.expect(statusLine).toHaveText(text)

const cardsFor =
  (device: 'KeyboardMouse' | 'Touch'): SceneStep =>
  s =>
    Array.reduce(CONTROL_CARDS, s, (current, { id, action }) =>
      current
        .expect(inControls(card(action, helpLineOf(id, device))))
        .toExist(),
    )
      .expect(inControls(HtmlLocator.role('listitem')))
      .toHaveCount(12)

describe('Pause screen controls', () => {
  it.effect(
    'shows the keyboard and mouse controls as cards, with the other keys in one line',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(fighting)
        s.pipe(measureHud)
          .expect(keyboardHelp)
          .toBeAbsent()
          .pipe(
            emitPressedKey('Escape'),
            pausePressRuns,
            expectStatus(PAUSED_STATUS),
          )
          .expect(touchHelp)
          .toBeAbsent()
          .expect(keyboardHelp)
          .toExist()
          .pipe(cardsFor('KeyboardMouse'))
          .expect(moreKey('G next trap'))
          .toExist()
          .expect(moreKey('Esc pause'))
          .toExist()
          .expect(moreKey('Enter start'))
          .toExist()
          .expect(moreKey('H menu'))
          .toExist()
          .expect(moreKey('M sound'))
          .toExist()
          .expect(moreKey('N music'))
          .toExist()
          .pipe(
            emitPressedKey('Escape'),
            ackHudSlots,
            expectStatus(FIGHTING_STATUS),
          )
          .expect(keyboardHelp)
          .toBeAbsent()
      }),
  )

  it.effect('shows the touch controls as cards, with no keys', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(pausedOn('Touch'))
      s.pipe(measureSurface, pausePressRuns)
        .expect(keyboardHelp)
        .toBeAbsent()
        .expect(touchHelp)
        .toExist()
        .expect(Locator.tag('kbd'))
        .toBeAbsent()
        .expect(moreKeys)
        .toBeAbsent()
        .pipe(cardsFor('Touch'))
    }),
  )

  it.effect('is plain text with no controls of its own to tab to', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(pausedOn('KeyboardMouse'))
      s.pipe(measureSurface, pausePressRuns)
        .expect(keyboardHelp)
        .toExist()
        .expect(Locator.inside(keyboardHelp, HtmlLocator.role('button')))
        .toBeAbsent()
        .expect(
          HtmlLocator.role('heading', {
            name: 'How to play with keyboard and mouse',
          }),
        )
        .toExist()
    }),
  )

  it.effect('a tap on the panel resumes and does not grab a stick', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(pausedOn('Touch'))
      s.pipe(
        measureSurface,
        pressPanel({ pointerId: 4, device: 'Touch' }),
        ackHudSlots,
        expectStatus(FIGHTING_STATUS),
      )
        .expect(touchHelp)
        .toBeAbsent()
        .expect(Locator.attr('data-stick', 'aim'))
        .toBeAbsent()
    }),
  )

  it.effect('a click on the panel resumes without pulling the trigger', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(pausedOn('KeyboardMouse'))
      s.pipe(
        measureSurface,
        pressPanel({ pointerId: 1, device: 'Mouse' }),
        ackHudSlots,
        expectStatus(FIGHTING_STATUS),
      )
        .expect(keyboardHelp)
        .toBeAbsent()
      const story = yield* storyOf(pausedOn('KeyboardMouse'))
      story.pipe(
        send(Message.MeasuredGameSurface(SURFACE)),
        send(
          Message.PressedPointer({
            pointerId: 1,
            device: 'Mouse',
            clientX: 400,
            clientY: 200,
          }),
        ),
        checkModel(resumed => {
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
  it.effect(
    'pauses a round, hides on the pause screen, and Esc brings it back',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(fighting)
        s.pipe(
          measureHud,
          expectAttr(pauseButton, 'aria-keyshortcuts', 'Escape'),
        )
          .click(pauseButton)
          .pipe(pausePressRuns, expectStatus(PAUSED_STATUS))
          .expect(keyboardHelp)
          .toExist()
          .expect(pauseButton)
          .toBeAbsent()
          .pipe(
            emitPressedKey('Escape'),
            ackHudSlots,
            expectStatus(FIGHTING_STATUS),
          )
          .expect(pauseButton)
          .toExist()
      }),
  )

  it.effect('shows on touch between waves, and not on the title', () =>
    Effect.gen(function* () {
      const inBreak = yield* sceneOf(
        UiStruct.evolve(fighting, {
          lastDevice: () => 'Touch',
          phase: () =>
            Phase.Preparation({
              clock: BreakClock.Counting(),
              wave: 3,
              remainingMs: 15_000,
              durationMs: PREPARATION_MS,
              spawns: [],
            }),
        }),
      )
      inBreak
        .pipe(measureHud)
        .expect(pauseButton)
        .toExist()
        .click(pauseButton)
        .pipe(pausePressRuns)
        .expect(touchHelp)
        .toExist()
      const title = yield* sceneOf(initialModel)
      title.pipe(measureSurface).expect(pauseButton).toBeAbsent()
    }),
  )
})

describe('Touch gun slots', () => {
  it.effect(
    'are buttons named by the upgrade tier: a tap swaps, the held one reloads',
    () =>
      Effect.gen(function* () {
        const pistolName = tierName('Pistol', 1)
        const shotgunName = tierName('Shotgun', 1)
        vitestExpect(pistolName).not.toBe(WEAPONS.Pistol.name)
        vitestExpect(shotgunName).not.toBe(WEAPONS.Shotgun.name)
        const slot = (name: string | RegExp) =>
          Locator.inside(
            byClass('gun-slots'),
            HtmlLocator.role('button', { name }),
          )
        const s = yield* sceneOf(
          modifyFocus(
            UiStruct.evolve(fighting, { lastDevice: () => 'Touch' }),
            {
              player: player =>
                UiStruct.evolve(player, {
                  arsenal: () =>
                    Arsenal.HoldingFirst({
                      first: { ...STARTING_PISTOL, tier: 1, kills: 40 },
                      second: {
                        kind: 'Shotgun',
                        loaded: 6,
                        tier: 1,
                        kills: 40,
                      },
                    }),
                }),
            },
          ),
        )
        s.pipe(
          measureHud,
          expectAttr(
            slot(`Reload the ${pistolName}`),
            'aria-keyshortcuts',
            'R 1',
          ),
          expectAttr(
            slot(`Switch to the ${shotgunName}`),
            'aria-keyshortcuts',
            'Q 2',
          ),
        )
          .expect(HtmlLocator.role('button', { name: /^Swap to/ }))
          .toBeAbsent()
          .click(slot(`Switch to the ${shotgunName}`))
          .expect(slot(`Reload the ${shotgunName}`))
          .toExist()
          .expect(slot(`Switch to the ${pistolName}`))
          .toExist()
      }),
  )
})
