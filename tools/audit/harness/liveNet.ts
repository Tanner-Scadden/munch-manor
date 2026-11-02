// NOTE: the harness's CoopNet for `coop=live`: the room is a real room in a
// Web Worker (liveRoom.worker.ts) and the page is its seat 0, through the
// real wire, `Session`, and the game's co-op client. Nothing else answers.

import {
  Clock,
  Effect,
  Layer,
  Option,
  Queue,
  Result,
  Schema,
  Stream,
} from 'effect'

import { CoopNet } from '@game/coop/net'
import { decodeServerFrame, encodeClientFrame } from '@munch/netcode'
import { RoomEvent } from '@munch/netcode/browser'

import { LiveRoomRequest } from './liveRoom'

const decodeBytes = Schema.decodeUnknownOption(Schema.Uint8Array)

const roomWorker = { maybe: Option.none<Worker>() }

const post = (request: LiveRoomRequest) =>
  Option.map(roomWorker.maybe, worker =>
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a Worker's postMessage takes no target origin
    worker.postMessage(request),
  )

const roomEvents = (seats: number, zombies: number) =>
  Stream.callback<Uint8Array>(queue =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const worker = new Worker(
          new URL('./liveRoom.worker.ts', import.meta.url),
          { type: 'module' },
        )
        worker.onmessage = (event: MessageEvent<unknown>) =>
          Option.map(decodeBytes(event.data), bytes =>
            Queue.offerUnsafe(queue, bytes),
          )
        roomWorker.maybe = Option.some(worker)
        post(LiveRoomRequest.cases.Start.make({ seats, zombies }))
        return worker
      }),
      worker =>
        Effect.sync(() => {
          worker.terminate()
          roomWorker.maybe = Option.none()
        }),
    ).pipe(Effect.flatMap(() => Effect.never)),
  ).pipe(
    Stream.filterMap(bytes =>
      Result.map(decodeServerFrame(bytes), frame => ({
        frame,
        bytes: bytes.length,
      })),
    ),
    Stream.mapEffect(({ frame, bytes }) =>
      Effect.map(Clock.currentTimeMillis, atMs =>
        RoomEvent.cases.Received.make({ frame, bytes, atMs }),
      ),
    ),
  )

export const liveCoopNet = (
  seats: number,
  zombies: number,
): Layer.Layer<CoopNet> =>
  Layer.succeed(
    CoopNet,
    CoopNet.of({
      requestRoom: () => Effect.never,
      quickPlay: () => Stream.never,
      answerOffer: () => Effect.void,
      cancelQuickPlay: Effect.void,
      lobby: () => Stream.never,
      changeLobby: () => Effect.void,
      room: () => roomEvents(seats, zombies),
      sendToRoom: frames =>
        Effect.sync(() =>
          frames.map(frame => {
            const bytes = Result.getOrThrow(encodeClientFrame(frame))
            post(LiveRoomRequest.cases.Send.make({ bytes }))
            return bytes.length
          }),
        ),
      leaveRoom: Effect.void,
      resyncRoom: Effect.void,
    }),
  )
