import { Effect, Option } from 'effect'

import { Command, UiStruct } from '@effect/ui'
import { NEUTRAL_INPUT } from '@munch/netcode'

import { releaseDare } from '../../domain/beatMyRun'
import { isLeftFromRoom, maybeRunRoom } from '../../domain/onlineRun'
import { cleanName, joinName } from '../../domain/playerName'
import { CoopNotice } from '../../features/coop/message'
import type { CoopMessage } from '../../features/coop/message'
import type { Model as CoopModel } from '../../features/coop/model'
import { IS_COOP_RELEASED } from '../../features/coop/release'
import { pressAction, readRoomLink } from '../../features/coop/roomState'
import { boughtHero } from '../../features/coop/steps'
import {
  type CoopResult,
  asRequest,
  isOpen,
  leaveRoom,
  open,
  pressKeyWithPicker,
  tickRoom,
  toggleReadyInRoom,
  updateCoop,
} from '../../features/coop/update'
import {
  buyCalling,
  chooseCalling,
  startingCallingOf,
} from '../../features/heroes/callingPick'
import { isCoopKey } from '../../screens/home/home'
import { lookCodeOf } from '../../shared/lookCodes'
import type { Calling } from '../../shared/playerData'
import { stepWhen } from '../../shared/stepWhen'
import { callingStandingOf, canAffordCalling } from '../../world/heroes/calling'
import { bonesBalanceOf, rankOf, totalPointsOf } from '../../world/heroes/rank'
import type { SeatAction } from '../../world/step/stepWorld'
import { MenuState, menuState } from '../menuState'
import { Message } from '../message'
import type { Model } from '../model'
import { applyCoop, playRoomFrame } from './coopPlay'
import { FocusHomeButton, goHome } from './home'
import { playSounds, tapSound, uiCue, unlockAudio } from './sound'
import {
  type App$,
  type UpdateStep,
  combine,
  defineHandlers,
  modelStep,
  releaseInput,
  toModel,
} from './step'
import { FetchBuild } from './version'

// Co-op in the root (MULTIPLAYER.md): its Model is the root's `coop` field,
// its Messages a group of the root's (src/features/coop/message.ts), and its
// rules (src/features/coop/update.ts) run here as the root's Steps, each
// rule's notice answered by the root's own Steps below.

// COMMAND

// NOTE: a `?room=CODE` link, read once the splash is gone, joins that room.
export const ReadRoomLink = Command.make('ReadRoomLink', { args: {} }, () =>
  Effect.sync(() =>
    Message.CompletedReadRoomLink({
      maybeCode: readRoomLink(location.search),
    }),
  ),
)

// NOTE: once the splash is gone, a room link in the address joins its room.
export const askForRoomLink: UpdateStep = $ => $.run(ReadRoomLink.make())

export const isCoopOpen = (model: Model): boolean => isOpen(model.coop)

// NOTICES

// NOTE: the World a room run left in the root goes home once the room is
// gone. Co-op says so with LeftRoom, and every co-op notice checks it, as
// NeededNewerBuild also drops the room.
const leftRoom: UpdateStep = stepWhen(isLeftFromRoom, goHome)

// NOTE: a hero picked in the lobby is the player's pick at home too, so
// the two agree, saved as any pick is (the rank was checked in the lobby, and
// `chooseCalling` checks it again).
const choseCalling = (calling: Calling): UpdateStep =>
  modelStep(model => chooseCalling(model, calling))

// NOTE: the BUY pill in co-op's hero picker: the same purchase the home
// picker's BUY makes (`buyCalling`: the Bones spent, the id bought, the hero
// the pick, all saved and synced as a bought look is). Nothing if the hero is
// no longer for sale or the Bones fall short, so a stale tap buys nothing.
// Co-op is then handed the purse and the hero, to send the room.
const boughtCalling =
  (calling: Calling): UpdateStep =>
  $ => {
    const model = $.model
    if (
      callingStandingOf(
        calling,
        rankOf(totalPointsOf(model.rank)),
        model.boughtCosmetics,
      ) !== 'ForSale' ||
      !canAffordCalling(model.rank, calling)
    ) {
      return model
    }
    const after = buyCalling(model, calling)
    return $.combine(
      toModel(after),
      playSounds([uiCue('Purchase')]),
      inCoop(
        asRequest(
          boughtHero({
            calling,
            bought: after.boughtCosmetics,
            bones: bonesBalanceOf(after.rank),
          }),
        ),
      ),
    )
  }

// NOTE: a name changed in the lobby is the player's name everywhere, kept
// and synced as the Profile's Name tab keeps it.
const choseName = (name: string): UpdateStep =>
  modelStep(model =>
    UiStruct.evolve(model, { playerName: () => cleanName(name) }),
  )

const closedCoop: UpdateStep = combine([
  $ => $.run(FocusHomeButton.make({ button: 'Coop' })),
  leftRoom,
])

// NOTE: a room that refuses this build's protocol asks for the build check
// at once, so the update chip shows the newer build to install.
const neededNewerBuild: UpdateStep = combine([
  $ => $.run(FetchBuild.make()),
  leftRoom,
])

const noticeStep = (notice: CoopNotice): UpdateStep =>
  CoopNotice.match(notice, {
    ClosedCoop: () => closedCoop,
    NeededNewerBuild: () => neededNewerBuild,
    LeftRoom: () => leftRoom,
    ChoseCalling: ({ calling }) => choseCalling(calling),
    ChoseName: ({ name }) => choseName(name),
    BoughtCalling: ({ calling }) => boughtCalling(calling),
  })

// RUNNING CO-OP'S RULES

// NOTE: a rule's result in the root: co-op's next Model and its Commands
// (applyCoop), then the root's answer to its notice.
const runCoop =
  (result: CoopResult): UpdateStep =>
  $ =>
    result.notice === undefined
      ? applyCoop(result)($)
      : $.combine(applyCoop(result), noticeStep(result.notice))

// NOTE: one of co-op's rules, run on the root's `coop` field as it stands.
const inCoop =
  (rule: (coop: CoopModel) => CoopResult): UpdateStep =>
  $ =>
    runCoop(rule($.model.coop))($)

// NOTE: one of co-op's Messages, by the rule co-op gives it.
const coopMessage = ($: App$, message: CoopMessage) =>
  inCoop(updateCoop(message))($)

// THE ROOM'S FRAME

// NOTE: the room's frame clock is the root's (src/app/subscriptions.ts). In a
// run the room gets this client's controls and the root draws what came
// back (src/app/update/coopPlay.ts); in a lobby the room ticks with none.
const tickRoomFrame =
  (nowMs: number): UpdateStep =>
  $ =>
    Option.isSome(maybeRunRoom($.model))
      ? playRoomFrame(nowMs)($)
      : $.combine(
          inCoop(
            asRequest(
              tickRoom({
                controls: NEUTRAL_INPUT,
                nowMs,
                isPictureHeld: false,
              }),
            ),
          ),
          leftRoom,
        )

// OPERATIONS

// NOTE: a press for the room, sent with the next inputs.
export const pressInRoom = (action: SeatAction): UpdateStep =>
  inCoop(asRequest(coop => ({ model: pressAction(coop, action) })))

// NOTE: the root hands co-op every key while it is open, so the home menu's
// keys stay out of the way (src/app/update/play.ts).
export const pressCoopKey = (code: string): UpdateStep =>
  inCoop(asRequest(pressKeyWithPicker(code)))

// NOTE: a key let go while co-op is open: co-op holds no keys, so only its
// stray picker check runs.
export const releaseCoopKey = (_code: string): UpdateStep =>
  inCoop(asRequest(coop => ({ model: coop })))

// NOTE: READY and LEAVE from the end card over a room's run
// (src/app/update/end.ts).
export const toggleCoopReady: UpdateStep = inCoop(asRequest(toggleReadyInRoom))

export const leaveCoopRoom: UpdateStep = inCoop(asRequest(leaveRoom))

// NOTE: co-op opens over the bare home menu, for every player, a new one
// too (MULTIPLAYER.md, decision 14). A room link read at boot may land while
// the update greeting is up: co-op opens under it, so neither the link nor
// the party is lost.
const canOpenCoop = (model: Model): boolean =>
  IS_COOP_RELEASED &&
  MenuState.isAnyOf(['Home', 'UpdateGreeting'])(menuState(model))

const openCoop = (maybeCode: Option.Option<string>): UpdateStep =>
  stepWhen(
    canOpenCoop,
    combine([
      releaseInput,
      modelStep(releaseDare),
      $ => {
        const model = $.model
        return inCoop(
          asRequest(
            open({
              name: joinName(model),
              maybeCode,
              look: lookCodeOf(model.appearance),
              rank: rankOf(totalPointsOf(model.rank)),
              calling: startingCallingOf(model),
              introSeen: model.introSeen === 'Seen',
              rngState: model.cosmetics.cosmeticRngState,
              bought: model.boughtCosmetics,
              bones: bonesBalanceOf(model.rank),
            }),
          ),
        )($)
      },
    ]),
  )

export const coopFromKey = (code: string): UpdateStep =>
  stepWhen(
    (model: Model) => isCoopKey(code) && !isCoopOpen(model),
    openCoop(Option.none()),
  )

// NOTE: CO-OP from home, a room link read at start, the room's frame, and
// every one of co-op's own Messages (src/features/coop/message.ts).
export const coopHandlers = defineHandlers({
  ClickedCoopButton: combine([unlockAudio, tapSound, openCoop(Option.none())]),

  CompletedReadRoomLink: ($, { maybeCode }) =>
    Option.match(maybeCode, {
      onNone: () => $.model,
      onSome: () => openCoop(maybeCode)($),
    }),

  TickedRoomFrame: ($, { nowMs }) => tickRoomFrame(nowMs)($),

  ClickedCoopQuickPlayButton: coopMessage,
  ClickedCoopCodeButton: coopMessage,
  ClickedCoopCreateButton: coopMessage,
  ClickedCoopBackButton: coopMessage,
  ClickedCoopCloseButton: coopMessage,
  UpdatedCoopCode: coopMessage,
  SubmittedCoopCode: coopMessage,
  SucceededRequestRoom: coopMessage,
  FailedRequestRoom: coopMessage,
  ReceivedQuickPlayEvent: coopMessage,
  ClickedCoopAcceptOfferButton: coopMessage,
  ClickedCoopKeepWaitingButton: coopMessage,
  ClickedCoopCancelQueueButton: coopMessage,
  ReceivedLobbyEvent: coopMessage,
  ReceivedRoomEvent: coopMessage,
  CompletedSendRoomFrames: coopMessage,
  ClickedCoopReadyButton: coopMessage,
  ClickedCoopKickButton: coopMessage,
  ClickedCoopModePick: coopMessage,
  ClickedCoopDifficultyPick: coopMessage,
  ClickedCoopModifierPick: coopMessage,
  ClickedCoopEasyBreakPick: coopMessage,
  ClickedCoopDareMarkPick: coopMessage,
  ClickedCoopCallingPill: coopMessage,
  ClickedCoopPickNudge: coopMessage,
  ClickedCoopNameButton: coopMessage,
  UpdatedCoopNameDraft: coopMessage,
  SubmittedCoopName: coopMessage,
  ClickedCoopNameDice: coopMessage,
  ClickedCoopNameCancel: coopMessage,
  ClickedCoopLeaveButton: coopMessage,
  CompletedLeaveRoom: coopMessage,
  ClickedCoopShareButton: coopMessage,
  CompletedShareRoomLink: coopMessage,
  ClickedCoopRoomCode: coopMessage,
  CompletedCopyRoomCode: coopMessage,
  PickedCoopHero: coopMessage,
  RequestedBuyCoopHero: coopMessage,
  RequestedCloseCoopHeroPicker: coopMessage,
})
