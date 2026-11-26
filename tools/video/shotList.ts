import { type Effect, Schema } from 'effect'

import { MusicLevel, MusicMood, MusicStinger } from '../../src/audio/music'
import { Difficulty } from '../../src/shared/records/playerData'

const Ticks = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const Positive = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))

export const Format = Schema.Literals(['16:9', '9:16'])
export type Format = typeof Format.Type

const Segment = Schema.Struct({
  from: Ticks,
  to: Ticks,
  keys: Schema.optionalKey(Schema.Array(Schema.String)),
  move: Schema.optionalKey(Schema.Tuple([Schema.Finite, Schema.Finite])),
  aim: Schema.optionalKey(
    Schema.Union([
      Schema.Literal('nearest'),
      Schema.Tuple([Schema.Finite, Schema.Finite]),
    ]),
  ),
  turn: Schema.optionalKey(Schema.Finite),
  fire: Schema.optionalKey(Schema.Boolean),
})

const Tap = Schema.Struct({ at: Ticks, key: Schema.String })

const Click = Schema.Struct({ at: Ticks, selector: Schema.String })

const Revive = Schema.Struct({
  down: Schema.Int,
  reviver: Schema.Int,
  at: Ticks,
  walkAt: Ticks,
  bleedMs: Positive,
  spot: Schema.optionalKey(Schema.Tuple([Schema.Finite, Schema.Finite])),
})

const CoopPlan = Schema.Struct({
  seed: Schema.Finite,
  preroll: Ticks,
  difficulty: Schema.optionalKey(Difficulty),
  god: Schema.optionalKey(Schema.Boolean),
  revive: Schema.optionalKey(Revive),
})

const CardName = Schema.Literals(['Title', 'End', 'Couch'])
type CardName = typeof CardName.Type

const Card = Schema.Struct({
  from: Ticks,
  to: Ticks,
  card: CardName,
})

const SlowMotion = Schema.Struct({
  from: Ticks,
  to: Ticks,
  repeat: Positive,
})
const Hold = Schema.Struct({ at: Ticks, frames: Positive })

export const CameraKey = Schema.Struct({
  at: Ticks,
  zoom: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(1)),
  x: Schema.Finite,
  y: Schema.Finite,
})
export type CameraKey = typeof CameraKey.Type

const Devices = Schema.Struct({ from: Ticks, to: Ticks })

export const Caption = Schema.Struct({
  from: Ticks,
  to: Ticks,
  text: Schema.String,
  place: Schema.optionalKey(Schema.Literals(['Top', 'Middle', 'Bottom'])),
  top: Schema.optionalKey(Schema.Finite),
  pixel: Schema.optionalKey(Positive),
  tone: Schema.optionalKey(
    Schema.Literals(['Plain', 'Prompt', 'Title', 'Victory', 'Defeat', 'Fresh']),
  ),
})
export type Caption = typeof Caption.Type

const LobbyKey = Schema.Struct({
  at: Ticks,
  seats: Positive,
  ready: Ticks,
})

export const Shot = Schema.Struct({
  name: Schema.String,
  scene: Schema.String,
  ticks: Positive,
  skip: Schema.optionalKey(Ticks),
  step: Schema.optionalKey(Positive),
  hideHud: Schema.optionalKey(Schema.Boolean),
  hudTop: Schema.optionalKey(Schema.Finite),
  segments: Schema.optionalKey(Schema.Array(Segment)),
  taps: Schema.optionalKey(Schema.Array(Tap)),
  clicks: Schema.optionalKey(Schema.Array(Click)),
  coop: Schema.optionalKey(CoopPlan),
  slowMotion: Schema.optionalKey(Schema.Array(SlowMotion)),
  holds: Schema.optionalKey(Schema.Array(Hold)),
  captions: Schema.optionalKey(Schema.Array(Caption)),
  fadeIn: Schema.optionalKey(Ticks),
  fadeOut: Schema.optionalKey(Ticks),
  crossfade: Schema.optionalKey(Positive),
  camera: Schema.optionalKey(Schema.NonEmptyArray(CameraKey)),
  cards: Schema.optionalKey(Schema.Array(Card)),
  devices: Schema.optionalKey(Devices),
  lobby: Schema.optionalKey(Schema.Array(LobbyKey)),
})
export type Shot = typeof Shot.Type

const ScoreCue = Schema.Struct({
  frame: Ticks,
  mood: MusicMood,
  level: Schema.optionalKey(MusicLevel),
  stinger: Schema.optionalKey(MusicStinger),
})
export const Score = Schema.Struct({
  bpm: Schema.Finite,
  cues: Schema.NonEmptyArray(ScoreCue),
})
export type Score = typeof Score.Type

export const Clip = Schema.Struct({
  name: Schema.String,
  format: Format,
  gif: Schema.optionalKey(Schema.Boolean),
  music: Schema.optionalKey(Schema.Boolean),
  score: Schema.optionalKey(Score),
  loop: Schema.optionalKey(Positive),
  shots: Schema.NonEmptyArray(Shot),
})
export type Clip = typeof Clip.Type

const ShotList = Schema.Struct({ clips: Schema.NonEmptyArray(Clip) })
type ShotList = typeof ShotList.Type

const decodeList = Schema.decodeUnknownEffect(Schema.fromJsonString(ShotList))

export const decodeShotList = (
  text: string,
): Effect.Effect<ShotList, Schema.SchemaError> => decodeList(text)

export const FRAMES_PER_SECOND = 60

const DirectorPlan = Schema.Struct({
  segments: Schema.Array(Segment),
  taps: Schema.Array(Tap),
  coop: Schema.optionalKey(CoopPlan),
  cards: Schema.Array(Card),
  lobby: Schema.optionalKey(Schema.Array(LobbyKey)),
})

const encodeDirectorPlan = Schema.encodeEffect(
  Schema.fromJsonString(DirectorPlan),
)

export const encodePlan = (
  plan: typeof DirectorPlan.Type,
): Effect.Effect<string, Schema.SchemaError> => encodeDirectorPlan(plan)
