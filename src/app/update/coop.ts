import { Effect, Option } from 'effect'
import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { NEUTRAL_INPUT } from '@munch/netcode'

import { releaseDare } from '../../domain/beatMyRun'
import { isLeftFromRoom, maybeRunRoom } from '../../domain/onlineRun'
import { cleanName, joinName } from '../../domain/playerName'
import { IS_COOP_RELEASED } from '../../features/coop/release'
import { readRoomLink } from '../../features/coop/roomState'
import * as Coop from '../../features/coop/update'
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
import { CoopBinding } from '../bindings'
import { ApplicationBlock, makeStep } from '../definition'
import { MenuState, menuState } from '../menuState'
import { Message } from '../message'
import type { Model } from '../model'
import { playRoomFrame } from './coopPlay'
import { FocusHomeButton, goHome } from './home'
import { playSounds, tapSound, uiCue, unlockAudio } from './sound'
import {
  type UpdateStep,
  combine,
  defineHandlers,
  modelStep,
  releaseInput,
  unchanged,
} from './step'
import { FetchBuild } from './version'

// COMMAND

// NOTE: a `?room=CODE` link, read once the splash is gone, joins that room.
export const ReadRoomLink = ApplicationBlock.makeCommand('ReadRoomLink', {
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

export const isCoopOpen = (model: Model): boolean => Coop.isOpen(model.coop)

// OUT MESSAGES

// NOTE: the World a room run left in the root goes home once the room is
// gone. Co-op says so with LeftRoom, and every co-op OutMessage checks it,
// as NeededNewerBuild also drops the room.
export const leftRoom = stepWhen(isLeftFromRoom, goHome)

// NOTE: a hero picked in the lobby is the player's pick at home too, so
// the two agree, saved as any pick is (the rank was checked in the lobby, and
// `chooseCalling` checks it again).
export const choseCalling = (calling: Calling): UpdateStep =>
  modelStep(model => chooseCalling(model, calling))

// NOTE: the BUY pill in co-op's hero picker: the same purchase the home
// picker's BUY makes (`buyCalling`: the Bones spent, the id bought, the hero
// the pick, all saved and synced as a bought look is). Nothing if the hero is
// no longer for sale or the Bones fall short, so a stale tap buys nothing.
// Co-op is then handed the purse and the hero, to send the room.
export const boughtCalling = (calling: Calling) =>
  makeStep(model => {
    const after = buyCalling(model, calling)
    return callingStandingOf(
      calling,
      rankOf(totalPointsOf(model.rank)),
      model.boughtCosmetics,
    ) === 'ForSale' && canAffordCalling(model.rank, calling)
      ? Update.combineSteps([
          stepModel =>
            playSounds([uiCue('Purchase')])(buyCalling(stepModel, calling)),
          CoopBinding.requestBoughtHero({
            calling,
            bought: after.boughtCosmetics,
            bones: bonesBalanceOf(after.rank),
          }),
        ])
      : unchanged
  })

// NOTE: a name changed in the lobby is the player's name everywhere, kept
// and synced as the Profile's Name tab keeps it.
export const choseName = (name: string): UpdateStep =>
  modelStep(model => modifyFields(model, { playerName: () => cleanName(name) }))

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

// NOTE: the room's frame clock is the root's (src/app/subscriptions.ts). In a
// run the room gets this client's controls and the root draws what came
// back (src/app/update/coopPlay.ts); in a lobby the room ticks with none.
const tickRoomFrame = (nowMs: number) =>
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

// NOTE: co-op opens over the bare home menu, for every player, a new one
// too (MULTIPLAYER.md, decision 14). A room link read at boot may land while
// the update greeting is up: co-op opens under it, so neither the link nor
// the party is lost.
const canOpenCoop = (model: Model): boolean =>
  IS_COOP_RELEASED &&
  MenuState.isAnyOf(['Home', 'UpdateGreeting'])(menuState(model))

const openCoop = (maybeCode: Option.Option<string>) =>
  makeStep(model =>
    canOpenCoop(model)
      ? Update.combineSteps([
          releaseInput,
          modelStep(releaseDare),
          CoopBinding.requestOpen({
            name: joinName(model),
            maybeCode,
            look: lookCodeOf(model.appearance),
            rank: rankOf(totalPointsOf(model.rank)),
            calling: startingCallingOf(model),
            introSeen: model.introSeen === 'Seen',
            rngState: model.cosmeticRngState,
            bought: model.boughtCosmetics,
            bones: bonesBalanceOf(model.rank),
          }),
        ])
      : unchanged,
  )

export const coopFromKey = (code: string) =>
  makeStep(model =>
    isCoopKey(code) && !isCoopOpen(model) ? openCoop(Option.none()) : unchanged,
  )

// NOTE: CO-OP from home, a room link read at start, and the room's frame.
export const coopHandlers = defineHandlers({
  ClickedCoopButton: model =>
    Update.combineSteps(model, [
      unlockAudio,
      tapSound,
      openCoop(Option.none()),
    ]),

  CompletedReadRoomLink: (model, { maybeCode }) =>
    Update.combineSteps(model, [
      makeStep(() =>
        Option.isSome(maybeCode) ? openCoop(maybeCode) : unchanged,
      ),
    ]),

  TickedRoomFrame: (model, { nowMs }) =>
    Update.combineSteps(model, [tickRoomFrame(nowMs)]),
})
