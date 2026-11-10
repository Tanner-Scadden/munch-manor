import { Array } from 'effect'
import { Scene } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, it } from '@effect/vitest'

import { Message } from '../../../app/message'
import type { Model } from '../../../app/model'
import { MAX_FRAME_DELTA_MS } from '../../../shared/constants'
import { home } from '../../../test/model.fixture'
import {
  APPLICATION,
  SCENE_SUBSCRIPTIONS,
  emitPressedKey,
  lobbyStartButton,
  measureSurface,
  openLobbyInScene,
  readDareCardInScene,
  resolveFocusLobbyInScene,
  startIntoIntroInScene,
  statusLine,
  throughIntroByTapInScene,
  throughIntroInScene,
} from '../../../test/testing'
import { FOLD_MS, READ_MS } from '../pocketCard'

// The dare card in your pocket (src/features/dare/pocketCard.ts): out on
// the slam, the first break waits under it while it is read, and it folds
// into the HUD's dare card on a key, a tap, or after a few seconds.
// Endless has no list, so no card.

const CARD_STATUS = "Your friends' dare card"
const BREAK_STATUS = 'Get ready for wave 1.'
const surface = Scene.role('application', { name: 'Game surface' })

const framesOf = (ms: number) =>
  Array.makeBy(Math.ceil(ms / MAX_FRAME_DELTA_MS), () =>
    Scene.Subscription.emit(
      SCENE_SUBSCRIPTIONS.frame,
      Message.TickedFrame({ deltaTime: MAX_FRAME_DELTA_MS }),
    ),
  )

const onTouch: Model = modifyFields(home, {
  lastDevice: () => 'Touch',
})

describe('the dare card in your pocket', () => {
  it.effect('comes out on the slam, and the first break waits under it', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(home),
      measureSurface,
      ...startIntoIntroInScene(),
      ...throughIntroInScene(),
      Scene.expect(statusLine).toContainText(CARD_STATUS),
      ...framesOf(READ_MS - 200),
      Scene.expect(statusLine).toContainText(CARD_STATUS),
    ),
  )

  it.effect('folds itself away after a few seconds, and the break runs', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(home),
      measureSurface,
      ...startIntoIntroInScene(),
      ...throughIntroInScene(),
      ...framesOf(READ_MS),
      Scene.expect(statusLine).toContainText(BREAK_STATUS),
      ...framesOf(FOLD_MS),
      Scene.expect(statusLine).toContainText(BREAK_STATUS),
    ),
  )

  it.effect('a key puts it away once it has opened', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(home),
      measureSurface,
      ...startIntoIntroInScene(),
      ...throughIntroInScene(),
      emitPressedKey('Escape'),
      Scene.expect(statusLine).toContainText(CARD_STATUS),
      ...readDareCardInScene(),
      Scene.expect(statusLine).toContainText(BREAK_STATUS),
    ),
  )

  it.effect('a tap puts it away on touch', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(onTouch),
      measureSurface,
      ...startIntoIntroInScene(),
      ...throughIntroByTapInScene(),
      Scene.expect(statusLine).toContainText(CARD_STATUS),
      ...framesOf(500),
      Scene.pointerDown(surface, {
        pointerType: 'touch',
        pointerId: 4,
        clientX: 100,
        clientY: 100,
      }),
      Scene.expect(statusLine).toContainText(BREAK_STATUS),
    ),
  )

  it.effect('stays in the pocket when you stay the night', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(home),
      measureSurface,
      ...openLobbyInScene(),
      Scene.click(Scene.role('button', { name: 'Endless' })),
      resolveFocusLobbyInScene(),
      Scene.click(lobbyStartButton),
      ...throughIntroInScene(),
      Scene.expect(statusLine).toContainText('Get ready for endless wave 1.'),
    ),
  )
})
