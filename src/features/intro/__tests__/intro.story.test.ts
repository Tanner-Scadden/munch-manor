import { Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../../app/message'
import { AudioState, type Model, Phase } from '../../../app/model'
import { saveOf } from '../../../platform/save'
import { MAX_FRAME_DELTA_MS } from '../../../shared/constants'
import { newPlayerCardSeen, readyModel } from '../../../test/model.fixture'
import {
  APPLICATION,
  checkPendingSounds,
  openLobbyByKey,
  playPendingSounds,
  press,
  ticks,
  ticksFor,
} from '../../../test/testing'
import { focusOf } from '../../../world/party/party'
import { ARRIVAL_MS, SLAM_MS, slamAtMs } from '../../../world/run/arrival'
import { KNOCK_BACK_MS, maybeIntroFrameOf } from '../introBeat'

// The intro in single player (src/features/intro/introBeat.ts, the clock in
// src/world/run/arrival.ts): START opens on it, the whole drive up the first
// time and the knock after, a press skips to the slam, the slam is never
// skipped, and the run starts on it.

const firstTimer: Model = modifyFields(readyModel, {
  introSeen: () => 'Unseen',
})

const startFrom = Story.steps(openLobbyByKey, press('Enter'))

const beatOf = (current: Model) =>
  Option.map(maybeIntroFrameOf(current), ({ beat }) => beat)

const arrivalMsOf = (current: Model): number =>
  Phase.matchOrElse(
    current.phase,
    { Arriving: ({ elapsedMs }) => elapsedMs },
    () => -1,
  )

const framesFor = (ms: number) => ticksFor(ms, MAX_FRAME_DELTA_MS)

describe('the intro', () => {
  it.effect(
    'the first START plays the whole drive up, and the slam starts the first break',
    () =>
      Story.story(
        APPLICATION,
        Story.given(firstTimer),
        startFrom,
        Story.model(current => {
          expect(current.phase).toEqual(
            Phase.Arriving({ elapsedMs: 0, cut: 'Full' }),
          )
          expect(beatOf(current)).toEqual(Option.some('Drive'))
          expect(current.introSeen).toBe('Seen')
          expect(saveOf(current).onboarding.intro).toBe('Seen')
        }),
        ...framesFor(slamAtMs('Full') - 100),
        Story.model(current => {
          expect(beatOf(current)).toEqual(Option.some('Hello'))
          expect(current.stats.runMs).toBe(0)
          expect(focusOf(current).player).toEqual(focusOf(firstTimer).player)
        }),
        ...framesFor(ARRIVAL_MS.Full - slamAtMs('Full') + 100),
        Story.model(current => {
          expect(Phase.guards.Preparation(current.phase)).toBe(true)
          expect(current.stats.runMs).toBe(0)
        }),
      ),
  )

  it.effect(
    "a new player's first PLAY goes straight in, on the whole intro",
    () =>
      Story.story(
        APPLICATION,
        Story.given(newPlayerCardSeen),
        Story.message(Message.ClickedPlayButton()),
        Story.model(current => {
          expect(current.lobby.status).toBe('Closed')
          expect(current.phase).toEqual(
            Phase.Arriving({ elapsedMs: 0, cut: 'Full' }),
          )
        }),
      ),
  )

  it.effect('a returning player gets the knock and the slam', () =>
    Story.story(
      APPLICATION,
      Story.given(readyModel),
      startFrom,
      Story.model(current => {
        expect(current.phase).toEqual(
          Phase.Arriving({ elapsedMs: 0, cut: 'Short' }),
        )
        expect(beatOf(current)).toEqual(Option.some('Knock'))
      }),
      ...framesFor(ARRIVAL_MS.Short - MAX_FRAME_DELTA_MS),
      Story.model(current => {
        expect(beatOf(current)).toEqual(Option.some('Slam'))
      }),
      ...framesFor(MAX_FRAME_DELTA_MS),
      Story.model(current => {
        expect(Phase.guards.Preparation(current.phase)).toBe(true)
      }),
    ),
  )

  it.effect('any key skips to the slam, and the slam plays out', () =>
    Story.story(
      APPLICATION,
      Story.given(firstTimer),
      startFrom,
      ...ticks(4, MAX_FRAME_DELTA_MS),
      press('KeyQ'),
      Story.model(current => {
        expect(arrivalMsOf(current)).toBe(slamAtMs('Full'))
        expect(beatOf(current)).toEqual(Option.some('Slam'))
      }),
      ...framesFor(SLAM_MS - MAX_FRAME_DELTA_MS),
      Story.model(current => {
        expect(Phase.guards.Arriving(current.phase)).toBe(true)
      }),
      ...framesFor(MAX_FRAME_DELTA_MS),
      Story.model(current => {
        expect(Phase.guards.Preparation(current.phase)).toBe(true)
      }),
    ),
  )

  it.effect('the slam is never skipped, by a key or a tap', () =>
    Story.story(
      APPLICATION,
      Story.given(readyModel),
      startFrom,
      press('Escape'),
      ...ticks(4, MAX_FRAME_DELTA_MS),
      Story.model(current => {
        expect(arrivalMsOf(current)).toBeCloseTo(
          slamAtMs('Short') + 4 * MAX_FRAME_DELTA_MS,
        )
      }),
      press('Escape'),
      Story.message(
        Message.PressedPointer({
          pointerId: 2,
          device: 'Mouse',
          clientX: 300,
          clientY: 200,
        }),
      ),
      Story.model(current => {
        expect(arrivalMsOf(current)).toBeCloseTo(
          slamAtMs('Short') + 4 * MAX_FRAME_DELTA_MS,
        )
        expect(beatOf(current)).toEqual(Option.some('Slam'))
      }),
    ),
  )

  it.effect(
    'the intro has no pause, and a hidden page leaves it as it is',
    () =>
      Story.story(
        APPLICATION,
        Story.given(readyModel),
        startFrom,
        ...ticks(2, MAX_FRAME_DELTA_MS),
        Story.message(Message.ClickedPauseButton()),
        Story.message(Message.ChangedPageVisibility({ visibility: 'Hidden' })),
        Story.model(current => {
          expect(arrivalMsOf(current)).toBeCloseTo(2 * MAX_FRAME_DELTA_MS)
        }),
      ),
  )

  it.effect(
    'the knock, the knock back, and the slam sound, then the run music comes in',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          modifyFields(readyModel, {
            audio: () => AudioState.Ready(),
            musicSetting: () => 'Off',
          }),
        ),
        startFrom,
        playPendingSounds,
        ...framesFor(400),
        checkPendingSounds(sounds => {
          expect(sounds).toEqual(['Knock'])
        }),
        ...framesFor(300),
        checkPendingSounds(sounds => {
          expect(sounds).toEqual(['Knock'])
        }),
        ...framesFor(KNOCK_BACK_MS - 700 + MAX_FRAME_DELTA_MS),
        checkPendingSounds(sounds => {
          expect(sounds).toEqual(['KnockBack'])
        }),
        ...framesFor(ARRIVAL_MS.Short - KNOCK_BACK_MS - MAX_FRAME_DELTA_MS),
        checkPendingSounds(sounds => {
          expect(sounds).toEqual(['DoorSlam'])
        }),
        Story.model(current => {
          expect(Phase.guards.Preparation(current.phase)).toBe(true)
        }),
        Story.Command.expectNone(),
      ),
  )
})
