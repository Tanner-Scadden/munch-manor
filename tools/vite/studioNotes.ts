import {
  Clock,
  DateTime,
  Effect,
  FileSystem,
  Option,
  Predicate,
  Result,
  Schema,
  Stream,
  String,
} from 'effect'
import { Base64 } from 'effect/encoding'
import type { Connect, Plugin } from 'vite'

import { nodeRuntime, textOf } from '../node.ts'
import {
  BEFORE_DIR,
  BEFORE_PATH,
  NOTES_FILE,
  NOTES_PATH,
  NoteDraftJson,
  NoteEvent,
  NoteEventJson,
  StoredNotesJson,
  eventsOf,
  nextNoteId,
  notesOf,
} from '../studio/notes.ts'

// The art studio's notes (tools/studio/README.md), on the dev server only.
// POST NOTES_PATH takes a note from the page, keeps its before picture in
// BEFORE_DIR, and appends it to NOTES_FILE; GET NOTES_PATH answers every
// note with its status; GET BEFORE_PATH<id>.png answers a before picture.

class NoteRefused extends Schema.TaggedError<
  NoteRefused,
  { readonly brand: unique symbol }
>()('NoteRefused', { message: Schema.String }) {}

const refused = (message: string): NoteRefused => NoteRefused.make({ message })

const PNG_PREFIX = 'data:image/png;base64,'

const NOTE_ID = /^n\d+$/

// NOTE: the request body as text, read off Node's stream.
const bodyOf = (request: Connect.IncomingMessage) =>
  textOf(
    Stream.filter(
      Stream.fromAsyncIterable<unknown, NoteRefused>(request, () =>
        refused('the body did not arrive'),
      ),
      Predicate.isUint8Array,
    ),
  )

const readEvents = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const text = yield* fs
    .readFileString(NOTES_FILE)
    .pipe(Effect.orElseSucceed(() => ''))
  return eventsOf(text)
})

const nowIso = Effect.map(Clock.currentTimeMillis, now =>
  DateTime.formatIso(DateTime.makeUnsafe(now)),
)

const pngOf = (dataUrl: string) =>
  String.startsWith(PNG_PREFIX)(dataUrl)
    ? Result.getSuccess(Base64.decode(String.slice(PNG_PREFIX.length)(dataUrl)))
    : Option.none()

const receive = (request: Connect.IncomingMessage) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const body = yield* bodyOf(request)
    const draft = yield* Schema.decodeEffect(NoteDraftJson)(body).pipe(
      Effect.mapError(error => refused(error.message)),
    )
    const events = yield* readEvents
    const noteId = nextNoteId(events)
    const maybePng = Option.flatMap(Option.fromNullishOr(draft.before), pngOf)
    if (Option.isSome(maybePng)) {
      yield* fs.makeDirectory(BEFORE_DIR, { recursive: true })
      yield* fs.writeFile(`${BEFORE_DIR}/${noteId}.png`, maybePng.value)
    }
    const line = yield* Schema.encodeEffect(NoteEventJson)(
      NoteEvent.Noted({
        tab: draft.tab,
        targetId: draft.targetId,
        title: draft.title,
        source: draft.source,
        kind: draft.kind,
        pin: draft.pin,
        area: draft.area,
        note: draft.note,
        noteId,
        at: yield* nowIso,
        hasBefore: Option.isSome(maybePng),
      }),
    )
    yield* fs.writeFileString(NOTES_FILE, `${line}\n`, { flag: 'a' })
    return noteId
  })

const listing = Effect.flatMap(readEvents, events =>
  Schema.encodeEffect(StoredNotesJson)(notesOf(events)),
)

const beforeFile = (name: string) =>
  Effect.gen(function* () {
    const id = String.replace('.png', '')(name)
    if (!NOTE_ID.test(id)) {
      return Option.none()
    }
    const fs = yield* FileSystem.FileSystem
    return yield* fs.readFile(`${BEFORE_DIR}/${id}.png`).pipe(Effect.option)
  })

type Answer = Readonly<{
  status: number
  type: string
  body: string | Uint8Array
}>

const answer = (
  status: number,
  type: string,
  body: string | Uint8Array,
): Answer => ({ status, type, body })

const route = (request: Connect.IncomingMessage) => {
  const url = request.url ?? ''
  if (String.startsWith(BEFORE_PATH)(url)) {
    return Effect.map(
      beforeFile(String.slice(BEFORE_PATH.length)(url)),
      maybe =>
        Option.match(maybe, {
          onNone: () => answer(404, 'text/plain', 'no picture'),
          onSome: file => answer(200, 'image/png', file),
        }),
    )
  }
  return request.method === 'POST'
    ? Effect.match(receive(request), {
        onFailure: error => answer(400, 'text/plain', error.message),
        onSuccess: noteId => answer(200, 'text/plain', noteId),
      })
    : Effect.match(listing, {
        onFailure: error => answer(500, 'text/plain', error.message),
        onSuccess: json => answer(200, 'application/json', json),
      })
}

export const studioNotes = (): Plugin => ({
  name: 'munch-manor:studio-notes',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const url = request.url ?? ''
      if (
        !String.startsWith(NOTES_PATH)(url) &&
        !String.startsWith(BEFORE_PATH)(url)
      ) {
        next()
        return
      }
      nodeRuntime.runFork(
        Effect.flatMap(route(request), ({ status, type, body }) =>
          Effect.sync(() => {
            if (request.method === 'POST') {
              server.config.logger.info(
                status === 200
                  ? `studio: note ${typeof body === 'string' ? body : ''} saved to ${NOTES_FILE}`
                  : 'studio: a note was refused',
                { timestamp: true },
              )
            }
            response.statusCode = status
            response.setHeader('Content-Type', type)
            response.setHeader('Cache-Control', 'no-cache')
            response.end(body)
          }),
        ),
      )
    })
  },
})
