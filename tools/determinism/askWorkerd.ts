import { Duration, Effect, Schedule } from 'effect'
import {
  HttpClient,
  type HttpClientError,
  type HttpClientRequest,
} from 'effect/http'

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
