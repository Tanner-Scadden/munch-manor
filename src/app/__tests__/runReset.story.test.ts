import { Array, Effect, Record } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { readyModel } from '../../test/model.fixture'
import {
  APPLICATION,
  closeDialog,
  press,
  release,
  showDialog,
  startRunFromHome,
  ticks,
} from '../../test/testing'
import { modifyFocus } from '../../world/party/party'
import { Message } from '../message'
import { type Model, Phase, TrapNotice, freshLoot } from '../model'

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

const leaveForHome = Story.steps(
  press('Escape'),
  press('KeyH'),
  showDialog(),
  Story.message(Message.ClickedLeaveRunButton()),
  closeDialog(),
)

describe('going home', () => {
  it.effect(
    'resets every run field, and the next run starts like a fresh one',
    () =>
      Effect.gen(function* () {
        const played: Array<Model> = []
        yield* Story.story(
          APPLICATION,
          Story.given(readyModel),
          startRunFromHome,
          press('KeyD'),
          press('KeyS'),
          ...ticks(40, 16),
          release('KeyD'),
          release('KeyS'),
          Story.model(current => {
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
        yield* Story.story(
          APPLICATION,
          Story.given(messy),
          leaveForHome,
          Story.model(current => {
            expect(Phase.guards.Ready(current.phase)).toBe(true)
            expect(runState(current)).toEqual(
              runState({ ...readyModel, loot: freshLoot(current.rngState) }),
            )
            atHome.push(current)
          }),
        )

        const wentHome = atHome[0]!
        const freshStart: Array<Model> = []
        yield* Story.story(
          APPLICATION,
          Story.given({ ...readyModel, rngState: wentHome.rngState }),
          startRunFromHome,
          Story.model(current => {
            freshStart.push(current)
          }),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(wentHome),
          startRunFromHome,
          Story.model(current => {
            expect(Phase.guards.Preparation(current.phase)).toBe(true)
            expect(current.phase).toEqual(freshStart[0]!.phase)
            expect(runState(current)).toEqual(runState(freshStart[0]!))
          }),
        )
      }),
  )
})
