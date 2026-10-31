import { Schema } from 'effect'

import { MusicLevel, MusicMood, MusicStinger } from '../../src/music'
import { Difficulty } from '../../src/playerData'

// THE SHOT LIST
//
// NOTE: a shot list file is JSON: clips, each made of shots played one
// after another. A shot is a harness scene (the query string the audit
// harness reads, with a `seed`), how many game ticks it plays, and the
// script the director plays it with (tools/audit/harness/director.ts).
// Everything in it is counted in ticks of 1/60 s, so a shot plays the same
// however long a frame takes to capture.

const Ticks = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const Positive = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))

// NOTE: 16:9 is 1920x1080 at six screen pixels a game pixel, the
// landscape layout with a mouse. 9:16 is 1080x1920, an upright phone
// with touch, so the portrait layout and its thumb area.
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

// NOTE: a click on the page between ticks, for HTML such as the shop's rows.
const Click = Schema.Struct({ at: Ticks, selector: Schema.String })

// NOTE: a seat downed on purpose and a teammate who comes to revive it:
// at `at` the seat at `down` drops to zero hearts, and its bleed out clock
// is set to `bleedMs`, so the revive lands with as much left as the shot
// wants. From `walkAt` the seat at `reviver` walks to it and stands still.
const Revive = Schema.Struct({
  down: Schema.Int,
  reviver: Schema.Int,
  at: Ticks,
  walkAt: Ticks,
  bleedMs: Positive,
  // NOTE: where the seat to be downed walks first, in world pixels.
  spot: Schema.optionalKey(Schema.Tuple([Schema.Finite, Schema.Finite])),
})

const CoopPlan = Schema.Struct({
  seed: Schema.Finite,
  preroll: Ticks,
  difficulty: Schema.optionalKey(Difficulty),
  // NOTE: every seat but a downed one is kept at full hearts.
  god: Schema.optionalKey(Schema.Boolean),
  revive: Schema.optionalKey(Revive),
})

// NOTE: a pixel art card the page draws over the game in the director
// (tools/audit/harness/cards.ts): the title slam with its drips, the end
// card with the logo and the chomping Groaner, and four players on a
// couch with their phones. `at` is the tick the card's own clock starts.
const CardName = Schema.Literals(['Title', 'End', 'Couch'])
type CardName = typeof CardName.Type

const Card = Schema.Struct({
  from: Ticks,
  to: Ticks,
  card: CardName,
})

// NOTE: slow motion repeats each captured frame of the ticks from `from` up
// to before `to` `repeat` times; a hold shows the frame at `at` for
// `frames` more frames.
const SlowMotion = Schema.Struct({
  from: Ticks,
  to: Ticks,
  repeat: Positive,
})
const Hold = Schema.Struct({ at: Ticks, frames: Positive })

// NOTE: the director's own camera, on its own path over the finished
// picture: a key holds where the frame looks at a tick, the center in game
// pixels of the screen (320x180, or 180x320 upright) and how far it is
// pushed in. Between keys it eases; before the first and after the last it
// holds.
export const CameraKey = Schema.Struct({
  at: Ticks,
  zoom: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(1)),
  x: Schema.Finite,
  y: Schema.Finite,
})
export type CameraKey = typeof CameraKey.Type

// NOTE: the four device split screen: over these ticks the frame is a
// laptop and three phones, each showing the room from one seat's camera.
const Devices = Schema.Struct({ from: Ticks, to: Ticks })

// NOTE: a caption shows over the ticks from `from` up to before `to`, in
// the game's pixel font: three or four words at most. `top`, a share of
// the frame's height, places it exactly in place of `place`, and `pixel`
// sets the screen pixels a font pixel, in place of the largest that fits.
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

// NOTE: a staged co-op lobby (`coop=host`) seating its members on cue:
// from `at`, the first `seats` sit in it and the first `ready` of them
// have pressed READY.
const LobbyKey = Schema.Struct({
  at: Ticks,
  seats: Positive,
  ready: Ticks,
})

export const Shot = Schema.Struct({
  name: Schema.String,
  scene: Schema.String,
  ticks: Positive,
  // NOTE: ticks played before the first captured frame, such as a walk to
  // the stall; every other tick in the shot still counts from 0.
  skip: Schema.optionalKey(Ticks),
  // NOTE: ticks per captured frame: 1 is 60 frames a second.
  step: Schema.optionalKey(Positive),
  hideHud: Schema.optionalKey(Schema.Boolean),
  // NOTE: the share of the screen's height from the top in which the HUD
  // is not drawn, so its top band uncovers the world under it.
  hudTop: Schema.optionalKey(Schema.Finite),
  segments: Schema.optionalKey(Schema.Array(Segment)),
  taps: Schema.optionalKey(Schema.Array(Tap)),
  clicks: Schema.optionalKey(Schema.Array(Click)),
  coop: Schema.optionalKey(CoopPlan),
  slowMotion: Schema.optionalKey(Schema.Array(SlowMotion)),
  holds: Schema.optionalKey(Schema.Array(Hold)),
  captions: Schema.optionalKey(Schema.Array(Caption)),
  // NOTE: frames of fade from black at the start and to black at the end;
  // without them shots cut.
  fadeIn: Schema.optionalKey(Ticks),
  fadeOut: Schema.optionalKey(Ticks),
  // NOTE: frames this shot's start dissolves over the last shot's end, so
  // the two overlap and the clip is that much shorter.
  crossfade: Schema.optionalKey(Positive),
  camera: Schema.optionalKey(Schema.NonEmptyArray(CameraKey)),
  cards: Schema.optionalKey(Schema.Array(Card)),
  devices: Schema.optionalKey(Devices),
  lobby: Schema.optionalKey(Schema.Array(LobbyKey)),
})
export type Shot = typeof Shot.Type

// NOTE: a clip's own music in place of what the game cued: each cue at
// the clip frame it starts on. `bpm` is the tune's tempo, so the tool can
// say how far each cut lands from a beat.
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
  // NOTE: frames of the clip's end dissolved into its start, so it loops
  // with no seam; the clip is that much shorter.
  loop: Schema.optionalKey(Positive),
  shots: Schema.NonEmptyArray(Shot),
})
export type Clip = typeof Clip.Type

const ShotList = Schema.Struct({ clips: Schema.NonEmptyArray(Clip) })
type ShotList = typeof ShotList.Type

export const decodeShotList = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ShotList),
)

export const FRAMES_PER_SECOND = 60

// NOTE: what the director in the page plays a shot with, as the JSON its
// `start` takes (the harness decodes it with its own copy of this Schema).
const DirectorPlan = Schema.Struct({
  segments: Schema.Array(Segment),
  taps: Schema.Array(Tap),
  coop: Schema.optionalKey(CoopPlan),
  cards: Schema.Array(Card),
  lobby: Schema.optionalKey(Schema.Array(LobbyKey)),
})

export const encodePlan = Schema.encodeEffect(
  Schema.fromJsonString(DirectorPlan),
)
