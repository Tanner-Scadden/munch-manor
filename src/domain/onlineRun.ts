import { Array, Option, String } from 'effect'

import type { Model } from '../app/model'
import { rankOf, totalPointsOf } from '../world/heroes/rank'
import { isCoop, leadSeatOf, playerCountOf } from '../world/party/party'
import { isRunUnderway } from '../world/run/arrival'
import { withMarkModifiers } from '../world/run/dareLadder'
import type { Modifiers } from '../world/run/modifiers'
import {
  type Difficulty,
  Phase,
  type PlayerSlot,
} from '../world/schema/worldSchema'
import { botNameOf, botSlotOf, isBotCrew } from './bots'
import { type Room as CoopRoom, isInLobby, maybeRoomOf } from './coopRoom'

// What the root reads about an online co-op run (MULTIPLAYER.md, Phase 2):
// whether one is on, its room, and its difficulty. Pure reads of the Model,
// apart from src/app/update/coopPlay.ts (the drawing) and src/app/update/coopRun.ts (the
// presses), so any update module can ask without importing either.

// NOTE: the end of a run the room has finished but this client has not drawn
// yet. The client draws the room 100 ms behind (Session's interpolation), so
// RoomClosed, and the lobby's result on the lobby's own socket, can both come
// before the frame that ends the run is drawn. Until it is, the run stays the
// root's to draw: while the game's socket still plays (the last frames are
// on their way), or once the end is in the session's frames. A session closed
// with no end in its frames has nothing more to draw.
const isEndToDraw = (model: Model, room: CoopRoom): boolean =>
  isRunUnderway(model.phase) &&
  (room.session.phase._tag === 'Playing' ||
    Option.exists(
      Array.last(room.session.frames),
      frame => !isRunUnderway(frame.world.world.phase),
    ))

// NOTE: a room whose run is on, its lobby Playing, or back in its lobby with
// the run's end still to draw, so the lobby never shows before the end card.
export const maybeRunRoom = (model: Model): Option.Option<CoopRoom> =>
  Option.filter(
    maybeRoomOf(model.coop),
    room => !isInLobby(room) || isEndToDraw(model, room),
  )

// NOTE: the room is back in its lobby, but the root still draws the run's
// end, so co-op keeps its arena up and not the lobby.
export const isRunEndComing = (model: Model): boolean =>
  Option.exists(
    maybeRoomOf(model.coop),
    room => isInLobby(room) && isEndToDraw(model, room),
  )

// NOTE: the room's frames tick while its game plays, and after RoomClosed
// until the root has drawn the run's end.
export const isRoomFrameDue = (model: Model): boolean =>
  Option.exists(
    maybeRoomOf(model.coop),
    room => room.session.phase._tag === 'Playing' || isEndToDraw(model, room),
  )

// NOTE: a run is drawn from the room once its first World has come.
const isOnlineRun = (model: Model): boolean =>
  Option.exists(maybeRunRoom(model), room => Option.isSome(room.maybeWorld))

// NOTE: the World a room run left in the root, after its room is gone.
export const isLeftFromRoom = (model: Model): boolean =>
  isCoop(model) &&
  !isBotCrew(model) &&
  model.localPlayers <= 1 &&
  !Phase.isAnyOf(['Ready'])(model.phase) &&
  Option.isNone(maybeRoomOf(model.coop))

// NOTE: the difficulty a run plays on: the room's, which its host picked,
// while the player is in a room that has sent a World, else their own.
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

// NOTE: the modifiers a run plays with: the room's, kept with the run
// (maybeRoomModifiers) so a LEAVE, which drops the room, still has them,
// else the player's own pick.
const playedModifiersOf = (run: Model): Modifiers =>
  Option.getOrElse(run.maybeRoomModifiers, () => run.modifiers)

// NOTE: the dare mark a run plays (src/world/run/dareLadder.ts): the room's,
// kept with the run as the modifiers are, else the player's own pick.
export const playedMarkOf = (run: Model): number =>
  Option.getOrElse(run.maybeRoomDareMark, () => run.dareMark)

// NOTE: the modifiers that bite in a run, its mark's too. Friendly Fire
// needs a teammate to hit, so with only one seat it is off, and pays
// nothing.
export const effectiveModifiersOf = (run: Model): Modifiers => {
  const played = withMarkModifiers(playedModifiersOf(run), playedMarkOf(run))
  return {
    ...played,
    friendlyFire: played.friendlyFire && playerCountOf(run) > 1,
  }
}

// NOTE: an online run under way, its intro too: its presses and frames go
// to the room.
export const isRunOn = (model: Model): boolean =>
  isOnlineRun(model) && isRunUnderway(model.phase)

// NOTE: a run with bots has no lobby: the human is their own name, and each
// bot its goofy one.
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
          model.crewBots,
          (bot, index) => [botSlotOf(model, index), botNameOf(bot)] as const,
        ),
      ]
    : []

// NOTE: each seat's name from the room's lobby, in capitals. A seat nobody
// named is its number, as the room names it.
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

// NOTE: in a run with bots only the human has a rank. A bot has none (0), and
// the crew board marks it BOT in the rank's place.
const botCrewRanks = (
  model: Model,
): ReadonlyArray<readonly [PlayerSlot, number]> =>
  isBotCrew(model)
    ? [
        [leadSeatOf(model).slot, rankOf(totalPointsOf(model.rank))],
        ...Array.map(
          model.crewBots,
          (_bot, index) => [botSlotOf(model, index), 0] as const,
        ),
      ]
    : []

// NOTE: each seat's rank from the room's lobby, as the player sent it when
// they joined. A seat the lobby does not know reads as rank 1.
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
