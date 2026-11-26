import { Array, Function, Option } from 'effect'

import { UiStruct } from '@effect/ui'

import { maybeTakenDareOf, withDarePicks } from '#domain/beatMyRun.ts'
import { activeBots, crewBotSlots, seatCallings } from '#domain/bots.ts'
import {
  raiseDebutCard,
  settleLessons,
} from '#features/onboarding/onboarding.ts'
import { RunRecorder, beginRecording } from '#platform/recording.ts'
import { RUNNING_BUILD } from '#platform/version.ts'
import { rollDare } from '#world/dare/dare.ts'
import type { DareKind } from '#world/dare/dareSchema.ts'
import { thingsOpenedBy } from '#world/dare/milestones.ts'
import { focusOf, seatCrew, withStartingHearts } from '#world/party/party.ts'
import { beginArrival } from '#world/run/arrival.ts'
import { rigTutorialCase } from '#world/run/tutorialRules.ts'
import { withWorld } from '#world/schema/world.ts'
import type { IntroCut } from '#world/schema/worldSchema.ts'
import { SeatAction } from '#world/step/stepWorld.ts'

import { type Model, Phase, Round, type RunMode } from './model.ts'
import { freshRun } from './runReset.ts'
import { actAsLead } from './update/action.ts'

const introCutOf = (model: Model): IntroCut =>
  model.introSeen === 'Seen' ? 'Short' : 'Full'

const startRun = (model: Model, mode: RunMode): Model =>
  recordedFromStart(startedRun(model, mode))

const recordedFromStart = (model: Model): Model =>
  UiStruct.evolve(model, {
    recorder: () =>
      model.recordUnlock === 'Unlocked' && model.settings.recordRuns === 'On'
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

const fromDare = (model: Model): Model =>
  Option.match(maybeTakenDareOf(model), {
    onNone: () => model,
    onSome: dare =>
      UiStruct.evolve(withDarePicks(model, dare), {
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
      runStart: { runSeed: model.rngState, runPool: pool, crewBots: bots },
      mode,
      lessons: settleLessons(model.lessons),
      introSeen: 'Seen',
    },
    world =>
      beginArrival(
        rigTutorialCase(
          withStartingHearts(
            seatCallings(
              seatCrew(rollDare(pool)(world), model.localPlayers + bots.length),
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
  UiStruct.evolve(model, {
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

export const startWave = (model: Model): Model => {
  const readied = actAsLead(model, SeatAction.Ready())
  return Phase.isAnyOf(['Preparation'])(model.phase) &&
    Phase.isAnyOf(['Wave'])(readied.phase)
    ? raiseDebutCard(readied)
    : readied
}
