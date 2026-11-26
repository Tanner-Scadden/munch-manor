import { Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { Message } from '#app/message.ts'
import { AudioState, type Model, Phase } from '#app/model.ts'
import type { SoundEffect } from '#audio/audio.ts'
import { KNOCK_BACK_MS, maybeIntroFrameOf } from '#features/intro/introBeat.ts'
import { saveOf } from '#platform/save/save.ts'
import { MAX_FRAME_DELTA_MS } from '#shared/constants.ts'
import { newPlayerCardSeen, readyModel } from '#test/model.fixture.ts'
import {
  type StoryStep,
  checkModel,
  checkPendingSounds,
  openLobbyByKey,
  playPendingSounds,
  press,
  resolveFocusLobby,
  send,
  steps,
  storyOf,
  tick,
  ticks,
  ticksFor,
} from '#test/testing.ts'
import { focusOf } from '#world/party/party.ts'
import { ARRIVAL_MS, SLAM_MS, slamAtMs } from '#world/run/arrival.ts'

const firstTimer: Model = UiStruct.evolve(readyModel, {
  introSeen: () => 'Unseen',
})

const startFrom: StoryStep = steps(openLobbyByKey, press('Enter'))

const beatOf = (current: Model) =>
  Option.map(maybeIntroFrameOf(current), ({ beat }) => beat)

const arrivalMsOf = (current: Model): number =>
  Phase.matchOrElse(
    current.phase,
    { Arriving: ({ elapsedMs }) => elapsedMs },
    () => -1,
  )

const framesFor = (ms: number): StoryStep => ticksFor(ms, MAX_FRAME_DELTA_MS)

const heardOver =
  (ms: number, heard: ReadonlyArray<SoundEffect>): StoryStep =>
  s => {
    const sounds: Array<SoundEffect> = []
    const frame = steps(
      tick(MAX_FRAME_DELTA_MS),
      checkPendingSounds(each => {
        sounds.push(...each)
      }),
    )
    for (
      let index = 0;
      index < Math.round(ms / MAX_FRAME_DELTA_MS);
      index += 1
    ) {
      frame(s)
    }
    expect(sounds).toEqual(heard)
    return s
  }

const isPreparing: StoryStep = s =>
  checkModel(current => {
    expect(Phase.guards.Preparation(current.phase)).toBe(true)
  })(s)

describe('the intro', () => {
  it.effect(
    'the first START plays the whole drive up, and the slam starts the first break',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(firstTimer)
        s.pipe(
          startFrom,
          checkModel(current => {
            expect(current.phase).toEqual(
              Phase.Arriving({ elapsedMs: 0, cut: 'Full' }),
            )
            expect(beatOf(current)).toEqual(Option.some('Drive'))
            expect(current.introSeen).toBe('Seen')
            expect(saveOf(current).onboarding.intro).toBe('Seen')
          }),
          framesFor(slamAtMs('Full') - 100),
          checkModel(current => {
            expect(beatOf(current)).toEqual(Option.some('Hello'))
            expect(current.stats.runMs).toBe(0)
            expect(focusOf(current).player).toEqual(focusOf(firstTimer).player)
          }),
          framesFor(ARRIVAL_MS.Full - slamAtMs('Full') + 100),
          checkModel(current => {
            expect(Phase.guards.Preparation(current.phase)).toBe(true)
            expect(current.stats.runMs).toBe(0)
          }),
        )
      }),
  )

  it.effect(
    "a new player's first PLAY goes straight in, on the whole intro",
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(newPlayerCardSeen)
        s.pipe(send(Message.ClickedPlayButton()))
        expect(s.model.lobby.status).toBe('Closed')
        expect(s.model.phase).toEqual(
          Phase.Arriving({ elapsedMs: 0, cut: 'Full' }),
        )
      }),
  )

  it.effect('a returning player gets the knock and the slam', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(readyModel)
      s.pipe(
        startFrom,
        checkModel(current => {
          expect(current.phase).toEqual(
            Phase.Arriving({ elapsedMs: 0, cut: 'Short' }),
          )
          expect(beatOf(current)).toEqual(Option.some('Knock'))
        }),
        framesFor(ARRIVAL_MS.Short - MAX_FRAME_DELTA_MS),
        checkModel(current => {
          expect(beatOf(current)).toEqual(Option.some('Slam'))
        }),
        framesFor(MAX_FRAME_DELTA_MS),
        isPreparing,
      )
    }),
  )

  it.effect('any key skips to the slam, and the slam plays out', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(firstTimer)
      s.pipe(
        startFrom,
        ticks(4, MAX_FRAME_DELTA_MS),
        press('KeyQ'),
        checkModel(current => {
          expect(arrivalMsOf(current)).toBe(slamAtMs('Full'))
          expect(beatOf(current)).toEqual(Option.some('Slam'))
        }),
        framesFor(SLAM_MS - MAX_FRAME_DELTA_MS),
        checkModel(current => {
          expect(Phase.guards.Arriving(current.phase)).toBe(true)
        }),
        framesFor(MAX_FRAME_DELTA_MS),
        isPreparing,
      )
    }),
  )

  it.effect('the slam is never skipped, by a key or a tap', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(readyModel)
      s.pipe(
        startFrom,
        press('Escape'),
        ticks(4, MAX_FRAME_DELTA_MS),
        checkModel(current => {
          expect(arrivalMsOf(current)).toBeCloseTo(
            slamAtMs('Short') + 4 * MAX_FRAME_DELTA_MS,
          )
        }),
        press('Escape'),
        send(
          Message.PressedPointer({
            pointerId: 2,
            device: 'Mouse',
            clientX: 300,
            clientY: 200,
          }),
        ),
        checkModel(current => {
          expect(arrivalMsOf(current)).toBeCloseTo(
            slamAtMs('Short') + 4 * MAX_FRAME_DELTA_MS,
          )
          expect(beatOf(current)).toEqual(Option.some('Slam'))
        }),
      )
    }),
  )

  it.effect(
    'the intro has no pause, and a hidden page leaves it as it is',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(readyModel)
        s.pipe(
          startFrom,
          ticks(2, MAX_FRAME_DELTA_MS),
          send(Message.ClickedPauseButton()),
          send(Message.ChangedPageVisibility({ visibility: 'Hidden' })),
        )
        expect(arrivalMsOf(s.model)).toBeCloseTo(2 * MAX_FRAME_DELTA_MS)
      }),
  )

  it.effect(
    'the knock, the knock back, and the slam sound, then the run music comes in',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(
          UiStruct.evolve(readyModel, {
            audio: () => AudioState.Ready,
            settings: UiStruct.evolve({ musicSetting: () => 'Off' }),
          }),
        )
        s.pipe(
          press('Enter'),
          playPendingSounds,
          resolveFocusLobby(),
          press('Enter'),
          playPendingSounds,
          heardOver(400, ['Knock']),
          heardOver(300, ['Knock']),
          heardOver(KNOCK_BACK_MS - 700 + MAX_FRAME_DELTA_MS, ['KnockBack']),
          heardOver(ARRIVAL_MS.Short - KNOCK_BACK_MS - MAX_FRAME_DELTA_MS, [
            'DoorSlam',
          ]),
          isPreparing,
        ).expectNone()
      }),
  )
})
