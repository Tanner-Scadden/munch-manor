import { Array, Effect, Option, Result } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import type { Difficulty } from '../../../app/model'
import { FIXED_STEP_MS } from '../../../shared/constants'
import {
  atCase,
  atStove,
  kitchenBreak,
  quietWave,
  readyModel,
  withDareThings,
} from '../../../test/model.fixture'
import {
  APPLICATION,
  settleRunCommands,
  startRunFromHome,
  tagsOf,
  tick,
} from '../../../test/testing'
import { caseFootOf, caseRoomOf } from '../../feats/caseSpots'
import { stoveBoxOf } from '../../kitchen/stove'
import { levelOf } from '../../level/arena'
import { focusOf } from '../../party/party'
import { CaseState } from '../../schema/worldSchema'
import { DARE_WAYS, roomDepthOf, spotsOf } from '../dare'
import { type DareThing, DareThingState } from '../dareSchema'

// The dare's things that come out of the house's fixtures
// (src/world/dare/dareCases.ts): the guest book's page from a display case,
// Grandma's recipe from the stove, a thing off the list delivered to a case,
// and where the roll puts things (deeper rooms more).

const FRAME_MS = FIXED_STEP_MS

const thing = (
  kind: DareThing['kind'],
  state: DareThingState,
  isAsked = true,
): DareThing => ({ id: 0, kind, isAsked, state })

const startedOn = (difficulty: Difficulty, seed: number) =>
  Story.story(
    APPLICATION,
    Story.given(
      modifyFields(readyModel, {
        rngState: () => seed,
        difficulty: setting =>
          modifyFields(setting, { chosen: () => difficulty }),
      }),
    ),
    startRunFromHome,
    settleRunCommands,
  )

describe('the guest book page in its case', () => {
  it.effect('stays locked in while the case is shut', () =>
    Story.story(
      APPLICATION,
      Story.given(
        withDareThings(
          atCase(
            modifyFields(quietWave(3), { phase: () => kitchenBreak(3) }),
            'Shotgun',
            CaseState.Locked(),
          ),
          [thing('GuestBookPage', DareThingState.InCase({ caseId: 0 }))],
        ),
      ),
      tick(FRAME_MS),
      Story.model(current => {
        expect(current.dareThings[0]?.state).toEqual(
          DareThingState.InCase({ caseId: 0 }),
        )
      }),
    ),
  )

  it.effect('falls out in front of it once the case opens', () =>
    Story.story(
      APPLICATION,
      Story.given(
        withDareThings(
          atCase(
            modifyFields(quietWave(3), { phase: () => kitchenBreak(3) }),
            'Shotgun',
            CaseState.Opened({ by: 0 }),
          ),
          [thing('GuestBookPage', DareThingState.InCase({ caseId: 0 }))],
        ),
      ),
      tick(FRAME_MS),
      Story.model(current => {
        const state = current.dareThings[0]?.state
        const foot = Option.getOrThrow(
          Option.map(Array.head(current.cases), displayCase =>
            caseFootOf(levelOf(current), displayCase),
          ),
        )
        expect(
          state !== undefined && DareThingState.isAnyOf(['Dropped'])(state),
        ).toBe(true)
        if (state !== undefined && DareThingState.isAnyOf(['Dropped'])(state)) {
          expect(state.x).toBe(foot.x)
          expect(state.y).toBeGreaterThan(foot.y)
        }
      }),
    ),
  )
})

describe('a thing off the list delivered to a case', () => {
  it.effect('opens the case for whoever brought it, whatever its feat', () =>
    Story.story(
      APPLICATION,
      Story.given(
        withDareThings(
          atCase(
            modifyFields(quietWave(3), { phase: () => kitchenBreak(3) }),
            'Shotgun',
            CaseState.Locked(),
          ),
          [thing('MusicBox', DareThingState.Held({ slot: 0 }), false)],
        ),
      ),
      tick(FRAME_MS),
      Story.model(current => {
        expect(current.dareThings[0]?.state).toEqual(
          DareThingState.Delivered({ slot: 0 }),
        )
        expect(current.cases[0]?.state).toEqual(CaseState.Opened({ by: 0 }))
        expect(focusOf(current).feats.delivered).toBe(1)
        expect(tagsOf(current.frameEvents)).toEqual(
          expect.arrayContaining(['DareDelivered', 'CaseOpened']),
        )
      }),
    ),
  )

  it.effect('a case already open takes nothing', () =>
    Story.story(
      APPLICATION,
      Story.given(
        withDareThings(
          atCase(
            modifyFields(quietWave(3), { phase: () => kitchenBreak(3) }),
            'Shotgun',
            CaseState.Opened({ by: 0 }),
          ),
          [thing('MusicBox', DareThingState.Held({ slot: 0 }), false)],
        ),
      ),
      tick(FRAME_MS),
      Story.model(current => {
        expect(current.dareThings[0]?.state).toEqual(
          DareThingState.Held({ slot: 0 }),
        )
        expect(focusOf(current).feats.delivered).toBe(0)
      }),
    ),
  )
})

describe("Grandma's recipe in the stove", () => {
  it.effect('cooks out once a player has earned the stove', () =>
    Story.story(
      APPLICATION,
      Story.given(
        withDareThings(atStove(0), [
          thing('GrandmasRecipe', DareThingState.InStove()),
        ]),
      ),
      tick(FRAME_MS),
      Story.model(current => {
        const state = current.dareThings[0]?.state
        const box = Option.getOrThrow(stoveBoxOf(current))
        expect(
          state !== undefined && DareThingState.isAnyOf(['Dropped'])(state),
        ).toBe(true)
        if (state !== undefined && DareThingState.isAnyOf(['Dropped'])(state)) {
          expect(state.y).toBeGreaterThan(box.bottom)
        }
        expect(tagsOf(current.frameEvents)).toContain('DareDropped')
      }),
    ),
  )

  it.effect('stays in the stove before the stove is earned', () =>
    Story.story(
      APPLICATION,
      Story.given(
        withDareThings(
          modifyFields(atStove(0), {
            seats: seats =>
              Array.map(seats, seat =>
                modifyFields(seat, {
                  feats: feats =>
                    modifyFields(feats, { kitchenKills: () => 0 }),
                }),
              ),
          }),
          [thing('GrandmasRecipe', DareThingState.InStove())],
        ),
      ),
      tick(FRAME_MS),
      Story.model(current => {
        expect(current.dareThings[0]?.state).toEqual(DareThingState.InStove())
      }),
    ),
  )
})

describe('where the roll puts things', () => {
  it('every room has its hiding spots, behind boards but the start', () => {
    const level = levelOf(quietWave(2))
    const spots = spotsOf(level)
    expect(spots).toHaveLength(20)
    expect(Array.filter(spots, ({ depth }) => depth === 0)).toHaveLength(4)
    expect(Array.filter(spots, ({ depth }) => depth === 2)).toHaveLength(4)
  })

  it.effect(
    'a run hides most of the hunt behind boards, the deepest rooms the most',
    () =>
      Effect.gen(function* () {
        const runs = yield* Effect.forEach(Array.range(1, 12), seed =>
          startedOn('Nightmare', seed * 6151),
        )
        const hidden = Array.flatMap(runs, run =>
          Array.filterMap(run.dareThings, ({ isAsked, state }) =>
            isAsked && DareThingState.isAnyOf(['Hidden'])(state)
              ? Result.succeed(
                  Option.getOrElse(
                    Option.map(
                      Array.findFirst(
                        spotsOf(levelOf(run)),
                        ({ point }) =>
                          point.x === state.x && point.y === state.y,
                      ),
                      ({ depth }) => depth,
                    ),
                    () => 0,
                  ),
                )
              : Result.failVoid,
          ),
        )
        const behind = Array.filter(hidden, depth => depth > 0)
        expect(hidden.length).toBeGreaterThan(0)
        const deepest = Array.filter(hidden, depth => depth > 1)
        expect(behind.length / hidden.length).toBeGreaterThan(0.92)
        expect(deepest.length / hidden.length).toBeGreaterThan(0.35)
      }),
  )

  it.effect('the guest book page locks in a case behind boards', () =>
    Effect.gen(function* () {
      const runs = yield* Effect.forEach(Array.range(1, 12), seed =>
        startedOn('Nightmare', seed * 7907),
      )
      const pages = Array.flatMap(runs, run =>
        Array.filterMap(run.dareThings, ({ kind, state }) =>
          DARE_WAYS[kind] === 'InCase' &&
          DareThingState.isAnyOf(['InCase'])(state)
            ? Result.fromOption(
                Option.map(
                  Array.findFirst(run.cases, ({ id }) => id === state.caseId),
                  displayCase =>
                    roomDepthOf(
                      levelOf(run).spec,
                      caseRoomOf(levelOf(run), displayCase),
                    ),
                ),
                () => undefined,
              )
            : Result.failVoid,
        ),
      )
      expect(pages.length).toBeGreaterThan(0)
      expect(Array.every(pages, depth => depth > 0)).toBe(true)
    }),
  )
})
