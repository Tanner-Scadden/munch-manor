import { Array, Effect, Option, Record } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../app/message'
import { Life, type Model } from '../../app/model'
import { FIXED_STEP_MS } from '../../shared/constants'
import {
  armedBreak,
  crewInWave,
  hidingSpotIn,
  pipeline,
  placeSeat,
  quietWave,
  roomOpenIn,
  withDareThings,
  withPlayerAt,
  withSeatLife,
} from '../../test/model.fixture'
import {
  checkModel,
  modelAfter,
  send,
  settleRunCommands,
  steps,
  ticks,
} from '../../test/testing'
import { DareThingState } from '../../world/dare/dareSchema'
import { FIND_RULES } from '../../world/dare/finds'
import { levelOf } from '../../world/level/arena'
import { DEFAULT_ARRANGEMENT, PARLOUR_ROOM_ID } from '../../world/level/plan'
import { COOP_RULES, modifyFocus } from '../../world/party/party'
import { Purchasable, Purchase } from '../../world/schema/worldSchema'
import {
  atTool,
  houseWave,
} from '../../world/stations/__tests__/roomTools.fixture'
import {
  ActionPose,
  MOTIONS,
  PAYOFF_MS,
  motionFrameOf,
  poseOf,
} from '../actionPose'
import { noActionWatch } from '../renderSchema'

const FRAME_MS = FIXED_STEP_MS
const LEFT_X = 60
const ROW_Y = 104

const poseAt = (model: Model, slot: number): ActionPose =>
  poseOf(model, model.cosmetics.actionWatch, slot)

const motionOf = (pose: ActionPose): Option.Option<string> =>
  ActionPose.isAnyOf(['Working'])(pose)
    ? Option.some(pose.motion)
    : Option.none()

const payoffsOf = (model: Model, slot: number): ReadonlyArray<string> =>
  Array.map(
    Array.filter(model.cosmetics.actionWatch.beats, beat => beat.slot === slot),
    ({ payoff }) => payoff,
  )

describe('a motion', () => {
  it.effect('quickens as its work nears done', () =>
    Effect.sync(() => {
      const changesOver = (share: number): number =>
        Array.reduce(
          Array.makeBy(400, step => step * 10),
          { changes: 0, last: 0 },
          (seen, ms) => {
            const frame = motionFrameOf('Crank', share, ms)
            return {
              changes: seen.changes + (frame === seen.last ? 0 : 1),
              last: frame,
            }
          },
        ).changes
      expect(changesOver(0.9)).toBeGreaterThan(changesOver(0.1))
    }),
  )

  it.effect('loops two to four frames, each motion its own', () =>
    Effect.sync(() => {
      Array.forEach(Record.values(MOTIONS), ({ frames }) => {
        expect(frames.length).toBeGreaterThanOrEqual(2)
        expect(frames.length).toBeLessThanOrEqual(4)
      })
    }),
  )
})

describe('CPR', () => {
  const beside = pipeline(
    placeSeat(0, LEFT_X, ROW_Y),
    placeSeat(1, LEFT_X + 8, ROW_Y, 0),
    withSeatLife(
      1,
      Life.Downed({ bleedMs: COOP_RULES.bleedOutMs, reviveMs: 0, callMs: 0 }),
    ),
  )(crewInWave(2))

  it.effect(
    'the reviver kneels and pushes on the chest, facing the body, then pumps a fist as they spring up',
    () =>
      modelAfter(
        beside,
        steps(
          ticks(Math.floor(COOP_RULES.reviveMs / FRAME_MS / 2), FRAME_MS),
          checkModel(current => {
            const pose = poseAt(current, 0)
            expect(motionOf(pose)).toEqual(Option.some('Compress'))
            expect(ActionPose.isAnyOf(['Working'])(pose) && pose.facing).toBe(
              'Right',
            )
            expect(
              ActionPose.isAnyOf(['Working'])(pose) && pose.share,
            ).toBeCloseTo(0.5, 1)
          }),
          ticks(Math.ceil(COOP_RULES.reviveMs / FRAME_MS / 2) + 2, FRAME_MS),
          settleRunCommands,
          checkModel(current => {
            expect(payoffsOf(current, 0)).toEqual(['FistPump'])
            expect(payoffsOf(current, 1)).toEqual(['SpringUp'])
            expect(poseAt(current, 0)._tag).toBe('Beat')
          }),
        ),
      ),
  )

  it.effect('a blow lands once each time the push comes round', () =>
    modelAfter(
      beside,
      steps(
        ticks(Math.floor(COOP_RULES.reviveMs / FRAME_MS / 2), FRAME_MS),
        checkModel(current => {
          expect(current.cosmetics.actionWatch.working).toEqual([
            expect.objectContaining({ slot: 0, motion: 'Compress' }),
          ])
        }),
      ),
    ),
  )
})

describe('a find', () => {
  const spot = hidingSpotIn(levelOf(quietWave(3)), PARLOUR_ROOM_ID)
  const atTrunk = withPlayerAt(
    UiStruct.evolve(
      withDareThings(quietWave(3), [
        {
          id: 0,
          kind: 'SilverSpoon',
          state: DareThingState.Hidden({ ...spot, workedMs: 0 }),
        },
      ]),
      { level: () => roomOpenIn(DEFAULT_ARRANGEMENT, 'Parlour') },
    ),
    spot.x,
    spot.y,
  )

  it.effect(
    'rummages the trunk while it is worked, then holds the thing up overhead',
    () =>
      modelAfter(
        atTrunk,
        steps(
          ticks(10, FRAME_MS),
          checkModel(current => {
            expect(motionOf(poseAt(current, 0))).toEqual(Option.some('Rummage'))
          }),
          ticks(Math.ceil(FIND_RULES.Rummage.workMs / FRAME_MS), FRAME_MS),
          settleRunCommands,
          checkModel(current => {
            const pose = poseAt(current, 0)
            expect(pose._tag).toBe('Beat')
            expect(
              ActionPose.isAnyOf(['Beat'])(pose) && pose.maybeThing,
            ).toEqual(Option.some('SilverSpoon'))
          }),
        ),
      ),
  )
})

describe('a room tool', () => {
  const CASES = [
    ['Gramophone', 'Crank'],
    ['NorthStack', 'Shove'],
    ['Shelf', 'Push'],
    ['Barrels', 'Shove'],
    ['Bulb', 'Pull'],
    ['SoupPot', 'Stir'],
  ] as const

  it.effect('each is worked with its own motion', () =>
    Effect.forEach(CASES, ([id, motion]) =>
      modelAfter(
        atTool(houseWave, id),
        steps(
          ticks(6, FRAME_MS),
          checkModel(current => {
            expect(motionOf(poseAt(current, 0))).toEqual(Option.some(motion))
          }),
        ),
      ),
    ),
  )
})

describe('a hold to buy', () => {
  const CASES = [
    [Purchasable.Fridge(), 'Pull'],
    [Purchasable.Stove(), 'Stir'],
    [Purchasable.Valve(), 'Crank'],
    [Purchasable.Case({ id: 0 }), 'Pry'],
  ] as const

  it.effect('works the thing bought, filling with the hold', () =>
    Effect.sync(() => {
      Array.forEach(CASES, ([target, motion]) => {
        const holding = modifyFocus(quietWave(3), {
          purchase: () => Purchase.Holding({ target, heldMs: 100 }),
        })
        expect(motionOf(poseAt(holding, 0))).toEqual(Option.some(motion))
      })
    }),
  )

  it.effect('stands as usual with nothing to do', () =>
    Effect.sync(() => {
      expect(poseOf(quietWave(3), noActionWatch, 0)).toEqual(ActionPose.Ready())
    }),
  )
})

describe('a swap', () => {
  it.effect('tosses the gun for a beat, then stands as usual', () =>
    modelAfter(
      armedBreak,
      steps(
        ticks(1, FRAME_MS),
        send(Message.ClickedSwapButton()),
        ticks(1, FRAME_MS),
        settleRunCommands,
        checkModel(current => {
          expect(payoffsOf(current, 0)).toEqual(['Swap'])
        }),
        ticks(Math.ceil(PAYOFF_MS.Swap / FRAME_MS) + 1, FRAME_MS),
        settleRunCommands,
        checkModel(current => {
          expect(payoffsOf(current, 0)).toEqual([])
          expect(poseAt(current, 0)).toEqual(ActionPose.Ready())
        }),
      ),
    ),
  )
})
