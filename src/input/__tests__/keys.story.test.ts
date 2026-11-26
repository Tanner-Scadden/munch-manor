import { Effect } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { Message } from '#app/message.ts'
import { DebutCard, type Model, Phase, Reload, RunMode } from '#app/model.ts'
import { DEBUT_CARD_MIN_MS } from '#features/onboarding/onboarding.ts'
import { screenToFloorDirection } from '#render/lens.ts'
import { RESTART_GRACE_MS } from '#shared/constants.ts'
import { SHOTGUN } from '#test/arsenals.ts'
import {
  WAVE_2_BREAK,
  WAVE_2_FIGHT,
  armedBreak,
  armedFight,
  readyModel,
} from '#test/model.fixture.ts'
import {
  checkModel,
  isPausedPhase,
  openLobbyByKey,
  press,
  resolveFocusLobby,
  send,
  storyOf,
  tap,
  throughIntro,
  tick,
} from '#test/testing.ts'
import { STARTING_PISTOL } from '#world/gear/weapons.ts'
import { focusOf, modifyFocus } from '#world/party/party.ts'
import { Arsenal } from '#world/schema/worldSchema.ts'

const FRAME_MS = 50

const fighting: Model = armedFight

const preparing: Model = armedBreak

const ROUNDS: ReadonlyArray<
  readonly [Model, typeof WAVE_2_FIGHT | typeof WAVE_2_BREAK]
> = [
  [fighting, WAVE_2_FIGHT],
  [preparing, WAVE_2_BREAK],
]

const withDebutCard: Model = UiStruct.evolve(fighting, {
  debutCard: () =>
    DebutCard.Showing({ kind: 'Runner', ageMs: DEBUT_CARD_MIN_MS }),
})

const isPaused = isPausedPhase

describe('one key per action: removed keys do nothing', () => {
  it.effect('the arrow keys do not move the player', () =>
    Effect.forEach(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'], code =>
      Effect.gen(function* () {
        const s = yield* storyOf(fighting)
        s.pipe(
          press(code),
          checkModel(({ seats: [{ intent }] }) => {
            expect(intent.move).toEqual({ x: 0, y: 0 })
          }),
          tick(FRAME_MS),
          checkModel(({ seats: [{ player }] }) => {
            expect(player.x).toBe(focusOf(fighting).player.x)
            expect(player.y).toBe(focusOf(fighting).player.y)
          }),
        )
      }),
    ),
  )

  it.effect('Space does not fire', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(fighting)
      s.pipe(
        press('Space'),
        checkModel(({ seats: [{ intent }] }) => {
          expect(intent.trigger).toBe('Released')
        }),
        tick(FRAME_MS),
        tick(FRAME_MS),
        checkModel(({ stats, bullets }) => {
          expect(stats.shotsFired).toBe(0)
          expect(bullets).toEqual([])
        }),
      )
    }),
  )

  it.effect('E does not swap a gun', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(fighting)
      s.pipe(
        tap('KeyE'),
        checkModel(({ seats: [{ player }] }) => {
          expect(player.arsenal).toEqual(focusOf(fighting).player.arsenal)
        }),
      )
    }),
  )

  it.effect('P does not pause a wave or Preparation', () =>
    Effect.forEach(ROUNDS, ([start]) =>
      Effect.gen(function* () {
        const s = yield* storyOf(start)
        s.pipe(
          tap('KeyP'),
          checkModel(current => {
            expect(isPaused(current)).toBe(false)
          }),
        )
      }),
    ),
  )

  it.effect('Space does not start a run from the title or Game Over', () =>
    Effect.forEach(
      [
        readyModel,
        UiStruct.evolve(readyModel, {
          phase: () => Phase.GameOver({ wave: 3 }),
          screenMs: () => RESTART_GRACE_MS,
        }),
      ],
      start =>
        Effect.gen(function* () {
          const s = yield* storyOf(start)
          s.pipe(
            tap('Space'),
            checkModel(({ phase }) => {
              expect(phase).toEqual(start.phase)
            }),
          )
        }),
    ),
  )

  it.effect(
    'Space does not start the wave early or skip the new zombie card',
    () =>
      Effect.gen(function* () {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const s = yield* storyOf(preparing)
            s.pipe(
              tap('Space'),
              checkModel(({ phase }) => {
                expect(phase).toEqual(WAVE_2_BREAK)
              }),
            )
          }),
        )
        yield* Effect.scoped(
          Effect.gen(function* () {
            const s = yield* storyOf(withDebutCard)
            s.pipe(
              tap('Space'),
              checkModel(({ debutCard }) => {
                expect(debutCard).toEqual(withDebutCard.debutCard)
              }),
            )
          }),
        )
      }),
  )

  it.effect('Enter and Space do not resume a paused round', () =>
    Effect.forEach(['Enter', 'Space'], code =>
      Effect.gen(function* () {
        const s = yield* storyOf(fighting)
        s.pipe(
          tap('Escape'),
          tap(code),
          checkModel(current => {
            expect(current.phase).toEqual(Phase.Paused({ round: WAVE_2_FIGHT }))
          }),
        )
      }),
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
        Effect.gen(function* () {
          const s = yield* storyOf(fighting)
          s.pipe(
            press(code),
            checkModel(({ seats: [{ intent }] }) => {
              expect(intent.move).toEqual(screenToFloorDirection(move))
            }),
          )
        }),
      )
    }),
  )

  it.effect('Q swaps guns both ways', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(fighting)
      s.pipe(
        tap('KeyQ'),
        checkModel(({ seats: [{ player }] }) => {
          expect(player.arsenal).toEqual(
            Arsenal.HoldingSecond({
              first: { ...STARTING_PISTOL, loaded: 3 },
              second: SHOTGUN,
            }),
          )
        }),
        tap('KeyQ'),
        checkModel(({ seats: [{ player }] }) => {
          expect(player.arsenal).toEqual(focusOf(fighting).player.arsenal)
        }),
      )
    }),
  )

  it.effect('R reloads', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(fighting)
      s.pipe(
        tap('KeyR'),
        checkModel(({ seats: [{ player }] }) => {
          expect(Reload.isAnyOf(['Reloading'])(player.reload)).toBe(true)
        }),
      )
    }),
  )

  it.effect('G picks the next trap and T places it', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        modifyFocus(preparing, {
          trapStock: () => ({ Barricade: 1, Turret: 1 }),
          selectedTrap: () => 'Barricade',
        }),
      )
      s.pipe(
        tap('KeyG'),
        checkModel(({ seats: [{ selectedTrap }] }) => {
          expect(selectedTrap).toBe('Turret')
        }),
        tap('KeyT'),
        checkModel(({ traps, seats: [{ trapStock }] }) => {
          expect(traps).toHaveLength(1)
          expect(trapStock.Turret).toBe(0)
        }),
      )
    }),
  )

  it.effect(
    'Enter starts a campaign, starts the wave, and skips the new zombie card',
    () =>
      Effect.gen(function* () {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const s = yield* storyOf(readyModel)
            s.pipe(
              openLobbyByKey,
              tap('Enter'),
              throughIntro,
              checkModel(({ phase, mode }) => {
                expect(Phase.isAnyOf(['Preparation'])(phase)).toBe(true)
                expect(mode).toEqual(RunMode.Campaign())
              }),
            )
          }),
        )
        yield* Effect.scoped(
          Effect.gen(function* () {
            const s = yield* storyOf(preparing)
            s.pipe(
              tap('Enter'),
              checkModel(({ phase }) => {
                expect(Phase.isAnyOf(['Wave'])(phase)).toBe(true)
              }),
            )
          }),
        )
        yield* Effect.scoped(
          Effect.gen(function* () {
            const s = yield* storyOf(withDebutCard)
            s.pipe(
              tap('Enter'),
              checkModel(({ debutCard }) => {
                expect(debutCard).toEqual(DebutCard.Hidden())
              }),
            )
          }),
        )
      }),
  )

  it.effect('E switches the lobby mode to endless, and Enter plays it', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(readyModel)
      s.pipe(
        openLobbyByKey,
        tap('KeyE'),
        resolveFocusLobby(),
        checkModel(({ phase, home }) => {
          expect(Phase.isAnyOf(['Ready'])(phase)).toBe(true)
          expect(home.mode).toBe('Endless')
        }),
        tap('Enter'),
        throughIntro,
        checkModel(({ phase, mode }) => {
          expect(Phase.isAnyOf(['Preparation'])(phase)).toBe(true)
          expect(mode).toEqual(RunMode.Endless())
        }),
      )
    }),
  )

  it.effect('Esc pauses a wave or Preparation and Esc resumes it', () =>
    Effect.forEach(ROUNDS, ([start, round]) =>
      Effect.gen(function* () {
        const s = yield* storyOf(start)
        s.pipe(
          tap('Escape'),
          checkModel(current => {
            expect(current.phase).toEqual(Phase.Paused({ round }))
          }),
          tick(FRAME_MS),
          tap('Escape'),
          checkModel(current => {
            expect(current.phase).toEqual(start.phase)
          }),
        )
      }),
    ),
  )

  it.effect('M mutes and N turns the music off', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(fighting)
      s.pipe(
        tap('KeyM'),
        tap('KeyN'),
        checkModel(({ settings: { soundSetting, musicSetting } }) => {
          expect(soundSetting).toBe('Muted')
          expect(musicSetting).toBe('Off')
        }),
      )
    }),
  )
})

describe('the PAUSE button', () => {
  it.effect('pauses a wave or Preparation, and does nothing elsewhere', () =>
    Effect.gen(function* () {
      yield* Effect.forEach(ROUNDS, ([start, round]) =>
        Effect.gen(function* () {
          const s = yield* storyOf(start)
          s.pipe(
            send(Message.ClickedPauseButton()),
            checkModel(current => {
              expect(current.phase).toEqual(Phase.Paused({ round }))
            }),
          )
        }),
      )
      yield* Effect.scoped(
        Effect.gen(function* () {
          const s = yield* storyOf(readyModel)
          s.pipe(
            send(Message.ClickedPauseButton()),
            checkModel(({ phase }) => {
              expect(phase).toEqual(readyModel.phase)
            }),
          )
        }),
      )
    }),
  )

  it.effect('lets go of held keys so nothing moves after resuming', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(fighting)
      s.pipe(
        press('KeyD'),
        send(Message.ClickedPauseButton()),
        checkModel(({ input, seats: [{ intent }] }) => {
          expect(input.pressedKeys).toEqual([])
          expect(intent.move).toEqual({ x: 0, y: 0 })
        }),
      )
    }),
  )
})
