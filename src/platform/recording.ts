import { Array, Function, Option, Schema, String, Struct } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

import { InputDevice } from '../input/inputSchema'
import { Calling } from '../shared/playerData'
import { hashWorld } from '../world/net/worldHash'
import { focusOf, modifyFocus } from '../world/party/party'
import { World } from '../world/schema/world'
import { Phase, PlayerSlot, noPractice } from '../world/schema/worldSchema'
import {
  type InputsByPlayer,
  SeatAction,
  applySeatAction,
} from '../world/step/stepWorld'
import { roundWave } from '../world/waves/waves'
import { RunId } from './recordingApi'
import { type TickInputs, encodeChunk, lineOfTick } from './recordingCodec'

// A recorded run, for the bot that learns to play like a person
// (docs/BOT_PLAN.md, Track B). A run records the World it starts from, each
// 60 Hz tick's intent for every seat, the seat actions pressed between
// ticks, and any other change the client made to the World between ticks,
// so a replay (tools/learn/replay.ts) plays it back exactly and checks the
// hash of its last World. It records the intent the client derived, not the
// raw input, since aim goes through the camera only the client knows.
//
// Recording only reads: it never writes the World, so a recorded run plays
// exactly as one that is not. Its state is the client's `recorder` field.

// NOTE: a World with every field optional: the fields the client changed
// between two ticks, each with its new value.
const WorldPatch = World.mapFields(Struct.map(Schema.optionalKey))
type WorldPatch = typeof WorldPatch.Type

// NOTE: what happened before a tick's step, in order: a seat's press as its
// action, then the other changes as one patch.
export const TickEdit = defineTaggedUnion({
  Pressed: { slot: PlayerSlot, action: SeatAction },
  Patched: { fields: WorldPatch },
})
export type TickEdit = typeof TickEdit.Type

const TimedEdit = Schema.Struct({ tick: Schema.Finite, edit: TickEdit })
type TimedEdit = typeof TimedEdit.Type

const DeviceChange = Schema.Struct({
  tick: Schema.Finite,
  device: InputDevice,
})
type DeviceChange = typeof DeviceChange.Type

// NOTE: every setting that shapes the run, for training to sort runs by.
// The start World holds them all; these are the same values, easy to read.
const RunSettings = Schema.Struct({
  seed: Schema.Finite,
  mode: World.fields.mode,
  difficulty: World.fields.difficulty,
  modifiers: World.fields.modifiers,
  easyBreakSeconds: World.fields.easyBreakSeconds,
  lessons: World.fields.lessons,
  practice: World.fields.practice,
  callings: Schema.Array(Calling),
  localPlayers: Schema.Finite,
  botSlots: Schema.Array(PlayerSlot),
  focusSlot: PlayerSlot,
})
type RunSettings = typeof RunSettings.Type

export const RunEnd = Schema.Struct({
  ticks: Schema.Finite,
  outcome: Schema.Literals(['Escaped', 'LeftEarly', 'GameOver', 'Quit']),
  wave: Schema.Finite,
  hash: Schema.Finite,
})
export type RunEnd = typeof RunEnd.Type

const PendingPress = Schema.Struct({ slot: PlayerSlot, action: SeatAction })
type PendingPress = typeof PendingPress.Type

export const RunRecorder = defineTaggedUnion({
  Idle: {},
  Recording: {
    runId: RunId,
    build: Schema.String,
    settings: RunSettings,
    start: World,
    lastWorld: World,
    tick: Schema.Finite,
    startDevice: InputDevice,
    device: InputDevice,
    devices: Schema.Array(DeviceChange),
    pending: Schema.Array(PendingPress),
    lines: Schema.Array(Schema.String),
    chunks: Schema.Array(Schema.String),
    edits: Schema.Array(TimedEdit),
  },
})
export type RunRecorder = typeof RunRecorder.Type
type Recording = typeof RunRecorder.Recording.Type

// NOTE: the upload, one finished run. Version 1.
export const RunRecording = Schema.Struct({
  format: Schema.Literal(1),
  runId: RunId,
  build: Schema.String,
  device: InputDevice,
  devices: Schema.Array(DeviceChange),
  settings: RunSettings,
  start: World,
  ticks: Schema.Array(Schema.String),
  edits: Schema.Array(TimedEdit),
  end: RunEnd,
})
export type RunRecording = typeof RunRecording.Type

export const RunRecordingJson = Schema.fromJsonString(
  Schema.toCodecJson(RunRecording),
)

// START

const HEX = 16
const SEED_DIGITS = 8
const NO_VISIT = String.repeat(HEX)('0')

const runIdOf = (maybeVisitId: Option.Option<string>, seed: number): string =>
  `${Option.getOrElse(maybeVisitId, () => NO_VISIT)}${String.padStart(
    SEED_DIGITS,
    '0',
  )((seed >>> 0).toString(HEX))}`

export type RecordingStart = Readonly<{
  world: World
  maybeVisitId: Option.Option<string>
  build: string
  device: InputDevice
  localPlayers: number
  botSlots: ReadonlyArray<PlayerSlot>
  focusSlot: PlayerSlot
}>

export const beginRecording = (start: RecordingStart): RunRecorder => {
  const { world } = start
  return Option.match(
    Schema.decodeOption(RunId)(runIdOf(start.maybeVisitId, world.rngState)),
    {
      onNone: () => RunRecorder.Idle(),
      onSome: runId =>
        RunRecorder.Recording({
          runId,
          build: start.build,
          settings: {
            seed: world.rngState,
            mode: world.mode,
            difficulty: world.difficulty,
            modifiers: world.modifiers,
            easyBreakSeconds: world.easyBreakSeconds,
            lessons: world.lessons,
            practice: world.practice,
            callings: Array.map(world.seats, seat => seat.player.calling),
            localPlayers: start.localPlayers,
            botSlots: start.botSlots,
            focusSlot: start.focusSlot,
          },
          start: world,
          lastWorld: world,
          tick: 0,
          startDevice: start.device,
          device: start.device,
          devices: [],
          pending: [],
          lines: [],
          chunks: [],
          edits: [],
        }),
    },
  )
}

// PRESSES

// NOTE: a seat's press between ticks, applied to the World by its own rule;
// the next tick's edits start with it.
export const notePress: {
  (slot: PlayerSlot, action: SeatAction): (recorder: RunRecorder) => RunRecorder
  (recorder: RunRecorder, slot: PlayerSlot, action: SeatAction): RunRecorder
} = Function.dual(
  3,
  (recorder: RunRecorder, slot: PlayerSlot, action: SeatAction): RunRecorder =>
    RunRecorder.isAnyOf(['Recording'])(recorder)
      ? modifyFields(recorder, {
          pending: pending => Array.append(pending, { slot, action }),
        })
      : recorder,
)

// TICKS

// NOTE: a tick clears the last tick's events before it reads them
// (advanceTick in src/world/step/simulation.ts), and the frame clears them
// too, so a cleared list is a flag on the tick rather than a patch.
const PATCHED_FIELDS: ReadonlyArray<keyof World> = Array.filter(
  Struct.keys(World.fields),
  field => field !== 'frameEvents' && field !== 'practice',
)

// NOTE: the client's own tallies of a frame, which no step reads: how far
// the player walked and aimed for the practice gate, and the frames and
// time the run has been active. They change on every frame, so a recording
// keeps none of them and its hash leaves them out.
const withoutTallies = (world: World): World => ({
  ...world,
  practice: noPractice,
  stats: modifyFields(world.stats, {
    activeFrames: () => 0,
    activeFrameMs: () => 0,
    runMs: () => 0,
  }),
})

// NOTE: the hash a recording ends on, and a replay checks.
export const recordedHashOf = (world: World): number =>
  hashWorld(withoutTallies(world))

const isSamePatch = Schema.toEquivalence(WorldPatch)

const isSameTally = Schema.toEquivalence(World.fields.stats)

const isFieldChanged = (
  current: World,
  baseline: World,
  field: keyof World,
): boolean =>
  current[field] !== baseline[field] &&
  (field === 'stats'
    ? !isSameTally(
        withoutTallies(current).stats,
        withoutTallies(baseline).stats,
      )
    : !isSamePatch(
        Struct.pick(current, [field]),
        Struct.pick(baseline, [field]),
      ))

const pressedOn = (world: World, presses: ReadonlyArray<PendingPress>): World =>
  Array.reduce(presses, world, (current, { slot, action }) =>
    applySeatAction(current, slot, action),
  )

// NOTE: the client writes the first seat's intent from its input between
// ticks, and the tick writes it again from the recorded intent, so what it
// held before is no change.
const withFocusIntentOf = (baseline: World, current: World): World =>
  focusOf(baseline).intent === focusOf(current).intent
    ? baseline
    : modifyFocus(baseline, { intent: () => focusOf(current).intent })

const CHUNK_TICKS = 600

// NOTE: what the client did between the last tick and this one: the
// presses, then any field still unlike what the presses alone would make.
const editsBefore = (
  recording: Recording,
  current: World,
): Readonly<{ edits: ReadonlyArray<TickEdit>; isCleared: boolean }> => {
  const baseline = withFocusIntentOf(
    Array.isReadonlyArrayEmpty(recording.pending)
      ? recording.lastWorld
      : pressedOn(recording.lastWorld, recording.pending),
    current,
  )
  const changed = Array.filter(PATCHED_FIELDS, field =>
    isFieldChanged(current, baseline, field),
  )
  const isCleared =
    Array.isReadonlyArrayEmpty(current.frameEvents) &&
    Array.isReadonlyArrayNonEmpty(baseline.frameEvents)
  const isEventsPatched =
    !isCleared && isFieldChanged(current, baseline, 'frameEvents')
  const fields = isEventsPatched
    ? [...changed, 'frameEvents' as const]
    : changed
  return {
    edits: [
      ...Array.map(recording.pending, press => TickEdit.Pressed(press)),
      ...(Array.isReadonlyArrayNonEmpty(fields)
        ? [TickEdit.Patched({ fields: Struct.pick(current, fields) })]
        : []),
    ],
    isCleared,
  }
}

export type NotedTick = Readonly<{
  before: World
  inputs: InputsByPlayer
  after: World
  device: InputDevice
}>

// NOTE: one tick: the World before the client's intent went in, every
// seat's intent, and the World the step made. A teammate bot's intent is
// left out: its brain reads only the World (botInputs in
// src/features/bots/teammateBot.ts), so a replay asks it again.
export const noteTick: {
  (tick: NotedTick): (recorder: RunRecorder) => RunRecorder
  (recorder: RunRecorder, tick: NotedTick): RunRecorder
} = Function.dual(2, (recorder: RunRecorder, tick: NotedTick): RunRecorder =>
  RunRecorder.matchOrElse(
    recorder,
    {
      Recording: recording => {
        const { edits, isCleared } = editsBefore(recording, tick.before)
        const inputs: TickInputs = {
          isCleared,
          inputs: Array.filter(
            Array.fromIterable(tick.inputs),
            ([slot]) => !Array.contains(recording.settings.botSlots, slot),
          ),
        }
        const lines = Array.append(recording.lines, lineOfTick(inputs))
        const isFull = lines.length >= CHUNK_TICKS
        return RunRecorder.Recording({
          ...recording,
          lastWorld: tick.after,
          tick: recording.tick + 1,
          device: tick.device,
          devices:
            tick.device === recording.device
              ? recording.devices
              : Array.append(recording.devices, {
                  tick: recording.tick,
                  device: tick.device,
                }),
          pending: [],
          lines: isFull ? [] : lines,
          chunks: isFull
            ? Array.append(recording.chunks, encodeChunk(lines))
            : recording.chunks,
          edits: Array.appendAll(
            recording.edits,
            Array.map(edits, edit => ({ tick: recording.tick, edit })),
          ),
        })
      },
    },
    () => recorder,
  ),
)

// END

export const outcomeOf = (world: World): RunEnd['outcome'] =>
  Phase.matchOrElse(
    world.phase,
    {
      Escaped: (): RunEnd['outcome'] => 'Escaped',
      LeftEarly: (): RunEnd['outcome'] => 'LeftEarly',
      GameOver: (): RunEnd['outcome'] => 'GameOver',
    },
    (): RunEnd['outcome'] => 'Quit',
  )

// NOTE: the run as it ended, with the hash of its last ticked World, or
// nothing when no run was recorded. Its device is the one it started on,
// and `devices` lists each change after.
export const finishRecording = (
  recorder: RunRecorder,
): Option.Option<RunRecording> =>
  RunRecorder.matchOrElse(
    recorder,
    {
      Recording: recording =>
        Option.some<RunRecording>({
          format: 1,
          runId: recording.runId,
          build: recording.build,
          device: recording.startDevice,
          devices: recording.devices,
          settings: recording.settings,
          start: recording.start,
          ticks: Array.isReadonlyArrayEmpty(recording.lines)
            ? recording.chunks
            : Array.append(recording.chunks, encodeChunk(recording.lines)),
          edits: recording.edits,
          end: {
            ticks: recording.tick,
            outcome: outcomeOf(recording.lastWorld),
            wave: roundWave(recording.lastWorld.phase),
            hash: recordedHashOf(recording.lastWorld),
          },
        }),
    },
    () => Option.none(),
  )
