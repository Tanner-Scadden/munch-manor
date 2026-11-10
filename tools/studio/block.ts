// The art studio's Block contract: its Model, Messages, and the flags it
// starts from. The update is ./update.ts, the Commands and Subscriptions
// ./commands.ts, the view ./view.ts.
import { Array, Function, Option, Schema } from 'effect'
import { Block } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'

import { FacingChoice, Tab, Tone } from './catalog'
import { NoteKind, Pin, StoredNote, Tile, TileArea } from './notes'
import { StudioRoom } from './room'

// MODEL

export const Backdrop = Schema.Literals(['Floor', 'Dark', 'Light', 'Grass'])
export type Backdrop = typeof Backdrop.Type

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
  // NOTE: a drafted room's twist: the chandelier down, the shelf open.
  isTwistOn: Schema.Boolean,
  isGridOn: Schema.Boolean,
  isOnion: Schema.Boolean,
  isCrew: Schema.Boolean,
  speed: Schema.Finite,
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
  room: 'Manor',
  isKitchenOpen: true,
  isTwistOn: false,
  isGridOn: true,
  isOnion: false,
  isCrew: false,
  speed: 1,
}

// MESSAGE

export const Message = defineMessageUnion({
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
  CompletedSaveView: {},
  CompletedSaveSeen: {},
})
export type Message = typeof Message.Type

// BLOCK

const StudioKey = Symbol('Studio')
export const StudioBlock = Block.make('Studio', {
  key: StudioKey,
  InitArgs: Schema.Tuple([Flags]),
  view: { kind: 'Document' },
  Model,
  Message,
})

export const { makeFieldsStep, makeNoopStep } = StudioBlock

export const StudioComposition = StudioBlock.makeComposition()
export type StudioViewBuilder = Block.ViewBuilderFor<typeof StudioComposition>

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
