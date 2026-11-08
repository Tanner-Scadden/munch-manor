import { Array, Effect, Option } from 'effect'
import { Scene, Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

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
  APPLICATION,
  SCENE_SUBSCRIPTIONS,
  emitPressedKey,
  endButtons,
  keepGoingButton,
  manorButton,
  measureSurface,
  retryButton,
  shareMountSettles,
  updateChip,
} from '../../../test/testing'
import { asVeteran } from '../../../test/veteran'
import { SHARE_COPIED_MS } from '../endBeat'

const tickPastGrace = () =>
  Array.makeBy(Math.ceil(RESTART_GRACE_MS / 50), () =>
    Scene.Subscription.emit(
      SCENE_SUBSCRIPTIONS.frame,
      Message.TickedFrame({ deltaTime: 50 }),
    ),
  )

const menuButton = Scene.role('button', { name: /^Menu: back/ })
const shareButton = Scene.role('button', { name: 'Share your run' })
const copiedButton = Scene.role('button', { name: 'Share: copied' })
const updateNote = Scene.selector('.mode-button-gift')
const menuOnlyButtons = Scene.all.selector('.mode-choice .mode-button')

const END_PHASES: ReadonlyArray<readonly [string, Phase]> = [
  ['Game Over', Phase.GameOver({ wave: 4 })],
  ['Victory', Phase.Victory()],
]

const onEndScreen = (phase: Phase, screenMs: number): Model =>
  modifyFields(asVeteran(initialModel), {
    phase: () => phase,
    screenMs: () => screenMs,
  })

describe('the end screens', () => {
  it.effect('Game Over puts HOME first, then RETRY and SHARE', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(onEndScreen(Phase.GameOver({ wave: 4 }), RESTART_GRACE_MS)),
      measureSurface,
      Scene.expectAll(endButtons).toHaveCount(3),
      Scene.expect(Scene.first(endButtons)).toHaveText('HOMEH'),
      Scene.expect(menuButton).toHaveAttr('aria-keyshortcuts', 'H'),
      Scene.expect(retryButton).toHaveAttr('aria-keyshortcuts', 'Enter'),
      Scene.expect(retryButton).toHaveText('RETRYENTER'),
      Scene.expect(shareButton).not.toHaveAttr('aria-keyshortcuts'),
      Scene.expect(shareButton).toHaveText('SHARE'),
      shareMountSettles('Shared'),
      Scene.expect(updateNote).toBeAbsent(),
    ),
  )

  it.effect('Victory puts HOME first, then AGAIN, Keep going, and SHARE', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(onEndScreen(Phase.Victory(), RESTART_GRACE_MS)),
      measureSurface,
      Scene.expectAll(endButtons).toHaveCount(4),
      Scene.expect(Scene.first(endButtons)).toHaveText('HOMEH'),
      Scene.expect(retryButton).toHaveText('AGAINENTER'),
      Scene.expect(keepGoingButton).toExist(),
      Scene.expect(shareButton).toExist(),
      Scene.expect(updateNote).toBeAbsent(),
      shareMountSettles('Cancelled'),
    ),
  )

  it.effect(
    'SHARE carries the run post and the Mount that shares it in the click',
    () => {
      const gameOver = onEndScreen(
        Phase.GameOver({ wave: 4 }),
        RESTART_GRACE_MS,
      )
      return Scene.scene(
        APPLICATION,
        Scene.given(gameOver),
        measureSurface,
        Scene.expect(shareButton).toHaveAttr(
          'data-share-text',
          shareTextOf(gameOver),
        ),
        Scene.expect(Scene.selector('a#end-share-button')).toBeAbsent(),
        Scene.Mount.expectHas(ShareFromClick),
        shareMountSettles('Cancelled'),
      )
    },
  )

  it.effect('a tap on SHARE skips the beat and counts the share', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(
        modifyFields(
          onEndScreen(Phase.GameOver({ wave: 4 }), RESTART_GRACE_MS),
          {
            shareStats: () => 'On' as const,
            maybeVisitId: () => Option.some('0123456789abcdef'),
          },
        ),
      ),
      measureSurface,
      shareMountSettles('Shared'),
      Scene.click(shareButton),
      Scene.Command.expectHas(SendShareEvent),
      Scene.Command.resolve(SendShareEvent, Message.CompletedSendShareEvent()),
      Scene.expect(shareButton).toHaveText('SHARE'),
    ),
  )

  it.effect.each(END_PHASES)(
    'a post copied on %s flashes COPIED! on SHARE, then SHARE comes back',
    ([_name, phase]) =>
      Scene.scene(
        APPLICATION,
        Scene.given(onEndScreen(phase, RESTART_GRACE_MS)),
        measureSurface,
        shareMountSettles('Copied'),
        Scene.expect(copiedButton).toHaveText('COPIED!'),
        ...Array.makeBy(Math.ceil(SHARE_COPIED_MS / 50), () =>
          Scene.Subscription.emit(
            SCENE_SUBSCRIPTIONS.frame,
            Message.TickedFrame({ deltaTime: 50 }),
          ),
        ),
        Scene.expect(shareButton).toHaveText('SHARE'),
      ),
  )

  it.effect.each(END_PHASES)(
    '%s with a new version waiting offers only MENU, wearing a gift, and it lands on the gift',
    ([_name, phase]) =>
      Scene.scene(
        APPLICATION,
        Scene.given(withNewerBuild(onEndScreen(phase, RESTART_GRACE_MS))),
        measureSurface,
        Scene.expectAll(menuOnlyButtons).toHaveCount(1),
        Scene.expect(menuButton).toHaveAttr('aria-keyshortcuts', 'Enter H'),
        Scene.expect(menuButton).toHaveAccessibleName(
          'Menu: back home, where a new version is waiting',
        ),
        Scene.expect(updateNote).toExist(),
        Scene.expect(retryButton).toBeAbsent(),
        Scene.expect(shareButton).toBeAbsent(),
        Scene.expect(keepGoingButton).toBeAbsent(),
        Scene.expect(updateChip).toBeAbsent(),
        Scene.click(menuButton),
        Scene.expect(manorButton).toExist(),
        Scene.expect(updateChip).toExist(),
      ),
  )

  it.effect.each(END_PHASES)(
    '%s skips the beat on an early Enter, then focuses MENU, and Enter goes home',
    ([_name, phase]) =>
      Scene.scene(
        APPLICATION,
        Scene.given(withNewerBuild(onEndScreen(phase, 0))),
        measureSurface,
        Scene.expect(menuButton).toBeAbsent(),
        ...tickPastGrace().slice(0, 2),
        emitPressedKey('Enter'),
        Scene.expect(manorButton).toBeAbsent(),
        Scene.Command.expectExact(FocusEndMenuButton),
        Scene.Command.resolve(
          FocusEndMenuButton,
          Message.CompletedFocusEndMenuButton(),
        ),
        Scene.expect(menuButton).toExist(),
        Scene.expect(updateNote).toExist(),
        emitPressedKey('Enter'),
        Scene.expect(manorButton).toExist(),
        Scene.expect(updateChip).toExist(),
      ),
  )

  // NOTE: the newer build arrives as FetchBuild's result, which a Scene
  // cannot send by itself: the Story sends it and checks the focus, and the
  // Scene draws the Model it left.
  it.effect('a new version found on Game Over swaps the choices for MENU', () =>
    Effect.gen(function* () {
      const gameOver = onEndScreen(
        Phase.GameOver({ wave: 4 }),
        RESTART_GRACE_MS,
      )
      const found = Message.CompletedFetchBuild({ build: 'newer-build' })
      yield* Scene.scene(
        APPLICATION,
        Scene.given(gameOver),
        measureSurface,
        Scene.expect(retryButton).toExist(),
        shareMountSettles('Cancelled'),
      )
      const versionFound = yield* Story.story(
        APPLICATION,
        Story.given(gameOver),
        Story.message(found),
        Story.Command.expectExact(FocusEndMenuButton),
        Story.Command.resolve(
          FocusEndMenuButton,
          Message.CompletedFocusEndMenuButton(),
        ),
      )
      yield* Scene.scene(
        APPLICATION,
        Scene.given(versionFound),
        measureSurface,
        Scene.expect(retryButton).toBeAbsent(),
        Scene.expect(updateNote).toExist(),
      )
    }),
  )
})
