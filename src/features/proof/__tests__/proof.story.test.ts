import { Array, Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { isPanelOpen } from '../../../app/menuState'
import { Message } from '../../../app/message'
import { type Model, Phase } from '../../../app/model'
import { BIG_KEY, type ProofStamp } from '../../../shared/proofData'
import {
  crewInWave,
  knowingDay,
  readyAfterRead,
  withDareThings,
} from '../../../test/model.fixture'
import {
  checkModel,
  modelAfter,
  send,
  steps,
  storyOf,
  writeSave,
} from '../../../test/testing'
import { type DareThing, DareThingState } from '../../../world/dare/dareSchema'
import { focusOf } from '../../../world/party/party'
import { BOT } from '../../bots/__tests__/bots.fixture'
import {
  checkSavedChanges,
  diesOnWave7,
  frame,
  lastWave,
} from '../../end/__tests__/rank.fixture'
import { type ShelfThing, hasNewProof, maybeStampAt, shelveRun } from '../proof'

// The Proof Shelf's root side (src/features/proof/proof.ts): what a run puts
// on the shelf as it ends, the first stamp a slot keeps, the crew it names,
// and the PROOF card's NEW pip.

const TODAY = '2026-11-13'

const SPOON: DareThing = {
  id: 0,
  kind: 'SilverSpoon',
  state: DareThingState.Found({ slot: 0 }),
}

const HIDDEN_BOX: DareThing = {
  id: 1,
  kind: 'MusicBox',
  state: DareThingState.Hidden({ x: 40, y: 40, workedMs: 0 }),
}

// NOTE: a Normal run about to die on wave 7 with the spoon in hand.
const munchedWithSpoon = knowingDay(
  withDareThings(diesOnWave7, [SPOON, HIDDEN_BOX]),
  TODAY,
)

const SPOON_NORMAL = { thing: 'SilverSpoon', difficulty: 'Normal' } as const

const stampOf = (model: Model, thing: ShelfThing) =>
  maybeStampAt(model.proof, { thing, difficulty: 'Normal' })

describe('a run that ends', () => {
  it.effect(
    'puts a find from a lost run on the shelf, MUNCHED, and saves it once',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(munchedWithSpoon)
        s.pipe(
          frame,
          checkModel(model => {
            expect(Phase.guards.GameOver(model.phase)).toBe(true)
            expect(model.proof).toHaveLength(1)
            expect(maybeStampAt(model.proof, SPOON_NORMAL)).toEqual(
              Option.some<ProofStamp>({
                wave: 7,
                hero: focusOf(munchedWithSpoon).player.calling,
                crew: [],
                day: TODAY,
                ending: 'Munched',
              }),
            )
            expect(stampOf(model, 'MusicBox')).toEqual(Option.none())
            expect(stampOf(model, BIG_KEY)).toEqual(Option.none())
          }),
          checkSavedChanges(changes => {
            expect(
              Array.filter(changes, change => change._tag === 'ShelvedProof'),
            ).toHaveLength(1)
          }),
          writeSave,
          frame,
          checkModel(model => {
            expect(model.proof).toHaveLength(1)
          }),
        )
      }),
  )

  it.effect('keeps the first stamp when a later run finds it again', () =>
    Effect.gen(function* () {
      const first = yield* modelAfter(munchedWithSpoon, steps(frame, writeSave))
      // NOTE: the next day, a run that escapes with the spoon.
      const again = knowingDay(
        UiStruct.evolve(lastWave, { proof: () => first.proof }),
        '2026-11-14',
      )
      const s = yield* storyOf(again)
      s.pipe(
        frame,
        checkModel(model => {
          expect(Phase.guards.Escaped(model.phase)).toBe(true)
          expect(
            Option.map(stampOf(model, 'SilverSpoon'), stamp => stamp.ending),
          ).toEqual(Option.some('Munched'))
          expect(
            Option.map(stampOf(model, 'MusicBox'), stamp => stamp.ending),
          ).toEqual(Option.some('Escaped'))
          expect(
            Option.map(stampOf(model, BIG_KEY), stamp => stamp.day),
          ).toEqual(Option.some('2026-11-14'))
        }),
        writeSave,
      )
    }),
  )

  it.effect('a run left from the pause menu shelves nothing', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(munchedWithSpoon)
      s.pipe(
        send(Message.ClickedPauseButton()),
        send(Message.ClickedMenuButton()),
        checkModel(model => {
          expect(model.proof).toEqual([])
        }),
      )
    }),
  )
})

describe('the crew on a stamp', () => {
  it('names the other seats as this player saw them, a bot marked a bot', () => {
    const crew = UiStruct.evolve(withDareThings(crewInWave(3), [SPOON]), {
      runStart: UiStruct.evolve({ crewBots: () => [BOT, BOT] }),
    })
    const over = UiStruct.evolve(crew, {
      phase: () => Phase.GameOver({ wave: 3 }),
    })
    const shelved = shelveRun(crew, over)
    expect(Option.map(stampOf(shelved, 'SilverSpoon'), s => s.crew)).toEqual(
      Option.some([
        { name: 'GIZMO', isBot: true },
        { name: 'GIZMO', isBot: true },
      ]),
    )
  })

  it('stamps nothing on a frame that is not the end', () => {
    const run = withDareThings(crewInWave(1), [SPOON])
    expect(shelveRun(run, run).proof).toEqual([])
  })
})

describe('the NEW pip', () => {
  const shelvedSpoon = {
    ...SPOON_NORMAL,
    stamp: {
      wave: 7,
      hero: 'You',
      crew: [],
      day: TODAY,
      ending: 'Munched',
    } satisfies ProofStamp,
  }

  it.effect('shows once a find is shelved and clears when PROOF opens', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        UiStruct.evolve(knowingDay(readyAfterRead, TODAY), {
          proof: () => [shelvedSpoon],
        }),
      )
      s.pipe(
        checkModel(model => {
          expect(hasNewProof(model)).toBe(true)
        }),
        send(Message.ClickedProofButton()),
        checkModel(model => {
          expect(isPanelOpen(model, 'Proof')).toBe(true)
          expect(hasNewProof(model)).toBe(false)
          expect(model.freshUnlocks).toContain('proof:SilverSpoon:Normal')
        }),
        writeSave,
      )
    }),
  )

  it('a day of missions done shows on it too', () => {
    const stamped = UiStruct.evolve(knowingDay(readyAfterRead, TODAY), {
      missions: missions =>
        UiStruct.evolve(missions, { stampedDays: () => [TODAY] }),
    })
    expect(hasNewProof(readyAfterRead)).toBe(false)
    expect(hasNewProof(stamped)).toBe(true)
  })
})
