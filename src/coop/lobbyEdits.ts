import { Option, String } from 'effect'
import { modifyFields } from 'foldkit/struct'

import {
  type CallingStanding,
  callingPriceOf,
  callingStandingOf,
  isCallingOwned,
} from '../calling'
import {
  type Modifier,
  maskOfModifiers,
  modifiersOfMask,
  toggledModifier,
} from '../modifiers'
import { type Calling, type SavedBoughtCosmetics } from '../playerData'
import { cleanName, draftName, rollName } from '../profile'
import { stepWhen } from '../stepWhen'
import { callingOfMember } from './looks'
import { OutMessage } from './message'
import { LobbyChange, type Model, type NudgeReason, type Room } from './model'
import {
  CALLING_PILL_ID,
  NAME_BUTTON_ID,
  NAME_INPUT_ID,
  isInLobby,
  isPicking,
  maybeRoomOf,
  meIn,
  withRoom,
} from './roomState'

// The lobby's edits to yourself: the hero (a pick, a try-on, the BUY pill and
// its answer), a tap on a pick that is not yours, and your name. They are
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

  // NOTE: a player picks their own hero in the lobby. One they own goes to the
  // room's lobby for the others to see and to seat at the start, and up to the
  // parent, which saves it as the player's pick at home too. Nobody's READY
  // changes. Picking the one already worn only closes the picker. One for sale
  // (the rank reached, not bought) is tried on, as in the home picker, and its
  // BUY pill asks the parent to spend the Bones (`buyCalling`). One below the
  // rank stays shut.
  const closePicker = (model: Model, room: Room): R => ({
    model: withRoom(model, {
      ...room,
      isPickingCalling: false,
      maybeTryingCalling: Option.none(),
    }),
    commands: [commands.focus(CALLING_PILL_ID)],
  })

  const wearCalling = (model: Model, room: Room, calling: Calling): R => {
    const closed = closePicker(model, room)
    return {
      model: modifyFields(closed.model, { calling: () => calling }),
      commands: [
        commands.changeLobby(LobbyChange.ChangedMemberCalling({ calling })),
        ...(closed.commands ?? []),
      ],
    }
  }

  const pickCalling = (model: Model, room: Room, calling: Calling): R =>
    Option.match(meIn(room), {
      onNone: () => ({ model }),
      onSome: me => {
        if (!isInLobby(room)) {
          return { model }
        }
        return CALLING_TAPS[callingStandingOf(calling, me.rank, model.bought)]({
          model,
          room,
          calling,
          isWorn: callingOfMember(me) === calling,
        })
      },
    })

  type CallingTap = Readonly<{
    model: Model
    room: Room
    calling: Calling
    isWorn: boolean
  }>

  const CALLING_TAPS = {
    Owned: ({ model, room, calling, isWorn }: CallingTap): R =>
      isWorn
        ? closePicker(model, room)
        : {
            ...wearCalling(model, room, calling),
            outMessage: OutMessage.ChoseCalling({ calling }),
          },
    ForSale: ({ model, room, calling }: CallingTap): R => ({
      model: withRoom(model, {
        ...room,
        maybeTryingCalling: Option.some(calling),
      }),
    }),
    Locked: ({ model }: CallingTap): R => ({ model }),
  } satisfies Record<CallingStanding, (tap: CallingTap) => R>

  // NOTE: the BUY pill, for the hero being tried on while it is still for sale
  // and the Bones cover it. The parent spends them and answers with
  // `RequestedBoughtHero`, which makes the hero the pick; nothing is spent here.
  const buyCalling = (model: Model, room: Room): R =>
    Option.match(Option.all([room.maybeTryingCalling, meIn(room)]), {
      onNone: () => ({ model }),
      onSome: ([calling, me]) =>
        isInLobby(room) &&
        callingStandingOf(calling, me.rank, model.bought) === 'ForSale' &&
        model.bones >= Option.getOrElse(callingPriceOf(calling), () => 0)
          ? {
              model: withRoom(model, {
                ...room,
                maybeTryingCalling: Option.none(),
              }),
              outMessage: OutMessage.BoughtCalling({ calling }),
            }
          : { model },
    })

  // NOTE: the parent bought the hero: the purse is updated, and the hero is
  // the player's pick, sent to the room like any other pick. The parent has
  // saved it already, so no ChoseCalling goes up.
  const boughtHero = (
    model: Model,
    calling: Calling,
    bought: SavedBoughtCosmetics,
    bones: number,
  ): R => {
    const purse = modifyFields(model, {
      bought: () => bought,
      bones: () => bones,
    })
    return Option.match(maybeRoomOf(purse), {
      onNone: () => ({ model: purse }),
      onSome: room =>
        stepWhen<Model, R>(
          () => isInLobby(room) && isCallingOwned(calling, bought),
          () => wearCalling(purse, room, calling),
        )(purse),
    })
  }

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
  // dice as the Profile's Name tab (src/profile.ts). Saving sends the name to
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
    pickCalling,
    pickModifier,
    buyCalling,
    boughtHero,
    nudge,
    startNaming,
    stopNaming,
    typeName,
    rollNameDraft,
    keepName,
  }
}
