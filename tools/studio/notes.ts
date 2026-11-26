import { Array, Schema, String, pipe } from 'effect'

import { UiSchema } from '@effect/ui'

export const NOTES_PATH = '/__studio/notes'

export const BEFORE_PATH = '/__studio/before/'

export const NOTES_FILE = 'tools/studio/notes.jsonl'

export const BEFORE_DIR = 'tools/studio/before'

export const NoteKind = Schema.Literals(['Change', 'Idea', 'Bug', 'Love'])
export type NoteKind = typeof NoteKind.Type

export const Tile = Schema.Struct({ column: Schema.Finite, row: Schema.Finite })
export type Tile = typeof Tile.Type

export const TileArea = Schema.Struct({
  left: Schema.Finite,
  top: Schema.Finite,
  right: Schema.Finite,
  bottom: Schema.Finite,
})
export type TileArea = typeof TileArea.Type

export const Pin = Schema.Struct({ x: Schema.Finite, y: Schema.Finite })
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

export const NoteDraft = Schema.Struct({
  ...NoteFields,
  before: Schema.NullOr(Schema.String),
})
export type NoteDraft = typeof NoteDraft.Type

export const NoteDraftJson = Schema.fromJsonString(NoteDraft)

export const NoteEvent = UiSchema.TaggedEnum({
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
type Noted = typeof NoteEvent.cases.Noted.Type

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

export const nextNoteId = (events: ReadonlyArray<NoteEvent>): string =>
  `n${Array.filter(events, NoteEvent.isAnyOf(['Noted'])).length + 1}`
