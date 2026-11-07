import {
  Clock,
  Duration,
  Effect,
  Function,
  Layer,
  Option,
  Schema,
  pipe,
} from 'effect'
import { FetchHttpClient, HttpClient, HttpClientResponse } from 'effect/http'

import { describeError } from './describeError'
import { Phase } from './model'

// BUILD

export const DEV_BUILD = 'dev'

export const RUNNING_BUILD: string = __BUILD_ID__

export const isCheckingForUpdates = (runningBuild: string): boolean =>
  runningBuild !== DEV_BUILD

export const maybeNewerBuild: {
  (remoteBuild: string): (runningBuild: string) => Option.Option<string>
  (runningBuild: string, remoteBuild: string): Option.Option<string>
} = Function.dual(
  2,
  (runningBuild: string, remoteBuild: string): Option.Option<string> =>
    remoteBuild === runningBuild ? Option.none() : Option.some(remoteBuild),
)

// NOTE: checks run on any quiet screen so a newer build is already known
// when the player reaches the home menu, the only screen with the chip.
export const isUpdateCheckWindow = Phase.isAnyOf([
  'Ready',
  'Preparation',
  'Paused',
  'Victory',
  'GameOver',
])

export const UPDATE_CHECK_INTERVAL = Duration.minutes(5)

// FETCH

const VERSION_FILE = 'version.json'
const FETCH_TIMEOUT = Duration.seconds(10)

const VersionFile = Schema.Struct({ build: Schema.String })

class VersionCheckError extends Schema.TaggedError<
  VersionCheckError,
  { readonly brand: unique symbol }
>()('VersionCheckError', {
  reason: Schema.String,
}) {}

const versionUrl = (stamp: number): string => {
  const url = new URL(VERSION_FILE, document.baseURI)
  url.searchParams.set('at', String(stamp))
  return url.href
}

// NOTE: no-store and the time query both keep a stale copy from answering,
// whatever the browser or a proxy in between would cache. Trace headers stay
// off so the request is the same plain GET it always was.
const fetchVersionFile = (stamp: number) =>
  pipe(
    Layer.build(FetchHttpClient.layer),
    Effect.flatMap(client =>
      pipe(
        HttpClient.get(versionUrl(stamp)),
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(VersionFile)),
        Effect.provideService(FetchHttpClient.RequestInit, {
          cache: 'no-store',
        }),
        Effect.provideService(HttpClient.TracerPropagationEnabled, false),
        Effect.provide(client),
      ),
    ),
    Effect.scoped,
    Effect.mapError(error => VersionCheckError.make({ reason: error.message })),
  )

export const fetchRemoteBuild: Effect.Effect<string, VersionCheckError> = pipe(
  Clock.currentTimeMillis,
  Effect.flatMap(fetchVersionFile),
  Effect.map(({ build }) => build),
  Effect.timeoutOrElse({
    duration: FETCH_TIMEOUT,
    orElse: () => Effect.fail(VersionCheckError.make({ reason: 'timed out' })),
  }),
)

// UPDATE MARKER

// NOTE: the gift reloads with the build it unwrapped in the address, so the
// page that loads can tell it was just updated, and onto which build. The
// greeting shows only when that build is the one running: a reload that
// still landed on the old build greets nobody. The marker leaves the address
// at once, so a later reload never greets again.
const UPDATE_MARKER_PARAM = 'updated'

const markedUrl = (build: string): string => {
  const url = new URL(window.location.href)
  url.searchParams.set(UPDATE_MARKER_PARAM, build)
  return url.href
}

export const reloadOnto = (
  build: string,
): Effect.Effect<void, VersionCheckError> =>
  Effect.try({
    try: () => window.location.replace(markedUrl(build)),
    catch: error => VersionCheckError.make({ reason: describeError(error) }),
  })

const takeUpdateMarker = (): Option.Option<string> => {
  const url = new URL(window.location.href)
  const maybeBuild = Option.fromNullishOr(
    url.searchParams.get(UPDATE_MARKER_PARAM),
  )
  if (Option.isSome(maybeBuild)) {
    url.searchParams.delete(UPDATE_MARKER_PARAM)
    window.history.replaceState(window.history.state, '', url.href)
  }
  return maybeBuild
}

export const readUpdateMarker: Effect.Effect<
  Option.Option<string>,
  VersionCheckError
> = Effect.try({
  try: takeUpdateMarker,
  catch: error => VersionCheckError.make({ reason: describeError(error) }),
})

export const isGreetingDue: {
  (maybeBuild: Option.Option<string>): (runningBuild: string) => boolean
  (runningBuild: string, maybeBuild: Option.Option<string>): boolean
} = Function.dual(
  2,
  (runningBuild: string, maybeBuild: Option.Option<string>): boolean =>
    Option.match(maybeBuild, {
      onNone: () => false,
      onSome: build => build === runningBuild,
    }),
)
