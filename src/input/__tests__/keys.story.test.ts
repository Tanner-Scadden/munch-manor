import { Effect } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../app/message'
import { DebutCard, type Model, Phase, Reload, RunMode } from '../../app/model'
import { DEBUT_CARD_MIN_MS } from '../../features/onboarding/onboarding'
import { RESTART_GRACE_MS } from '../../shared/constants'
import { SHOTGUN } from '../../test/arsenals'
import {
  WAVE_2_BREAK,
  WAVE_2_FIGHT,
  armedBreak,
  armedFight,
  readyModel,
} from '../../test/model.fixture'
import {
  APPLICATION,
  isPausedPhase,
  openLobbyByKey,
  press,
  resolveFocusLobby,
  tap,
  throughIntro,
  tick,
} from '../../test/testing'
import { STARTING_PISTOL } from '../../world/gear/weapons'
import { focusOf, modifyFocus } from '../../world/party/party'
import { Arsenal } from '../../world/schema/worldSchema'

const FRAME_MS = 50

const fighting: Model = armedFight

const preparing: Model = armedBreak

const ROUNDS: ReadonlyArray<
  readonly [Model, typeof WAVE_2_FIGHT | typeof WAVE_2_BREAK]
> = [
  [fighting, WAVE_2_FIGHT],
  [preparing, WAVE_2_BREAK],
]

const withDebutCard: Model = modifyFields(fighting, {
  debutCard: () =>
    DebutCard.Showing({ kind: 'Runner', ageMs: DEBUT_CARD_MIN_MS }),
})

const isPaused = isPausedPhase

describe('one key per action: removed keys do nothing', () => {
  it.effect('the arrow keys do not move the player', () =>
    Effect.forEach(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'], code =>
      Story.story(
        APPLICATION,
        Story.given(fighting),
        press(code),
        Story.model(({ seats: [{ intent }] }) => {
          expect(intent.move).toEqual({ x: 0, y: 0 })
        }),
        tick(FRAME_MS),
        Story.model(({ seats: [{ player }] }) => {
          expect(player.x).toBe(focusOf(fighting).player.x)
          expect(player.y).toBe(focusOf(fighting).player.y)
        }),
      ),
    ),
  )

  it.effect('Space does not fire', () =>
    Story.story(
      APPLICATION,
      Story.given(fighting),
      press('Space'),
      Story.model(({ seats: [{ intent }] }) => {
        expect(intent.trigger).toBe('Released')
      }),
      tick(FRAME_MS),
      tick(FRAME_MS),
      Story.model(({ stats, bullets }) => {
        expect(stats.shotsFired).toBe(0)
        expect(bullets).toEqual([])
      }),
    ),
  )

  it.effect('E does not swap a gun', () =>
    Story.story(
      APPLICATION,
      Story.given(fighting),
      tap('KeyE'),
      Story.model(({ seats: [{ player }] }) => {
        expect(player.arsenal).toEqual(focusOf(fighting).player.arsenal)
      }),
    ),
  )

  it.effect('P does not pause a wave or Preparation', () =>
    Effect.forEach(ROUNDS, ([start]) =>
      Story.story(
        APPLICATION,
        Story.given(start),
        tap('KeyP'),
        Story.model(current => {
          expect(isPaused(current)).toBe(false)
        }),
      ),
    ),
  )

  it.effect('Space does not start a run from the title or Game Over', () =>
    Effect.forEach(
      [
        readyModel,
        modifyFields(readyModel, {
          phase: () => Phase.GameOver({ wave: 3 }),
          screenMs: () => RESTART_GRACE_MS,
        }),
      ],
      start =>
        Story.story(
          APPLICATION,
          Story.given(start),
          tap('Space'),
          Story.model(({ phase }) => {
            expect(phase).toEqual(start.phase)
          }),
        ),
    ),
  )

  it.effect(
    'Space does not start the wave early or skip the new zombie card',
    () =>
      Effect.gen(function* () {
        yield* Story.story(
          APPLICATION,
          Story.given(preparing),
          tap('Space'),
          Story.model(({ phase }) => {
            expect(phase).toEqual(WAVE_2_BREAK)
          }),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(withDebutCard),
          tap('Space'),
          Story.model(({ debutCard }) => {
            expect(debutCard).toEqual(withDebutCard.debutCard)
          }),
        )
      }),
  )

  it.effect('Enter and Space do not resume a paused round', () =>
    Effect.forEach(['Enter', 'Space'], code =>
      Story.story(
        APPLICATION,
        Story.given(fighting),
        tap('Escape'),
        tap(code),
        Story.model(current => {
          expect(current.phase).toEqual(Phase.Paused({ round: WAVE_2_FIGHT }))
        }),
      ),
    ),
  )
})

describe('one key per action: the kept keys work', () => {
  it.effect('W, A, S, and D move', () =>
    Effect.gen(function* () {
      const moves: ReadonlyArray<readonly [string, { x: number; y: number }]> =
        [
          ['KeyW', { x: 0, y: -1 }],
          ['KeyA', { x: -1, y: 0 }],
          ['KeyS', { x: 0, y: 1 }],
          ['KeyD', { x: 1, y: 0 }],
        ]
      yield* Effect.forEach(moves, ([code, move]) =>
        Story.story(
          APPLICATION,
          Story.given(fighting),
          press(code),
          Story.model(({ seats: [{ intent }] }) => {
            expect(intent.move).toEqual(move)
          }),
        ),
      )
    }),
  )

  it.effect('Q swaps guns both ways', () =>
    Story.story(
      APPLICATION,
      Story.given(fighting),
      tap('KeyQ'),
      Story.model(({ seats: [{ player }] }) => {
        expect(player.arsenal).toEqual(
          Arsenal.HoldingSecond({
            first: { ...STARTING_PISTOL, loaded: 3 },
            second: SHOTGUN,
          }),
        )
      }),
      tap('KeyQ'),
      Story.model(({ seats: [{ player }] }) => {
        expect(player.arsenal).toEqual(focusOf(fighting).player.arsenal)
      }),
    ),
  )

  it.effect('R reloads', () =>
    Story.story(
      APPLICATION,
      Story.given(fighting),
      tap('KeyR'),
      Story.model(({ seats: [{ player }] }) => {
        expect(Reload.isAnyOf(['Reloading'])(player.reload)).toBe(true)
      }),
    ),
  )

  it.effect('G picks the next trap and T places it', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFocus(preparing, {
          trapStock: () => ({ Barricade: 1, Turret: 1 }),
          selectedTrap: () => 'Barricade',
        }),
      ),
      tap('KeyG'),
      Story.model(({ seats: [{ selectedTrap }] }) => {
        expect(selectedTrap).toBe('Turret')
      }),
      tap('KeyT'),
      Story.model(({ traps, seats: [{ trapStock }] }) => {
        expect(traps).toHaveLength(1)
        expect(trapStock.Turret).toBe(0)
      }),
    ),
  )

  it.effect(
    'Enter starts a campaign, starts the wave, and skips the new zombie card',
    () =>
      Effect.gen(function* () {
        yield* Story.story(
          APPLICATION,
          Story.given(readyModel),
          openLobbyByKey,
          tap('Enter'),
          throughIntro,
          Story.model(({ phase, mode }) => {
            expect(Phase.isAnyOf(['Preparation'])(phase)).toBe(true)
            expect(mode).toEqual(RunMode.Campaign())
          }),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(preparing),
          tap('Enter'),
          Story.model(({ phase }) => {
            expect(Phase.isAnyOf(['Wave'])(phase)).toBe(true)
          }),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(withDebutCard),
          tap('Enter'),
          Story.model(({ debutCard }) => {
            expect(debutCard).toEqual(DebutCard.Hidden())
          }),
        )
      }),
  )

  it.effect('E switches the lobby mode to endless, and Enter plays it', () =>
    Story.story(
      APPLICATION,
      Story.given(readyModel),
      openLobbyByKey,
      tap('KeyE'),
      resolveFocusLobby(),
      Story.model(({ phase, home }) => {
        expect(Phase.isAnyOf(['Ready'])(phase)).toBe(true)
        expect(home.mode).toBe('Endless')
      }),
      tap('Enter'),
      throughIntro,
      Story.model(({ phase, mode }) => {
        expect(Phase.isAnyOf(['Preparation'])(phase)).toBe(true)
        expect(mode).toEqual(RunMode.Endless())
      }),
    ),
  )

  it.effect('Esc pauses a wave or Preparation and Esc resumes it', () =>
    Effect.forEach(ROUNDS, ([start, round]) =>
      Story.story(
        APPLICATION,
        Story.given(start),
        tap('Escape'),
        Story.model(current => {
          expect(current.phase).toEqual(Phase.Paused({ round }))
        }),
        tick(FRAME_MS),
        tap('Escape'),
        Story.model(current => {
          expect(current.phase).toEqual(start.phase)
        }),
      ),
    ),
  )

  it.effect('M mutes and N turns the music off', () =>
    Story.story(
      APPLICATION,
      Story.given(fighting),
      tap('KeyM'),
      tap('KeyN'),
      Story.model(({ soundSetting, musicSetting }) => {
        expect(soundSetting).toBe('Muted')
        expect(musicSetting).toBe('Off')
      }),
    ),
  )
})

describe('the PAUSE button', () => {
  it.effect('pauses a wave or Preparation, and does nothing elsewhere', () =>
    Effect.gen(function* () {
      yield* Effect.forEach(ROUNDS, ([start, round]) =>
        Story.story(
          APPLICATION,
          Story.given(start),
          Story.message(Message.ClickedPauseButton()),
          Story.model(current => {
            expect(current.phase).toEqual(Phase.Paused({ round }))
          }),
        ),
      )
      yield* Story.story(
        APPLICATION,
        Story.given(readyModel),
        Story.message(Message.ClickedPauseButton()),
        Story.model(({ phase }) => {
          expect(phase).toEqual(readyModel.phase)
        }),
      )
    }),
  )

  it.effect('lets go of held keys so nothing moves after resuming', () =>
    Story.story(
      APPLICATION,
      Story.given(fighting),
      press('KeyD'),
      Story.message(Message.ClickedPauseButton()),
      Story.model(({ input, seats: [{ intent }] }) => {
        expect(input.pressedKeys).toEqual([])
        expect(intent.move).toEqual({ x: 0, y: 0 })
      }),
    ),
  )
})
