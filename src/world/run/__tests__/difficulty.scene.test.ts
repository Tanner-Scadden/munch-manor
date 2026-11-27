import { Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { HtmlLocator } from '@effect/ui/html/testing'
import { Locator } from '@effect/ui/testing'
import { describe, it } from '@effect/vitest'

import { type Model, Phase } from '#app/model.ts'
import { initialModel } from '#app/pureApp.ts'
import { PANEL_DIALOG_ID } from '#domain/clientSchema.ts'
import {
  lobbyAttr,
  lobbySceneIn,
} from '#features/lobby/__tests__/lobby.fixture.ts'
import { Lobby } from '#features/lobby/block.ts'
import { Events as LobbyEvents } from '#features/lobby/message.ts'
import { RESTART_GRACE_MS } from '#shared/constants.ts'
import {
  byClass,
  expectAttr,
  lockedNightmare,
  measureSurface,
  openLobbyInScene,
  playButton,
  shareMountSettles,
  showDialog,
  statusLine,
  withAttrs,
} from '#test/sceneTesting.ts'
import { resolveFocusLobby, sceneOf, steps } from '#test/testing.ts'
import { asVeteran } from '#test/veteran.ts'

const card = HtmlLocator.role('dialog', { name: 'How tough are you?' })
const inCard = (locator: Locator.Locator) => Locator.inside(card, locator)
const easy = HtmlLocator.role('button', {
  name: 'Dare: Just here for the vibes',
})
const normal = HtmlLocator.role('button', {
  name: "Double Dare: The way it's meant to be played",
})
const hard = HtmlLocator.role('button', { name: 'Triple Dare: They bite back' })
const openNightmare = HtmlLocator.role('button', {
  name: 'Triple Dog Dare: No backing out. Bring snacks',
})

const openCard = steps(
  measureSurface,
  s => s.click(playButton),
  showDialog(PANEL_DIALOG_ID),
)

describe('the difficulty card', () => {
  it.effect(
    'the first PLAY shows the four dares by name, Triple Dog Dare locked',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(initialModel)
        s.pipe(
          openCard,
          expectAttr(inCard(lockedNightmare), 'aria-disabled', 'true'),
        )
          .expect(inCard(easy))
          .toExist()
          .expect(inCard(normal))
          .toExist()
          .expect(inCard(hard))
          .toExist()
          .expect(inCard(easy))
          .toHaveText(/Dare/)
          .expect(inCard(normal))
          .toHaveText(/Double Dare/)
          .expect(inCard(hard))
          .toHaveText(/Triple Dare/)
          .expect(inCard(lockedNightmare))
          .toHaveText(/Triple Dog Dare/)
          .expect(inCard(Locator.text('Escape on Triple Dare to unlock')))
          .toBeAbsent()
          .expect(
            inCard(
              Locator.inside(
                withAttrs({ 'data-difficulty': 'Nightmare' })(
                  Locator.attr('data-difficulty'),
                ),
                byClass('difficulty-unlock'),
              ),
            ),
          )
          .toExist()
      }),
  )

  it.effect(
    'the first PLAY offers TUTORIAL, lit, or SKIP IT, and a tap lights SKIP IT',
    () =>
      Effect.gen(function* () {
        const tutorial = inCard(
          HtmlLocator.role('button', { name: 'Play the tutorial' }),
        )
        const skip = inCard(
          HtmlLocator.role('button', { name: 'Skip the tutorial' }),
        )
        const s = yield* sceneOf(initialModel)
        s.pipe(
          openCard,
          expectAttr(tutorial, 'aria-pressed', 'true'),
          expectAttr(skip, 'aria-pressed', 'false'),
        )
          .expect(tutorial)
          .toHaveText(/TUTORIAL/)
          .expect(skip)
          .toHaveText(/SKIP IT/)
          .click(skip)
          .pipe(
            expectAttr(tutorial, 'aria-pressed', 'false'),
            expectAttr(skip, 'aria-pressed', 'true'),
          )
      }),
  )

  it.effect('after a Hard win Nightmare is open, with a NEW badge', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(
        UiStruct.evolve(initialModel, {
          difficulty: () => ({ chosen: 'Hard', nightmare: 'JustUnlocked' }),
        }),
      )
      s.pipe(
        openCard,
        expectAttr(inCard(openNightmare), 'aria-disabled', undefined),
      )
        .expect(inCard(openNightmare))
        .toExist()
        .expect(inCard(Locator.text('NEW!')))
        .toExist()
    }),
  )
})

describe('the difficulty in the lobby', () => {
  const skull = (name: string) =>
    HtmlLocator.role('button', { name: new RegExp(`^${name}`) })

  it.effect(
    'shows four skulls, marks the chosen level, and keeps Nightmare locked',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(asVeteran(initialModel))
        s.pipe(measureSurface)
          .expect(byClass('coop-skull-pick'))
          .toBeAbsent()
          .pipe(openLobbyInScene)
        const lobby = yield* lobbySceneIn(s)
        lobby
          .pipe(
            lobbyAttr(skull('Dare:'), 'aria-pressed', 'false'),
            lobbyAttr(skull('Double Dare'), 'aria-pressed', 'true'),
            lobbyAttr(skull('Triple Dare'), 'aria-pressed', 'false'),
            lobbyAttr(lockedNightmare, 'aria-disabled', 'true'),
            lobbyAttr(skull('Double Dare'), 'aria-pressed', 'true'),
          )
          .click(skull('Triple Dare'))
          .emitted(LobbyEvents.PickedDifficulty({ difficulty: 'Hard' }))
        s.childEmit(
          Lobby,
          'lobby',
          LobbyEvents.PickedDifficulty({ difficulty: 'Hard' }),
        ).pipe(resolveFocusLobby())
        const picked = yield* lobbySceneIn(s)
        picked.pipe(
          lobbyAttr(skull('Triple Dare'), 'aria-pressed', 'true'),
          lobbyAttr(skull('Double Dare'), 'aria-pressed', 'false'),
        )
      }),
  )

  it.effect('a Hard win opens Nightmare with a NEW pip', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(
        UiStruct.evolve(asVeteran(initialModel), {
          difficulty: () => ({ chosen: 'Hard', nightmare: 'JustUnlocked' }),
        }),
      )
      s.pipe(measureSurface, openLobbyInScene)
      const lobby = yield* lobbySceneIn(s)
      lobby
        .pipe(lobbyAttr(skull('Triple Dog Dare'), 'aria-disabled', undefined))
        .expect(Locator.inside(byClass('coop-skull-pick'), byClass('new-pip')))
        .toExist()
    }),
  )
})

const ended = (phase: Phase, base: Model): Model =>
  UiStruct.evolve(asVeteran(base), {
    phase: () => phase,
    screenMs: () => RESTART_GRACE_MS,
  })

describe('the end screens', () => {
  it.effect('Game Over names the difficulty', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(
        ended(
          Phase.GameOver({ wave: 4 }),
          UiStruct.evolve(initialModel, {
            difficulty: () => ({ chosen: 'Hard', nightmare: 'Locked' }),
          }),
        ),
      )
      s.pipe(measureSurface, shareMountSettles('Cancelled'))
        .expect(statusLine)
        .toHaveText(/Difficulty: Triple Dare\./)
    }),
  )

  it.effect('a Hard Victory names the difficulty and the unlock', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(
        ended(
          Phase.Escaped({ wave: 10 }),
          UiStruct.evolve(initialModel, {
            difficulty: () => ({ chosen: 'Hard', nightmare: 'JustUnlocked' }),
            maybeSurface: () => Option.none(),
          }),
        ),
      )
      s.pipe(measureSurface, shareMountSettles('Cancelled'))
        .expect(statusLine)
        .toHaveText(/Difficulty: Triple Dare\. Triple Dog Dare unlocked!/)
    }),
  )
})
