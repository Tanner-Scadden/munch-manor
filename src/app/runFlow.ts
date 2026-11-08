import { Array, Function } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { activeBots, seatCallings } from '../features/bots/bots'
import {
  raiseDebutCard,
  settleLessons,
} from '../features/onboarding/onboarding'
import { FIRST_PREPARATION_MS } from '../shared/constants'
import { seatCrew, withStartingHearts } from '../world/party/party'
import { withWorld } from '../world/schema/world'
import { SeatAction } from '../world/step/stepWorld'
import { beginPreparation } from '../world/waves/waves'
import { type Model, Phase, Round, type RunMode } from './model'
import { freshRun } from './runReset'
import { actAsLead } from './update/action'

// Starting, resuming, and starting a wave from the player's side: each
// resets or reads client state (the run's fields, the lessons settled from
// the save, the new zombie card) around the World's own step.

// NOTE: a `?local=N` link seats N players at this keyboard, and the
// lobby's bots sit after them, all before the first wave is rolled, so the
// wave already counts them. Each bot plays its own hero, as a co-op seat
// does (src/world/net/roomWorld.ts).
const startRun = (model: Model, mode: RunMode): Model => {
  const bots = activeBots(model)
  return withWorld(
    {
      ...model,
      ...freshRun(model),
      mode,
      lessons: settleLessons(model.lessons),
      crewBots: bots,
    },
    world =>
      beginPreparation(
        withStartingHearts(
          seatCallings(
            seatCrew(world, model.localPlayers + bots.length),
            model.localPlayers,
            Array.map(bots, ({ calling }) => calling),
          ),
        ),
        1,
        FIRST_PREPARATION_MS,
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
    Preparation: () => model,
    Wave: () => model,
    Paused: ({ round }) => resume(model, round),
    Victory: () => startRun(model, mode),
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
