import { Array, Effect, Schema } from 'effect'

import type { PlayerInput } from '@munch/netcode'

import {
  DEFAULT_ROOM_SETTINGS,
  type RoomWorld,
  startRoomWorld,
  stepRoomWorld,
} from '../../src/world/net/roomWorld'
import { worldFromJson, worldToJson } from '../../src/world/net/worldWire'
import type { World } from '../../src/world/schema/world'
import { Intent } from '../../src/world/schema/worldSchema'
import { type InputsByPlayer, stepWorld } from '../../src/world/step/stepWorld'
import { decodeJson, encodeJson } from '../json'

export type PlayRequest = Readonly<{
  world: string
  intents: ReadonlyArray<readonly [slot: number, intent: string]>
  ticks: number
}>

const IntentJson = Schema.toCodecJson(Intent)
const encodeIntent = encodeJson(IntentJson)
const decodeIntent = decodeJson(IntentJson)

export const intentToJson = (intent: Intent): string => encodeIntent(intent)

const play = (world: World, inputs: InputsByPlayer, ticks: number): World =>
  ticks <= 0 ? world : play(stepWorld(world, inputs).world, inputs, ticks - 1)

const inputsOf = (request: PlayRequest): InputsByPlayer =>
  new Map(
    Array.map(
      request.intents,
      ([slot, intent]) => [slot, decodeIntent(intent)] as const,
    ),
  )

export const playWorld = (
  request: PlayRequest,
): Effect.Effect<string, Schema.SchemaError> =>
  Effect.gen(function* () {
    const world = yield* worldFromJson(request.world)
    return yield* worldToJson(play(world, inputsOf(request), request.ticks))
  })

export type RoomPlayRequest = Readonly<{
  slots: ReadonlyArray<number>
  seed: number
  inputs: ReadonlyArray<readonly [slot: number, input: PlayerInput]>
  ticks: number
}>

const playRoomTicks = (
  room: RoomWorld,
  request: RoomPlayRequest,
  ticks: number,
): RoomWorld =>
  ticks <= 0
    ? room
    : playRoomTicks(
        stepRoomWorld(
          room,
          Array.map(request.inputs, ([slot, input]) => ({
            slot,
            input,
            presence: 'Here',
            viewLagTicks: 0,
            rttMs: 0,
          })),
        ),
        request,
        ticks - 1,
      )

export const playRoomWorld = (
  request: RoomPlayRequest,
): Effect.Effect<string, Schema.SchemaError> =>
  Effect.gen(function* () {
    const played = playRoomTicks(
      startRoomWorld(request.slots, request.seed, DEFAULT_ROOM_SETTINGS),
      request,
      request.ticks,
    )
    const world = yield* worldToJson(played.world)
    return `${played.tick} ${world}`
  })
