import { Effect, Function, Schema } from 'effect'
import type { Page } from 'playwright-core'

import type { Model } from '@game/app/model'
import { describeError } from '@game/shared/describeError'
import type { Level } from '@game/world/level/arena'
import type { RATTLES_BOX } from '@game/world/level/arena'

import type { AudioCue, seatsOnScreen } from './harness/director'

declare global {
  interface Window {
    __harnessReady?: boolean
    __sceneError?: string | undefined
    __whenSettled: () => Promise<void>
    __loadScene: (query: string) => Promise<void>
    __model: Model
    __messages: Array<string>
    __timings: {
      update: Array<number>
      view: Array<number>
      viewFrames: Array<number>
      tickFrames: Array<number>
    }
    __shapeCounts: Array<number>
    __countShapes: () => number
    __isFrozen: boolean
    __directedTick: number | undefined
    __animationStarts?: WeakMap<Animation, number>
    __director: Readonly<{
      start: (plan: string) => void
      step: (ticks: number) => void
      audio: () => ReadonlyArray<AudioCue>
      seats: () => ReturnType<typeof seatsOnScreen>
    }>
    __stall: typeof RATTLES_BOX
    __doors: Level['doors']
    __renderAudio: (json: string) => Promise<string>
    __splashTimes?: Record<string, number>
    __longTasks?: Array<[number, number]>
    __frameStamps?: Array<number>
    __pad?: { isPlugged: boolean; axes: Array<number>; buttons: Array<number> }
    __rumbles?: number
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

export class AuditFailed extends Schema.TaggedError<
  AuditFailed,
  { readonly brand: unique symbol }
>()('AuditFailed', { message: Schema.String }) {}

export const attempt = <A>(
  run: () => Promise<A>,
): Effect.Effect<A, AuditFailed> =>
  Effect.tryPromise({
    try: run,
    catch: error => AuditFailed.make({ message: describeError(error) }),
  })

export const failWith = (reason: string) =>
  AuditFailed.make({ message: reason })

type Typed<S extends Schema.ConstraintDecoder<unknown>> = Effect.Effect<
  S['Type'],
  AuditFailed | Schema.SchemaError
>

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
