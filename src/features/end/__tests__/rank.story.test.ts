import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../../app/message'
import { type Model, Phase, RunMode } from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { WriteSave } from '../../../app/update/save'
import { type PlayerChange } from '../../../platform/playerSync'
import { FIXED_STEP_MS, PREPARATION_MS } from '../../../shared/constants'
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
  ticks,
  writeSave,
} from '../../../test/testing'
import { type DareThing, DareThingState } from '../../../world/dare/dareSchema'
import { noRank } from '../../../world/heroes/rank'
import { seatCrew } from '../../../world/party/party'
import { type Modifiers } from '../../../world/run/modifiers'
import { withWorld } from '../../../world/schema/world'
import { noKills } from '../../../world/schema/worldSchema'

// Rank and Bones (src/world/heroes/rank.ts, src/features/end/rankRun.ts): a run pays its points and
// Bones into the saved rank when it ends or is left, and sets what the end
// card's strip shows. The numbers are the design's: a Normal run that dies
// on wave 7 pays 60 points and 6 Bones; a Normal escape on wave 10 with its
// three things and the hat 315 and 31.

const frame = tick(FIXED_STEP_MS)

// NOTE: a run in `phase` that has cleared `wavesCleared` waves, on Normal.
const runAt = (phase: Phase, wavesCleared: number, bosses = 0): Model =>
  modifyFields(readyAfterRead, {
    phase: () => phase,
    mode: () => RunMode.Campaign(),
    stats: stats =>
      modifyFields(stats, {
        wavesCleared: () => wavesCleared,
        kills: () => ({ ...noKills, Boss: bosses }),
      }),
  })

const foundBy0 = DareThingState.Found({ slot: 0 })

const wave = (number: number): Phase =>
  Phase.Wave({ wave: number, elapsedMs: 4000, spawns: [] })

const diesOnWave7 = lastHeart(runAt(wave(7), 6))

// NOTE: the dare's three things found, and Uncle Chunk's hat taken.
const FOUND_THINGS: ReadonlyArray<DareThing> = [
  { id: 0, kind: 'SilverSpoon', state: foundBy0 },
  { id: 1, kind: 'MusicBox', state: foundBy0 },
  { id: 2, kind: 'FamilyPortrait', state: foundBy0 },
]

const HAT: DareThing = {
  id: 3,
  kind: 'PartyHat',
  state: foundBy0,
}

// NOTE: wave 10 with the list done, the hat taken, the front door open,
// and the player on its sill: the next tick walks out.
const lastWave = escaping(
  withDareThings(
    runAt(
      Phase.Wave({ wave: 10, elapsedMs: 4000, spawns: [DISTANT_SPAWN] }),
      9,
      1,
    ),
    [...FOUND_THINGS, HAT],
  ),
)

// NOTE: the Model one frame after `model`, its run ended and the end saved.
const ended = (model: Model) =>
  Story.story(APPLICATION, Story.given(model), frame, writeSave())

// NOTE: a step that hands the save's pending changes to a check.
const checkSavedChanges =
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

// NOTE: the end card's beat is over, so its buttons work.
const afterBeat = (model: Model): Model =>
  modifyFields(model, { screenMs: () => 60_000 })

// NOTE: pause, MENU, and leave the run for home.
const leave = Story.steps(
  Story.message(Message.ClickedPauseButton()),
  Story.message(Message.ClickedMenuButton()),
  showDialog(),
  Story.message(Message.ClickedLeaveRunButton()),
  closeDialog(),
)

describe('a death', () => {
  it.effect('pays 10 points a wave cleared, and a Bone for each 10', () =>
    Story.story(
      APPLICATION,
      Story.given(diesOnWave7),
      frame,
      Story.model(after => {
        expect(after.phase._tag).toBe('GameOver')
        expect(after.rank).toMatchObject({ earnedPoints: 60, earnedBones: 6 })
        expect(after.maybeRankGain).toEqual(
          Option.some({
            pointsBefore: 0,
            gained: 60,
            bonesGained: 6,
            bonusPercent: 0,
          }),
        )
      }),
      writeSave(),
    ),
  )

  it.effect('grows the save, as an increment', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(diesOnWave7, {
          rank: rank => ({ ...rank, earnedPoints: 90, earnedBones: 9 }),
        }),
      ),
      frame,
      Story.model(after => {
        expect(after.rank.earnedPoints).toBe(150)
        expect(after.maybeRankGain).toEqual(
          Option.some({
            pointsBefore: 90,
            gained: 60,
            bonesGained: 6,
            bonusPercent: 0,
          }),
        )
      }),
      checkSavedChanges(changes => {
        expect(changes).toContainEqual({
          _tag: 'EarnedRank',
          points: 60,
          bones: 6,
        })
      }),
      writeSave(),
    ),
  )

  it.effect('counts the points the veteran grant gave before the run', () =>
    Effect.gen(function* () {
      const after = yield* ended(
        modifyFields(diesOnWave7, {
          rank: rank => ({ ...rank, veteranPoints: 400, veteranBones: 40 }),
        }),
      )
      expect(after.maybeRankGain).toEqual(
        Option.some({
          pointsBefore: 400,
          gained: 60,
          bonesGained: 6,
          bonusPercent: 0,
        }),
      )
    }),
  )

  it.effect('is multiplied by the difficulty and rounded down', () =>
    Effect.gen(function* () {
      const on = (chosen: 'Easy' | 'Hard'): Model =>
        modifyFields(diesOnWave7, {
          difficulty: setting =>
            modifyFields(setting, { chosen: () => chosen }),
        })
      const hard = yield* ended(on('Hard'))
      const easy = yield* ended(on('Easy'))
      expect(hard.rank.earnedPoints).toBe(90)
      expect(easy.rank.earnedPoints).toBe(45)
    }),
  )

  it.effect(
    'is multiplied by the modifiers’ bonus, and the end card says so',
    () =>
      Effect.gen(function* () {
        const modifiers: Modifiers = {
          friendlyFire: false,
          bigCrowd: false,
          broke: true,
          glass: true,
        }
        const after = yield* ended(
          modifyFields(diesOnWave7, { modifiers: () => modifiers }),
        )
        expect(after.rank).toMatchObject({ earnedPoints: 315, earnedBones: 31 })
        expect(after.maybeRankGain).toEqual(
          Option.some({
            pointsBefore: 0,
            gained: 315,
            bonesGained: 31,
            bonusPercent: 425,
          }),
        )
      }),
  )

  it.effect('counts Friendly Fire only with a teammate to hit', () =>
    Effect.gen(function* () {
      const friendly: Modifiers = {
        friendlyFire: true,
        bigCrowd: false,
        broke: false,
        glass: false,
      }
      const alone = yield* ended(
        modifyFields(diesOnWave7, { modifiers: () => friendly }),
      )
      expect(alone.rank.earnedPoints).toBe(60)
      expect(
        Option.map(alone.maybeRankGain, ({ bonusPercent }) => bonusPercent),
      ).toEqual(Option.some(0))
      return yield* Story.story(
        APPLICATION,
        Story.given(
          withWorld(
            modifyFields(runAt(wave(7), 6), { modifiers: () => friendly }),
            world => seatCrew(world, 2),
          ),
        ),
        leave,
        Story.model(crewed => {
          expect(crewed.rank.earnedPoints).toBe(69)
        }),
        writeSave(),
      )
    }),
  )

  it.effect('pays once: the end card ticking on pays nothing more', () =>
    Story.story(
      APPLICATION,
      Story.given(diesOnWave7),
      frame,
      writeSave(),
      ...ticks(30, FIXED_STEP_MS),
      Story.model(later => {
        expect(later.rank.earnedPoints).toBe(60)
      }),
    ),
  )
})

describe('an escape', () => {
  it.effect('pays the waves, each thing found, the hat, and the walk out', () =>
    Effect.gen(function* () {
      const won = yield* ended(lastWave)
      expect(won.phase._tag).toBe('Escaped')
      expect(won.rank).toMatchObject({ earnedPoints: 315, earnedBones: 31 })
      expect(won.maybeRankGain).toEqual(
        Option.some({
          pointsBefore: 0,
          gained: 315,
          bonesGained: 31,
          bonusPercent: 0,
        }),
      )
    }),
  )

  it.effect('a death still pays for the things it found', () =>
    Effect.gen(function* () {
      const after = yield* ended(
        lastHeart(withDareThings(runAt(wave(7), 6), FOUND_THINGS)),
      )
      expect(after.phase._tag).toBe('GameOver')
      expect(after.rank.earnedPoints).toBe(60 + 75)
    }),
  )
})

describe('leaving a run', () => {
  it.effect('pays the waves cleared so far like a death, once', () =>
    Story.story(
      APPLICATION,
      Story.given(runAt(wave(4), 3)),
      leave,
      Story.model(left => {
        expect(left.phase._tag).toBe('Ready')
        expect(left.rank).toMatchObject({ earnedPoints: 30, earnedBones: 3 })
        expect(Option.isNone(left.maybeRankGain)).toBe(true)
      }),
      writeSave(),
      Story.message(Message.ClickedMenuButton()),
      Story.model(after => {
        expect(after.rank.earnedPoints).toBe(30)
      }),
    ),
  )

  it.effect('a run left from the end card pays nothing more', () =>
    Effect.gen(function* () {
      const over = yield* ended(diesOnWave7)
      return yield* Story.story(
        APPLICATION,
        Story.given(afterBeat(over)),
        Story.message(Message.ClickedMenuButton()),
        Story.model(home => {
          expect(home.phase._tag).toBe('Ready')
          expect(home.rank.earnedPoints).toBe(60)
        }),
      )
    }),
  )

  it.effect('the practice gate pays nothing', () =>
    // NOTE: a guided run cannot have cleared waves, so the stats are forced
    // to show that the gate itself pays nothing.
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(initialModel, {
          stats: stats => modifyFields(stats, { wavesCleared: () => 3 }),
          phase: () =>
            Phase.Preparation({
              wave: 1,
              remainingMs: 9000,
              durationMs: PREPARATION_MS,
              spawns: [],
            }),
        }),
      ),
      leave,
      Story.model(left => {
        expect(left.rank).toEqual(noRank)
      }),
    ),
  )
})
