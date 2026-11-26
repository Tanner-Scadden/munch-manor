// The art studio's component as defined: its Model, Messages, and the flags
// it starts from. The update is ./update.ts, the Commands and Subscriptions
// ./commands.ts, the view ./view.ts.
import { Array, Function, Option, Schema } from 'effect'

import { UiSchema, type View } from '@effect/ui'
import { Html } from '@effect/ui/html'

import { FacingChoice, Tab, Tone } from './catalog'
import { LabEdits } from './lab'
import { DEFAULT_LIVE, LiveScene, LiveTool } from './liveScene'
import { NoteKind, Pin, StoredNote, Tile, TileArea } from './notes'
import { StudioRoom } from './room'
import { StagePreset } from './stagePresets'

// MODEL

export const Backdrop = Schema.Literals(['Floor', 'Dark', 'Light', 'Grass'])
export type Backdrop = typeof Backdrop.Type

// NOTE: the big view as the flat picture, or carved into blocks on the 3D
// stage (./stage3d.ts).
export const StageMode = Schema.Literals(['Flat', 'Blocks'])
export type StageMode = typeof StageMode.Type

export const ZOOMS: Array.NonEmptyReadonlyArray<number> = [2, 3, 4, 6, 8]

export const SPEEDS: Array.NonEmptyReadonlyArray<number> = [0.5, 1, 2]

// NOTE: the part of the Model a reload keeps (in sessionStorage), so an
// edit to a sprite, which reloads the page, lands back on what was open.
export const SavedView = Schema.Struct({
  tab: Tab,
  zoom: Schema.Finite,
  backdrop: Backdrop,
  facing: FacingChoice,
  tone: Tone,
  maybeSelectedId: Schema.OptionFromNullOr(Schema.String),
  room: StudioRoom,
  isKitchenOpen: Schema.Boolean,
  // NOTE: which of the manor's rolled arrangements the manor shows, by its
  // place in ARRANGEMENTS (src/world/level/plan.ts).
  house: Schema.Finite,
  // NOTE: a drafted room's twist: the chandelier down, the shelf open.
  isTwistOn: Schema.Boolean,
  // NOTE: the live room's scene, and what a press on it does.
  live: LiveScene,
  liveTool: LiveTool,
  isGridOn: Schema.Boolean,
  isOnion: Schema.Boolean,
  isCrew: Schema.Boolean,
  speed: Schema.Finite,
  stageMode: StageMode,
  stagePreset: StagePreset,
  isAutoSpin: Schema.Boolean,
  // NOTE: the light and color lab's edits (./lab.ts), kept until reset, and
  // whether its panel is open.
  labEdits: LabEdits,
  isLabOpen: Schema.Boolean,
})
export type SavedView = typeof SavedView.Type

export const SendStatus = Schema.Literals(['Idle', 'Sending', 'Sent', 'Failed'])
export type SendStatus = typeof SendStatus.Type

export const Model = Schema.Struct({
  ...SavedView.fields,
  isPlaying: Schema.Boolean,
  clockMs: Schema.Finite,
  maybeHoverTile: Schema.OptionFromNullOr(Tile),
  maybeDraftPin: Schema.OptionFromNullOr(Pin),
  // NOTE: the room tiles picked for the note being written, and where a drag
  // over the room began while it is still held.
  maybeDraftArea: Schema.OptionFromNullOr(TileArea),
  maybeDragFrom: Schema.OptionFromNullOr(Tile),
  draftKind: NoteKind,
  note: Schema.String,
  sendStatus: SendStatus,
  notes: Schema.Array(StoredNote),
  seenDone: Schema.Array(Schema.String),
  isInboxOnline: Schema.Boolean,
  // NOTE: raised to stand the stage's camera where the game's stands.
  cameraResets: Schema.Finite,
})
export type Model = typeof Model.Type

export const Flags = Schema.Struct({
  maybeSavedView: Schema.OptionFromNullOr(SavedView),
  seenDone: Schema.Array(Schema.String),
})
export type Flags = typeof Flags.Type

export const DEFAULT_VIEW: SavedView = {
  tab: 'Zombies',
  zoom: 4,
  backdrop: 'Floor',
  facing: 'Right',
  tone: 'Normal',
  maybeSelectedId: Option.none(),
  room: 'Live',
  isKitchenOpen: true,
  house: 0,
  isTwistOn: false,
  live: DEFAULT_LIVE,
  liveTool: 'Pin',
  isGridOn: true,
  isOnion: false,
  isCrew: false,
  speed: 1,
  stageMode: 'Flat',
  stagePreset: 'Break',
  isAutoSpin: false,
  labEdits: {},
  isLabOpen: false,
}

// MESSAGE

export const Message = UiSchema.TaggedEnum({
  ClickedTab: { tab: Tab },
  ClickedZoom: { zoom: Schema.Finite },
  ClickedBackdrop: { backdrop: Backdrop },
  ClickedFacing: { facing: FacingChoice },
  ClickedTone: { tone: Tone },
  ClickedPlay: {},
  ClickedStep: { step: Schema.Finite },
  ClickedSpeed: { speed: Schema.Finite },
  ClickedOnion: {},
  ClickedCrew: {},
  ClickedGrid: {},
  ClickedRoom: { room: StudioRoom },
  ClickedRoomToggle: {},
  ClickedHouse: { house: Schema.Finite },
  ClickedLive: { live: LiveScene },
  ClickedLiveTool: { tool: LiveTool },
  TickedFrame: { deltaTime: Schema.Finite },
  ClickedEntry: { id: Schema.String },
  ClickedNote: { tab: Tab, targetId: Schema.String },
  HoveredTile: { tile: Tile },
  LeftRoom: {},
  PressedRoomTile: { tile: Tile },
  ReleasedRoom: {},
  PressedPicture: { pin: Pin },
  ClickedClearPin: {},
  ClickedKind: { kind: NoteKind },
  UpdatedNote: { value: Schema.String },
  ClickedSend: {},
  CompletedSendNote: { noteId: Schema.String },
  FailedSendNote: { reason: Schema.String },
  ReceivedNotes: { notes: Schema.Array(StoredNote) },
  LostInbox: {},
  ClickedStageMode: { mode: StageMode },
  ClickedStagePreset: { preset: StagePreset },
  ClickedAutoSpin: {},
  ClickedPlayCamera: {},
  ClickedLabToggle: {},
  ChangedLab: { id: Schema.String, text: Schema.String },
  ClickedLabReset: {},
  ClickedPropose: {},
})
export type Message = typeof Message.Type

// COMPONENT

// NOTE: the studio as defined. Its update is ./update.ts, its Commands and
// Subscriptions ./commands.ts, its view ./view.ts, and ./entry.ts makes and
// mounts it.
export const StudioDef = Html.component({
  name: 'Studio',
  props: Schema.Struct({ flags: Flags }),
  model: Model,
  message: Message,
  restore: false,
})

// NOTE: the view vocabulary every studio view is written against.
export type StudioH = Html.H<Message>
export type StudioHtml = View.Content<Message>

// NOTE: a picked thing's done notes the person has not looked at since.
export const freshDoneOf: {
  (targetId: string): (model: Model) => ReadonlyArray<StoredNote>
  (model: Model, targetId: string): ReadonlyArray<StoredNote>
} = Function.dual(
  2,
  (model: Model, targetId: string): ReadonlyArray<StoredNote> =>
    Array.filter(
      model.notes,
      note =>
        note.targetId === targetId &&
        note.status === 'Done' &&
        !Array.contains(model.seenDone, note.noteId),
    ),
)

export const notesFor: {
  (targetId: string): (model: Model) => ReadonlyArray<StoredNote>
  (model: Model, targetId: string): ReadonlyArray<StoredNote>
} = Function.dual(
  2,
  (model: Model, targetId: string): ReadonlyArray<StoredNote> =>
    Array.filter(model.notes, note => note.targetId === targetId),
)
