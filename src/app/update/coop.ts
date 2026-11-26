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

export const ReadRoomLink = Command.make('ReadRoomLink', { args: {} }, () =>
  Effect.sync(() =>
    Message.CompletedReadRoomLink({
      maybeCode: readRoomLink(location.search),
    }),
  ),
)

export const askForRoomLink: UpdateStep = $ => $.run(ReadRoomLink.make())

export const isCoopOpen = (model: Model): boolean => isOpen(model.coop)

const leftRoom: UpdateStep = stepWhen(isLeftFromRoom, goHome)

const choseCalling = (calling: Calling): UpdateStep =>
  modelStep(model => chooseCalling(model, calling))

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

const choseName = (name: string): UpdateStep =>
  modelStep(model =>
    UiStruct.evolve(model, { playerName: () => cleanName(name) }),
  )

const closedCoop: UpdateStep = combine([
  $ => $.run(FocusHomeButton.make({ button: 'Coop' })),
  leftRoom,
])

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

const runCoop =
  (result: CoopResult): UpdateStep =>
  $ =>
    result.notice === undefined
      ? applyCoop(result)($)
      : $.combine(applyCoop(result), noticeStep(result.notice))

const inCoop =
  (rule: (coop: CoopModel) => CoopResult): UpdateStep =>
  $ =>
    runCoop(rule($.model.coop))($)

const coopMessage = ($: App$, message: CoopMessage) =>
  inCoop(updateCoop(message))($)

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

export const pressInRoom = (action: SeatAction): UpdateStep =>
  inCoop(asRequest(coop => ({ model: pressAction(coop, action) })))

export const pressCoopKey = (code: string): UpdateStep =>
  inCoop(asRequest(pressKeyWithPicker(code)))

export const releaseCoopKey = (_code: string): UpdateStep =>
  inCoop(asRequest(coop => ({ model: coop })))

export const toggleCoopReady: UpdateStep = inCoop(asRequest(toggleReadyInRoom))

export const leaveCoopRoom: UpdateStep = inCoop(asRequest(leaveRoom))

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
