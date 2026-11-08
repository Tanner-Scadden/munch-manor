import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'

import { SoundEffect } from '../shared/soundEffect'
import { PlayOutcome, Playback } from './audio'
import { MusicMood } from './music'

// NOTE: the root's Messages about sound: the mute and music buttons, the
// audio engine's lifetime, and each sound and tune played. Their handlers
// are in src/app/update/sound.ts.
export const soundCases = {
  ClickedMuteButton: {},
  ClickedMusicButton: {},
  AcquiredAudioEngine: {},
  FailedAcquireAudioEngine: { reason: Schema.String },
  ReleasedAudioEngine: {},
  CompletedResumeAudio: { playback: Playback },
  FailedResumeAudio: { reason: Schema.String },
  CompletedPlaySound: { sound: SoundEffect, outcome: PlayOutcome },
  FailedPlaySound: { sound: SoundEffect, reason: Schema.String },
  CompletedCueMusic: { mood: MusicMood },
  FailedCueMusic: { mood: MusicMood, reason: Schema.String },
}
export const SoundMessage = defineMessageUnion(soundCases)
export type SoundMessage = typeof SoundMessage.Type
