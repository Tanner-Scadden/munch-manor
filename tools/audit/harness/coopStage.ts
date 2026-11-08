// NOTE: co-op staged at one screen for a scene (`coop=<stage>`): the hub,
// the queue, a lobby, or a room's arena, with a fake network that never
// answers.

import { Array, Function, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { Message } from '@game/app/message'
import { type Model, Phase } from '@game/app/model'
import { update } from '@game/app/pureApp'
import * as CoopModel from '@game/domain/coopRoom'
import {
  CODE as COOP_CODE,
  lobbyOf,
  memberOf,
  playingSession,
  stagedWorld,
} from '@game/features/coop/testing'
import type { Model as HeroPickerModel } from '@game/features/heroes/model'
import type { RoomWorld } from '@game/world/net/roomWorld'
import { modifySeat, modifySeatRecord } from '@game/world/party/party'
import { Session } from '@munch/netcode'

import { type HarnessConfig } from './config'
import { LIVE_SEATS } from './liveRoom'

// NOTE: co-op staged at one screen, with a fake network that never
// answers, so the screen holds still for a screenshot.
const coopRoom = (
  members: ReadonlyArray<ReturnType<typeof memberOf>>,
  status: 'Lobby' | 'Playing',
  extra: Partial<CoopModel.Room> = {},
): CoopModel.Room => {
  const world = stagedWorld(
    Array.map(members, member => member.slot),
    members,
  )
  return {
    code: COOP_CODE,
    slot: 0,
    maybePlayerId: Option.some('player-0'),
    maybeLobby: Option.some(lobbyOf(members, status)),
    link: 'Online',
    droppedAtMs: Option.none(),
    session: {
      ...(status === 'Playing'
        ? playingSession(world, 0)
        : Session.makeSession(0)),
      rttMs: COOP_PINGS[0] ?? 0,
      rtts: Array.map(members, member => ({
        slot: member.slot,
        rttMs: COOP_PINGS[member.slot] ?? 0,
      })),
    },
    maybeWorld: status === 'Playing' ? Option.some(world) : Option.none(),
    frameEvents: [],
    eventsTick: 0,
    predictedShots: 0,
    tracers: [],
    tracerCount: 0,
    hits: { looked: 0, confirmed: 0 },
    presses: CoopModel.noPresses,
    share: 'Idle',
    codeCopies: 0,
    departure: 'Staying',
    maybeNameDraft: Option.none(),
    maybeNudge: Option.none(),
    ...extra,
  }
}

const COOP_NAMES = ['Tanner', 'Mo', 'Pip', 'Grumbles']

// NOTE: each staged player's run for the end card's crew board: kills,
// revives, downs, shots fired and landed, money earned and left.
const COOP_RUNS = [
  [212, 1, 2, 640, 410, 2450, 180],
  [148, 4, 1, 520, 230, 1800, 40],
  [96, 0, 5, 300, 220, 1210, 600],
  [171, 2, 0, 900, 380, 2900, 15],
]

const withRuns = (room: RoomWorld, phase: Phase): RoomWorld => ({
  ...room,
  world: Array.reduce(
    COOP_RUNS,
    modifyFields(room.world, { phase: () => phase }),
    (world, [kills, revives, downs, fired, hit, earned, balance], slot) =>
      modifySeatRecord(
        modifySeat(world, slot, {
          wallet: wallet => ({
            ...wallet,
            earned: earned ?? 0,
            balance: balance ?? 0,
          }),
        }),
        slot,
        seat => ({
          ...seat,
          kills: kills ?? 0,
          revives: revives ?? 0,
          downs: downs ?? 0,
          shotsFired: fired ?? 0,
          shotsHit: hit ?? 0,
        }),
      ),
  ),
})

// NOTE: a run that just ended on the end card, the room's lobby still on
// Playing, as the root sees it before LOBBY.
const endedRoom = (
  members: ReadonlyArray<ReturnType<typeof memberOf>>,
  phase: Phase,
): CoopModel.Room => {
  const room = coopRoom(members, 'Playing')
  return Option.match(room.maybeWorld, {
    onNone: () => room,
    onSome: world => {
      const ended = withRuns(world, phase)
      return {
        ...room,
        maybeWorld: Option.some(ended),
        session: {
          ...room.session,
          frames: [{ tick: ended.tick, world: ended, atMs: 0 }],
        },
      }
    },
  })
}

// NOTE: the looks the staged teammates sent with their joins; the first
// seat is the page's own player, who wears the page's own look.
// NOTE: each staged player's round trip: good, fair, poor, good.
const COOP_PINGS = [48, 140, 260, 90]

const COOP_LOOKS = [
  '',
  'Broad.Curly.Blonde.Deep.Coral.AAAA.H.D',
  'Slim.Long.Black.Fair.Gold.AGAB.J.B',
  'Broad.Short.Pink.Medium.Glow.CDAA.N.F',
]

// NOTE: the ranks the staged teammates sent: wood, tin, silver, and the
// golden drumstick, so the shots show the badges' tiers.
const COOP_RANKS = [7, 18, 33, 62]

// NOTE: and the callings, so the shots show a body prop for each hero and a
// hero icon by each teammate's name tag.
const COOP_CALLINGS = ['LineCook', 'Handyman', 'TrackStar', 'PennyPincher']

const coopScreen = (
  stage: NonNullable<HarnessConfig['coop']>,
  liveSeats: number,
) => {
  const Screen = CoopModel.Screen
  const queue = (
    waiting: number,
    offer: number,
    answer: CoopModel.OfferAnswer,
  ) =>
    Screen.Queue({
      queue: {
        names: COOP_NAMES.slice(0, waiting),
        waiting,
        position: 1,
        groupSize: 4,
        offerPlayers: offer,
        accepted: answer === 'Accepted' ? 2 : 1,
        answer,
      },
    })
  const members = (count: number, readyCount = 0) =>
    Array.map(COOP_NAMES.slice(0, count), (name, slot) =>
      modifyFields(
        memberOf(
          slot,
          name,
          slot < readyCount,
          COOP_LOOKS[slot] ?? '',
          false,
          COOP_RANKS[slot] ?? 1,
          COOP_CALLINGS[slot] ?? 'You',
        ),
        { pingMs: () => COOP_PINGS[slot] ?? 0 },
      ),
    )
  switch (stage) {
    case 'tile':
      return Screen.Closed()
    case 'hub':
      return Screen.Hub({ maybeProblem: Option.none() })
    case 'problem':
      return Screen.Hub({ maybeProblem: Option.some('Full') })
    case 'code':
      return Screen.Code({ typed: 'MN', maybeProblem: Option.none() })
    case 'asking':
      return Screen.Asking({ request: { _tag: 'Create' } })
    case 'queue':
      return queue(2, 0, 'Unanswered')
    case 'offer':
      return queue(3, 3, 'Unanswered')
    case 'accepted':
      return queue(3, 3, 'Accepted')
    case 'lobby':
      return Screen.InRoom({ room: coopRoom(members(2), 'Lobby') })
    case 'host':
      return Screen.InRoom({ room: coopRoom(members(4, 1), 'Lobby') })
    case 'heroes':
      return Screen.InRoom({ room: coopRoom(members(3, 1), 'Lobby') })
    case 'guest':
      return Screen.InRoom({
        room: coopRoom(members(3, 1), 'Lobby', {
          slot: 1,
          maybePlayerId: Option.some('player-1'),
        }),
      })
    case 'nudge':
      return Screen.InRoom({
        room: coopRoom(members(3, 1), 'Lobby', {
          slot: 1,
          maybePlayerId: Option.some('player-1'),
          maybeNudge: Option.some({ reason: 'HostPicks', count: 1 }),
        }),
      })
    case 'padlock':
      return Screen.InRoom({
        room: coopRoom(members(3, 1), 'Lobby', {
          maybeNudge: Option.some({ reason: 'Locked', count: 1 }),
        }),
      })
    case 'name': {
      const room = coopRoom(members(3, 1), 'Lobby')
      return Screen.InRoom({
        room: { ...room, maybeNameDraft: Option.some('Tanner') },
      })
    }
    case 'herosale':
    case 'heroshort':
      return Screen.InRoom({ room: coopRoom(members(3, 1), 'Lobby') })
    case 'picks': {
      const room = coopRoom(members(2, 1), 'Lobby')
      return Screen.InRoom({
        room: {
          ...room,
          maybeLobby: Option.map(room.maybeLobby, lobby => ({
            ...lobby,
            mode: 'Endless' as const,
            difficulty: 'Hard' as const,
          })),
        },
      })
    }
    case 'keep': {
      const room = coopRoom(
        Array.map(members(2), member =>
          member.slot === 0
            ? modifyFields(member, { canNightmare: () => true })
            : member,
        ),
        'Lobby',
        {
          slot: 1,
          maybePlayerId: Option.some('player-1'),
        },
      )
      return Screen.InRoom({
        room: {
          ...room,
          maybeLobby: Option.map(room.maybeLobby, lobby => ({
            ...lobby,
            mode: 'KeepGoing' as const,
            canKeepGoing: true,
            difficulty: 'Nightmare' as const,
          })),
        },
      })
    }
    case 'ready':
      return Screen.InRoom({
        room: coopRoom(
          Array.map(members(3, 3), (member, slot) =>
            slot === 2 ? modifyFields(member, { ready: () => false }) : member,
          ),
          'Lobby',
        ),
      })
    case 'result': {
      const room = coopRoom(members(3), 'Lobby')
      return Screen.InRoom({
        room: {
          ...room,
          maybeLobby: Option.map(room.maybeLobby, lobby => ({
            ...lobby,
            result: Option.some({
              round: 1,
              reason: 'GameOver' as const,
              ticks: 10800,
              scores: Array.map(members(3), (member, slot) => ({
                playerId: member.playerId,
                slot,
                score: [7, 12, 3][slot] ?? 0,
              })),
            }),
          })),
        },
      })
    }
    case 'arena':
      return Screen.InRoom({ room: coopRoom(members(4), 'Playing') })
    // NOTE: a room playing in a Worker (liveNet.ts), joined with no World
    // yet: its snapshots bring the World in.
    case 'live':
      return Screen.InRoom({
        room: {
          ...coopRoom(members(liveSeats), 'Playing'),
          session: Session.makeSession(0),
          maybeWorld: Option.none(),
        },
      })
    case 'away':
      return Screen.InRoom({
        room: coopRoom(members(3), 'Playing', { link: 'Reconnecting' }),
      })
    case 'card':
      return Screen.InRoom({
        room: endedRoom(members(4, 1), Phase.GameOver({ wave: 7 })),
      })
    case 'cardwon':
      return Screen.InRoom({
        room: endedRoom(members(3, 2), Phase.Victory()),
      })
    case 'cardduo':
      return Screen.InRoom({
        room: endedRoom(members(2), Phase.GameOver({ wave: 3 })),
      })
    case 'ended': {
      const room = coopRoom(members(3), 'Playing')
      return Screen.InRoom({
        room: {
          ...room,
          session: {
            ...room.session,
            phase: { _tag: 'Ended', reason: 'GameOver' },
          },
        },
      })
    }
  }
}

// NOTE: `mods` is the host's pick of run modifiers (a mask, as the lobby keeps
// it), shown in a staged lobby.
const withModifiersPicked = (
  screen: CoopModel.Screen,
  mask: number,
): CoopModel.Screen =>
  CoopModel.Screen.matchOrElse(
    screen,
    {
      InRoom: ({ room }) =>
        CoopModel.Screen.InRoom({
          room: {
            ...room,
            maybeLobby: Option.map(room.maybeLobby, lobby => ({
              ...lobby,
              modifiers: mask,
            })),
          },
        }),
    },
    () => screen,
  )

// NOTE: the hero picker the lobby stages show open: shut, open on the cards,
// or with the Track Star tried on (BUY lit or short of Bones).
const pickerOf = (stage: HarnessConfig['coop']): HeroPickerModel => {
  if (stage === 'heroes') {
    return { status: 'Open', maybeTrying: Option.none() }
  } else if (stage === 'herosale' || stage === 'heroshort') {
    return { status: 'Open', maybeTrying: Option.some('TrackStar') }
  } else {
    return { status: 'Closed', maybeTrying: Option.none() }
  }
}

// NOTE: a staged run draws its room's World as the game, one frame of it,
// as an online run does (src/app/update/coopPlay.ts).
export const withCoop: {
  (model: Model): (config: HarnessConfig) => Model
  (config: HarnessConfig, model: Model): Model
} = Function.dual(2, (config: HarnessConfig, model: Model): Model => {
  const stage = config.coop
  if (stage === undefined) {
    return model
  }
  const staged = modifyFields(model, {
    coop: coop => ({
      ...coop,
      screen: withModifiersPicked(
        coopScreen(stage, config.seats ?? LIVE_SEATS),
        config.mods ?? 0,
      ),
      heroPicker: pickerOf(stage),
    }),
  })
  const drawn = update(staged, Message.TickedRoomFrame({ nowMs: 0 })).model
  return stage === 'card' || stage === 'cardwon' || stage === 'cardduo'
    ? modifyFields(drawn, { screenMs: () => 60_000 })
    : drawn
})
