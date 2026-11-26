import { Array, Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { HtmlLocator } from '@effect/ui/html/testing'
import { Locator } from '@effect/ui/testing'
import { describe, expect, it } from '@effect/vitest'

import { Phase, RunMode } from '#app/model.ts'
import { initialModel } from '#app/pureApp.ts'
import { withBests } from '#domain/run.ts'
import { Lobby } from '#features/lobby/block.ts'
import { Events } from '#features/lobby/message.ts'
import { RESTART_GRACE_MS } from '#shared/constants.ts'
import {
  ackHudSlots,
  byClass,
  emitFrame,
  expectAttr,
  keepGoingButton,
  lobbyMode,
  lobbyStartButton,
  measureSurface,
  openLobbyInScene,
  playButton,
  playEndlessButton,
  retryButton,
  shareMountSettles,
  startRunInScene,
  statusLine,
  throughIntroInScene,
} from '#test/sceneTesting.ts'
import { resolveFocusLobby, sceneOf, steps } from '#test/testing.ts'
import { asVeteran } from '#test/veteran.ts'

import { expectLobbyDrawn, lobbyAttr, lobbySceneIn } from './lobby.fixture.ts'

const endlessModeButton = HtmlLocator.role('button', { name: 'Endless' })
const START_PROMPT =
  'Press Enter, or use the Start wave button, to start it now.'

describe('Mode choice', () => {
  it.effect(
    'the home menu offers PLAY alone, and the lobby picks endless and starts it',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(asVeteran(initialModel))
        s.pipe(
          measureSurface,
          expectAttr(playButton, 'aria-keyshortcuts', 'Enter'),
        )
          .expect(endlessModeButton)
          .toBeAbsent()
          .expect(byClass('home-key'))
          .toExist()
          .expect(keepGoingButton)
          .toBeAbsent()
          .pipe(openLobbyInScene)
        const campaign = yield* lobbySceneIn(s)
        campaign
          .pipe(lobbyAttr(endlessModeButton, 'aria-pressed', 'false'))
          .click(endlessModeButton)
          .emitted(Events.PickedMode({ mode: 'Endless' }))
        s.childEmit(
          Lobby,
          'lobby',
          Events.PickedMode({ mode: 'Endless' }),
        ).pipe(resolveFocusLobby())
        const endless = yield* lobbySceneIn(s)
        endless
          .pipe(
            lobbyAttr(endlessModeButton, 'aria-pressed', 'true'),
            lobbyAttr(lobbyMode('Campaign'), 'aria-pressed', 'false'),
          )
          .click(lobbyStartButton)
          .emitted(Events.RequestedStart())
        s.childEmit(Lobby, 'lobby', Events.RequestedStart())
          .pipe(expectLobbyDrawn(false), throughIntroInScene, ackHudSlots)
          .expect(statusLine)
          .toHaveText(
            `Get ready for endless wave 1. ${START_PROMPT} Keys on the ring: 0.`,
          )
          .expect(playEndlessButton)
          .toBeAbsent()
      }),
  )

  it.effect('the Play button starts the escape', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(
        UiStruct.evolve(asVeteran(initialModel), {
          mode: () => RunMode.Endless(),
        }),
      )
      s.pipe(measureSurface, startRunInScene, ackHudSlots)
        .expect(statusLine)
        .toHaveText(
          `Get ready for wave 1. ${START_PROMPT} Keys on the ring: 0.`,
        )
    }),
  )

  it.effect(
    'touch shows the buttons without key badges, and PLAY as the dare card',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(
          UiStruct.evolve(initialModel, { lastDevice: () => 'Touch' }),
        )
        s.pipe(measureSurface)
          .expect(playButton)
          .toHaveText('I DARE YOU')
          .expect(byClass('home-play-icon'))
          .toExist()
          .expect(byClass('home-key'))
          .toBeAbsent()
      }),
  )

  it.effect('an escape offers no Keep going, even after the grace', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(
        UiStruct.evolve(asVeteran(initialModel), {
          phase: () => Phase.Escaped({ wave: 10 }),
        }),
      )
      s.pipe(
        measureSurface,
        steps(
          ...Array.makeBy(Math.ceil(RESTART_GRACE_MS / 50), () =>
            emitFrame(50),
          ),
        ),
      )
        .expect(retryButton)
        .toExist()
        .expect(keepGoingButton)
        .toBeAbsent()
        .pipe(shareMountSettles('Cancelled'))
    }),
  )

  it.effect(
    'Game Over and an escape ask the player to tell whoever sent the game what they think',
    () =>
      Effect.gen(function* () {
        const FEEDBACK = 'Tell whoever sent you this what you think!'
        const feedback = new RegExp(FEEDBACK)
        yield* Effect.forEach(
          [Phase.GameOver({ wave: 4 }), Phase.Escaped({ wave: 10 })],
          phase =>
            Effect.map(
              sceneOf(UiStruct.evolve(initialModel, { phase: () => phase })),
              s =>
                s.pipe(measureSurface).expect(statusLine).toHaveText(feedback),
            ),
          { discard: true },
        )
        const s = yield* sceneOf(initialModel)
        s.pipe(measureSurface).check(() => {
          expect(Locator.textOf(s.get(statusLine))).not.toContain(FEEDBACK)
        })
      }),
  )
  it.effect(
    'an endless Game Over reads out the wave reached and your best',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(
          UiStruct.evolve(
            withBests(initialModel, bests =>
              UiStruct.evolve(bests, {
                maybeBestEndlessWave: () => Option.some(14),
              }),
            ),
            {
              mode: () => RunMode.Endless(),
              phase: () => Phase.GameOver({ wave: 12 }),
            },
          ),
        )
        s.pipe(measureSurface)
          .expect(statusLine)
          .toHaveText(/Wave reached: 12\. Your best: wave 14\./)
      }),
  )
})
