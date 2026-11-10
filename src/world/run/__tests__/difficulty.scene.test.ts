import { Option } from 'effect'
import { Scene } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, it } from '@effect/vitest'

import { type Model, Phase } from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { RESTART_GRACE_MS } from '../../../shared/constants'
import {
  APPLICATION,
  lockedNightmare,
  measureSurface,
  openLobbyInScene,
  playButton,
  resolveFocusLobbyInScene,
  shareMountSettles,
  showDialogInScene,
} from '../../../test/testing'
import { asVeteran } from '../../../test/veteran'

const card = Scene.role('dialog', { name: 'How tough are you?' })
const easy = Scene.role('button', { name: 'Dare: Just here for the vibes' })
const normal = Scene.role('button', {
  name: "Double Dare: The way it's meant to be played",
})
const hard = Scene.role('button', { name: 'Triple Dare: They bite back' })
const openNightmare = Scene.role('button', {
  name: 'Triple Dog Dare: No backing out. Bring snacks',
})

describe('the difficulty card', () => {
  it.effect(
    'the first PLAY shows the four dares by name, Triple Dog Dare locked',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(initialModel),
        measureSurface,
        Scene.click(playButton),
        ...showDialogInScene(),
        Scene.inside(
          card,
          Scene.expect(easy).toExist(),
          Scene.expect(normal).toExist(),
          Scene.expect(hard).toExist(),
          Scene.expect(lockedNightmare).toHaveAttr('aria-disabled', 'true'),
          Scene.expect(easy).toContainText('Dare'),
          Scene.expect(normal).toContainText('Double Dare'),
          Scene.expect(hard).toContainText('Triple Dare'),
          Scene.expect(lockedNightmare).toContainText('Triple Dog Dare'),
          Scene.expect(Scene.text('Beat Triple Dare first')).toBeAbsent(),
          Scene.expect(
            Scene.selector("[data-difficulty='Nightmare'] .difficulty-unlock"),
          ).toExist(),
        ),
      ),
  )

  it.effect(
    'the first PLAY offers TUTORIAL, lit, or SKIP IT, and a tap lights SKIP IT',
    () => {
      const tutorial = Scene.role('button', { name: 'Play the tutorial' })
      const skip = Scene.role('button', { name: 'Skip the tutorial' })
      return Scene.scene(
        APPLICATION,
        Scene.given(initialModel),
        measureSurface,
        Scene.click(playButton),
        ...showDialogInScene(),
        Scene.inside(
          card,
          Scene.expect(tutorial).toHaveAttr('aria-pressed', 'true'),
          Scene.expect(tutorial).toContainText('TUTORIAL'),
          Scene.expect(skip).toHaveAttr('aria-pressed', 'false'),
          Scene.expect(skip).toContainText('SKIP IT'),
        ),
        Scene.click(skip),
        Scene.inside(
          card,
          Scene.expect(tutorial).toHaveAttr('aria-pressed', 'false'),
          Scene.expect(skip).toHaveAttr('aria-pressed', 'true'),
        ),
      )
    },
  )

  it.effect('after a Hard win Nightmare is open, with a NEW badge', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(
        modifyFields(initialModel, {
          difficulty: () => ({ chosen: 'Hard', nightmare: 'JustUnlocked' }),
        }),
      ),
      measureSurface,
      Scene.click(playButton),
      ...showDialogInScene(),
      Scene.inside(
        card,
        Scene.expect(openNightmare).toExist(),
        Scene.expect(openNightmare).not.toHaveAttr('aria-disabled', 'true'),
        Scene.expect(Scene.text('NEW!')).toExist(),
      ),
    ),
  )
})

describe('the difficulty in the lobby', () => {
  const skull = (name: string) =>
    Scene.role('button', { name: new RegExp(`^${name}`) })

  it.effect(
    'shows four skulls, marks the chosen level, and keeps Nightmare locked',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(asVeteran(initialModel)),
        measureSurface,
        Scene.expect(Scene.selector('.coop-skull-pick')).toBeAbsent(),
        ...openLobbyInScene(),
        Scene.expect(skull('Dare:')).toHaveAttr('aria-pressed', 'false'),
        Scene.expect(skull('Double Dare')).toHaveAttr('aria-pressed', 'true'),
        Scene.expect(skull('Triple Dare')).toHaveAttr('aria-pressed', 'false'),
        Scene.expect(lockedNightmare).toHaveAttr('aria-disabled', 'true'),
        Scene.expect(skull('Double Dare')).toHaveAttr('aria-pressed', 'true'),
        Scene.click(skull('Triple Dare')),
        resolveFocusLobbyInScene(),
        Scene.expect(skull('Triple Dare')).toHaveAttr('aria-pressed', 'true'),
        Scene.expect(skull('Double Dare')).toHaveAttr('aria-pressed', 'false'),
      ),
  )

  it.effect('a Hard win opens Nightmare with a NEW pip', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(
        modifyFields(asVeteran(initialModel), {
          difficulty: () => ({ chosen: 'Hard', nightmare: 'JustUnlocked' }),
        }),
      ),
      measureSurface,
      ...openLobbyInScene(),
      Scene.expect(skull('Triple Dog Dare')).not.toHaveAttr(
        'aria-disabled',
        'true',
      ),
      Scene.expect(Scene.selector('.coop-skull-pick .new-pip')).toExist(),
    ),
  )
})

const ended = (phase: Phase, base: Model): Model =>
  modifyFields(asVeteran(base), {
    phase: () => phase,
    screenMs: () => RESTART_GRACE_MS,
  })

describe('the end screens', () => {
  it.effect('Game Over names the difficulty', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(
        ended(
          Phase.GameOver({ wave: 4 }),
          modifyFields(initialModel, {
            difficulty: () => ({ chosen: 'Hard', nightmare: 'Locked' }),
          }),
        ),
      ),
      measureSurface,
      shareMountSettles('Cancelled'),
      Scene.expect(Scene.role('status')).toContainText(
        'Difficulty: Triple Dare.',
      ),
    ),
  )

  it.effect('a Hard Victory names the difficulty and the unlock', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(
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
      Scene.expect(Scene.role('status')).toContainText(
        'Difficulty: Triple Dare. Triple Dog Dare unlocked!',
      ),
    ),
  )
})
