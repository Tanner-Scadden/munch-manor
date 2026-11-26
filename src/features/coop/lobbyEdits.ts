import { Option, String } from 'effect'

import { UiStruct } from '@effect/ui'

import {
  LobbyChange,
  type NudgeReason,
  type Room,
  isInLobby,
} from '#domain/coopRoom.ts'
import { cleanName, draftName, rollName } from '#domain/playerName.ts'
import { clampMark, isCoveredByMark } from '#world/run/dareLadder.ts'
import { nextEasyBreakOf } from '#world/run/difficulty.ts'
import {
  type Modifier,
  maskOfModifiers,
  modifiersOfMask,
  toggledModifier,
} from '#world/run/modifiers.ts'

import { CoopNotice } from './message.ts'
import { type Model } from './model.ts'
import { type CoopFocus, isPicking, meIn, withRoom } from './roomState.ts'

export type EditCommands<C> = Readonly<{
  changeLobby: (change: LobbyChange) => C
  focus: (target: CoopFocus) => C
}>

type EditReturn<C> = Readonly<{
  model: Model
  commands?: ReadonlyArray<C>
  notice?: CoopNotice
}>

export const makeEdits = <C>(commands: EditCommands<C>) => {
  type R = EditReturn<C>

  const pickModifier = (model: Model, room: Room, modifier: Modifier): R =>
    Option.match(room.maybeLobby, {
      onNone: () => ({ model }),
      onSome: lobby =>
        isPicking(room) && !isCoveredByMark(lobby.dareMark, modifier)
          ? {
              model,
              commands: [
                commands.changeLobby(
                  LobbyChange.ChangedModifiers({
                    modifiers: maskOfModifiers(
                      toggledModifier(
                        modifiersOfMask(lobby.modifiers),
                        modifier,
                      ),
                    ),
                  }),
                ),
              ],
            }
          : { model },
    })

  const pickEasyBreak = (model: Model, room: Room): R =>
    Option.match(room.maybeLobby, {
      onNone: () => ({ model }),
      onSome: lobby =>
        isPicking(room) && lobby.difficulty === 'Easy'
          ? {
              model,
              commands: [
                commands.changeLobby(
                  LobbyChange.ChangedEasyBreak({
                    seconds: nextEasyBreakOf(lobby.easyBreakSeconds),
                  }),
                ),
              ],
            }
          : { model },
    })

  const pickDareMark = (model: Model, room: Room, mark: number): R =>
    Option.match(room.maybeLobby, {
      onNone: () => ({ model }),
      onSome: lobby =>
        isPicking(room) && mark !== lobby.dareMark
          ? {
              model,
              commands: [
                commands.changeLobby(
                  LobbyChange.ChangedDareMark({ mark: clampMark(mark) }),
                ),
              ],
            }
          : { model },
    })

  const nudge = (model: Model, room: Room, reason: NudgeReason): R =>
    isInLobby(room)
      ? {
          model: withRoom(model, {
            ...room,
            maybeNudge: Option.some({
              reason,
              count: Option.match(room.maybeNudge, {
                onNone: () => 1,
                onSome: last => last.count + 1,
              }),
            }),
          }),
        }
      : { model }

  const withNameDraft = (
    model: Model,
    room: Room,
    maybeNameDraft: Option.Option<string>,
  ): Model => withRoom(model, { ...room, maybeNameDraft })

  const startNaming = (model: Model, room: Room): R =>
    Option.match(meIn(room), {
      onNone: () => ({ model }),
      onSome: me =>
        isInLobby(room)
          ? {
              model: withNameDraft(model, room, Option.some(me.name)),
              commands: [commands.focus('NameInput')],
            }
          : { model },
    })

  const stopNaming = (model: Model, room: Room): R =>
    Option.isSome(room.maybeNameDraft)
      ? {
          model: withNameDraft(model, room, Option.none()),
          commands: [commands.focus('NameButton')],
        }
      : { model }

  const typeName = (model: Model, room: Room, value: string): R =>
    Option.isSome(room.maybeNameDraft)
      ? { model: withNameDraft(model, room, Option.some(draftName(value))) }
      : { model }

  const rollNameDraft = (model: Model, room: Room): R =>
    Option.match(room.maybeNameDraft, {
      onNone: () => ({ model }),
      onSome: draft => {
        const [rngState, name] = rollName(model.rngState, cleanName(draft))
        return {
          model: UiStruct.evolve(
            withNameDraft(model, room, Option.some(name)),
            {
              rngState: () => rngState,
            },
          ),
          commands: [commands.focus('NameInput')],
        }
      },
    })

  const keepName = (model: Model, room: Room): R =>
    Option.match(room.maybeNameDraft, {
      onNone: () => ({ model }),
      onSome: draft => {
        const name = cleanName(draft)
        const closed = stopNaming(model, room)
        const isWorn = Option.exists(meIn(room), me => me.name === name)
        if (!isInLobby(room) || String.isEmpty(name) || isWorn) {
          return closed
        } else {
          return {
            model: UiStruct.evolve(closed.model, { name: () => name }),
            commands: [
              commands.changeLobby(LobbyChange.ChangedMemberName({ name })),
              ...(closed.commands ?? []),
            ],
            notice: CoopNotice.ChoseName({ name }),
          }
        }
      },
    })

  return {
    pickDareMark,
    pickEasyBreak,
    pickModifier,
    nudge,
    startNaming,
    stopNaming,
    typeName,
    rollNameDraft,
    keepName,
  }
}
