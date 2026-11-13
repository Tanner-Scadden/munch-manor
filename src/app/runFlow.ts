import { Array, Function, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { maybeTakenDareOf, withDarePicks } from '../domain/beatMyRun'
import { activeBots, crewBotSlots, seatCallings } from '../domain/bots'
import {
  raiseDebutCard,
  settleLessons,
} from '../features/onboarding/onboarding'
import { RunRecorder, beginRecording } from '../platform/recording'
import { RUNNING_BUILD } from '../platform/version'
import { rollDare } from '../world/dare/dare'
import type { DareKind } from '../world/dare/dareSchema'
import { thingsOpenedBy } from '../world/dare/milestones'
import { focusOf, seatCrew, withStartingHearts } from '../world/party/party'
import { beginArrival } from '../world/run/arrival'
import { rigTutorialCase } from '../world/run/tutorialRules'
import { withWorld } from '../world/schema/world'
import type { IntroCut } from '../world/schema/worldSchema'
import { SeatAction } from '../world/step/stepWorld'
import { type Model, Phase, Round, type RunMode } from './model'
import { freshRun } from './runReset'
import { actAsLead } from './update/action'

// Starting, resuming, and starting a wave from the player's side: each
// resets or reads client state (the run's fields, the lessons settled from
// the save, the new zombie card) around the World's own step.

// NOTE: a run opens on the intro (src/world/run/arrival.ts): the whole
// drive up the first time on this device, the knock and the slam after.
// The first break begins on the slam.
const introCutOf = (model: Model): IntroCut =>
  model.introSeen === 'Seen' ? 'Short' : 'Full'

// NOTE: a `?local=N` link seats N players at this keyboard, and the
// lobby's bots sit after them, all before the first wave is rolled, so the
// wave already counts them. Each bot plays its own hero, as a co-op seat
// does (src/world/net/roomWorld.ts).
const startRun = (model: Model, mode: RunMode): Model =>
  recordedFromStart(startedRun(model, mode))

// NOTE: a run starts its recording (src/platform/recording.ts) from the
// World it starts with, when this device shows RECORD MY RUNS and it is on.
const recordedFromStart = (model: Model): Model =>
  modifyFields(model, {
    recorder: () =>
      model.recordUnlock === 'Unlocked' && model.recordRuns === 'On'
        ? beginRecording({
            world: model,
            maybeVisitId: model.maybeVisitId,
            build: RUNNING_BUILD,
            device: model.lastDevice,
            localPlayers: model.localPlayers,
            botSlots: crewBotSlots(model),
            focusSlot: focusOf(model).seat.slot,
          })
        : RunRecorder.Idle(),
  })

// NOTE: a friend's dare taken (src/domain/beatMyRun.ts) starts from its
// link: its seed, its picks, and the things its list rolls from, so the
// house, the list, and every roll are the friend's. Otherwise the run rolls
// its list from the things this player's milestones opened.
const fromDare = (model: Model): Model =>
  Option.match(maybeTakenDareOf(model), {
    onNone: () => model,
    onSome: dare =>
      modifyFields(withDarePicks(model, dare), {
        rngState: () => dare.seed,
      }),
  })

const poolOf = (model: Model): ReadonlyArray<DareKind> =>
  Option.match(maybeTakenDareOf(model), {
    onNone: () => thingsOpenedBy(model.journal.milestones),
    onSome: ({ pool }) => pool,
  })

const startedRun = (model: Model, mode: RunMode): Model =>
  startedFrom(fromDare(model), mode)

const startedFrom = (model: Model, mode: RunMode): Model => {
  const bots = activeBots(model)
  const pool = poolOf(model)
  return withWorld(
    {
      ...model,
      ...freshRun(model),
      runPool: pool,
      mode,
      lessons: settleLessons(model.lessons),
      crewBots: bots,
      introSeen: 'Seen',
    },
    world =>
      beginArrival(
        rigTutorialCase(
          withStartingHearts(
            seatCallings(
              seatCrew(
                rollDare(pool)(world),
                model.localPlayers + bots.length,
              ),
              model.localPlayers,
              Array.map(bots, ({ calling }) => calling),
            ),
          ),
        ),
        introCutOf(model),
      ),
  )
}

const resume = (model: Model, round: Round): Model =>
  modifyFields(model, {
    phase: () =>
      Round.match(round, {
        Preparation: (preparation): Phase => preparation,
        Wave: (wave): Phase => wave,
      }),
  })

export const startOrResume: {
  (mode: RunMode): (model: Model) => Model
  (model: Model, mode: RunMode): Model
} = Function.dual(2, (model: Model, mode: RunMode): Model =>
  Phase.match(model.phase, {
    Ready: () => startRun(model, mode),
    Arriving: () => model,
    Preparation: () => model,
    Wave: () => model,
    Paused: ({ round }) => resume(model, round),
    Escaped: () => startRun(model, mode),
    LeftEarly: () => startRun(model, mode),
    GameOver: () => startRun(model, mode),
  }),
)

// NOTE: START WAVE from the player, as their seat's READY
// (src/world/step/stepWorld.ts): alone the wave starts, and a new kind in it raises
// its card; in co-op it waits for everyone (decided 7).
export const startWave = (model: Model): Model => {
  const readied = actAsLead(model, SeatAction.Ready())
  return Phase.isAnyOf(['Preparation'])(model.phase) &&
    Phase.isAnyOf(['Wave'])(readied.phase)
    ? raiseDebutCard(readied)
    : readied
}
