import { Array, type Effect, Function } from 'effect'

import { UiStruct } from '@effect/ui'

import { Message } from '#app/message.ts'
import { type Model, Phase, RunMode } from '#app/model.ts'
import { WriteSave } from '#app/update/save.ts'
import { type PlayerChange } from '#platform/playerSync.ts'
import { FIXED_STEP_MS } from '#shared/constants.ts'
import {
  DISTANT_SPAWN,
  escaping,
  lastHeart,
  readyAfterRead,
  withDareThings,
} from '#test/model.fixture.ts'
import {
  type RootStep,
  type StoryStep,
  modelAfter,
  pendingArgsOf,
  send,
  steps,
  tick,
  writeSave,
} from '#test/testing.ts'
import { type DareThing, DareThingState } from '#world/dare/dareSchema.ts'
import { noKills } from '#world/schema/worldSchema.ts'

export const frame: StoryStep = tick(FIXED_STEP_MS)

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

export const FOUND_THINGS: ReadonlyArray<DareThing> = [
  { id: 0, kind: 'SilverSpoon', state: foundBy0 },
  { id: 1, kind: 'MusicBox', state: foundBy0 },
  { id: 2, kind: 'FamilyPortrait', state: foundBy0 },
]

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

export const ended = (model: Model): Effect.Effect<Model> =>
  modelAfter(model, steps(frame, writeSave))

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

export const leave: StoryStep = steps(
  send(Message.ClickedPauseButton()),
  send(Message.ClickedMenuButton()),
  send(Message.ClickedLeaveRunButton()),
)
