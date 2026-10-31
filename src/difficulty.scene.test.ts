import { Option } from 'effect'
import {
  click,
  expect,
  given,
  inside,
  role,
  scene,
  selector,
  text,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'

import { RESTART_GRACE_MS } from './constants'
import { type Model, Phase, initialModel } from './model'
import {
  ROOT,
  closeButton,
  difficultyButton,
  lockedNightmare,
  measureSurface,
  playButton,
  showDialogInScene,
} from './testing'
import { asVeteran } from './veteran'

const card = role('dialog', { name: 'How tough are you?' })
const picker = role('dialog', { name: 'Difficulty' })
const easy = role('button', { name: 'Easy: Just here for the vibes' })
const normal = role('button', {
  name: "Normal: The way it's meant to be played",
})
const hard = role('button', { name: 'Hard: They bite back' })
const openNightmare = role('button', {
  name: 'Nightmare: No mercy. Bring snacks',
})

// NOTE: the attribute the Foldkit dialog focuses when it opens.
const INITIAL_FOCUS = 'data-foldkit-dialog-initial-focus'

describe('the difficulty card', () => {
  test('the first PLAY shows four choices with Nightmare locked', () => {
    scene(
      ROOT,
      given(initialModel),
      measureSurface,
      click(playButton),
      ...showDialogInScene(),
      inside(
        card,
        expect(easy).toExist(),
        expect(normal).toExist(),
        expect(hard).toExist(),
        expect(lockedNightmare).toHaveAttr('aria-disabled', 'true'),
        expect(text('Beat Hard to unlock')).toBeAbsent(),
        expect(
          selector("[data-difficulty='Nightmare'] .difficulty-unlock"),
        ).toExist(),
      ),
    )
  })

  test('after a Hard win Nightmare is open, with a NEW badge', () => {
    scene(
      ROOT,
      given(
        modifyFields(initialModel, {
          difficulty: () => ({ chosen: 'Hard', nightmare: 'JustUnlocked' }),
        }),
      ),
      measureSurface,
      click(playButton),
      ...showDialogInScene(),
      inside(
        card,
        expect(openNightmare).toExist(),
        expect(openNightmare).not.toHaveAttr('aria-disabled', 'true'),
        expect(text('NEW!')).toExist(),
      ),
    )
  })
})

describe('the difficulty picker by PLAY', () => {
  test('marks the chosen level, keeps Nightmare locked, and opens on the chosen level', () => {
    scene(
      ROOT,
      given(asVeteran(initialModel)),
      measureSurface,
      click(difficultyButton),
      ...showDialogInScene(),
      inside(
        picker,
        expect(normal).toHaveAttr('data-chosen', 'Chosen'),
        expect(hard).not.toHaveAttr('data-chosen', 'Chosen'),
        expect(lockedNightmare).toHaveAttr('aria-disabled', 'true'),
        expect(normal).toHaveAttr(INITIAL_FOCUS),
        expect(hard).not.toHaveAttr(INITIAL_FOCUS),
        expect(closeButton).not.toHaveAttr(INITIAL_FOCUS),
      ),
    )
  })
})

const ended = (phase: Phase, base: Model): Model =>
  modifyFields(asVeteran(base), {
    phase: () => phase,
    screenMs: () => RESTART_GRACE_MS,
  })

describe('the end screens', () => {
  test('Game Over names the difficulty', () => {
    scene(
      ROOT,
      given(
        ended(
          Phase.GameOver({ wave: 4 }),
          modifyFields(initialModel, {
            difficulty: () => ({ chosen: 'Hard', nightmare: 'Locked' }),
          }),
        ),
      ),
      measureSurface,
      expect(role('status')).toContainText('Difficulty: Hard.'),
    )
  })

  test('a Hard Victory names the difficulty and the unlock', () => {
    scene(
      ROOT,
      given(
        ended(
          Phase.Victory(),
          modifyFields(initialModel, {
            difficulty: () => ({ chosen: 'Hard', nightmare: 'JustUnlocked' }),
            maybeSurface: () => Option.none(),
          }),
        ),
      ),
      measureSurface,
      expect(role('status')).toContainText(
        'Difficulty: Hard. Nightmare unlocked!',
      ),
    )
  })
})
