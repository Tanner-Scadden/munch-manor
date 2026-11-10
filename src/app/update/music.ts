import { Effect, pipe } from 'effect'

import { playMusic } from '../../audio/audio'
import { SoundMessage } from '../../audio/message'
import { MusicLevel, MusicMood, MusicStinger } from '../../audio/music'
import { Phase, Round } from '../../world/schema/worldSchema'
import { FINAL_WAVE } from '../../world/waves/wavePlans'
import { ApplicationBlock } from '../definition'
import type { Model } from '../model'
import {
  AudioEngineResource,
  audioFailureReason,
  isSoundAudible,
} from './sound'
import type { UpdateStep } from './step'

// COMMAND

export const CueMusic = ApplicationBlock.makeCommand('CueMusic', {
  args: { mood: MusicMood, level: MusicLevel, stinger: MusicStinger },
  messages: [SoundMessage.CompletedCueMusic, SoundMessage.FailedCueMusic],
  handler: function* () {
    return cue =>
      pipe(
        AudioEngineResource.get,
        Effect.flatMap(engine => playMusic(engine, cue)),
        Effect.as(SoundMessage.CompletedCueMusic({ mood: cue.mood })),
        Effect.catch(error =>
          Effect.succeed(
            SoundMessage.FailedCueMusic({
              mood: cue.mood,
              reason: audioFailureReason(error),
            }),
          ),
        ),
      )
  },
})

type MusicPlan = Readonly<{ mood: MusicMood; level: MusicLevel }>

const SILENT_PLAN: MusicPlan = { mood: 'Silence', level: 'Full' }

const roundMood = (round: Round): MusicMood =>
  Round.match(round, {
    Preparation: (): MusicMood => 'Creep',
    Wave: ({ wave }): MusicMood => (wave >= FINAL_WAVE ? 'Stampede' : 'Romp'),
  })

const phasePlan = (phase: Phase): MusicPlan =>
  Phase.match(phase, {
    Ready: (): MusicPlan => ({ mood: 'Creep', level: 'Full' }),
    // NOTE: the intro has no tune: the car's radio, the house's creaks, and
    // silence on HELLO? are its own sounds (src/features/intro/introBeat.ts),
    // and the run's music comes in on the slam.
    Arriving: () => SILENT_PLAN,
    Preparation: (round): MusicPlan => ({
      mood: roundMood(round),
      level: 'Full',
    }),
    Wave: (round): MusicPlan => ({ mood: roundMood(round), level: 'Full' }),
    Paused: ({ round }): MusicPlan => ({
      mood: roundMood(round),
      level: 'Ducked',
    }),
    Victory: () => SILENT_PLAN,
    GameOver: () => SILENT_PLAN,
  })

const isMusicAudible = (model: Model): boolean =>
  isSoundAudible(model) &&
  model.musicSetting === 'On' &&
  model.pageVisibility === 'Visible'

const musicPlan = (model: Model): MusicPlan =>
  isMusicAudible(model) ? phasePlan(model.phase) : SILENT_PLAN

const phaseStinger = (before: Phase, after: Phase): MusicStinger => {
  if (
    Phase.isAnyOf(['Victory'])(after) &&
    !Phase.isAnyOf(['Victory'])(before)
  ) {
    return 'Victory'
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
  stepModel => {
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
      return { model: stepModel }
    } else {
      return {
        model: stepModel,
        commands: [CueMusic({ mood: plan.mood, level: plan.level, stinger })],
      }
    }
  }
