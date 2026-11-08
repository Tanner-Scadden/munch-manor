import { Effect, Function, Schema } from 'effect'
import type { Page } from 'playwright-core'

import type { Model } from '@game/app/model'
import { describeError } from '@game/shared/describeError'
import type { Level } from '@game/world/level/arena'
import type { STALL_BOX } from '@game/world/shop/shop'

import type { AudioCue, seatsOnScreen } from './harness/director'

// THE PAGE'S GLOBALS

// NOTE: what the harness (harness/entry.ts), the video tool's audio page
// (tools/video/audioPage.ts), and the audits' own init scripts put on
// `window`. Code inside `page.evaluate` runs in the page, so it reads them
// with their real types. A value that comes back out through Playwright's
// serializer loses its prototypes, so read anything but a plain number,
// string, or boolean with `evaluateAs` below.
declare global {
  interface Window {
    // NOTE: the harness's ready signal, or why the scene could not load.
    __harnessReady?: boolean
    __sceneError?: string | undefined
    // NOTE: resolves once the page has rendered and every image it asked
    // for has decoded.
    __whenSettled: () => Promise<void>
    // NOTE: swaps the scene in place; wait for the ready signal afterwards.
    __loadScene: (query: string) => Promise<void>
    __model: Model
    // NOTE: every Message the runtime dispatched, as `Tag:ChildTag` chains.
    __messages: Array<string>
    // NOTE: each frame's update and view time with `instrument`, and the
    // animation frame (its `document.timeline` time) each view and each
    // frame tick that changed the Model ran in.
    __timings: {
      update: Array<number>
      view: Array<number>
      viewFrames: Array<number>
      tickFrames: Array<number>
    }
    __shapeCounts: Array<number>
    __countShapes: () => number
    __isFrozen: boolean
    // NOTE: the video tool's controls (`director` in the query).
    __directedTick: number | undefined
    // NOTE: the video tool's paused CSS animations, by the tick each was
    // first seen on (tools/video/frames.ts).
    __animationStarts?: WeakMap<Animation, number>
    __director: Readonly<{
      start: (plan: string) => void
      step: (ticks: number) => void
      audio: () => ReadonlyArray<AudioCue>
      seats: () => ReturnType<typeof seatsOnScreen>
    }>
    __stall: typeof STALL_BOX
    __doors: Level['doors']
    // NOTE: tools/video's audio page renders a soundtrack request to a WAV
    // data URL.
    __renderAudio: (json: string) => Promise<string>
    // NOTE: splash.ts's init script: when each load moment happened (ms
    // from navigation, by name), and the long tasks as [start, duration].
    __splashTimes?: Record<string, number>
    __longTasks?: Array<[number, number]>
    // NOTE: shots43.ts's stand-ins for navigator.share and the clipboard:
    // what each was handed, whether the tap's user activation was still
    // live, and whether the click was still being dispatched.
    __shared?: Array<
      Readonly<{
        call: 'Sheet' | 'Copy'
        text: string
        isActive: boolean
        isInClick: boolean
      }>
    >
  }
}

// TYPED RESULTS

// NOTE: a browser call, or any promise a script waits on, that failed: the
// error every Effect in the audits carries, with the thrown value's message.
export class AuditFailed extends Schema.TaggedError<
  AuditFailed,
  { readonly brand: unique symbol }
>()('AuditFailed', { message: Schema.String }) {}

// NOTE: a promise, such as a Playwright call, as an Effect that fails with
// `AuditFailed`.
export const attempt = <A>(
  run: () => Promise<A>,
): Effect.Effect<A, AuditFailed> =>
  Effect.tryPromise({
    try: run,
    catch: error => AuditFailed.make({ message: describeError(error) }),
  })

// NOTE: fails the audit with `reason`, as a thrown Error did.
export const failWith = (reason: string) =>
  AuditFailed.make({ message: reason })

type Typed<S extends Schema.ConstraintDecoder<unknown>> = Effect.Effect<
  S['Type'],
  AuditFailed | Schema.SchemaError
>

// NOTE: what `run` hands back from the page, decoded with `schema`, for a
// page function that takes an argument (`evaluateAs` takes none).
export const decodedFrom: {
  (
    run: () => Promise<unknown>,
  ): <S extends Schema.ConstraintDecoder<unknown>>(schema: S) => Typed<S>
  <S extends Schema.ConstraintDecoder<unknown>>(
    schema: S,
    run: () => Promise<unknown>,
  ): Typed<S>
} = Function.dual(
  2,
  <S extends Schema.ConstraintDecoder<unknown>>(
    schema: S,
    run: () => Promise<unknown>,
  ): Typed<S> =>
    attempt(run).pipe(
      Effect.flatMap(value => Schema.decodeUnknownEffect(schema)(value)),
    ),
)

// NOTE: runs `pageFunction` in the page and decodes what comes back with
// `schema`, so an audit reads a typed value, and a page that changed shape
// fails here with the Schema's message instead of later as `undefined`.
// Declare a Schema for only the fields the audit reads: a Struct ignores the
// rest.
export const evaluateAs: {
  <S extends Schema.ConstraintDecoder<unknown>>(
    schema: S,
    pageFunction: () => unknown,
  ): (page: Page) => Typed<S>
  <S extends Schema.ConstraintDecoder<unknown>>(
    page: Page,
    schema: S,
    pageFunction: () => unknown,
  ): Typed<S>
} = Function.dual(
  3,
  <S extends Schema.ConstraintDecoder<unknown>>(
    page: Page,
    schema: S,
    pageFunction: () => unknown,
  ): Typed<S> => decodedFrom(schema, () => page.evaluate(pageFunction)),
)
