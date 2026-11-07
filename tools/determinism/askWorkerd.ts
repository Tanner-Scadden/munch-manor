import { Duration, Effect, Schedule } from 'effect'
import {
  HttpClient,
  type HttpClientError,
  type HttpClientRequest,
} from 'effect/http'

// NOTE: a local workerd takes a moment to listen after it spawns, so a
// request that finds nobody there is sent again every 200 ms, up to 50 more
// times. Succeeds with the answer's text.
/** @stability unstable */
export const askWorkerd = (
  request: HttpClientRequest.HttpClientRequest,
): Effect.Effect<
  string,
  HttpClientError.HttpClientError,
  HttpClient.HttpClient
> =>
  HttpClient.execute(request).pipe(
    Effect.flatMap(response => response.text),
    Effect.retry({
      schedule: Schedule.spaced(Duration.millis(200)),
      times: 50,
    }),
  )
