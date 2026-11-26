import { Array, Effect, Record } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { readyModel } from '../../test/model.fixture'
import {
  checkModel,
  modelAfter,
  press,
  release,
  send,
  settleRunCommands,
  startRunFromHome,
  steps,
  ticks,
} from '../../test/testing'
import { modifyFocus } from '../../world/party/party'
import { Message } from '../message'
import { type Model, Phase, TrapNotice, freshLevel, freshLoot } from '../model'

const RUN_FIELDS = [
  'pacing',
  'boss',
  'frenzyPacks',
  'seats',
  'intensity',
  'cameraLean',
  'cameraGlide',
  'zombies',
  'bullets',
  'elapsedMs',
  'frameEvents',
  'hitStop',
  'shake',
  'streak',
  'traps',
  'pickups',
  'loot',
  'level',
  'debutCard',
  'hintBand',
  'stats',
  'screenMs',
] as const satisfies ReadonlyArray<keyof Model>

const runState = (current: Model) => ({
  ...Record.fromEntries(
    Array.map(RUN_FIELDS, field => [field, current[field]]),
  ),
  runTally: current.runGains.runTally,
  particles: current.cosmetics.particles,
  decals: current.cosmetics.decals,
  dustCooldownMs: current.cosmetics.dustCooldownMs,
  popups: current.cosmetics.popups,
  blasts: current.cosmetics.blasts,
  callouts: current.cosmetics.callouts,
  trapNotice: current.cosmetics.trapNotice,
})

const leaveForHome = steps(
  press('Escape'),
  settleRunCommands,
  press('KeyH'),
  settleRunCommands,
  send(Message.ClickedLeaveRunButton()),
  settleRunCommands,
)

describe('going home', () => {
  it.effect(
    'resets every run field, and the next run starts like a fresh one',
    () =>
      Effect.gen(function* () {
        const played = yield* modelAfter(
          readyModel,
          steps(
            startRunFromHome,
            settleRunCommands,
            press('KeyD'),
            press('KeyS'),
            ticks(40, 16),
            settleRunCommands,
            release('KeyD'),
            release('KeyS'),
            settleRunCommands,
            checkModel(current => {
              expect(Phase.guards.Preparation(current.phase)).toBe(true)
              expect(current.elapsedMs).toBeGreaterThan(0)
            }),
          ),
        )
        const messy = modifyFocus(
          UiStruct.evolve(played, {
            cameraLean: () => ({ x: 12, y: -7 }),
            cameraGlide: () => ({
              offset: { x: 40, y: 9 },
              velocity: { x: -3, y: 1 },
            }),
            hintBand: () => 'Bottom',
            loot: loot => UiStruct.evolve(loot, { dryMs: () => 5000 }),
            cosmetics: cosmetics =>
              UiStruct.evolve(cosmetics, {
                dustCooldownMs: () => 90,
                trapNotice: () =>
                  TrapNotice.Refused({ reason: 'No room', remainingMs: 800 }),
              }),
          }),
          {
            selectedTrap: () => 'Turret',
            intent: intent =>
              UiStruct.evolve(intent, { move: () => ({ x: 1, y: 0 }) }),
          },
        )

        const wentHome = yield* modelAfter(
          messy,
          steps(
            leaveForHome,
            checkModel(current => {
              expect(Phase.guards.Ready(current.phase)).toBe(true)
              expect(runState(current)).toEqual(
                runState({
                  ...readyModel,
                  loot: freshLoot(current.rngState),
                  level: freshLevel(current.rngState),
                }),
              )
            }),
          ),
        )

        const freshStart = yield* modelAfter(
          { ...readyModel, rngState: wentHome.rngState },
          steps(startRunFromHome, settleRunCommands),
        )
        const again = yield* modelAfter(
          wentHome,
          steps(startRunFromHome, settleRunCommands),
        )
        expect(Phase.guards.Preparation(again.phase)).toBe(true)
        expect(again.phase).toEqual(freshStart.phase)
        expect(runState(again)).toEqual(runState(freshStart))
      }),
  )
})
