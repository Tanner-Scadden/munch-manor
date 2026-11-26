import { Schema } from 'effect'

import { UiSchema } from '@effect/ui'

import { SoundEffect } from '../shared/soundEffect'
import { PlayOutcome, Playback } from './audio'

// NOTE: the root's Messages about sound: the mute and music buttons, the
// audio engine built and resumed, and a sound dropped under a suspended
// engine. Their handlers are in src/app/update/sound.ts. A sound played
// or a tune cued reports nothing else (`Component.noop`).
export const soundCases = {
  ClickedMuteButton: {},
  ClickedMusicButton: {},
  SucceededAcquireAudioEngine: {},
  FailedAcquireAudioEngine: { reason: Schema.String },
  CompletedResumeAudio: { playback: Playback },
  FailedResumeAudio: { reason: Schema.String },
  CompletedPlaySound: { sound: SoundEffect, outcome: PlayOutcome },
}
export const SoundMessage = UiSchema.TaggedEnum(soundCases)
export type SoundMessage = typeof SoundMessage.Type
