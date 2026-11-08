import { Array } from 'effect'
import { given, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { type Model, Phase, Tour } from '../../../app/model'
import { update } from '../../../app/pureApp'
import {
  crewInWave,
  home,
  onHard,
  pastTimedBreaks,
} from '../../../test/model.fixture'
import { press, tap, tick, ticks } from '../../../test/testing'
import { modifyFocus } from '../../../world/party/party'
import { withWorld } from '../../../world/schema/world'
import { idleIntent } from '../../../world/schema/worldSchema'
import {
  SeatAction,
  applySeatAction,
  soloInputs,
  stepWorld,
} from '../../../world/step/stepWorld'
import { beginPreparation, startWaveEarly } from '../../../world/waves/waves'
import { raiseDebutCardFrom } from '../../onboarding/onboarding'
import {
  CREW_NUDGE_MS,
  LAST_ONE_NUDGE_MS,
  SOLO_NUDGE_MS,
  advanceBreakIdle,
  isWaitingOnYou,
} from '../readyNudge'

// Breaks that wait on a player (owner, 2026-11-01): a break with no clock
// waits for READY, and after a quiet moment READY pulses and the HUD says
// WAITING ON YOU.

const FRAME_MS = 100

// NOTE: past the guided first break, whose tracker is its own nudge.
const soloBreak = (wave = 4): Model =>
  withWorld(
    modifyFields(pastTimedBreaks(home), { firstBreakQuest: () => Tour.Over() }),
    world => beginPreparation(world, wave, 20_000),
  )

const crewBreak = (): Model =>
  withWorld(crewInWave(2), world => beginPreparation(world, 4, 20_000))

const idleFor = (start: Model, ms: number): Model => advanceBreakIdle(start, ms)

const crewReadied = (start: Model, slot: number): Model =>
  withWorld(start, world => applySeatAction(world, slot, SeatAction.Ready()))

describe('a break with no clock', () => {
  test('a crew break on Normal waits for everyone to press READY', () => {
    const waiting = crewBreak()
    expect(
      waiting.phase._tag === 'Preparation' && waiting.phase.clock._tag,
    ).toBe('Waiting')
    const stepped = Array.reduce(
      globalThis.Array.from({ length: 3000 }),
      waiting,
      current =>
        withWorld(
          current,
          world => stepWorld(world, soloInputs(idleIntent)).world,
        ),
    )
    expect(stepped.phase._tag).toBe('Preparation')
    const one = withWorld(
      crewReadied(stepped, 0),
      world => stepWorld(world, soloInputs(idleIntent)).world,
    )
    expect(one.phase._tag).toBe('Preparation')
    const both = withWorld(
      crewReadied(one, 1),
      world => stepWorld(world, soloInputs(idleIntent)).world,
    )
    expect(both.phase._tag).toBe('Wave')
  })

  test('a solo break on Normal waits for Enter, however long the player takes', () => {
    story(
      update,
      given(soloBreak()),
      ...ticks(400, 100),
      model(current => {
        expect(current.phase._tag).toBe('Preparation')
      }),
      tap('Enter'),
      model(current => {
        expect(current.phase._tag).toBe('Wave')
      }),
    )
  })

  test('Hard keeps its clock', () => {
    const hard = withWorld(onHard(pastTimedBreaks(home)), world =>
      beginPreparation(world, 4, 20_000),
    )
    expect(hard.phase._tag === 'Preparation' && hard.phase.clock._tag).toBe(
      'Counting',
    )
  })
})

describe('the nudge', () => {
  test('a solo player is nudged after a quiet 15 s, and not before', () => {
    const quiet = idleFor(soloBreak(), SOLO_NUDGE_MS - FRAME_MS)
    expect(isWaitingOnYou(quiet)).toBe(false)
    expect(isWaitingOnYou(idleFor(quiet, FRAME_MS))).toBe(true)
  })

  test('moving starts the quiet over, and the nudge clears', () => {
    const nudged = idleFor(soloBreak(), SOLO_NUDGE_MS)
    expect(isWaitingOnYou(nudged)).toBe(true)
    const moving = advanceBreakIdle(
      modifyFocus(nudged, {
        intent: () => ({ ...idleIntent, move: { x: 1, y: 0 } }),
      }),
      FRAME_MS,
    )
    expect(moving.breakIdleMs).toBe(0)
    expect(isWaitingOnYou(moving)).toBe(false)
  })

  test('a timed break on Hard has the clock to nudge, so no nudge', () => {
    const hard = withWorld(onHard(pastTimedBreaks(home)), world =>
      beginPreparation(world, 4, 20_000),
    )
    expect(isWaitingOnYou(idleFor(hard, SOLO_NUDGE_MS * 2))).toBe(false)
  })

  test('the nudge runs through frames, and Enter ends the break and the nudge', () => {
    story(
      update,
      given(soloBreak()),
      ...ticks(Math.ceil(SOLO_NUDGE_MS / 50) + 4, 50),
      model(current => {
        expect(isWaitingOnYou(current)).toBe(true)
      }),
      press('Enter'),
      model(current => {
        expect(current.phase._tag).toBe('Wave')
        expect(isWaitingOnYou(current)).toBe(false)
      }),
      tick(50),
      model(current => {
        expect(current.breakIdleMs).toBe(0)
      }),
    )
  })

  test('in a crew, the last one not READY is nudged soon, and a pressed READY clears it', () => {
    const waiting = crewReadied(crewBreak(), 1)
    expect(isWaitingOnYou(idleFor(waiting, LAST_ONE_NUDGE_MS - FRAME_MS))).toBe(
      false,
    )
    const nudged = idleFor(waiting, LAST_ONE_NUDGE_MS)
    expect(isWaitingOnYou(nudged)).toBe(true)
    expect(isWaitingOnYou(crewReadied(nudged, 0))).toBe(false)
  })

  test('in a crew where others are still choosing, the nudge takes the longer 8 s', () => {
    const waiting = crewBreak()
    expect(isWaitingOnYou(idleFor(waiting, CREW_NUDGE_MS - FRAME_MS))).toBe(
      false,
    )
    expect(isWaitingOnYou(idleFor(waiting, CREW_NUDGE_MS))).toBe(true)
  })
})

describe('the new zombie card', () => {
  test('a crew run, bots included, raises no card for a kind it has not met', () => {
    const soloWave = withWorld(home, world =>
      startWaveEarly(beginPreparation(world, 2, 1)),
    )
    const solo = modifyFields(soloWave, { introducedKinds: () => [] })
    const before = withWorld(
      modifyFields(home, { introducedKinds: () => [] }),
      world => beginPreparation(world, 2, 20_000),
    )
    expect(solo.phase._tag).toBe('Wave')
    expect(raiseDebutCardFrom(before, solo).debutCard._tag).toBe('Showing')

    const crewBefore = modifyFields(crewBreak(), { introducedKinds: () => [] })
    const crewWave = withWorld(crewBefore, world => startWaveEarly(world))
    expect(Phase.isAnyOf(['Wave'])(crewWave.phase)).toBe(true)
    expect(raiseDebutCardFrom(crewBefore, crewWave).debutCard._tag).toBe(
      'Hidden',
    )
  })
})
