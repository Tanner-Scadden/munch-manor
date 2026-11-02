// NOTE: the `coop=live` room in a Web Worker, off the page's main thread as
// the real room is on the server. Seat 0 is the page, over postMessage
// (liveNet.ts) with a fixed delay each way; the other seats are scripted
// players, each with a Session of its own, as src/roomTesting.ts plays them.

import { Array, Effect, Option, Result, Schedule, Schema } from 'effect'

import { scriptedInput } from '@game/roomTesting'
import type { OwnSeat, RoomWorld } from '@game/roomWorld'
import {
  type ClientFrame,
  NEUTRAL_INPUT,
  Room,
  Session,
  decodeClientFrame,
  decodeServerFrame,
  encodeServerFrame,
} from '@munch/netcode'

import { LiveRoomRequest, crowdedWorld } from './liveRoom'

const ONE_WAY_MS = 40
const STEP_MS = 4
const FRAME_MS = 1000 / 60
const PAGE_SOCKET = 'page'
const SEED = 7

type InFlight = Readonly<{ atMs: number; bytes: Uint8Array }>

type Bot = {
  readonly slot: number
  readonly socket: string
  session: Session.Session<RoomWorld, OwnSeat>
  inbox: Array<InFlight>
}

const playRoom = (seats: number, zombies: number, fromPage: Array<InFlight>) =>
  Effect.gen(function* () {
    const world = crowdedWorld(zombies)
    const startMs = performance.now()
    const bots: Array<Bot> = Array.makeBy(seats - 1, index => ({
      slot: index + 1,
      socket: `bot-${index + 1}`,
      session: Session.makeSession<RoomWorld, OwnSeat>(startMs),
      inbox: [],
    }))
    const started = Room.startRoom(
      world,
      [
        { slot: 0, playerId: 'player-0', socket: Option.some(PAGE_SOCKET) },
        ...Array.map(bots, bot => ({
          slot: bot.slot,
          playerId: `player-${bot.slot}`,
          socket: Option.some(bot.socket),
        })),
      ],
      SEED,
      startMs,
    )
    const state = {
      room: started.room,
      nextWakeMs: Room.nextWakeMs(started.room),
      nextFrameMs: startMs,
      toPage: Array.empty<InFlight>(),
    }
    const deliver = (out: ReadonlyArray<Room.Out>, nowMs: number) =>
      Array.forEach(out, item => {
        if (item._tag !== 'Send') {
          return
        }
        const sent = {
          atMs: nowMs + ONE_WAY_MS,
          bytes: Result.getOrThrow(encodeServerFrame(item.frame)),
        }
        if (item.socket === PAGE_SOCKET) {
          state.toPage.push(sent)
        }
        Array.forEach(bots, bot => {
          if (bot.socket === item.socket) {
            bot.inbox.push(sent)
          }
        })
      })
    const receive = (socket: string, frame: ClientFrame, nowMs: number) => {
      const received = Room.receive(world, state.room, socket, frame, nowMs)
      state.room = received.room
      deliver(received.out, nowMs)
    }
    const arrivedBy = (inFlight: Array<InFlight>, nowMs: number) =>
      inFlight.splice(
        0,
        Array.findFirstIndex(inFlight, ({ atMs }) => atMs > nowMs).pipe(
          Option.getOrElse(() => inFlight.length),
        ),
      )
    const playBot = (bot: Bot, nowMs: number) => {
      Array.forEach(arrivedBy(bot.inbox, nowMs), ({ bytes }) => {
        bot.session = Result.getOrThrow(
          Session.receive(
            world,
            bot.session,
            Result.getOrThrow(decodeServerFrame(bytes)),
            bytes.length,
            nowMs,
          ),
        )
      })
      const input = Option.match(Array.last(bot.session.frames), {
        onNone: () => NEUTRAL_INPUT,
        onSome: newest =>
          scriptedInput(
            newest.world,
            bot.slot,
            Math.floor(Session.inputTickAt(bot.session, nowMs)),
          ),
      })
      const ticked = Session.tickInput(world, bot.session, input, nowMs)
      bot.session = Session.render(world, ticked.session, nowMs).session
      Array.forEach(ticked.outgoing, frame => receive(bot.socket, frame, nowMs))
    }
    deliver(started.out, startMs)
    const step = Effect.sync(() => {
      const nowMs = performance.now()
      Array.forEach(arrivedBy(fromPage, nowMs), ({ bytes }) =>
        receive(
          PAGE_SOCKET,
          Result.getOrThrow(decodeClientFrame(bytes)),
          nowMs,
        ),
      )
      if (nowMs >= state.nextFrameMs) {
        state.nextFrameMs = Math.max(state.nextFrameMs + FRAME_MS, nowMs)
        Array.forEach(bots, bot => playBot(bot, nowMs))
      }
      if (nowMs >= state.nextWakeMs) {
        const advanced = Room.advance(world, state.room, nowMs)
        state.room = advanced.room
        state.nextWakeMs = Room.nextWakeMs(advanced.room)
        deliver(advanced.out, nowMs)
      }
      Array.forEach(arrivedBy(state.toPage, nowMs), ({ bytes }) =>
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a Worker's postMessage takes no target origin
        self.postMessage(bytes),
      )
    })
    return yield* Effect.repeat(step, Schedule.spaced(STEP_MS))
  })

const decodeRequest = Schema.decodeUnknownOption(LiveRoomRequest)
const fromPage: Array<InFlight> = []
const isStarted = { value: false }

self.onmessage = (event: MessageEvent<unknown>) =>
  Option.map(decodeRequest(event.data), request =>
    LiveRoomRequest.match(request, {
      Start: ({ seats, zombies }) => {
        if (isStarted.value) {
          return
        }
        isStarted.value = true
        Effect.runFork(playRoom(seats, zombies, fromPage))
      },
      Send: ({ bytes }) => {
        fromPage.push({ atMs: performance.now() + ONE_WAY_MS, bytes })
      },
    }),
  )
