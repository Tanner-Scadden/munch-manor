import { Array, Option, String } from 'effect'

import type { Model } from '#app/model.ts'
import { rankOf, totalPointsOf } from '#world/heroes/rank.ts'
import { isCoop, leadSeatOf, playerCountOf } from '#world/party/party.ts'
import { isRunUnderway } from '#world/run/arrival.ts'
import { withMarkModifiers } from '#world/run/dareLadder.ts'
import type { Modifiers } from '#world/run/modifiers.ts'
import {
  type Difficulty,
  Phase,
  type PlayerSlot,
} from '#world/schema/worldSchema.ts'

import { botNameOf, botSlotOf, isBotCrew } from './bots.ts'
import { type Room as CoopRoom, isInLobby, maybeRoomOf } from './coopRoom.ts'

const isEndToDraw = (model: Model, room: CoopRoom): boolean =>
  isRunUnderway(model.phase) &&
  (room.session.phase._tag === 'Playing' ||
    Option.exists(
      Array.last(room.session.frames),
      frame => !isRunUnderway(frame.world.world.phase),
    ))

export const maybeRunRoom = (model: Model): Option.Option<CoopRoom> =>
  Option.filter(
    maybeRoomOf(model.coop),
    room => !isInLobby(room) || isEndToDraw(model, room),
  )

export const isRunEndComing = (model: Model): boolean =>
  Option.exists(
    maybeRoomOf(model.coop),
    room => isInLobby(room) && isEndToDraw(model, room),
  )

export const isRoomFrameDue = (model: Model): boolean =>
  Option.exists(
    maybeRoomOf(model.coop),
    room => room.session.phase._tag === 'Playing' || isEndToDraw(model, room),
  )

const isOnlineRun = (model: Model): boolean =>
  Option.exists(maybeRunRoom(model), room => Option.isSome(room.maybeWorld))

export const isLeftFromRoom = (model: Model): boolean =>
  isCoop(model) &&
  !isBotCrew(model) &&
  model.localPlayers <= 1 &&
  !Phase.isAnyOf(['Ready'])(model.phase) &&
  Option.isNone(maybeRoomOf(model.coop))

export const runDifficultyOf = (model: Model): Difficulty =>
  Option.getOrElse(
    Option.flatMap(maybeRoomOf(model.coop), room =>
      Option.map(
        room.maybeWorld,
        roomWorld => roomWorld.world.difficulty.chosen,
      ),
    ),
    () => model.difficulty.chosen,
  )

const playedModifiersOf = (run: Model): Modifiers =>
  Option.getOrElse(run.roomRun.maybeRoomModifiers, () => run.modifiers)

export const playedMarkOf = (run: Model): number =>
  Option.getOrElse(run.roomRun.maybeRoomDareMark, () => run.dareMark)

export const effectiveModifiersOf = (run: Model): Modifiers => {
  const played = withMarkModifiers(playedModifiersOf(run), playedMarkOf(run))
  return {
    ...played,
    friendlyFire: played.friendlyFire && playerCountOf(run) > 1,
  }
}

export const isRunOn = (model: Model): boolean =>
  isOnlineRun(model) && isRunUnderway(model.phase)

const botCrewNames = (
  model: Model,
): ReadonlyArray<readonly [PlayerSlot, string]> =>
  isBotCrew(model)
    ? [
        [
          leadSeatOf(model).slot,
          String.toUpperCase(
            model.playerName === '' ? 'YOU' : model.playerName,
          ),
        ],
        ...Array.map(
          model.runStart.crewBots,
          (bot, index) => [botSlotOf(model, index), botNameOf(bot)] as const,
        ),
      ]
    : []

export const seatNamesOf = (model: Model): ReadonlyMap<PlayerSlot, string> =>
  new Map(
    Option.match(
      Option.flatMap(maybeRoomOf(model.coop), room => room.maybeLobby),
      {
        onNone: () => botCrewNames(model),
        onSome: lobby =>
          Array.map(
            lobby.members,
            member => [member.slot, String.toUpperCase(member.name)] as const,
          ),
      },
    ),
  )

const botCrewRanks = (
  model: Model,
): ReadonlyArray<readonly [PlayerSlot, number]> =>
  isBotCrew(model)
    ? [
        [leadSeatOf(model).slot, rankOf(totalPointsOf(model.rank))],
        ...Array.map(
          model.runStart.crewBots,
          (_bot, index) => [botSlotOf(model, index), 0] as const,
        ),
      ]
    : []

export const seatRanksOf = (model: Model): ReadonlyMap<PlayerSlot, number> =>
  new Map(
    Option.match(
      Option.flatMap(maybeRoomOf(model.coop), room => room.maybeLobby),
      {
        onNone: () => botCrewRanks(model),
        onSome: lobby =>
          Array.map(
            lobby.members,
            member => [member.slot, member.rank] as const,
          ),
      },
    ),
  )
