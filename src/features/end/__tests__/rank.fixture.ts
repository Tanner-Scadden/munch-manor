import { Array, Function, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

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
  APPLICATION,
  closeDialog,
  showDialog,
  tick,
  writeSave,
} from '../../../test/testing'
import { type DareThing, DareThingState } from '../../../world/dare/dareSchema'
import { noKills } from '../../../world/schema/worldSchema'

// What the rank tests (rank.story.test.ts, bonuses.story.test.ts) start
// from: a Normal run at a wave, one that dies on wave 7 (60 points, 6
// Bones), and one about to walk out the front door on wave 10.

export const frame = tick(FIXED_STEP_MS)

// NOTE: a run in `phase` that has cleared `wavesCleared` waves, on Normal.
export const runAt: {
  (wavesCleared: number, bosses: number): (phase: Phase) => Model
  (phase: Phase, wavesCleared: number, bosses: number): Model
} = Function.dual(
  3,
  (phase: Phase, wavesCleared: number, bosses: number): Model =>
    modifyFields(readyAfterRead, {
      phase: () => phase,
      mode: () => RunMode.Campaign(),
      stats: stats =>
        modifyFields(stats, {
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
    modifyFields(
      runAt(
        Phase.Wave({ wave: 10, elapsedMs: 4000, spawns: [DISTANT_SPAWN] }),
        9,
        1,
      ),
      {
        stats: stats =>
          modifyFields(stats, {
            kills: kills => modifyFields(kills, { Boss: () => 1 }),
          }),
      },
    ),
    FOUND_THINGS,
  ),
)

// NOTE: the Model one frame after `model`, its run ended and the end saved.
export const ended = (model: Model) =>
  Story.story(APPLICATION, Story.given(model), frame, writeSave())

// NOTE: a step that hands the save's pending changes to a check.
export const checkSavedChanges =
  (check: (changes: ReadonlyArray<PlayerChange>) => void) =>
  <StoryModel, StoryMessage, OutMessage>(
    simulation: Story.StorySimulation<StoryModel, StoryMessage, OutMessage>,
  ): Story.StorySimulation<StoryModel, StoryMessage, OutMessage> => {
    check(
      Array.flatMap(simulation.commands, command =>
        Option.match(Story.Command.argsOf(WriteSave)(command), {
          onNone: () => [],
          onSome: ({ changes }) => changes,
        }),
      ),
    )
    return simulation
  }

// NOTE: pause, MENU, and leave the run for home.
export const leave = Story.steps(
  Story.message(Message.ClickedPauseButton()),
  Story.message(Message.ClickedMenuButton()),
  showDialog(),
  Story.message(Message.ClickedLeaveRunButton()),
  closeDialog(),
)
