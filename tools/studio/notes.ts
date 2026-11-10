import { Array, Schema, String, pipe } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { Vector } from '../../src/world/schema/entitySchema'

// NOTE: the notes between the art studio's page and the agent, as a log of
// events in NOTES_FILE, one JSON object a line: a note asked for (Noted) and
// a note done (Resolved). The page posts a draft to NOTES_PATH and reads the
// folded list back from it; tools/vite/studioNotes.ts writes the log, and
// ./inbox.ts and ./resolve.ts are the agent's side. A note's picture from
// before the change is a PNG in BEFORE_DIR, served under BEFORE_PATH.
export const NOTES_PATH = '/__studio/notes'

export const BEFORE_PATH = '/__studio/before/'

export const NOTES_FILE = 'tools/studio/notes.jsonl'

export const BEFORE_DIR = 'tools/studio/before'

export const NoteKind = Schema.Literals(['Change', 'Idea', 'Bug', 'Love'])
export type NoteKind = typeof NoteKind.Type

export const Tile = Schema.Struct({ column: Schema.Finite, row: Schema.Finite })
export type Tile = typeof Tile.Type

// NOTE: a block of room tiles, both corners included: what a drag over the
// room picks. One tile is an area with the same corners.
export const TileArea = Schema.Struct({
  left: Schema.Finite,
  top: Schema.Finite,
  right: Schema.Finite,
  bottom: Schema.Finite,
})
export type TileArea = typeof TileArea.Type

// NOTE: a spot on a picked sprite, in its pixels from its anchor.
export const Pin = Vector
export type Pin = typeof Pin.Type

const NoteFields = {
  tab: Schema.String,
  targetId: Schema.String,
  title: Schema.String,
  source: Schema.String,
  kind: NoteKind,
  pin: Schema.NullOr(Pin),
  area: Schema.NullOr(TileArea),
  note: Schema.String,
}

// NOTE: what the page sends: the note, and the picture of the thing as it
// looked, a PNG data URL, if the page could take one.
export const NoteDraft = Schema.Struct({
  ...NoteFields,
  before: Schema.NullOr(Schema.String),
})
export type NoteDraft = typeof NoteDraft.Type

export const NoteDraftJson = Schema.fromJsonString(NoteDraft)

export const NoteEvent = defineTaggedUnion({
  Noted: {
    ...NoteFields,
    noteId: Schema.String,
    at: Schema.String,
    hasBefore: Schema.Boolean,
  },
  Resolved: {
    noteId: Schema.String,
    at: Schema.String,
    reply: Schema.String,
  },
})
export type NoteEvent = typeof NoteEvent.Type
type Noted = typeof NoteEvent.Noted.Type

export const NoteEventJson = Schema.fromJsonString(NoteEvent)

const NoteStatus = Schema.Literals(['Open', 'Done'])

export const StoredNote = Schema.Struct({
  ...NoteFields,
  noteId: Schema.String,
  at: Schema.String,
  hasBefore: Schema.Boolean,
  status: NoteStatus,
  reply: Schema.String,
})
export type StoredNote = typeof StoredNote.Type

export const StoredNotesJson = Schema.fromJsonString(Schema.Array(StoredNote))

const decodeEvent = Schema.decodeOption(NoteEventJson)

// NOTE: the log's lines that read as events. A line that does not (a hand
// edit gone wrong) is skipped rather than losing every note after it.
export const eventsOf = (text: string): ReadonlyArray<NoteEvent> =>
  pipe(
    String.split(text, '\n'),
    Array.filter(line => String.isNonEmpty(String.trim(line))),
    Array.map(line => decodeEvent(line)),
    Array.getSomes,
  )

const openNote = (event: Noted): StoredNote => ({
  tab: event.tab,
  targetId: event.targetId,
  title: event.title,
  source: event.source,
  kind: event.kind,
  pin: event.pin,
  area: event.area,
  note: event.note,
  noteId: event.noteId,
  at: event.at,
  hasBefore: event.hasBefore,
  status: 'Open',
  reply: '',
})

// NOTE: the notes the log holds, oldest first, each with its last reply.
export const notesOf = (
  events: ReadonlyArray<NoteEvent>,
): ReadonlyArray<StoredNote> =>
  Array.reduce(events, Array.empty<StoredNote>(), (notes, event) =>
    NoteEvent.match(event, {
      Noted: noted => Array.append(notes, openNote(noted)),
      Resolved: ({ noteId, reply }) =>
        Array.map(notes, note =>
          note.noteId === noteId
            ? { ...note, status: 'Done' as const, reply }
            : note,
        ),
    }),
  )

// NOTE: the next note's id: n1, n2, and on, one past the notes so far.
export const nextNoteId = (events: ReadonlyArray<NoteEvent>): string =>
  `n${Array.filter(events, NoteEvent.isAnyOf(['Noted'])).length + 1}`
