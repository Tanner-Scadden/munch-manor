// The art studio's Commands and Subscriptions: keeping the view and what has
// been seen across reloads, taking a note's before picture and sending it,
// and reading the notes back from the dev server as the agent answers them.
import { Array, Effect, Layer, Option, Schema, Stream, pipe } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http'

import { Command, Component, Subscription } from '@effect/ui'

import { describeError } from '../../src/shared/describeError'
import { Flags, Message, type Model, SavedView } from './block'
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

// NOTE: a write that fails leaves nothing to report: the view and what has
// been seen are only conveniences.
export const SaveView = Command.make(
  'SaveView',
  { args: { view: SavedView } },
  ({ view }) =>
    pipe(
      Schema.encodeEffect(SavedViewJson)(view),
      Effect.flatMap(json => writeKey(session, VIEW_KEY, json)),
      Effect.ignore,
      Effect.as(Component.noop),
    ),
)

export const SaveSeen = Command.make(
  'SaveSeen',
  { args: { seen: Schema.Array(Schema.String) } },
  ({ seen }) =>
    pipe(
      Schema.encodeEffect(SeenJson)({ seenNoteIds: seen }),
      Effect.flatMap(json => writeKey(local, SEEN_KEY, json)),
      Effect.ignore,
      Effect.as(Component.noop),
    ),
)

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

// NOTE: the canvas a note pictures, by its selector.
const canvasOf = (selector: string): Option.Option<HTMLCanvasElement> => {
  const source = document.querySelector(selector)
  return source instanceof HTMLCanvasElement && source.width > 0
    ? Option.some(source)
    : Option.none()
}

// NOTE: the picture as a PNG data URL, with no 2D canvas: the crop is cut and
// scaled by createImageBitmap (whole pixels kept), shown on a bitmaprenderer
// canvas of its own size, and encoded from there.
const encodePicture = (
  source: HTMLCanvasElement,
  capture: Capture,
): Effect.Effect<string, string> => {
  const crop = capture.crop ?? {
    x: 0,
    y: 0,
    width: source.width,
    height: source.height,
  }
  const scale = Math.min(1, MAX_PICTURE / Math.max(crop.width, crop.height))
  const width = Math.max(1, Math.round(crop.width * scale))
  const height = Math.max(1, Math.round(crop.height * scale))
  return pipe(
    Effect.tryPromise({
      try: () =>
        createImageBitmap(source, crop.x, crop.y, crop.width, crop.height, {
          resizeWidth: width,
          resizeHeight: height,
          resizeQuality: 'pixelated',
        }),
      catch: error => describeError(error),
    }),
    Effect.flatMap(bitmap =>
      Effect.try({
        try: () => {
          const picture = document.createElement('canvas')
          picture.width = bitmap.width
          picture.height = bitmap.height
          const context = picture.getContext('bitmaprenderer')
          if (context === null) {
            bitmap.close()
            return Option.none<string>()
          }
          context.transferFromImageBitmap(bitmap)
          return Option.some(picture.toDataURL('image/png'))
        },
        catch: error => describeError(error),
      }),
    ),
    Effect.flatMap(Effect.fromOption),
    Effect.mapError(error =>
      typeof error === 'string' ? error : 'no bitmap renderer',
    ),
  )
}

const pictureOf = (capture: Capture): Effect.Effect<Option.Option<string>> =>
  Option.match(canvasOf(capture.selector), {
    onNone: () => Effect.succeed(Option.none<string>()),
    onSome: source => pipe(encodePicture(source, capture), Effect.option),
  })

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

export const SendNote = Command.make(
  'SendNote',
  { args: { draft: NoteDraft, capture: Capture } },
  ({ draft, capture }) =>
    pipe(
      pictureOf(capture),
      Effect.flatMap(maybePicture =>
        postDraft({ ...draft, before: Option.getOrNull(maybePicture) }),
      ),
      Effect.match({
        onSuccess: noteId => Message.CompletedSendNote({ noteId }),
        onFailure: error => Message.FailedSendNote({ reason: error.message }),
      }),
    ),
)

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

const frames = Subscription.make(
  'Frames',
  Stream.map(Stream.tick(`${FRAME_STEP_MS} millis`), () =>
    Message.TickedFrame({ deltaTime: FRAME_STEP_MS }),
  ),
)

const inbox = Subscription.make(
  'Inbox',
  Stream.mapEffect(Stream.tick(INBOX_POLL), () =>
    pipe(
      fetchNotes,
      Effect.map(notes =>
        Message.ReceivedNotes({ notes: Array.fromIterable(notes) }),
      ),
      Effect.orElseSucceed(() => Message.LostInbox()),
    ),
  ),
)

// NOTE: the clock runs while the animation plays; the inbox always.
export const subscriptions = ({ model }: { readonly model: Model }) => [
  model.isPlaying && frames,
  inbox,
]
