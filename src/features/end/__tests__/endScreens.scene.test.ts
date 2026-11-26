import { Array, Effect, Option } from 'effect'

import { Component, UiStruct } from '@effect/ui'
import { HtmlLocator } from '@effect/ui/html/testing'
import { Locator } from '@effect/ui/testing'
import { describe, it } from '@effect/vitest'

import { Message } from '../../../app/message'
import { type Model, Phase } from '../../../app/model'
import { ShareFromClick } from '../../../app/mount'
import { initialModel } from '../../../app/pureApp'
import { SendShareEvent } from '../../../app/update/end'
import { FocusEndMenuButton } from '../../../app/update/home'
import { shareTextOf } from '../../../screens/game/menus'
import { RESTART_GRACE_MS } from '../../../shared/constants'
import { withNewerBuild } from '../../../test/model.fixture'
import {
  byClass,
  emitFrame,
  emitPressedKey,
  endButtons,
  expectAttr,
  firstOf,
  keepGoingButton,
  manorButton,
  measureSurface,
  retryButton,
  shareMountSettles,
  updateChip,
  withAttrs,
} from '../../../test/sceneTesting'
import {
  type SceneStep,
  modelAfter,
  sceneOf,
  steps,
} from '../../../test/testing'
import { asVeteran } from '../../../test/veteran'
import { SHARE_COPIED_MS } from '../endBeat'

const frames = (count: number): SceneStep =>
  steps(...Array.makeBy(count, () => emitFrame(50)))

const menuButton = HtmlLocator.role('button', { name: /^Menu: back/ })
const shareButton = HtmlLocator.role('button', { name: 'Share your run' })
const copiedButton = HtmlLocator.role('button', { name: 'Share: copied' })
const updateNote = byClass('mode-button-gift')
const menuOnlyButtons = Locator.inside(
  byClass('mode-choice'),
  byClass('mode-button'),
)

const END_PHASES: ReadonlyArray<readonly [string, Phase]> = [
  ['Game Over', Phase.GameOver({ wave: 4 })],
  ['An escape', Phase.Escaped({ wave: 10 })],
]

const onEndScreen = (phase: Phase, screenMs: number): Model =>
  UiStruct.evolve(asVeteran(initialModel), {
    phase: () => phase,
    screenMs: () => screenMs,
  })

const gameOver = onEndScreen(Phase.GameOver({ wave: 4 }), RESTART_GRACE_MS)

describe('the end screens', () => {
  it.effect('Game Over puts HOME first, then RETRY and SHARE', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(gameOver)
      s.pipe(
        measureSurface,
        expectAttr(menuButton, 'aria-keyshortcuts', 'H'),
        expectAttr(retryButton, 'aria-keyshortcuts', 'Enter'),
        expectAttr(shareButton, 'aria-keyshortcuts', undefined),
      )
        .expect(endButtons)
        .toHaveCount(3)
        .expect(firstOf(endButtons))
        .toHaveText('HOMEH')
        .expect(retryButton)
        .toHaveText('RETRYENTER')
        .expect(shareButton)
        .toHaveText('SHARE')
        .pipe(shareMountSettles('Shared'))
        .expect(updateNote)
        .toBeAbsent()
    }),
  )

  it.effect(
    'an escape puts HOME first, then AGAIN and SHARE, and no Keep going',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(
          onEndScreen(Phase.Escaped({ wave: 10 }), RESTART_GRACE_MS),
        )
        s.pipe(measureSurface)
          .expect(endButtons)
          .toHaveCount(3)
          .expect(firstOf(endButtons))
          .toHaveText('HOMEH')
          .expect(retryButton)
          .toHaveText('AGAINENTER')
          .expect(keepGoingButton)
          .toBeAbsent()
          .expect(shareButton)
          .toExist()
          .expect(updateNote)
          .toBeAbsent()
          .pipe(shareMountSettles('Cancelled'))
      }),
  )

  it.effect(
    'SHARE carries the run post and the Mount that shares it in the click',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(gameOver)
        s.pipe(
          measureSurface,
          expectAttr(shareButton, 'data-share-text', shareTextOf(gameOver)),
        )
          .expect(withAttrs({ id: 'end-share-button' })(Locator.tag('a')))
          .toBeAbsent()
          .expectMount(ShareFromClick({}))
          .pipe(shareMountSettles('Cancelled'))
      }),
  )

  it.effect('a tap on SHARE skips the beat and counts the share', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(
        UiStruct.evolve(gameOver, {
          maybeVisitId: () => Option.some('0123456789abcdef'),
          settings: UiStruct.evolve({ shareStats: () => 'On' as const }),
        }),
      )
      s.pipe(measureSurface, shareMountSettles('Shared'))
        .click(shareButton)
        .expectExact(SendShareEvent)
        .resolve(SendShareEvent, Component.noop)
        .expect(shareButton)
        .toHaveText('SHARE')
    }),
  )

  it.effect.each(END_PHASES)(
    'a post copied on %s flashes COPIED! on SHARE, then SHARE comes back',
    ([_name, phase]) =>
      Effect.gen(function* () {
        const s = yield* sceneOf(onEndScreen(phase, RESTART_GRACE_MS))
        s.pipe(measureSurface, shareMountSettles('Copied'))
          .expect(copiedButton)
          .toHaveText('COPIED!')
          .pipe(frames(Math.ceil(SHARE_COPIED_MS / 50)))
          .expect(shareButton)
          .toHaveText('SHARE')
      }),
  )

  it.effect.each(END_PHASES)(
    '%s with a new version waiting offers only MENU, wearing a gift, and it lands on the gift',
    ([_name, phase]) =>
      Effect.gen(function* () {
        const s = yield* sceneOf(
          withNewerBuild(onEndScreen(phase, RESTART_GRACE_MS)),
        )
        s.pipe(
          measureSurface,
          expectAttr(menuButton, 'aria-keyshortcuts', 'Enter H'),
        )
          .expect(menuOnlyButtons)
          .toHaveCount(1)
          .expect(
            HtmlLocator.role('button', {
              name: 'Menu: back home, where a new version is waiting',
            }),
          )
          .toExist()
          .expect(updateNote)
          .toExist()
          .expect(retryButton)
          .toBeAbsent()
          .expect(shareButton)
          .toBeAbsent()
          .expect(keepGoingButton)
          .toBeAbsent()
          .expect(updateChip)
          .toBeAbsent()
          .click(menuButton)
          .expect(manorButton)
          .toExist()
          .expect(updateChip)
          .toExist()
      }),
  )

  it.effect.each(END_PHASES)(
    '%s skips the beat on an early Enter, then focuses MENU, and Enter goes home',
    ([_name, phase]) =>
      Effect.gen(function* () {
        const s = yield* sceneOf(withNewerBuild(onEndScreen(phase, 0)))
        s.pipe(measureSurface)
          .expect(menuButton)
          .toBeAbsent()
          .pipe(frames(2), emitPressedKey('Enter'))
          .expect(manorButton)
          .toBeAbsent()
          .expectExact(FocusEndMenuButton.make())
          .resolve(FocusEndMenuButton, Component.noop)
          .expect(menuButton)
          .toExist()
          .expect(updateNote)
          .toExist()
          .pipe(emitPressedKey('Enter'))
          .expect(manorButton)
          .toExist()
          .expect(updateChip)
          .toExist()
      }),
  )

  it.effect('a new version found on Game Over swaps the choices for MENU', () =>
    Effect.gen(function* () {
      const found = Message.CompletedFetchBuild({ build: 'newer-build' })
      const before = yield* sceneOf(gameOver)
      before
        .pipe(measureSurface)
        .expect(retryButton)
        .toExist()
        .pipe(shareMountSettles('Cancelled'))
      const versionFound = yield* modelAfter(gameOver, s =>
        s
          .send(found)
          .expectExact(FocusEndMenuButton.make())
          .resolve(FocusEndMenuButton, Component.noop),
      )
      const after = yield* sceneOf(versionFound)
      after
        .pipe(measureSurface)
        .expect(retryButton)
        .toBeAbsent()
        .expect(updateNote)
        .toExist()
    }),
  )
})
