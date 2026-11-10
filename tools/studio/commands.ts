// The art studio's Commands and Subscriptions: keeping the view and what has
// been seen across reloads, taking a note's before picture and sending it,
// and reading the notes back from the dev server as the agent answers them.
import { Array, Effect, Layer, Option, Schema, Stream, pipe } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http'

import { describeError } from '../../src/shared/describeError'
import { Flags, Message, SavedView, StudioBlock } from './block'
import { NOTES_PATH, NoteDraft, NoteDraftJson, StoredNotesJson } from './notes'

// STORAGE

// NOTE: the studio is a dev page with no store of its own: the view lives in
// sessionStorage (one tab's work), what has been seen in localStorage (it
// should not come back as new tomorrow).
const VIEW_KEY = 'munch-studio-view'
const SEEN_KEY = 'munch-studio-seen'

const SavedViewJson = Schema.fromJsonString(SavedView)
const SeenJson = Schema.fromJsonString(
  Schema.Struct({ seenNoteIds: Schema.Array(Schema.String) }),
)

const readKey = (storage: () => Storage, key: string) =>
  Effect.flatMap(
    Effect.try({
      try: () => Option.fromNullishOr(storage().getItem(key)),
      catch: error => describeError(error),
    }),
    Effect.fromOption,
  )

const writeKey = (storage: () => Storage, key: string, value: string) =>
  Effect.try({
    try: () => storage().setItem(key, value),
    catch: error => describeError(error),
  })

const session = (): Storage => sessionStorage
const local = (): Storage => localStorage

export const flags = Effect.all({
  maybeSavedView: pipe(
    readKey(session, VIEW_KEY),
    Effect.flatMap(Schema.decodeEffect(SavedViewJson)),
    Effect.option,
  ),
  seenDone: pipe(
    readKey(local, SEEN_KEY),
    Effect.flatMap(Schema.decodeEffect(SeenJson)),
    Effect.map(({ seenNoteIds }) => seenNoteIds),
    Effect.orElseSucceed(() => []),
  ),
}).pipe(Effect.map(fields => Flags.make(fields)))

export const SaveView = StudioBlock.makeCommand('SaveView', {
  args: { view: SavedView },
  messages: [Message.CompletedSaveView],
  handler: function* () {
    return ({ view }) =>
      pipe(
        Schema.encodeEffect(SavedViewJson)(view),
        Effect.flatMap(json => writeKey(session, VIEW_KEY, json)),
        Effect.as(Message.CompletedSaveView()),
        Effect.orElseSucceed(() => Message.CompletedSaveView()),
      )
  },
})

export const SaveSeen = StudioBlock.makeCommand('SaveSeen', {
  args: { seen: Schema.Array(Schema.String) },
  messages: [Message.CompletedSaveSeen],
  handler: function* () {
    return ({ seen }) =>
      pipe(
        Schema.encodeEffect(SeenJson)({ seenNoteIds: seen }),
        Effect.flatMap(json => writeKey(local, SEEN_KEY, json)),
        Effect.as(Message.CompletedSaveSeen()),
        Effect.orElseSucceed(() => Message.CompletedSaveSeen()),
      )
  },
})

// THE BEFORE PICTURE

const Crop = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  width: Schema.Finite,
  height: Schema.Finite,
})

// NOTE: which canvas to picture for a note, and the part of it, if not all.
export const Capture = Schema.Struct({
  selector: Schema.String,
  crop: Schema.NullOr(Crop),
})
export type Capture = typeof Capture.Type

// NOTE: a picture wider than this is scaled down, so a whole room stays a
// small file.
const MAX_PICTURE = 480

const pictureOf = (capture: Capture): Option.Option<string> => {
  const source = document.querySelector(capture.selector)
  if (!(source instanceof HTMLCanvasElement)) {
    return Option.none()
  }
  const crop = capture.crop ?? {
    x: 0,
    y: 0,
    width: source.width,
    height: source.height,
  }
  const scale = Math.min(1, MAX_PICTURE / Math.max(crop.width, crop.height))
  const picture = document.createElement('canvas')
  picture.width = Math.round(crop.width * scale)
  picture.height = Math.round(crop.height * scale)
  const context = picture.getContext('2d')
  if (context === null) {
    return Option.none()
  }
  context.imageSmoothingEnabled = false
  context.drawImage(
    source,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    picture.width,
    picture.height,
  )
  return Option.some(picture.toDataURL('image/png'))
}

// THE NOTES

class StudioUnreachable extends Schema.TaggedError<
  StudioUnreachable,
  { readonly brand: unique symbol }
>()('StudioUnreachable', { message: Schema.String }) {}

const unreachable = (error: unknown): StudioUnreachable =>
  StudioUnreachable.make({ message: describeError(error) })

const postDraft = (draft: NoteDraft) =>
  pipe(
    Layer.build(FetchHttpClient.layer),
    Effect.flatMap(client =>
      pipe(
        Schema.encodeEffect(NoteDraftJson)(draft),
        Effect.flatMap(body =>
          HttpClient.execute(
            HttpClientRequest.bodyText(
              HttpClientRequest.post(NOTES_PATH),
              body,
              'application/json',
            ),
          ),
        ),
        Effect.filterOrFail(
          response => response.status === 200,
          response =>
            unreachable(`the studio server answered ${response.status}`),
        ),
        Effect.flatMap(response => response.text),
        Effect.provide(client),
      ),
    ),
    Effect.scoped,
    Effect.mapError(unreachable),
  )

export const SendNote = StudioBlock.makeCommand('SendNote', {
  args: { draft: NoteDraft, capture: Capture },
  messages: [Message.CompletedSendNote, Message.FailedSendNote],
  handler: function* () {
    return ({ draft, capture }) =>
      pipe(
        Effect.sync(() => pictureOf(capture)),
        Effect.orElseSucceed(() => Option.none<string>()),
        Effect.flatMap(maybePicture =>
          postDraft({ ...draft, before: Option.getOrNull(maybePicture) }),
        ),
        Effect.map(noteId => Message.CompletedSendNote({ noteId })),
        Effect.catch(error =>
          Effect.succeed(Message.FailedSendNote({ reason: error.message })),
        ),
      )
  },
})

const fetchNotes = pipe(
  Layer.build(FetchHttpClient.layer),
  Effect.flatMap(client =>
    pipe(
      HttpClient.get(NOTES_PATH),
      Effect.flatMap(response => response.text),
      Effect.flatMap(Schema.decodeEffect(StoredNotesJson)),
      Effect.provide(client),
    ),
  ),
  Effect.scoped,
  Effect.mapError(unreachable),
)

// SUBSCRIPTIONS

// NOTE: the animation steps 20 times a second: every sprite's frames are
// 100 ms or longer, and a page that redraws less runs smooth.
const FRAME_STEP_MS = 50

// NOTE: how often the page asks for the notes, to see the agent's answers.
const INBOX_POLL = '2 seconds'

export const subscriptions = StudioBlock.makeSubscriptions(entry => ({
  frames: entry(
    'Frames',
    { isPlaying: Schema.Boolean },
    {
      messages: [Message.TickedFrame],
      modelToDependencies: model => ({ isPlaying: model.isPlaying }),
      handler: function* () {
        return ({ isPlaying }) =>
          isPlaying
            ? Stream.map(Stream.tick(`${FRAME_STEP_MS} millis`), () =>
                Message.TickedFrame({ deltaTime: FRAME_STEP_MS }),
              )
            : Stream.empty
      },
    },
  ),
  inbox: entry(
    'Inbox',
    {},
    {
      messages: [Message.ReceivedNotes, Message.LostInbox],
      modelToDependencies: () => ({}),
      handler: function* () {
        return () =>
          Stream.mapEffect(Stream.tick(INBOX_POLL), () =>
            pipe(
              fetchNotes,
              Effect.map(notes =>
                Message.ReceivedNotes({ notes: Array.fromIterable(notes) }),
              ),
              Effect.orElseSucceed(() => Message.LostInbox()),
            ),
          )
      },
    },
  ),
}))

export const EffectsLayer = Layer.mergeAll(
  SaveView.layer,
  SaveSeen.layer,
  SendNote.layer,
  subscriptions.layer,
)
