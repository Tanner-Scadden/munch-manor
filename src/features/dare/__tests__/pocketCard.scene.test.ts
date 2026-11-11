import { Array } from 'effect'
import { Scene, Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../../app/message'
import { Lesson, type Model } from '../../../app/model'
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
  startRunFromHome,
  statusLine,
  throughIntroByTapInScene,
  throughIntroInScene,
} from '../../../test/testing'
import { FOLD_MS, GATE_MS, READ_MS, UNFOLD_MS } from '../pocketCard'

// The dare card in your pocket (src/features/dare/pocketCard.ts): out on
// the slam, the first break waits under it while it is read, and it folds
// into the HUD's dare card on a key, a tap, or after a few seconds. The
// first time alone it waits for a key or a tap instead, taken only past
// its gate. Endless has no list, so no card.

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

// NOTE: a player who has never read the card: it waits for them.
const unread = (model: Model): Model =>
  modifyFields(model, {
    lessons: lessons =>
      modifyFields(lessons, { dareCard: () => Lesson.Pending() }),
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

  it.effect('a key puts it away as soon as it has opened', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(home),
      measureSurface,
      ...startIntoIntroInScene(),
      ...throughIntroInScene(),
      ...framesOf(UNFOLD_MS + 50),
      emitPressedKey('Escape'),
      Scene.expect(statusLine).toContainText(BREAK_STATUS),
    ),
  )

  it.effect('the first time, it waits past its clock for a key', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(unread(home)),
      measureSurface,
      ...startIntoIntroInScene(),
      ...throughIntroInScene(),
      ...framesOf(READ_MS + FOLD_MS + 1_000),
      Scene.expect(statusLine).toContainText(CARD_STATUS),
      emitPressedKey('Escape'),
      Scene.expect(statusLine).toContainText(BREAK_STATUS),
    ),
  )

  it.effect('the first time, a key before its gate leaves it up', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(unread(home)),
      measureSurface,
      ...startIntoIntroInScene(),
      ...throughIntroInScene(),
      ...framesOf(GATE_MS - 400),
      emitPressedKey('Escape'),
      Scene.expect(statusLine).toContainText(CARD_STATUS),
      ...framesOf(450),
      emitPressedKey('Escape'),
      Scene.expect(statusLine).toContainText(BREAK_STATUS),
    ),
  )

  it.effect('the first time, a tap before its gate leaves it up', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(unread(onTouch)),
      measureSurface,
      ...startIntoIntroInScene(),
      ...throughIntroByTapInScene(),
      ...framesOf(UNFOLD_MS + 100),
      Scene.pointerDown(surface, {
        pointerType: 'touch',
        pointerId: 4,
        clientX: 100,
        clientY: 100,
      }),
      Scene.expect(statusLine).toContainText(CARD_STATUS),
    ),
  )

  it.effect('reading it once learns it, so the next run keeps its clock', () =>
    Story.story(
      APPLICATION,
      Story.given(unread(home)),
      startRunFromHome,
      Story.model(current => {
        expect(current.pocketCard._tag).toBe('Folding')
        expect(current.lessons.dareCard._tag).toBe('Learned')
      }),
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
