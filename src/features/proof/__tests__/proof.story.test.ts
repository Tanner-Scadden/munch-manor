import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

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
import { APPLICATION, showDialog, writeSave } from '../../../test/testing'
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
      Story.story(
        APPLICATION,
        Story.given(munchedWithSpoon),
        frame,
        Story.model(model => {
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
        writeSave(),
        frame,
        Story.model(model => {
          expect(model.proof).toHaveLength(1)
        }),
      ),
  )

  it.effect('keeps the first stamp when a later run finds it again', () =>
    Effect.gen(function* () {
      const first = yield* Story.story(
        APPLICATION,
        Story.given(munchedWithSpoon),
        frame,
        writeSave(),
      )
      // NOTE: the next day, a run that escapes with the spoon.
      const again = knowingDay(
        modifyFields(lastWave, { proof: () => first.proof }),
        '2026-11-14',
      )
      return yield* Story.story(
        APPLICATION,
        Story.given(again),
        frame,
        Story.model(model => {
          expect(Phase.guards.Escaped(model.phase)).toBe(true)
          expect(
            Option.map(stampOf(model, 'SilverSpoon'), s => s.ending),
          ).toEqual(Option.some('Munched'))
          expect(Option.map(stampOf(model, 'MusicBox'), s => s.ending)).toEqual(
            Option.some('Escaped'),
          )
          expect(Option.map(stampOf(model, BIG_KEY), s => s.day)).toEqual(
            Option.some('2026-11-14'),
          )
        }),
        writeSave(),
      )
    }),
  )

  it.effect('a run left from the pause menu shelves nothing', () =>
    Story.story(
      APPLICATION,
      Story.given(munchedWithSpoon),
      Story.message(Message.ClickedPauseButton()),
      Story.message(Message.ClickedMenuButton()),
      showDialog(),
      Story.model(model => {
        expect(model.proof).toEqual([])
      }),
    ),
  )
})

describe('the crew on a stamp', () => {
  it('names the other seats as this player saw them, a bot marked a bot', () => {
    const crew = modifyFields(withDareThings(crewInWave(3), [SPOON]), {
      crewBots: () => [BOT, BOT],
    })
    const over = modifyFields(crew, {
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
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(knowingDay(readyAfterRead, TODAY), {
          proof: () => [shelvedSpoon],
        }),
      ),
      Story.model(model => {
        expect(hasNewProof(model)).toBe(true)
      }),
      Story.message(Message.ClickedProofButton()),
      showDialog(),
      Story.model(model => {
        expect(isPanelOpen(model, 'Proof')).toBe(true)
        expect(hasNewProof(model)).toBe(false)
        expect(model.freshUnlocks).toContain('proof:SilverSpoon:Normal')
      }),
      writeSave(),
    ),
  )

  it('a day of missions done shows on it too', () => {
    const stamped = modifyFields(knowingDay(readyAfterRead, TODAY), {
      missions: missions =>
        modifyFields(missions, { stampedDays: () => [TODAY] }),
    })
    expect(hasNewProof(readyAfterRead)).toBe(false)
    expect(hasNewProof(stamped)).toBe(true)
  })
})
