import { Array, type Effect, Function } from 'effect'

import { UiStruct } from '@effect/ui'

import { Message } from '../../../app/message'
import { type Model, Phase, RunMode } from '../../../app/model'
import { WriteSave } from '../../../app/update/save'
import { type PlayerChange } from '../../../platform/playerSync'
import { FIXED_STEP_MS } from '../../../shared/constants'
import {
  DISTANT_SPAWN,
  escaping,
  lastHeart,
  readyAfterRead,
  withDareThings,
} from '../../../test/model.fixture'
import {
  type RootStep,
  type StoryStep,
  modelAfter,
  pendingArgsOf,
  send,
  steps,
  tick,
  writeSave,
} from '../../../test/testing'
import { type DareThing, DareThingState } from '../../../world/dare/dareSchema'
import { noKills } from '../../../world/schema/worldSchema'

// What the rank tests (rank.story.test.ts, bonuses.story.test.ts) start
// from: a Normal run at a wave, one that dies on wave 7 (60 points, 6
// Bones), and one about to walk out the front door on wave 10.

export const frame: StoryStep = tick(FIXED_STEP_MS)

// NOTE: a run in `phase` that has cleared `wavesCleared` waves, on Normal.
export const runAt: {
  (wavesCleared: number, bosses: number): (phase: Phase) => Model
  (phase: Phase, wavesCleared: number, bosses: number): Model
} = Function.dual(
  3,
  (phase: Phase, wavesCleared: number, bosses: number): Model =>
    UiStruct.evolve(readyAfterRead, {
      phase: () => phase,
      mode: () => RunMode.Campaign(),
      stats: stats =>
        UiStruct.evolve(stats, {
          wavesCleared: () => wavesCleared,
          kills: () => ({ ...noKills, Boss: bosses }),
        }),
    }),
)

const foundBy0 = DareThingState.Found({ slot: 0 })

export const wave = (number: number): Phase =>
  Phase.Wave({ wave: number, elapsedMs: 4000, spawns: [] })

export const diesOnWave7 = lastHeart(runAt(wave(7), 6, 0))

// NOTE: the dare's three things found.
export const FOUND_THINGS: ReadonlyArray<DareThing> = [
  { id: 0, kind: 'SilverSpoon', state: foundBy0 },
  { id: 1, kind: 'MusicBox', state: foundBy0 },
  { id: 2, kind: 'FamilyPortrait', state: foundBy0 },
]

// NOTE: wave 10 with the list done, Uncle Chunk felled, the front door
// open, and the player on its sill: the next tick walks out.
export const lastWave = escaping(
  withDareThings(
    UiStruct.evolve(
      runAt(
        Phase.Wave({ wave: 10, elapsedMs: 4000, spawns: [DISTANT_SPAWN] }),
        9,
        1,
      ),
      {
        stats: stats =>
          UiStruct.evolve(stats, {
            kills: kills => UiStruct.evolve(kills, { Boss: () => 1 }),
          }),
      },
    ),
    FOUND_THINGS,
  ),
)

// NOTE: the Model one frame after `model`, its run ended and the end saved.
export const ended = (model: Model): Effect.Effect<Model> =>
  modelAfter(model, steps(frame, writeSave))

// NOTE: a step that hands the save's pending changes to a check.
export const checkSavedChanges =
  (check: (changes: ReadonlyArray<PlayerChange>) => void): RootStep =>
  s => {
    check(
      Array.flatMap(pendingArgsOf(WriteSave)(s.pending), ({ changes }) =>
        Array.fromIterable(changes),
      ),
    )
    return s
  }

// NOTE: pause, MENU, and leave the run for home. The menu's dialog opens
// and closes on the Model, with no Command to resolve.
export const leave: StoryStep = steps(
  send(Message.ClickedPauseButton()),
  send(Message.ClickedMenuButton()),
  send(Message.ClickedLeaveRunButton()),
)
