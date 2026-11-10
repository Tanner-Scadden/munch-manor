// Marks an art studio note done (./README.md), with a short reply the page
// shows beside it, so the person who wrote it sees it was handled.
//   bun tools/studio/resolve.ts <note id> "<reply>"
import {
  Array,
  Clock,
  Console,
  DateTime,
  Effect,
  FileSystem,
  Schema,
} from 'effect'

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'

import {
  NOTES_FILE,
  NoteEvent,
  NoteEventJson,
  eventsOf,
  notesOf,
} from './notes'

class UsageError extends Schema.TaggedError<
  UsageError,
  { readonly brand: unique symbol }
>()('UsageError', { message: Schema.String }) {}

const USAGE = 'usage: bun tools/studio/resolve.ts <note id> "<reply>"'

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const args = process.argv.slice(2)
  const noteId = yield* Effect.fromOption(Array.get(args, 0)).pipe(
    Effect.mapError(() => UsageError.make({ message: USAGE })),
  )
  const reply = Array.join(Array.drop(args, 1), ' ')
  const text = yield* fs
    .readFileString(NOTES_FILE)
    .pipe(Effect.orElseSucceed(() => ''))
  const notes = notesOf(eventsOf(text))
  if (!Array.some(notes, note => note.noteId === noteId)) {
    return yield* UsageError.make({ message: `no note ${noteId}. ${USAGE}` })
  }
  const now = yield* Clock.currentTimeMillis
  const line = yield* Schema.encodeEffect(NoteEventJson)(
    NoteEvent.Resolved({
      noteId,
      at: DateTime.formatIso(DateTime.makeUnsafe(now)),
      reply: reply === '' ? 'Done!' : reply,
    }),
  )
  yield* fs.writeFileString(NOTES_FILE, `${line}\n`, { flag: 'a' })
  yield* Console.log(`${noteId} marked done.`)
})

NodeRuntime.runMain(program.pipe(Effect.provide(NodeServices.layer)))
