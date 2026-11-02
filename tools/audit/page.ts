import { Schema } from 'effect'
import type { Page } from 'playwright-core'

import type { Level } from '@game/arena'
import type { Model } from '@game/model'
import type { STALL_BOX } from '@game/shop'

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

// NOTE: runs `pageFunction` in the page and decodes what comes back with
// `schema`, so an audit reads a typed value, and a page that changed shape
// fails here with the Schema's message instead of later as `undefined`.
// Declare a Schema for only the fields the audit reads: a Struct ignores the
// rest.
export function evaluateAs<S extends Schema.ConstraintDecoder<unknown>>(
  page: Page,
  schema: S,
  pageFunction: () => unknown,
): Promise<S['Type']>
export function evaluateAs<S extends Schema.ConstraintDecoder<unknown>, Arg>(
  page: Page,
  schema: S,
  pageFunction: (arg: Arg) => unknown,
  arg: Arg,
): Promise<S['Type']>
export async function evaluateAs<S extends Schema.ConstraintDecoder<unknown>>(
  page: Page,
  schema: S,
  pageFunction: (arg: unknown) => unknown,
  arg?: unknown,
): Promise<S['Type']> {
  return Schema.decodeUnknownPromise(schema)(
    await page.evaluate(pageFunction, arg),
  )
}
