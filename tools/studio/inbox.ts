// The agent's side of the art studio (./README.md): every open note, oldest
// first, with what it is about, where its pixels live, and its pin.
//   bun tools/studio/inbox.ts          the open notes
//   bun tools/studio/inbox.ts --all    every note, done ones with their reply
import { Array, Console, Effect, FileSystem, Option } from 'effect'

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'

import {
  BEFORE_DIR,
  NOTES_FILE,
  type StoredNote,
  eventsOf,
  notesOf,
} from './notes'
import { areaHeight, areaWidth, mapRowsOf } from './room'

const KIND_WORDS: Readonly<Record<StoredNote['kind'], string>> = {
  Change: 'CHANGE',
  Idea: 'IDEA',
  Bug: 'BUG',
  Love: 'LOVE IT',
}

const where = (note: StoredNote): ReadonlyArray<string> => [
  ...Option.toArray(
    Option.map(
      Option.fromNullishOr(note.pin),
      pin => `   pin: x ${pin.x}, y ${pin.y} (sprite pixels from its anchor)`,
    ),
  ),
  ...Option.match(Option.fromNullishOr(note.area), {
    onNone: () => [],
    onSome: area => [
      `   tiles: columns ${area.left} to ${area.right}, rows ${area.top} to ${area.bottom} (${areaWidth(area)} x ${areaHeight(area)}), the map there:`,
      ...Array.map(mapRowsOf(area), row => `     |${row}|`),
    ],
  }),
]

const lines = (note: StoredNote): ReadonlyArray<string> => [
  `${note.noteId} [${KIND_WORDS[note.kind]}] ${note.title} (${note.targetId}, ${note.tab} tab) at ${note.at}`,
  `   "${note.note}"`,
  `   pixels: ${note.source}`,
  ...where(note),
  ...(note.hasBefore ? [`   before: ${BEFORE_DIR}/${note.noteId}.png`] : []),
  ...(note.status === 'Done' ? [`   DONE: ${note.reply}`] : []),
]

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const isAll = Array.contains(process.argv.slice(2), '--all')
  const text = yield* fs
    .readFileString(NOTES_FILE)
    .pipe(Effect.orElseSucceed(() => ''))
  const notes = notesOf(eventsOf(text))
  const shown = isAll
    ? notes
    : Array.filter(notes, note => note.status === 'Open')
  yield* Console.log(
    Array.isReadonlyArrayEmpty(shown)
      ? 'No open notes.'
      : Array.join(
          Array.flatMap(shown, note => [...lines(note), '']),
          '\n',
        ),
  )
})

NodeRuntime.runMain(program.pipe(Effect.provide(NodeServices.layer)))
