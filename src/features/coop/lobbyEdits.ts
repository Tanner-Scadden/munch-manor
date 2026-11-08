import { Option, String } from 'effect'
import { modifyFields } from 'foldkit/struct'

import {
  LobbyChange,
  type NudgeReason,
  type Room,
  isInLobby,
} from '../../domain/coopRoom'
import { cleanName, draftName, rollName } from '../../domain/playerName'
import {
  type Modifier,
  maskOfModifiers,
  modifiersOfMask,
  toggledModifier,
} from '../../world/run/modifiers'
import { OutMessage } from './message'
import { type Model } from './model'
import {
  NAME_BUTTON_ID,
  NAME_INPUT_ID,
  isPicking,
  meIn,
  withRoom,
} from './roomState'

// The lobby's edits: the host's modifiers, a tap on a pick that is not
// yours, and your name (the hero is the picker's, src/features/coop/steps.ts). They are
// plain changes of the room; the Commands they return come from the caller,
// as the update names them (`ChangeLobby`, `FocusCoopElement`), so this
// module never imports the update that holds them.

export type EditCommands<C> = Readonly<{
  changeLobby: (change: LobbyChange) => C
  focus: (id: string) => C
}>

type EditReturn<C> = Readonly<{
  model: Model
  commands?: ReadonlyArray<C>
  outMessage?: OutMessage
}>

export const makeEdits = <C>(commands: EditCommands<C>) => {
  type R = EditReturn<C>

  // MODIFIERS

  // NOTE: the host turns a run modifier on or off, as they pick the
  // difficulty: the room takes back everyone's READY. A guest's tap is the
  // pick nudge's (the view sends that instead), so nothing here is theirs.
  const pickModifier = (model: Model, room: Room, modifier: Modifier): R =>
    Option.match(room.maybeLobby, {
      onNone: () => ({ model }),
      onSome: lobby =>
        isPicking(room)
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

  // NUDGE

  // NOTE: a tap on a pick that is not the player's to change: a guest's, since
  // the host picks, or the locked Nightmare. Nothing is sent; the lobby says
  // why, in place.
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

  // NAME

  // NOTE: a player renames themselves in the lobby with the same cleaning and
  // dice as the Profile's Name tab (src/features/profile/profile.ts). Saving sends the name to
  // the room for the others to see, and up to the parent, which keeps it as
  // the player's name everywhere else. An empty name or the one already worn
  // only closes the field. Nobody's READY changes.
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
              commands: [commands.focus(NAME_INPUT_ID)],
            }
          : { model },
    })

  const stopNaming = (model: Model, room: Room): R =>
    Option.isSome(room.maybeNameDraft)
      ? {
          model: withNameDraft(model, room, Option.none()),
          commands: [commands.focus(NAME_BUTTON_ID)],
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
          model: modifyFields(withNameDraft(model, room, Option.some(name)), {
            rngState: () => rngState,
          }),
          commands: [commands.focus(NAME_INPUT_ID)],
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
            model: modifyFields(closed.model, { name: () => name }),
            commands: [
              commands.changeLobby(LobbyChange.ChangedMemberName({ name })),
              ...(closed.commands ?? []),
            ],
            outMessage: OutMessage.ChoseName({ name }),
          }
        }
      },
    })

  return {
    pickModifier,
    nudge,
    startNaming,
    stopNaming,
    typeName,
    rollNameDraft,
    keepName,
  }
}
