import { Array, Result } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import { type Bot, Life, type Model } from '../../../app/model'
import { botInputs } from '../../../features/bots/teammateBot'
import { FIXED_STEP_MS } from '../../../shared/constants'
import {
  crewInWave,
  pickupAt,
  pipeline,
  placeSeat,
  withPickups,
  withSeatLife,
} from '../../../test/model.fixture'
import { APPLICATION, hasEvent, tap, ticks } from '../../../test/testing'
import type { World } from '../../schema/world'
import { SeatAction, trySeatAction } from '../../step/stepWorld'
import { MEDIC_RULES, isCallFresh } from '../medic'
import { COOP_RULES, seatStateAt } from '../party'

// The MEDIC call (src/world/party/medic.ts, MULTIPLAYER.md "Life"): a downed player
// falls with 20 s to bleed (played out whole in medic.sim.test.ts), shouts MEDIC! as they fall and again on a press
// every 4 s, the bots answer a fresh shout first, and a revive pays off
// with SAVED!, or CLUTCH! when the bleed was nearly out.

const TICK_MS = FIXED_STEP_MS
const LEFT_X = 60
const RIGHT_X = 240
const ROW_Y = 104

const downed = (bleedMs: number, callMs: number) =>
  Life.Downed({ bleedMs, reviveMs: 0, callMs })

const callMsOf = (current: World, slot: number): number => {
  const { life } = seatStateAt(current, slot).seat
  return life._tag === 'Downed' ? life.callMs : -1
}

// NOTE: the lead downed alone on the left, a teammate far off on the right.
const leadDown = (callMs: number) =>
  pipeline(
    placeSeat(0, LEFT_X, ROW_Y, 0),
    placeSeat(1, RIGHT_X, ROW_Y),
    withSeatLife(0, downed(COOP_RULES.bleedOutMs, callMs)),
  )(crewInWave(2))

describe('the MEDIC call', () => {
  it.effect('going down shouts MEDIC! at once', () => {
    const falling = pipeline(
      placeSeat(0, LEFT_X, ROW_Y),
      placeSeat(1, RIGHT_X, ROW_Y, 0),
    )(crewInWave(2))
    return Story.story(
      APPLICATION,
      Story.given(falling),
      ...ticks(1, TICK_MS),
      Story.model(current => {
        expect(seatStateAt(current, 1).seat.life).toEqual(
          Life.Downed({ bleedMs: 20_000, reviveMs: 0, callMs: 0 }),
        )
        expect(isCallFresh(seatStateAt(current, 1).seat)).toBe(true)
      }),
      ...ticks(1, TICK_MS),
      Story.model(current => {
        expect(hasEvent(current, 'MedicCalled')).toBe(true)
        expect(isCallFresh(seatStateAt(current, 1).seat)).toBe(true)
      }),
      ...ticks(1, TICK_MS),
      Story.model(current => {
        expect(hasEvent(current, 'MedicCalled')).toBe(false)
      }),
    )
  })

  it.effect('the shout is fresh for 1.5 s', () =>
    Story.story(
      APPLICATION,
      Story.given(leadDown(0)),
      ...ticks(Math.floor(MEDIC_RULES.freshMs / TICK_MS) - 1, TICK_MS),
      Story.model(current => {
        expect(isCallFresh(seatStateAt(current, 0).seat)).toBe(true)
      }),
      ...ticks(2, TICK_MS),
      Story.model(current => {
        expect(isCallFresh(seatStateAt(current, 0).seat)).toBe(false)
      }),
    ),
  )

  test('only a downed player can shout, and only once the last is 4 s old', () => {
    const standing = pipeline(
      placeSeat(0, LEFT_X, ROW_Y),
      placeSeat(1, RIGHT_X, ROW_Y),
    )(crewInWave(2))
    const call = SeatAction.CallMedic()
    expect(Result.isFailure(trySeatAction(standing, 0, call))).toBe(true)
    expect(
      Result.isFailure(
        trySeatAction(leadDown(MEDIC_RULES.cooldownMs - 1), 0, call),
      ),
    ).toBe(true)
    expect(
      Result.isFailure(
        trySeatAction(withSeatLife(0, Life.BledOut())(leadDown(0)), 0, call),
      ),
    ).toBe(true)
    const shouted = Result.getOrThrow(
      trySeatAction(leadDown(MEDIC_RULES.cooldownMs), 0, call),
    )
    expect(callMsOf(shouted, 0)).toBe(0)
  })

  it.effect('Enter shouts while downed, and the next tick sounds it', () =>
    Story.story(
      APPLICATION,
      Story.given(leadDown(MEDIC_RULES.cooldownMs)),
      tap('Enter'),
      Story.model(current => {
        expect(callMsOf(current, 0)).toBe(0)
      }),
      ...ticks(1, TICK_MS),
      Story.model(current => {
        expect(hasEvent(current, 'MedicCalled')).toBe(true)
      }),
    ),
  )

  it.effect('Enter does nothing while the last shout cools down', () => {
    const cooling = MEDIC_RULES.cooldownMs - 1000
    return Story.story(
      APPLICATION,
      Story.given(leadDown(cooling)),
      tap('Enter'),
      Story.model(current => {
        expect(callMsOf(current, 0)).toBe(cooling)
      }),
    )
  })
})

describe('the bots answer', () => {
  const BOT: Bot = {
    name: 'Gizmo',
    calling: 'You',
    look: crewInWave(1).appearance,
  }

  const withBot = (base: Model): Model =>
    modifyFields(base, { crewBots: () => [BOT] })

  it.effect('a bot leaves a power-up beside it to answer a call', () => {
    const start = withPickups(
      pipeline(
        placeSeat(1, 150, 90),
        placeSeat(0, 30, 140, 0),
        withSeatLife(0, downed(COOP_RULES.bleedOutMs, 0)),
      )(withBot(crewInWave(2))),
      [pickupAt(900, 'Damage', 150, 135)],
    )
    return Story.story(
      APPLICATION,
      Story.given(start),
      ...ticks(60, TICK_MS),
      Story.model(current => {
        expect(current.pickups).toHaveLength(1)
        expect(seatStateAt(current, 1).player.x).toBeLessThan(120)
      }),
    )
  })

  test('a fresh call comes before a nearer teammate who is down', () => {
    const start = pipeline(
      placeSeat(1, 120, ROW_Y),
      placeSeat(0, 80, ROW_Y, 0),
      placeSeat(2, 220, ROW_Y, 0),
      withSeatLife(0, downed(COOP_RULES.bleedOutMs, MEDIC_RULES.cooldownMs)),
      withSeatLife(2, downed(COOP_RULES.bleedOutMs, 0)),
    )(withBot(crewInWave(3)))
    const move = botInputs(start, [1]).get(1)?.move
    expect(move?.x ?? 0).toBeGreaterThan(0)
  })
})

describe('the payoff', () => {
  const reviveTicks = Math.ceil(COOP_RULES.reviveMs / TICK_MS)

  const besideDowned = (bleedMs: number) =>
    pipeline(
      placeSeat(0, RIGHT_X - 8, ROW_Y),
      placeSeat(1, RIGHT_X, ROW_Y, 0),
      withSeatLife(1, downed(bleedMs, MEDIC_RULES.cooldownMs)),
    )(crewInWave(2))

  const popupKindsOf = (current: Model) =>
    Array.map(current.popups, ({ kind }) => kind)

  it.effect('a revive shows SAVED! with confetti over the reviver', () =>
    Story.story(
      APPLICATION,
      Story.given(besideDowned(COOP_RULES.bleedOutMs)),
      ...ticks(reviveTicks + 1, TICK_MS),
      Story.model(current => {
        expect(seatStateAt(current, 1).seat.life._tag).toBe('Standing')
        expect(popupKindsOf(current)).toContain('Saved')
        expect(popupKindsOf(current)).not.toContain('Clutch')
        expect(
          Array.some(current.particles, ({ kind }) => kind === 'Confetti'),
        ).toBe(true)
      }),
    ),
  )

  it.effect('a revive with under 3 s of bleed left shows CLUTCH!', () =>
    Story.story(
      APPLICATION,
      Story.given(
        besideDowned(COOP_RULES.reviveMs + MEDIC_RULES.clutchBleedMs - 100),
      ),
      ...ticks(reviveTicks + 1, TICK_MS),
      Story.model(current => {
        expect(seatStateAt(current, 1).seat.life._tag).toBe('Standing')
        expect(popupKindsOf(current)).toContain('Clutch')
        expect(popupKindsOf(current)).not.toContain('Saved')
      }),
    ),
  )
})
