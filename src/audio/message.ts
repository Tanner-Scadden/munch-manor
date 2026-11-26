import { Schema } from 'effect'

import { UiSchema } from '@effect/ui'

import { SoundEffect } from '#shared/soundEffect.ts'

import { PlayOutcome, Playback } from './audio.ts'

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
