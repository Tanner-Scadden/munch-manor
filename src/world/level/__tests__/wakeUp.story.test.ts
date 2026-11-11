import { Array, Effect } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { type Model, Phase, type PlannedSpawn } from '../../../app/model'
import { FIXED_STEP_MS, PACK_WARNING_MS } from '../../../shared/constants'
import {
  DISTANT_SPAWN,
  crewInWave,
  freshRunModel,
  pastTimedBreaks,
  placeSeat,
  withKeys,
} from '../../../test/model.fixture'
import {
  APPLICATION,
  BELOW_KITCHEN_DOOR,
  holdToBuy,
  settleRunCommands,
  startWave,
  tick,
} from '../../../test/testing'
import { modifyFocus } from '../../party/party'
import { withWorld } from '../../schema/world'
import { EXIT_RULES } from '../exits'
import { WAKE_RULES, isWakePack, wakeRoom } from '../wakeUp'

// Opening a room wakes it (src/world/level/wakeUp.ts): a rush of about
// 10 s from the opened room's own doors. Opened mid-wave, it comes as soon
// as its doors have rattled; opened in a break, it comes as the next wave
// starts. The rush is the round's own planned spawns, drawn from the run's
// seeded generator.

const KEYS = EXIT_RULES.kitchenKeys + 2

const isKitchenDoor = ({ door }: PlannedSpawn): boolean =>
  door === 'Back' || door === 'Window'

const spawnsOf = (model: Model): ReadonlyArray<PlannedSpawn> =>
  Phase.isAnyOf(['Preparation', 'Wave'])(model.phase) ? model.phase.spawns : []

const rushOf = (model: Model): ReadonlyArray<PlannedSpawn> =>
  Array.filter(spawnsOf(model), ({ pack }) => isWakePack(pack))

const atKitchenBoards = (phase: Phase): Model =>
  modifyFocus(
    modifyFields(withKeys(pastTimedBreaks(freshRunModel()), KEYS), {
      phase: () => phase,
    }),
    {
      player: player =>
        modifyFields(player, {
          x: () => BELOW_KITCHEN_DOOR.x,
          y: () => BELOW_KITCHEN_DOOR.y,
        }),
    },
  )

const WAVE_CLOCK_MS = 4000

const fighting = atKitchenBoards(
  Phase.Wave({ wave: 4, elapsedMs: WAVE_CLOCK_MS, spawns: [DISTANT_SPAWN] }),
)

const resting = atKitchenBoards(
  Phase.Preparation({
    wave: 4,
    remainingMs: 15_000,
    durationMs: 20_000,
    spawns: [DISTANT_SPAWN],
  }),
)

const bought = (model: Model) =>
  Story.story(APPLICATION, Story.given(model), holdToBuy, settleRunCommands)

describe('opening a room wakes it', () => {
  it.effect(
    'mid-wave: a rush from its own doors, after their warning, over about 10 s',
    () =>
      Effect.gen(function* () {
        const after = yield* bought(fighting)
        const rush = rushOf(after)
        expect(rush).toHaveLength(WAKE_RULES.count)
        expect(Array.every(rush, isKitchenDoor)).toBe(true)
        expect(Array.some(rush, ({ door }) => door === 'Back')).toBe(true)
        expect(Array.some(rush, ({ door }) => door === 'Window')).toBe(true)
        const times = Array.map(rush, ({ atMs }) => atMs)
        const clockMs = Phase.isAnyOf(['Wave'])(after.phase)
          ? after.phase.elapsedMs
          : 0
        expect(Math.min(...times)).toBeGreaterThanOrEqual(
          clockMs + PACK_WARNING_MS - 20,
        )
        expect(Math.max(...times) - Math.min(...times)).toBeLessThan(
          WAKE_RULES.rushMs,
        )
        expect(Math.max(...times) - Math.min(...times)).toBeGreaterThan(
          WAKE_RULES.rushMs / 2,
        )
      }),
  )

  it.effect(
    'in a break: the room stirs, and the rush comes as the next wave starts',
    () =>
      Effect.gen(function* () {
        const after = yield* bought(resting)
        expect(Phase.isAnyOf(['Preparation'])(after.phase)).toBe(true)
        const rush = rushOf(after)
        expect(rush).toHaveLength(WAKE_RULES.count)
        expect(Array.every(rush, isKitchenDoor)).toBe(true)
        expect(Math.min(...Array.map(rush, ({ atMs }) => atMs))).toBe(
          PACK_WARNING_MS,
        )
        const started = yield* Story.story(
          APPLICATION,
          Story.given(after),
          startWave,
          settleRunCommands,
        )
        expect(Phase.isAnyOf(['Wave'])(started.phase)).toBe(true)
        expect(rushOf(started)).toEqual(rush)
      }),
  )

  it.effect('the same run wakes the same rush; another seed, another', () =>
    Effect.gen(function* () {
      const first = yield* bought(fighting)
      const again = yield* bought(fighting)
      expect(rushOf(again)).toEqual(rushOf(first))
      const other = yield* bought(
        modifyFields(fighting, { rngState: seed => seed + 7919 }),
      )
      expect(Array.map(rushOf(other), ({ offset }) => offset)).not.toEqual(
        Array.map(rushOf(first), ({ offset }) => offset),
      )
    }),
  )

  it.effect('a wave does not clear while its rush is still to come', () => {
    const emptyWave = modifyFields(fighting, {
      phase: () => Phase.Wave({ wave: 4, elapsedMs: 0, spawns: [] }),
    })
    const woken = withWorld(emptyWave, world => wakeRoom(world, ['Back']))
    return Effect.gen(function* () {
      const cleared = yield* Story.story(
        APPLICATION,
        Story.given(emptyWave),
        tick(FIXED_STEP_MS),
        settleRunCommands,
      )
      const held = yield* Story.story(
        APPLICATION,
        Story.given(woken),
        tick(FIXED_STEP_MS),
        settleRunCommands,
      )
      expect(Phase.isAnyOf(['Preparation'])(cleared.phase)).toBe(true)
      expect(Phase.isAnyOf(['Wave'])(held.phase)).toBe(true)
      expect(rushOf(held)).toHaveLength(WAKE_RULES.count)
    })
  })
})

describe('a wake-up in co-op', () => {
  it.effect('a bigger crew wakes a bigger rush', () =>
    Effect.sync(() => {
      const crew = placeSeat(crewInWave(2), 1, 40, 40)
      const woken = withWorld(crew, world => wakeRoom(world, ['Back']))
      const alone = withWorld(fighting, world => wakeRoom(world, ['Back']))
      expect(rushOf(woken)).toHaveLength(
        WAKE_RULES.count + WAKE_RULES.perExtraPlayer,
      )
      expect(rushOf(alone)).toHaveLength(WAKE_RULES.count)
    }),
  )

  it.effect('an opening with no doors of its own wakes nothing', () =>
    Effect.sync(() => {
      expect(withWorld(fighting, world => wakeRoom(world, []))).toEqual(
        fighting,
      )
    }),
  )
})
