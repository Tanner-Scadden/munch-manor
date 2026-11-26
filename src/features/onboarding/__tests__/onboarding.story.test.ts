import { Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../../app/message'
import {
  BreakClock,
  DebutCard,
  type Model,
  Phase,
  RunMode,
  type ZombieKind,
} from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import {
  FIRST_PREPARATION_MS,
  FIXED_STEP_MS,
  HIT_STOP_WAVE_CLEAR_MS,
  PREPARATION_MS,
} from '../../../shared/constants'
import { newPlayerCardSeen, onHard } from '../../../test/model.fixture'
import {
  SHOWN_TICKS,
  checkModel,
  hintIds,
  holdFire,
  modelAfter,
  mouseDown,
  press,
  release,
  releaseFire,
  send,
  startWave,
  steps,
  tap,
  throughIntro,
  throughIntroByTap,
  tick,
  ticks,
  touchDown,
  touchMove,
} from '../../../test/testing'
import { asVeteran } from '../../../test/veteran'
import { focusOf } from '../../../world/party/party'
import { rollSpawns } from '../../../world/waves/endlessWaves'
import {
  DEBUT_CARD_MIN_MS,
  DEBUT_CARD_MS,
  isLearned,
  shownGhostSticks,
} from '../onboarding'

const TICK_MS = 50
const CARD_TICKS = Math.ceil(DEBUT_CARD_MIN_MS / TICK_MS)
const AUTO_TICKS = Math.ceil(DEBUT_CARD_MS / TICK_MS)

const touchUp = (pointerId: number) =>
  send(Message.ReleasedPointer({ pointerId }))

const cardKind = (current: Model): Option.Option<ZombieKind> =>
  DebutCard.match(current.debutCard, {
    Hidden: () => Option.none(),
    Showing: ({ kind }) => Option.some(kind),
  })

const remainingMs = (current: Model): number =>
  Phase.match(current.phase, {
    Ready: () => -1,
    Arriving: () => -1,
    Preparation: preparation => preparation.remainingMs,
    Wave: () => -1,
    Paused: () => -1,
    Escaped: () => -1,
    LeftEarly: () => -1,
    GameOver: () => -1,
  })

const waveClockMs = (current: Model): number =>
  Phase.match(current.phase, {
    Ready: () => -1,
    Arriving: () => -1,
    Preparation: () => -1,
    Wave: wave => wave.elapsedMs,
    Paused: () => -1,
    Escaped: () => -1,
    LeftEarly: () => -1,
    GameOver: () => -1,
  })

const clearingWave = (wave: number, base: Model): Model =>
  UiStruct.evolve(base, {
    phase: () => Phase.Wave({ wave, elapsedMs: 0, spawns: [] }),
  })

const introduced = (base: Model, kinds: ReadonlyArray<ZombieKind>): Model =>
  UiStruct.evolve(base, { introducedKinds: () => kinds })

// NOTE: the break before wave 2, with these kinds met; START WAVE
// (`startWave`) starts wave 2.
const beforeWave2 = (kinds: ReadonlyArray<ZombieKind>): Model => {
  const [, spawns] = rollSpawns(1, 2)
  return UiStruct.evolve(introduced(asVeteran(newPlayerCardSeen), kinds), {
    phase: () =>
      Phase.Preparation({
        clock: BreakClock.Counting(),
        wave: 2,
        remainingMs: PREPARATION_MS,
        durationMs: PREPARATION_MS,
        spawns,
      }),
  })
}

describe('new zombie card', () => {
  it.effect(
    'wave 6 brings the Big Leaguer card and wave 7 the Ankle Biter card',
    () =>
      Effect.gen(function* () {
        const startOf = (wave: number, kinds: ReadonlyArray<ZombieKind>) => {
          const [, spawns] = rollSpawns(1, wave)
          return UiStruct.evolve(
            introduced(asVeteran(newPlayerCardSeen), kinds),
            {
              phase: () =>
                Phase.Preparation({
                  clock: BreakClock.Counting(),
                  wave,
                  remainingMs: PREPARATION_MS,
                  durationMs: PREPARATION_MS,
                  spawns,
                }),
            },
          )
        }

        yield* modelAfter(
          startOf(6, ['Shambler', 'Runner', 'Exploder', 'Tank']),
          steps(
            send(Message.ClickedStartWaveButton()),
            checkModel(current => {
              expect(cardKind(current)).toStrictEqual(Option.some('Thrower'))
            }),
          ),
        )

        yield* modelAfter(
          startOf(7, ['Shambler', 'Runner', 'Exploder', 'Tank', 'Thrower']),
          steps(
            send(Message.ClickedStartWaveButton()),
            checkModel(current => {
              expect(cardKind(current)).toStrictEqual(Option.some('Crawler'))
            }),
          ),
        )
      }),
  )

  it.effect('stays out of Preparation and comes up when the wave starts', () =>
    modelAfter(
      newPlayerCardSeen,
      steps(
        tap('Enter'),
        throughIntro,
        checkModel(current => {
          expect(Phase.guards.Preparation(current.phase)).toBe(true)
          expect(cardKind(current)).toStrictEqual(Option.none())
          expect(hintIds(current)).toEqual(['Move', 'Fire'])
        }),
        send(Message.ClickedStartWaveButton()),
        checkModel(current => {
          expect(Phase.guards.Wave(current.phase)).toBe(true)
          expect(cardKind(current)).toStrictEqual(Option.some('Shambler'))
          expect(hintIds(current)).toEqual([])
        }),
      ),
    ),
  )

  it.effect(
    'does not hold up the Preparation countdown, and comes up when it runs out',
    () =>
      modelAfter(
        clearingWave(
          3,
          onHard(
            introduced(asVeteran(newPlayerCardSeen), ['Shambler', 'Runner']),
          ),
        ),
        steps(
          // NOTE: one 60 Hz tick clears the wave; a 50 ms frame is three.
          tick(FIXED_STEP_MS),
          checkModel(current => {
            expect(cardKind(current)).toStrictEqual(Option.none())
            expect(remainingMs(current)).toBe(PREPARATION_MS)
          }),
          // NOTE: the clearing blow holds the world still first.
          ticks(4, TICK_MS),
          checkModel(current => {
            expect(remainingMs(current)).toBeCloseTo(
              PREPARATION_MS - (4 * TICK_MS - HIT_STOP_WAVE_CLEAR_MS),
            )
          }),
          ticks(Math.ceil(PREPARATION_MS / TICK_MS), TICK_MS),
          checkModel(current => {
            expect(Phase.guards.Wave(current.phase)).toBe(true)
            expect(cardKind(current)).toStrictEqual(Option.some('Exploder'))
          }),
        ),
      ),
  )

  it.effect('introduces each kind once per session', () =>
    Effect.gen(function* () {
      yield* modelAfter(
        beforeWave2(['Shambler']),
        steps(
          startWave,
          ticks(AUTO_TICKS, TICK_MS),
          checkModel(current => {
            expect(cardKind(current)).toStrictEqual(Option.none())
            expect(current.introducedKinds).toEqual(['Shambler', 'Runner'])
          }),
        ),
      )

      yield* modelAfter(
        beforeWave2(['Shambler', 'Runner']),
        steps(
          startWave,
          checkModel(current => {
            expect(Phase.guards.Wave(current.phase)).toBe(true)
            expect(cardKind(current)).toStrictEqual(Option.none())
          }),
        ),
      )

      yield* modelAfter(
        introduced(
          UiStruct.evolve(newPlayerCardSeen, {
            phase: () => Phase.GameOver({ wave: 1 }),
            screenMs: () => 1e6,
          }),
          ['Shambler'],
        ),
        steps(
          tap('Enter'),
          throughIntro,
          send(Message.ClickedStartWaveButton()),
          checkModel(current => {
            expect(Phase.guards.Wave(current.phase)).toBe(true)
            expect(cardKind(current)).toStrictEqual(Option.none())
          }),
        ),
      )
    }),
  )

  it.effect(
    'in endless, only kinds not yet introduced this session get a card',
    () =>
      Effect.gen(function* () {
        // NOTE: an endless run's tenth wave cleared: the next tick is the
        // break before wave 11.
        const victorious = (kinds: ReadonlyArray<ZombieKind>): Model =>
          introduced(
            clearingWave(
              10,
              UiStruct.evolve(asVeteran(newPlayerCardSeen), {
                mode: () => RunMode.Endless(),
              }),
            ),
            kinds,
          )

        yield* modelAfter(
          victorious([
            'Shambler',
            'Runner',
            'Exploder',
            'Tank',
            'Thrower',
            'Crawler',
          ]),
          steps(
            tick(TICK_MS),
            send(Message.ClickedStartWaveButton()),
            checkModel(current => {
              expect(Phase.guards.Wave(current.phase)).toBe(true)
              expect(cardKind(current)).toStrictEqual(Option.none())
            }),
          ),
        )

        yield* modelAfter(
          victorious(['Shambler', 'Runner', 'Exploder', 'Thrower', 'Crawler']),
          steps(
            tick(TICK_MS),
            checkModel(current => {
              expect(cardKind(current)).toStrictEqual(Option.none())
            }),
            send(Message.ClickedStartWaveButton()),
            checkModel(current => {
              expect(cardKind(current)).toStrictEqual(Option.some('Tank'))
            }),
          ),
        )
      }),
  )

  it.effect(
    'holds the world still while it is up, then lets the wave go on its own',
    () =>
      modelAfter(
        beforeWave2(['Shambler']),
        steps(
          startWave,
          press('KeyD'),
          ticks(AUTO_TICKS - 1, TICK_MS),
          checkModel(current => {
            expect(cardKind(current)).toStrictEqual(Option.some('Runner'))
            expect(waveClockMs(current)).toBe(0)
            expect(current.zombies).toEqual([])
            expect(focusOf(current).player.x).toBe(
              focusOf(initialModel).player.x,
            )
          }),
          tick(TICK_MS),
          checkModel(current => {
            expect(cardKind(current)).toStrictEqual(Option.none())
          }),
          ticks(4, TICK_MS),
          checkModel(current => {
            expect(waveClockMs(current)).toBeGreaterThan(0)
            expect(focusOf(current).player.x).toBeGreaterThan(
              focusOf(initialModel).player.x,
            )
          }),
        ),
      ),
  )

  it.effect(
    'a click, a tap, Enter, or GOT IT skip it, but only after a short minimum',
    () =>
      Effect.gen(function* () {
        const skips = [
          tap('Enter'),
          steps(
            mouseDown(700, 200),
            send(Message.ReleasedPointer({ pointerId: 1 })),
          ),
          steps(touchDown(4, 100, 200), touchUp(4)),
          send(Message.ClickedDebutCardButton()),
        ]
        yield* Effect.forEach(
          skips,
          skip =>
            modelAfter(
              beforeWave2(['Shambler']),
              steps(
                startWave,
                skip,
                checkModel(current => {
                  expect(cardKind(current)).toStrictEqual(Option.some('Runner'))
                }),
                ticks(CARD_TICKS, TICK_MS),
                skip,
                checkModel(current => {
                  expect(cardKind(current)).toStrictEqual(Option.none())
                  expect(current.introducedKinds).toEqual([
                    'Shambler',
                    'Runner',
                  ])
                  expect(Phase.guards.Wave(current.phase)).toBe(true)
                }),
              ),
            ),
          { discard: true },
        )
      }),
  )

  it.effect('movement and the other keys and buttons leave it up', () =>
    modelAfter(
      beforeWave2(['Shambler']),
      steps(
        startWave,
        ticks(CARD_TICKS, TICK_MS),
        press('KeyW'),
        press('KeyD'),
        tap('KeyR'),
        tap('KeyQ'),
        tap('KeyT'),
        tap('KeyM'),
        send(Message.MovedMouse({ clientX: 700, clientY: 100 })),
        send(Message.ClickedSwapButton()),
        send(Message.ClickedReloadButton()),
        send(Message.ClickedPlaceTrapButton()),
        tick(TICK_MS),
        checkModel(current => {
          expect(cardKind(current)).toStrictEqual(Option.some('Runner'))
          expect(current.stats.shotsFired).toBe(0)
        }),
      ),
    ),
  )

  it.effect('Escape pauses it, and it carries on after resuming', () =>
    modelAfter(
      beforeWave2(['Shambler']),
      steps(
        startWave,
        ticks(CARD_TICKS, TICK_MS),
        tap('Escape'),
        checkModel(current => {
          expect(Phase.guards.Paused(current.phase)).toBe(true)
        }),
        ticks(AUTO_TICKS, TICK_MS),
        tap('Escape'),
        checkModel(current => {
          expect(Phase.guards.Wave(current.phase)).toBe(true)
          expect(cardKind(current)).toStrictEqual(Option.some('Runner'))
        }),
      ),
    ),
  )
})

describe('touch first play', () => {
  const touchPlayer: Model = UiStruct.evolve(newPlayerCardSeen, {
    lastDevice: () => 'Touch',
  })

  it.effect(
    'shows both stick ghosts, and keeps the aim ghost until the player aims and fires',
    () =>
      modelAfter(
        touchPlayer,
        steps(
          touchDown(1, 400, 200),
          touchUp(1),
          send(Message.ClickedCampaignButton()),
          throughIntroByTap,
          checkModel(current => {
            expect(shownGhostSticks(current)).toEqual(['Move', 'Aim'])
          }),
          touchDown(2, 700, 200),
          ticks(10, TICK_MS),
          checkModel(current => {
            expect(current.stats.shotsFired).toBe(0)
            expect(shownGhostSticks(current)).toEqual(['Move'])
          }),
          touchUp(2),
          ticks(SHOWN_TICKS, TICK_MS),
          checkModel(current => {
            expect(isLearned(current.lessons.fire)).toBe(false)
            expect(shownGhostSticks(current)).toEqual(['Move', 'Aim'])
          }),
          touchDown(3, 100, 200),
          touchMove(3, 160, 200),
          ticks(10, TICK_MS),
          touchUp(3),
          checkModel(current => {
            expect(isLearned(current.lessons.move)).toBe(true)
            expect(shownGhostSticks(current)).toEqual(['Aim'])
          }),
          touchDown(4, 700, 200),
          touchMove(4, 760, 180),
          ticks(30, TICK_MS),
          touchUp(4),
          checkModel(current => {
            expect(isLearned(current.lessons.fire)).toBe(true)
            expect(shownGhostSticks(current)).toEqual([])
          }),
        ),
      ),
  )

  it.effect('shows no ghosts on keyboard and mouse', () =>
    modelAfter(
      newPlayerCardSeen,
      steps(
        tap('Enter'),
        throughIntro,
        checkModel(current => {
          expect(hintIds(current)).toEqual(['Move', 'Fire'])
          expect(shownGhostSticks(current)).toEqual([])
        }),
      ),
    ),
  )
})

describe('tutorial hints', () => {
  it.effect('do not clear on unrelated input or a quick nudge', () =>
    modelAfter(
      newPlayerCardSeen,
      steps(
        tap('Enter'),
        tap('KeyQ'),
        tap('KeyM'),
        tap('KeyM'),
        tap('KeyG'),
        tap('Digit2'),
        send(Message.MovedMouse({ clientX: 700, clientY: 100 })),
        press('KeyD'),
        tick(TICK_MS),
        release('KeyD'),
        holdFire,
        releaseFire,
        ticks(SHOWN_TICKS, TICK_MS),
        checkModel(current => {
          expect(isLearned(current.lessons.move)).toBe(false)
          expect(isLearned(current.lessons.fire)).toBe(false)
          expect(shownGhostSticks(current)).toEqual(['Move', 'Aim'])
        }),
      ),
    ),
  )

  it.effect(
    'stay up for a minimum time even when the action is done at once',
    () =>
      modelAfter(
        newPlayerCardSeen,
        steps(
          tap('Enter'),
          throughIntro,
          press('KeyD'),
          ticks(10, TICK_MS),
          release('KeyD'),
          checkModel(current => {
            expect(current.practice.movedPx).toBeGreaterThan(24)
            expect(hintIds(current)).toEqual(['Move', 'Fire'])
          }),
          ticks(SHOWN_TICKS, TICK_MS),
          checkModel(current => {
            expect(hintIds(current)).toEqual(['Fire'])
          }),
        ),
      ),
  )
})

describe('wave 1 practice gate', () => {
  it.effect(
    'wave 1 waits for the player to move, aim, and fire, and START WAVE skips it',
    () =>
      modelAfter(
        newPlayerCardSeen,
        steps(
          tap('Enter'),
          ticks(Math.ceil((FIRST_PREPARATION_MS * 3) / TICK_MS), TICK_MS),
          tap('KeyR'),
          checkModel(current => {
            expect(remainingMs(current)).toBe(FIRST_PREPARATION_MS)
          }),
          send(Message.ClickedStartWaveButton()),
          checkModel(current => {
            expect(Phase.guards.Wave(current.phase)).toBe(true)
          }),
        ),
      ),
  )

  it.effect('the countdown starts once both lessons are learned', () =>
    modelAfter(
      newPlayerCardSeen,
      steps(
        tap('Enter'),
        throughIntro,
        press('KeyD'),
        ticks(10, TICK_MS),
        release('KeyD'),
        send(Message.MovedMouse({ clientX: 700, clientY: 100 })),
        mouseDown(700, 100),
        ticks(SHOWN_TICKS, TICK_MS),
        send(Message.ReleasedPointer({ pointerId: 1 })),
        checkModel(current => {
          expect(isLearned(current.lessons.move)).toBe(true)
          expect(isLearned(current.lessons.fire)).toBe(true)
        }),
        ticks(Math.ceil(FIRST_PREPARATION_MS / TICK_MS) + 1, TICK_MS),
        checkModel(current => {
          expect(Phase.guards.Wave(current.phase)).toBe(true)
        }),
      ),
    ),
  )

  it.effect('only holds wave 1', () => {
    const [, spawns] = rollSpawns(1, 2)
    return modelAfter(
      UiStruct.evolve(introduced(newPlayerCardSeen, ['Shambler', 'Runner']), {
        phase: () =>
          Phase.Preparation({
            clock: BreakClock.Counting(),
            wave: 2,
            remainingMs: 1000,
            durationMs: PREPARATION_MS,
            spawns,
          }),
      }),
      steps(
        ticks(Math.ceil(1000 / TICK_MS) + 1, TICK_MS),
        checkModel(current => {
          expect(Phase.guards.Wave(current.phase)).toBe(true)
        }),
      ),
    )
  })
})
