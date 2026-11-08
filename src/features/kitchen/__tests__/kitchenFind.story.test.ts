import { Option } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { Boss, KitchenCall, type Model, Phase } from '../../../app/model'
import { cameraOf } from '../../../render/camera'
import {
  DISTANT_SPAWN,
  freshRunModel,
  pastTimedBreaks,
} from '../../../test/model.fixture'
import { BELOW_KITCHEN_DOOR, nextFrame } from '../../../test/testing'
import { openExitIn } from '../../../world/level/arena'
import { levelOf } from '../../../world/level/arena'
import { modifyFocus } from '../../../world/party/party'
import { soupBubbleShapes } from '../../shop/stallBubble'
import { CALL_MS, maybeKitchenSound } from '../kitchenCall'
import { kitchenLeakShapes } from '../kitchenLeak'
import { roomsCounterShapes, roomsOf } from '../roomsFound'

// NOTE: finding the kitchen (src/features/kitchen/kitchenCall.ts, src/features/kitchen/kitchenLeak.ts,
// src/features/kitchen/roomsFound.ts): Rattles hollers about the boards once in each break
// until they are open, the boards leak light and steam, and a counter in
// the break shows how many rooms are found.

const breakAt = (wave: number): Model =>
  modifyFields(pastTimedBreaks(freshRunModel()), {
    phase: () =>
      Phase.Preparation({
        wave,
        remainingMs: 600_000,
        durationMs: 600_000,
        spawns: [DISTANT_SPAWN],
      }),
  })

const frames = (current: Model, count: number): Model =>
  count <= 0 ? current : frames(nextFrame(current), count - 1)

const FRAMES_PER_CALL = Math.ceil(CALL_MS / (1000 / 60)) + 20

const withKitchenOpen = (current: Model): Model =>
  modifyFields(current, {
    level: state => openExitIn(state, 'Kitchen'),
  })

const isCalling = (current: Model): boolean =>
  KitchenCall.isAnyOf(['Calling'])(current.kitchenCall)

const callDrawn = (current: Model): boolean =>
  soupBubbleShapes(current, cameraOf(current)).length > 0

describe('Rattles pointing at the boards', () => {
  test('hollers in the first break the kitchen is on sale', () => {
    const called = frames(breakAt(3), 2)
    expect(isCalling(called)).toBe(true)
    expect(callDrawn(called)).toBe(true)
  })

  test('says nothing before the kitchen is on sale', () => {
    const early = frames(breakAt(2), 2)
    expect(isCalling(early)).toBe(false)
    expect(callDrawn(early)).toBe(false)
  })

  test('hollers once in a break, then hushes for the rest of it', () => {
    const hushed = frames(breakAt(3), FRAMES_PER_CALL)
    expect(isCalling(hushed)).toBe(false)
    expect(callDrawn(hushed)).toBe(false)
    expect(isCalling(frames(hushed, 120))).toBe(false)
  })

  test('hollers again in the next break until the boards are open', () => {
    const hushed = frames(breakAt(3), FRAMES_PER_CALL)
    const nextBreak = frames(
      modifyFields(hushed, { phase: () => breakAt(4).phase }),
      2,
    )
    expect(isCalling(nextBreak)).toBe(true)
  })

  test('stays quiet once the kitchen is open', () => {
    const opened = frames(withKitchenOpen(breakAt(3)), 2)
    expect(isCalling(opened)).toBe(false)
    expect(callDrawn(opened)).toBe(false)
  })

  test('stops when the boards open mid-holler', () => {
    const called = frames(breakAt(3), 2)
    const opened = frames(withKitchenOpen(called), 2)
    expect(callDrawn(opened)).toBe(false)
  })
})

describe('the rooms counter', () => {
  test('reads 1 of 2 before the kitchen is open and 2 of 2 after', () => {
    expect(roomsOf(levelOf(breakAt(3)))).toEqual({ found: 1, total: 2 })
    expect(roomsOf(levelOf(withKitchenOpen(breakAt(3))))).toEqual({
      found: 2,
      total: 2,
    })
  })

  test('shows in a break and not mid-wave', () => {
    const inBreak = breakAt(3)
    const inWave = modifyFields(inBreak, {
      phase: () =>
        Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
    })
    expect(roomsCounterShapes(inBreak, 200, 14).length).toBeGreaterThan(0)
    expect(roomsCounterShapes(inWave, 200, 14)).toEqual([])
  })

  test('sparkles when the kitchen opens, then settles', () => {
    const settled = roomsCounterShapes(withKitchenOpen(breakAt(3)), 200, 14)
    const sparkling = roomsCounterShapes(
      modifyFields(withKitchenOpen(breakAt(3)), {
        kitchenCall: () => KitchenCall.Opened({ ageMs: 100 }),
      }),
      200,
      14,
    )
    expect(sparkling.length).toBeGreaterThan(settled.length)
  })
})

describe('the boards leaking the kitchen', () => {
  test('light and steam show only while the boards are up', () => {
    expect(kitchenLeakShapes(breakAt(3)).length).toBeGreaterThan(0)
    expect(kitchenLeakShapes(withKitchenOpen(breakAt(3)))).toEqual([])
  })

  test('the steam moves on', () => {
    const later = modifyFields(breakAt(3), { elapsedMs: () => 1500 })
    expect(kitchenLeakShapes(later)).not.toEqual(kitchenLeakShapes(breakAt(3)))
  })
})

describe('the smell of soup', () => {
  const near = (current: Model): Model =>
    modifyFocus(current, {
      player: player =>
        modifyFields(player, {
          x: () => BELOW_KITCHEN_DOOR.x,
          y: () => BELOW_KITCHEN_DOOR.y,
        }),
    })

  const beat = (current: Model, elapsedMs: number): Model =>
    modifyFields(current, { elapsedMs: () => elapsedMs })

  test('a pot clatters or simmers at a beat when the player is near', () => {
    const before = near(beat(breakAt(3), 6900))
    const after = near(beat(breakAt(3), 7100))
    expect(Option.isSome(maybeKitchenSound(before, after))).toBe(true)
    expect(maybeKitchenSound(before, before)).toEqual(Option.none())
  })

  test('is silent when the player is far', () => {
    const before = beat(breakAt(3), 6900)
    const after = modifyFocus(beat(breakAt(3), 7100), {
      player: player => modifyFields(player, { x: () => 300, y: () => 170 }),
    })
    expect(Option.isNone(maybeKitchenSound(before, after))).toBe(true)
  })

  test('is silent once the kitchen is open', () => {
    const before = near(withKitchenOpen(beat(breakAt(3), 6900)))
    const after = near(withKitchenOpen(beat(breakAt(3), 7100)))
    expect(Option.isNone(maybeKitchenSound(before, after))).toBe(true)
  })

  test('is silent in a boss fight', () => {
    const bossed = (current: Model): Model =>
      modifyFields(current, {
        boss: () => Boss.Waiting({ door: 'South', waitBelow: 0, hp: 100 }),
      })
    const before = bossed(near(beat(breakAt(3), 6900)))
    const after = bossed(near(beat(breakAt(3), 7100)))
    expect(Option.isNone(maybeKitchenSound(before, after))).toBe(true)
  })
})
