import { Effect } from 'effect'

import { Command, Component } from '@effect/ui'

import { AudioEngine, playMusic } from '../../audio/audio'
import { MusicLevel, MusicMood, MusicStinger } from '../../audio/music'
import { isHouseHungry } from '../../world/dare/finale'
import { Phase, Round } from '../../world/schema/worldSchema'
import { FINAL_WAVE } from '../../world/waves/wavePlans'
import { isEndless } from '../../world/waves/waves'
import type { Model } from '../model'
import { isSoundAudible } from './sound'
import type { UpdateStep } from './step'

// COMMAND

// NOTE: a tune cued changes nothing on screen, so a failure is logged and
// nothing is reported.
export class CueMusic extends Command.Service<CueMusic>()('app/CueMusic', {
  args: { mood: MusicMood, level: MusicLevel, stinger: MusicStinger },
  success: Component.Noop,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const { engine } = yield* AudioEngine
      return cue =>
        engine.pipe(
          Effect.flatMap(built => playMusic(built, cue)),
          Effect.catch(error =>
            Effect.logWarning('cue music', cue.mood, error.reason),
          ),
          Effect.as(Component.noop),
        )
    }),
  )
}

type MusicPlan = Readonly<{ mood: MusicMood; level: MusicLevel }>

const SILENT_PLAN: MusicPlan = { mood: 'Silence', level: 'Full' }

// NOTE: a wave stampedes once the house is hungrier, the list done: Uncle
// Chunk's wave and the hold-out at the front door. Endless has no list, so
// its waves stampede from wave 10 on, as they always have.
const isStampede = (model: Model, wave: number): boolean =>
  isEndless(model) ? wave >= FINAL_WAVE : isHouseHungry(model)

const roundMood = (model: Model, round: Round): MusicMood =>
  Round.match(round, {
    Preparation: (): MusicMood => 'Creep',
    Wave: ({ wave }): MusicMood =>
      isStampede(model, wave) ? 'Stampede' : 'Romp',
  })

const phasePlan = (model: Model): MusicPlan => {
  const moodOf = (round: Round): MusicMood => roundMood(model, round)
  return Phase.match(model.phase, {
    Ready: (): MusicPlan => ({ mood: 'Creep', level: 'Full' }),
    // NOTE: the intro has no tune: the car's radio, the house's creaks, and
    // silence on HELLO? are its own sounds (src/features/intro/introBeat.ts),
    // and the run's music comes in on the slam.
    Arriving: () => SILENT_PLAN,
    Preparation: (round): MusicPlan => ({ mood: moodOf(round), level: 'Full' }),
    Wave: (round): MusicPlan => ({ mood: moodOf(round), level: 'Full' }),
    Paused: ({ round }): MusicPlan => ({
      mood: moodOf(round),
      level: 'Ducked',
    }),
    Escaped: () => SILENT_PLAN,
    LeftEarly: () => SILENT_PLAN,
    GameOver: () => SILENT_PLAN,
  })
}

const isMusicAudible = (model: Model): boolean =>
  isSoundAudible(model) &&
  model.settings.musicSetting === 'On' &&
  model.pageVisibility === 'Visible'

const musicPlan = (model: Model): MusicPlan =>
  isMusicAudible(model) ? phasePlan(model) : SILENT_PLAN

const phaseStinger = (before: Phase, after: Phase): MusicStinger => {
  if (
    Phase.isAnyOf(['Escaped'])(after) &&
    !Phase.isAnyOf(['Escaped'])(before)
  ) {
    return 'Escaped'
  } else if (
    Phase.isAnyOf(['LeftEarly'])(after) &&
    !Phase.isAnyOf(['LeftEarly'])(before)
  ) {
    return 'Chicken'
  } else if (
    Phase.isAnyOf(['GameOver'])(after) &&
    !Phase.isAnyOf(['GameOver'])(before)
  ) {
    return 'GameOver'
  } else if (
    Phase.isAnyOf(['Wave'])(before) &&
    Phase.isAnyOf(['Preparation'])(after)
  ) {
    return 'Cleared'
  } else {
    return 'None'
  }
}

const isSamePlan = (first: MusicPlan, second: MusicPlan): boolean =>
  first.mood === second.mood && first.level === second.level

export const cueMusicFrom =
  (before: Model): UpdateStep =>
  $ => {
    const stepModel = $.model
    const plan = musicPlan(stepModel)
    const stinger = isMusicAudible(stepModel)
      ? phaseStinger(before.phase, stepModel.phase)
      : 'None'
    const hasGoneQuiet = isMusicAudible(before) && !isMusicAudible(stepModel)
    if (
      isSamePlan(musicPlan(before), plan) &&
      stinger === 'None' &&
      !hasGoneQuiet
    ) {
      return $.model
    } else {
      return $.run(
        CueMusic.make({ mood: plan.mood, level: plan.level, stinger }),
      )
    }
  }
