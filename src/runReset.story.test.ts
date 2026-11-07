import { Array, Record } from 'effect'
import { given, message, model, steps, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { update } from './main'
import { Message } from './message'
import { type Model, Phase, TrapNotice, freshLoot } from './model'
import { readyModel } from './model.fixture'
import { modifyFocus } from './party'
import {
  closeDialog,
  press,
  release,
  showDialog,
  startRunFromHome,
  ticks,
} from './testing'

// NOTE: listed here by hand, not read from the reset itself, so a field the
// reset forgets shows up as a difference.
const RUN_FIELDS = [
  'pacing',
  'boss',
  'frenzyPacks',
  'seats',
  'intensity',
  'cameraLean',
  'zombies',
  'bullets',
  'particles',
  'decals',
  'dustCooldownMs',
  'elapsedMs',
  'frameEvents',
  'hitStop',
  'shake',
  'popups',
  'streak',
  'blasts',
  'traps',
  'pickups',
  'loot',
  'callouts',
  'trapNotice',
  'level',
  'debutCard',
  'hintBand',
  'stats',
  'runTally',
  'screenMs',
] as const satisfies ReadonlyArray<keyof Model>

const runState = (current: Model) =>
  Record.fromEntries(Array.map(RUN_FIELDS, field => [field, current[field]]))

const leaveForHome = steps(
  press('Escape'),
  press('KeyH'),
  showDialog(),
  message(Message.ClickedLeaveRunButton()),
  closeDialog(),
)

describe('going home', () => {
  test('resets every run field, and the next run starts like a fresh one', () => {
    const played: Array<Model> = []
    story(
      update,
      given(readyModel),
      startRunFromHome,
      press('KeyD'),
      press('KeyS'),
      ...ticks(40, 16),
      release('KeyD'),
      release('KeyS'),
      model(current => {
        expect(Phase.guards.Preparation(current.phase)).toBe(true)
        expect(current.elapsedMs).toBeGreaterThan(0)
        played.push(current)
      }),
    )
    const messy = modifyFocus(
      modifyFields(played[0]!, {
        cameraLean: () => ({ x: 12, y: -7 }),
        dustCooldownMs: () => 90,
        trapNotice: () =>
          TrapNotice.Refused({ reason: 'No room', remainingMs: 800 }),
        hintBand: () => 'Bottom',
        loot: loot => modifyFields(loot, { dryMs: () => 5000 }),
      }),
      {
        shopCategory: () => 'Traps',
        selectedTrap: () => 'Turret',
        intent: intent =>
          modifyFields(intent, { move: () => ({ x: 1, y: 0 }) }),
      },
    )

    const atHome: Array<Model> = []
    story(
      update,
      given(messy),
      leaveForHome,
      model(current => {
        expect(Phase.guards.Ready(current.phase)).toBe(true)
        expect(runState(current)).toEqual(
          runState({ ...readyModel, loot: freshLoot(current.rngState) }),
        )
        atHome.push(current)
      }),
    )

    const wentHome = atHome[0]!
    const freshStart: Array<Model> = []
    story(
      update,
      given({ ...readyModel, rngState: wentHome.rngState }),
      startRunFromHome,
      model(current => {
        freshStart.push(current)
      }),
    )
    story(
      update,
      given(wentHome),
      startRunFromHome,
      model(current => {
        expect(Phase.guards.Preparation(current.phase)).toBe(true)
        expect(current.phase).toEqual(freshStart[0]!.phase)
        expect(runState(current)).toEqual(runState(freshStart[0]!))
      }),
    )
  })
})
