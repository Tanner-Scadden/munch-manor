import { Array, Effect } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { Life, type Model, Phase } from '../../../app/model'
import { FIXED_STEP_MS } from '../../../shared/constants'
import {
  home,
  pastTimedBreaks,
  placeSeat,
  withSeatLife,
} from '../../../test/model.fixture'
import { APPLICATION, tick } from '../../../test/testing'
import { levelOf, startingLevel } from '../../level/arena'
import type { DoorId, PlannedSpawn } from '../../schema/worldSchema'
import { nearDoorsOf } from '../doorWeights'
import { rollWave } from '../endlessWaves'

// NOTE: the whole house open, the default arrangement: the parlour west,
// the library east, the cellar far beyond it.
const OPEN_HOUSE = {
  ...startingLevel,
  openExits: ['Kitchen', 'West', 'East', 'Far'] as const,
}

const CELLAR = { x: 840, y: 90 }
const DINING = { x: 180, y: 110 }
const CELLAR_DOORS: ReadonlyArray<DoorId> = ['FarTop', 'FarBottom']

const inHouseAt = ({ x, y }: { x: number; y: number }): Model =>
  placeSeat(
    modifyFields(pastTimedBreaks(home), {
      level: () => OPEN_HOUSE,
      phase: () => Phase.Wave({ wave: 4, elapsedMs: 0, spawns: [] }),
    }),
    0,
    x,
    y,
  )

const atDoors =
  (doors: ReadonlyArray<DoorId>) =>
  (spawns: ReadonlyArray<PlannedSpawn>): number =>
    Array.filter(spawns, ({ door }) => Array.contains(doors, door)).length

const breakSpawns = (model: Model): ReadonlyArray<PlannedSpawn> =>
  Phase.isAnyOf(['Preparation'])(model.phase) ? model.phase.spawns : []

describe('spawn doors weighted toward the players', () => {
  it('near doors are those of the players room and the open rooms beside it', () => {
    expect(nearDoorsOf(inHouseAt(CELLAR))).toEqual([
      'EastTop',
      'EastBottom',
      'FarTop',
      'FarBottom',
    ])
    const fromDining = nearDoorsOf(inHouseAt(DINING))
    expect(fromDining).toContain('North')
    expect(fromDining).toContain('Back')
    expect(fromDining).toContain('WestTop')
    expect(fromDining).toContain('EastTop')
    expect(fromDining).not.toContain('FarTop')
    expect(fromDining).not.toContain('FarBottom')
  })

  it('a downed player pulls no doors', () => {
    const downed = withSeatLife(
      inHouseAt(CELLAR),
      0,
      Life.Downed({ bleedMs: 1000, reviveMs: 0, callMs: 0 }),
    )
    expect(nearDoorsOf(downed)).toEqual([])
  })

  it('near doors take about twice their share, and all or none near rolls as before', () => {
    const doors = levelOf({ level: OPEN_HOUSE }).doorIds
    const seeds = Array.makeBy(150, seed => seed + 1)
    const share = (near: ReadonlyArray<DoorId>) => {
      const rolls = Array.map(seeds, seed => rollWave(seed, 5, doors, near)[1])
      const total = Array.reduce(
        rolls,
        0,
        (sum, { spawns }) => sum + spawns.length,
      )
      const atCellar = Array.reduce(
        rolls,
        0,
        (sum, { spawns }) => sum + atDoors(CELLAR_DOORS)(spawns),
      )
      return atCellar / total
    }
    const even = share([])
    const weighted = share(CELLAR_DOORS)
    expect(weighted).toBeGreaterThan(even * 1.5)
    expect(weighted).toBeLessThan(even * 2.2)
    expect(rollWave(7, 5, doors, doors)).toEqual(rollWave(7, 5, doors))
  })

  it.effect(
    'the break rolls the next wave toward where the player stands',
    () =>
      Effect.gen(function* () {
        const inCellar = yield* Story.story(
          APPLICATION,
          Story.given(inHouseAt(CELLAR)),
          tick(FIXED_STEP_MS),
        )
        const inDining = yield* Story.story(
          APPLICATION,
          Story.given(inHouseAt(DINING)),
          tick(FIXED_STEP_MS),
        )
        const fromCellar = atDoors(CELLAR_DOORS)(breakSpawns(inCellar))
        const fromDining = atDoors(CELLAR_DOORS)(breakSpawns(inDining))
        expect(breakSpawns(inCellar).length).toBeGreaterThan(0)
        expect(fromCellar).toBeGreaterThan(fromDining)
      }),
  )
})
