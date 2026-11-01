import { Effect, Option } from 'effect'
import { Update } from 'foldkit'

import { NEUTRAL_INPUT } from '@munch/netcode'

import { CoopBinding } from '../bindings'
import { IS_COOP_RELEASED } from '../coop/release'
import { readRoomLink } from '../coop/roomState'
import * as Coop from '../coop/update'
import { playRoomFrame } from '../coopPlay'
import { makeCommand, makeStep } from '../definition'
import { isCoopKey } from '../home'
import { MenuState, menuState } from '../menuState'
import { Message } from '../message'
import type { Model } from '../model'
import { isLearned } from '../onboarding'
import { isLeftFromRoom, maybeRunRoom } from '../onlineRun'
import { lookCodeOf } from '../playerData'
import { joinName } from '../profile'
import { rankOf, totalPointsOf } from '../rank'
import { stepWhen } from '../stepWhen'
import type { SeatAction } from '../stepWorld'
import { FocusHomeButton, goHome } from './home'
import { type UpdateStep, combine, releaseInput, unchanged } from './step'
import { FetchBuild } from './version'

// COMMAND

// NOTE: a `?room=CODE` link, read once the splash is gone, joins that room.
export const ReadRoomLink = makeCommand('ReadRoomLink', {
  messages: [Message.CompletedReadRoomLink],
  handler: function* () {
    return () =>
      Effect.sync(() =>
        Message.CompletedReadRoomLink({
          maybeCode: readRoomLink(location.search),
        }),
      )
  },
})

// NOTE: once the splash is gone, a room link in the address joins its room.
export const askForRoomLink: UpdateStep = model => ({
  model,
  commands: [ReadRoomLink()],
})

// NOTE: co-op opens only for a player who has finished the tutorial
// (MULTIPLAYER.md, decision 14): wave 1 cleared and wave 2 started from its
// open break.
export const hasFinishedTutorial = (model: Model): boolean =>
  isLearned(model.lessons.openBreak)

export const isCoopOpen = (model: Model): boolean => Coop.isOpen(model.coop)

// OUT MESSAGES

// NOTE: the World a room run left in the root goes home once the room is
// gone. Co-op says so with LeftRoom, and every co-op OutMessage checks it,
// as NeededNewerBuild also drops the room.
export const leftRoom = stepWhen(isLeftFromRoom, goHome)

export const closedCoop: UpdateStep = stepModel =>
  combine(stepModel, [
    model => ({
      model,
      commands: [FocusHomeButton({ button: 'Coop' })],
    }),
    leftRoom,
  ])

// NOTE: a room that refuses this build's protocol asks for the build check
// at once, so the update chip shows the newer build to install.
export const neededNewerBuild: UpdateStep = stepModel =>
  combine(stepModel, [model => ({ model, commands: [FetchBuild()] }), leftRoom])

// THE ROOM'S FRAME

// NOTE: the room's frame clock is the root's (src/subscriptions.ts). In a
// run the room gets this client's controls and the root draws what came
// back (src/coopPlay.ts); in a lobby the room ticks with none.
export const tickRoomFrame = (nowMs: number) =>
  makeStep(model =>
    Option.isSome(maybeRunRoom(model))
      ? playRoomFrame(nowMs)
      : Update.combineSteps([
          CoopBinding.requestTickRoom({
            controls: NEUTRAL_INPUT,
            nowMs,
            isPictureHeld: false,
          }),
          leftRoom,
        ]),
  )

// OPERATIONS

// NOTE: a press for the room, sent with the next inputs.
export const pressInRoom = (action: SeatAction) =>
  makeStep(() => CoopBinding.requestPressAction({ action }))

export const pressCoopKey = (code: string) =>
  makeStep(() => CoopBinding.requestPressKey({ code }))

export const releaseCoopKey = (code: string) =>
  makeStep(() => CoopBinding.requestReleaseKey({ code }))

// NOTE: co-op opens over the bare home menu. A room link read at boot may
// land while the update greeting is up: co-op opens under it, so neither
// the link nor the party is lost.
const canOpenCoop = (model: Model): boolean =>
  IS_COOP_RELEASED &&
  hasFinishedTutorial(model) &&
  MenuState.isAnyOf(['Home', 'UpdateGreeting'])(menuState(model))

export const openCoop = (maybeCode: Option.Option<string>) =>
  makeStep(model =>
    canOpenCoop(model)
      ? Update.combineSteps([
          releaseInput,
          CoopBinding.requestOpen({
            name: joinName(model),
            maybeCode,
            look: lookCodeOf(model.appearance),
            rank: rankOf(totalPointsOf(model.rank)),
          }),
        ])
      : unchanged,
  )

export const coopFromKey = (code: string) =>
  makeStep(model =>
    isCoopKey(code) && !isCoopOpen(model) ? openCoop(Option.none()) : unchanged,
  )
