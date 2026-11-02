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
  lockedNightmare,
  measureSurface,
  openLobbyInScene,
  playButton,
  resolveFocusLobbyInScene,
  shareMountSettles,
  showDialogInScene,
} from './testing'
import { asVeteran } from './veteran'

const card = role('dialog', { name: 'How tough are you?' })
const easy = role('button', { name: 'Easy: Just here for the vibes' })
const normal = role('button', {
  name: "Normal: The way it's meant to be played",
})
const hard = role('button', { name: 'Hard: They bite back' })
const openNightmare = role('button', {
  name: 'Nightmare: No mercy. Bring snacks',
})

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

describe('the difficulty in the lobby', () => {
  const skull = (name: string) =>
    role('button', { name: new RegExp(`^${name}`) })

  test('shows four skulls, marks the chosen level, and keeps Nightmare locked', () => {
    scene(
      ROOT,
      given(asVeteran(initialModel)),
      measureSurface,
      expect(selector('.coop-skull-pick')).toBeAbsent(),
      ...openLobbyInScene(),
      expect(skull('Easy')).toHaveAttr('aria-pressed', 'false'),
      expect(skull('Normal')).toHaveAttr('aria-pressed', 'true'),
      expect(skull('Hard')).toHaveAttr('aria-pressed', 'false'),
      expect(lockedNightmare).toHaveAttr('aria-disabled', 'true'),
      expect(skull('Normal')).toHaveAttr('aria-pressed', 'true'),
      click(skull('Hard')),
      resolveFocusLobbyInScene(),
      expect(skull('Hard')).toHaveAttr('aria-pressed', 'true'),
      expect(skull('Normal')).toHaveAttr('aria-pressed', 'false'),
    )
  })

  test('a Hard win opens Nightmare with a NEW pip', () => {
    scene(
      ROOT,
      given(
        modifyFields(asVeteran(initialModel), {
          difficulty: () => ({ chosen: 'Hard', nightmare: 'JustUnlocked' }),
        }),
      ),
      measureSurface,
      ...openLobbyInScene(),
      expect(skull('Nightmare')).not.toHaveAttr('aria-disabled', 'true'),
      expect(selector('.coop-skull-pick .new-pip')).toExist(),
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
      shareMountSettles('Cancelled'),
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
      shareMountSettles('Cancelled'),
      expect(role('status')).toContainText(
        'Difficulty: Hard. Nightmare unlocked!',
      ),
    )
  })
})
