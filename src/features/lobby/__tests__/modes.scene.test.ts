import { Array, Effect, Option } from 'effect'
import { Scene } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, it } from '@effect/vitest'

import { Message } from '../../../app/message'
import { Phase, RunMode } from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { withBests } from '../../../domain/run'
import { RESTART_GRACE_MS } from '../../../shared/constants'
import {
  APPLICATION,
  SCENE_SUBSCRIPTIONS,
  keepGoingButton,
  lobbyMode,
  lobbyStartButton,
  measureSurface,
  openLobbyInScene,
  playButton,
  playEndlessButton,
  resolveFocusLobbyInScene,
  retryButton,
  shareMountSettles,
  startRunInScene,
  throughIntroInScene,
} from '../../../test/testing'
import { asVeteran } from '../../../test/veteran'

const endlessModeButton = Scene.role('button', { name: 'Endless' })
const START_PROMPT =
  'Press Enter, or use the Start wave button, to start it now.'

describe('Mode choice', () => {
  it.effect(
    'the home menu offers PLAY alone, and the lobby picks endless and starts it',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(asVeteran(initialModel)),
        measureSurface,
        Scene.expect(playButton).toHaveAttr('aria-keyshortcuts', 'Enter'),
        Scene.expect(endlessModeButton).toBeAbsent(),
        Scene.expect(Scene.selector('.home-key')).toExist(),
        Scene.expect(keepGoingButton).toBeAbsent(),
        ...openLobbyInScene(),
        Scene.expect(endlessModeButton).toHaveAttr('aria-pressed', 'false'),
        Scene.click(endlessModeButton),
        resolveFocusLobbyInScene(),
        Scene.expect(endlessModeButton).toHaveAttr('aria-pressed', 'true'),
        Scene.expect(lobbyMode('Campaign')).toHaveAttr('aria-pressed', 'false'),
        Scene.click(lobbyStartButton),
        ...throughIntroInScene(),
        Scene.expect(Scene.role('status')).toHaveText(
          `Get ready for endless wave 1. ${START_PROMPT} Keys on the ring: 0.`,
        ),
        Scene.expect(playEndlessButton).toBeAbsent(),
      ),
  )

  it.effect('the Play button starts the escape', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(
        modifyFields(asVeteran(initialModel), {
          mode: () => RunMode.Endless(),
        }),
      ),
      measureSurface,
      ...startRunInScene(),
      Scene.expect(Scene.role('status')).toHaveText(
        `Get ready for wave 1. ${START_PROMPT} Keys on the ring: 0.`,
      ),
    ),
  )

  it.effect(
    'touch shows the buttons without key badges, and PLAY as its icon alone',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(modifyFields(initialModel, { lastDevice: () => 'Touch' })),
        measureSurface,
        Scene.expect(playButton).toExist(),
        Scene.expect(playButton).toHaveText(''),
        Scene.expect(Scene.selector('.home-play-icon')).toExist(),
        Scene.expect(Scene.selector('.home-key')).toBeAbsent(),
      ),
  )

  it.effect('an escape offers no Keep going, even after the grace', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(
        modifyFields(asVeteran(initialModel), {
          phase: () => Phase.Escaped({ wave: 10 }),
        }),
      ),
      measureSurface,
      ...Array.makeBy(Math.ceil(RESTART_GRACE_MS / 50), () =>
        Scene.Subscription.emit(
          SCENE_SUBSCRIPTIONS.frame,
          Message.TickedFrame({ deltaTime: 50 }),
        ),
      ),
      Scene.expect(retryButton).toExist(),
      Scene.expect(keepGoingButton).toBeAbsent(),
      shareMountSettles('Cancelled'),
    ),
  )

  it.effect(
    'Game Over and an escape ask the player to tell whoever sent the game what they think',
    () =>
      Effect.gen(function* () {
        const FEEDBACK = 'Tell whoever sent you this what you think!'
        yield* Effect.forEach(
          [Phase.GameOver({ wave: 4 }), Phase.Escaped({ wave: 10 })],
          phase =>
            Scene.scene(
              APPLICATION,
              Scene.given(modifyFields(initialModel, { phase: () => phase })),
              measureSurface,
              Scene.expect(Scene.role('status')).toContainText(FEEDBACK),
            ),
          { discard: true },
        )
        yield* Scene.scene(
          APPLICATION,
          Scene.given(initialModel),
          measureSurface,
          Scene.expect(Scene.role('status')).not.toContainText(FEEDBACK),
        )
      }),
  )

  it.effect(
    'an endless Game Over reads out the wave reached and your best',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(
          modifyFields(
            withBests(initialModel, bests =>
              modifyFields(bests, {
                maybeBestEndlessWave: () => Option.some(14),
              }),
            ),
            {
              mode: () => RunMode.Endless(),
              phase: () => Phase.GameOver({ wave: 12 }),
            },
          ),
        ),
        measureSurface,
        Scene.expect(Scene.role('status')).toContainText(
          'Wave reached: 12. Your best: wave 14.',
        ),
      ),
  )
})
