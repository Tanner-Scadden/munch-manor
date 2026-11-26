import { Array, Function, Option, Schema } from 'effect'

import { UiSchema, type View } from '@effect/ui'
import { Html } from '@effect/ui/html'

import { FacingChoice, Tab, Tone } from './catalog'
import { LabEdits } from './lab'
import { DEFAULT_LIVE, LiveScene, LiveTool } from './liveScene'
import { NoteKind, Pin, StoredNote, Tile, TileArea } from './notes'
import { StudioRoom } from './room'
import { StagePreset } from './stagePresets'

export const Backdrop = Schema.Literals(['Floor', 'Dark', 'Light', 'Grass'])
export type Backdrop = typeof Backdrop.Type

export const StageMode = Schema.Literals(['Flat', 'Blocks'])
export type StageMode = typeof StageMode.Type

export const ZOOMS: Array.NonEmptyReadonlyArray<number> = [2, 3, 4, 6, 8]

export const SPEEDS: Array.NonEmptyReadonlyArray<number> = [0.5, 1, 2]

export const SavedView = Schema.Struct({
  tab: Tab,
  zoom: Schema.Finite,
  backdrop: Backdrop,
  facing: FacingChoice,
  tone: Tone,
  maybeSelectedId: Schema.OptionFromNullOr(Schema.String),
  room: StudioRoom,
  isKitchenOpen: Schema.Boolean,
  house: Schema.Finite,
  isTwistOn: Schema.Boolean,
  live: LiveScene,
  liveTool: LiveTool,
  isGridOn: Schema.Boolean,
  isOnion: Schema.Boolean,
  isCrew: Schema.Boolean,
  speed: Schema.Finite,
  stageMode: StageMode,
  stagePreset: StagePreset,
  isAutoSpin: Schema.Boolean,
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
  maybeDraftArea: Schema.OptionFromNullOr(TileArea),
  maybeDragFrom: Schema.OptionFromNullOr(Tile),
  draftKind: NoteKind,
  note: Schema.String,
  sendStatus: SendStatus,
  notes: Schema.Array(StoredNote),
  seenDone: Schema.Array(Schema.String),
  isInboxOnline: Schema.Boolean,
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

export const StudioDef = Html.component({
  name: 'Studio',
  props: Schema.Struct({ flags: Flags }),
  model: Model,
  message: Message,
  restore: false,
})

export type StudioH = Html.H<Message>
export type StudioHtml = View.Content<Message>

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
