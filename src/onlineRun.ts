import { Array, Option } from 'effect'

import type { Room as CoopRoom } from './coop/model'
import { isInLobby, maybeRoomOf } from './coop/roomState'
import { type Model, Phase } from './model'
import { isCoop } from './party'
import { isRoundActive } from './waves'
import type { Difficulty, PlayerSlot } from './worldSchema'

// What the root reads about an online co-op run (MULTIPLAYER.md, Phase 2):
// whether one is on, its room, and its difficulty. Pure reads of the Model,
// apart from src/coopPlay.ts (the drawing) and src/update/coopRun.ts (the
// presses), so any update module can ask without importing either.

// NOTE: a room whose run is on, its lobby Playing.
export const maybeRunRoom = (model: Model): Option.Option<CoopRoom> =>
  Option.filter(maybeRoomOf(model.coop), room => !isInLobby(room))

// NOTE: a run is drawn from the room once its first World has come.
export const isOnlineRun = (model: Model): boolean =>
  Option.exists(maybeRunRoom(model), room => Option.isSome(room.maybeWorld))

// NOTE: the World a room run left in the root, after its room is gone.
export const isLeftFromRoom = (model: Model): boolean =>
  isCoop(model) &&
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

// NOTE: an online run in a round: its presses and frames go to the room.
export const isRunOn = (model: Model): boolean =>
  isOnlineRun(model) && isRoundActive(model.phase)

// NOTE: each seat's name from the room's lobby, in capitals. A seat nobody
// named is its number, as the room names it.
export const seatNamesOf = (model: Model): ReadonlyMap<PlayerSlot, string> =>
  new Map(
    Option.match(
      Option.flatMap(maybeRoomOf(model.coop), room => room.maybeLobby),
      {
        onNone: () => [],
        onSome: lobby =>
          Array.map(
            lobby.members,
            member => [member.slot, member.name.toUpperCase()] as const,
          ),
      },
    ),
  )
