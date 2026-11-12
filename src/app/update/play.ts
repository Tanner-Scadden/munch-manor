import { Array, Function, Option } from 'effect'
import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { positionVariation } from '../../audio/audio'
import { isEndScreen } from '../../domain/run'
import {
  agePocketCard,
  foldPocketCard,
  isPocketCardBlocking,
} from '../../features/dare/pocketCard'
import { skipBeat } from '../../features/end/endBeat'
import {
  advanceCaseCard,
  ageCaseCard,
  isCaseCardBlocking,
  skipCaseCard,
} from '../../features/onboarding/caseCard'
import { advanceQuest } from '../../features/onboarding/firstBreakQuest'
import { advanceKitchenTour } from '../../features/onboarding/kitchenTour'
import {
  ageDebutCard,
  isDebutCardUp,
  learnFromFrame,
  learnStartWave,
  learnSwap,
  moveHintBand,
  skipDebutCard,
} from '../../features/onboarding/onboarding'
import { advanceRattlesIntro } from '../../features/onboarding/rattlesIntro'
import { isCouchKey, pressCouchKey } from '../../input/couch'
import { isPadStirred, newlyPressed } from '../../input/gamepad'
import {
  type PointerPress,
  isPauseKey,
  isStartKey,
  pressKey,
  releaseAll,
  releaseKey,
} from '../../input/input'
import type {
  Gamepad,
  InputDevice,
  Orientation,
  PointerDevice,
  SlotClick,
} from '../../input/inputSchema'
import { playerKeyAction } from '../../input/keyActions'
import type { PageVisibility } from '../../platform/deviceSchema'
import { dropClip } from '../../render/particles/particles'
import { stepWhen } from '../../shared/stepWhen'
import {
  inHandOf,
  isReloading,
  isWieldingMelee,
} from '../../world/gear/weapons'
import { focusOf, isCoop } from '../../world/party/party'
import { isArriving } from '../../world/run/arrival'
import { tallyFrame } from '../../world/run/stats'
import { SeatAction, gunSlotAction } from '../../world/step/stepWorld'
import { isRoundActive, pause } from '../../world/waves/waves'
import { makeStep } from '../definition'
import { advanceGame, clampFrameDelta, refreshIntent } from '../frame'
import { isLobbyOpen, isPanelOpen } from '../menuState'
import { type GunSlot, type Model, Phase } from '../model'
import { startWave } from '../runFlow'
import { actAsLead } from './action'
import { coopFromKey, isCoopOpen, pressCoopKey, releaseCoopKey } from './coop'
import {
  advanceEndScreen,
  endFromKey,
  isBeatSkipKey,
  isRunCardKey,
  runCardFromKey,
} from './end'
import {
  homeFocusFromKey,
  homeFromKey,
  leaveRunFromPad,
  menuFromKey,
} from './home'
import { advanceIntro, skipIntro } from './intro'
import { lobbyFromKey, playFromKey } from './lobby'
import { profileFromKey } from './profile'
import { rumbleFor } from './rumble'
import { isPaused, isScreenAnimated, startWhenAllowed, startsRun } from './run'
import {
  ammoTickCues,
  frameSoundCues,
  fridgeLandCues,
  kitchenCues,
  mendCues,
  playSounds,
  playStartSoundWhen,
  playSwapSoundWhen,
  playTune,
  pocketScratchCues,
  toggleAudioFromKey,
  unlockAudio,
} from './sound'
import {
  type UpdateStep,
  combine,
  modelStep,
  releaseInput,
  toModel,
  unchanged,
  withInput,
} from './step'
import { nextTrap, placeSelectedTrap, trapFromKey } from './traps'
import { checkForUpdate } from './version'

// The Steps the root's handlers (src/app/update/input.ts, src/app/main.ts)
// are made of: the frame, the keys and pointers, the guns and traps,
// pausing, and the build check.

export const useDevice: {
  (device: InputDevice): (model: Model) => Model
  (model: Model, device: InputDevice): Model
} = Function.dual(2, (model: Model, device: InputDevice): Model =>
  model.lastDevice === device
    ? model
    : modifyFields(model, { lastDevice: () => device }),
)

export const asAllowedPress: {
  (press: PointerPress): (model: Model) => PointerPress
  (model: Model, press: PointerPress): PointerPress
} = Function.dual(2, (model: Model, press: PointerPress): PointerPress =>
  press.device === 'Touch' && model.touchControls === 'Blocked'
    ? { ...press, device: 'Mouse' }
    : press,
)

export const orientationOf: {
  (height: number): (width: number) => Orientation
  (width: number, height: number): Orientation
} = Function.dual(2, (width: number, height: number): Orientation =>
  height > width ? 'Portrait' : 'Landscape',
)

export const resumeFromPointer = (model: Model): Model =>
  isPaused(model.phase) ? startWhenAllowed(model, model.mode) : model

const hasStartedWave = (before: Model, after: Model): boolean =>
  Phase.isAnyOf(['Preparation'])(before.phase) &&
  Phase.isAnyOf(['Wave'])(after.phase)

const learnStartWaveWhen = (before: Model, after: Model): Model =>
  hasStartedWave(before, after) ? learnStartWave(after) : after

const learnSwapWhen = (before: Model, after: Model): Model =>
  changedWeapon(before, after) ? learnSwap(after) : after

// NOTE: whether the key presses one of these seat actions, read from the
// one key table (src/input/keyActions.ts).
const isKeyFor = (
  model: Model,
  code: string,
  tags: ReadonlyArray<SeatAction['_tag']>,
): boolean =>
  Option.exists(playerKeyAction(model, code), SeatAction.isAnyOf(tags))

const preparationFromKey = (model: Model, code: string): Model => {
  if (isPauseKey(code)) {
    return pause(model)
  } else if (isKeyFor(model, code, ['Ready'])) {
    return startWave(model)
  } else {
    return model
  }
}

// NOTE: Start with the leave panel up answers the panel (leaveRunFromPad
// in src/app/update/home.ts), never the round under it. A key never gets
// here then: the panel's Dialog has the keyboard.
const resumeFromKey = (model: Model, code: string): Model =>
  isPauseKey(code) && !isPanelOpen(model, 'LeaveRun')
    ? startWhenAllowed(model, model.mode)
    : model

// NOTE: a press of the hand, unless a card holds the game: the new zombie
// card or the display case's (src/features/onboarding/caseCard.ts). The
// rule is the seat action's (src/world/step/stepWorld.ts).
const actInHand =
  (action: SeatAction) =>
  (model: Model): Model =>
    isCardHolding(model) ? model : actAsLead(model, action)

// NOTE: Q switches guns, or with the knife out goes back to the last gun.
const swapGun = actInHand(SeatAction.Swap())

// NOTE: F, or a tap on the knife slot: the knife in hand (GAME_DESIGN.md,
// "The knife and two gun slots").
const equipMelee = actInHand(SeatAction.Melee())

// NOTE: Q, F, and the number keys: 1 and 2 draw that gun, 3 the melee slot.
const swapFromKey = (model: Model, code: string): Model =>
  Option.match(playerKeyAction(model, code), {
    onNone: () => model,
    onSome: action =>
      SeatAction.matchOrElse(
        action,
        {
          Swap: () => swapGun(model),
          Melee: () => equipMelee(model),
          Draw: () => actInHand(action)(model),
        },
        () => model,
      ),
  })

const changedWeapon = (before: Model, after: Model): boolean =>
  inHandOf(focusOf(before).player) !== inHandOf(focusOf(after).player)

const isFighting = Phase.isAnyOf(['Wave'])

// NOTE: in co-op the new zombie card shows without stopping the game
// (decided row 9), so only single player waits on it.
export const isDebutCardBlocking = (model: Model): boolean =>
  isFighting(model.phase) && isDebutCardUp(model) && !isCoop(model)

export const skipDebutCardWhenUp = (model: Model): Model =>
  isDebutCardBlocking(model) ? skipDebutCard(model) : model

// NOTE: a card that holds the round's buttons: the new zombie card in a
// wave, or the display case's in a break.
const isCardHolding = (model: Model): boolean =>
  isDebutCardBlocking(model) || isCaseCardBlocking(model)

export const skipCaseCardWhenUp = (model: Model): Model =>
  isCaseCardBlocking(model) ? skipCaseCard(model) : model

const caseCardFromKey = (model: Model, code: string): Model => {
  if (isStartKey(code)) {
    return skipCaseCard(model)
  } else if (isPauseKey(code)) {
    return pause(model)
  } else {
    return model
  }
}

const debutCardFromKey = (model: Model, code: string): Model => {
  if (isStartKey(code)) {
    return skipDebutCard(model)
  } else if (isPauseKey(code)) {
    return pause(model)
  } else {
    return model
  }
}

const phaseFromKey = (model: Model, code: string): Model =>
  Phase.match(model.phase, {
    Ready: () => model,
    Arriving: () => model,
    Preparation: () => preparationFromKey(model, code),
    Wave: () => (isPauseKey(code) ? pause(model) : model),
    Paused: () => resumeFromKey(model, code),
    Escaped: () => endFromKey(model, code),
    GameOver: () => endFromKey(model, code),
  })

const hasResumed = (before: Model, after: Model): boolean =>
  isPaused(before.phase) && !isPaused(after.phase)

// MENU TAPS

// RELOAD

const hasBegunReload = (before: Model, after: Model): boolean =>
  !isReloading(focusOf(before).player) && isReloading(focusOf(after).player)

const dropMagazine: UpdateStep = model =>
  playSounds([
    {
      sound: 'MagOut',
      variation: positionVariation(
        focusOf(model).player.x,
        focusOf(model).player.y,
      ),
    },
  ])(dropClip(model))

// NOTE: with the knife out, R puts the last gun back in hand to reload it.
const reloadHeldGun: UpdateStep = model => {
  const reloaded = actInHand(SeatAction.Reload())(model)
  return stepWhen(() => hasBegunReload(model, reloaded), dropMagazine)(reloaded)
}

const reloadFromKey = (code: string): UpdateStep =>
  stepWhen(model => isKeyFor(model, code, ['Reload']), reloadHeldGun)

// MEDIC

// NOTE: MEDIC! from a downed player (src/world/party/medic.ts): the interact key or a
// tap on the red cross. The tick after it sounds the shout.
const callMedic = modelStep(actInHand(SeatAction.CallMedic()))

const callMedicFromKey = (code: string): UpdateStep =>
  stepWhen(model => isKeyFor(model, code, ['CallMedic']), callMedic)

export const clickMedic: UpdateStep = model =>
  combine(model, [unlockAudio, callMedic])

// PAUSE

const pauseRound = modelStep(model => withInput(pause(model), releaseAll))

// NOTE: the pause button pauses a round under way and does nothing else.
export const clickPause = makeStep(model =>
  isRoundActive(model.phase)
    ? Update.combineSteps([unlockAudio, pauseRound])
    : unchanged,
)

export const pauseWhenAway = makeStep(model =>
  isRoundActive(model.phase) ? pauseRound : releaseInput,
)

// NOTE: a hidden page pauses the round; a page shown again checks for a
// newer build.
export const notePageVisibility = (visibility: PageVisibility) =>
  makeStep(model => {
    const noted = modifyFields(model, { pageVisibility: () => visibility })
    return visibility === 'Hidden'
      ? Update.combineSteps([toModel(noted), pauseWhenAway])
      : Update.combineSteps([toModel(noted), checkForUpdate])
  })

// FRAME

// NOTE: one frame of single player. An online run's room runs the World,
// so there its frames are TickedRoomFrame (orInRun in src/app/update/coopRun.ts).
export const tickFrame = (deltaTime: number) =>
  makeStep(model => {
    if (isDebutCardBlocking(model)) {
      return toModel(ageDebutCard(model, clampFrameDelta(deltaTime)))
    } else if (isPocketCardBlocking(model)) {
      const aged = agePocketCard(model, clampFrameDelta(deltaTime))
      return Update.combineSteps([
        toModel(aged),
        playSounds(pocketScratchCues(model, aged)),
      ])
    } else if (isCaseCardBlocking(model)) {
      return toModel(ageCaseCard(model, clampFrameDelta(deltaTime)))
    } else if (isArriving(model.phase)) {
      return advanceIntro(deltaTime)
    } else if (isRoundActive(model.phase)) {
      const framed = moveHintBand(
        advanceCaseCard(
          advanceKitchenTour(
            advanceQuest(
              advanceRattlesIntro(
                learnFromFrame(
                  model,
                  tallyFrame(
                    model,
                    advanceGame(model, deltaTime),
                    clampFrameDelta(deltaTime),
                  ),
                ),
                clampFrameDelta(deltaTime),
              ),
              clampFrameDelta(deltaTime),
            ),
            clampFrameDelta(deltaTime),
          ),
        ),
      )
      const advanced = agePocketCard(
        isCoop(framed)
          ? ageDebutCard(framed, clampFrameDelta(deltaTime))
          : framed,
        clampFrameDelta(deltaTime),
      )
      return Update.combineSteps([
        toModel(advanced),
        playSounds([
          ...frameSoundCues(advanced.frameEvents),
          ...ammoTickCues(advanced),
          ...fridgeLandCues(model, advanced),
          ...mendCues(model, advanced),
          ...kitchenCues(model, advanced),
          ...pocketScratchCues(model, advanced),
        ]),
        playTune(model, advanced),
        rumbleFor(advanced.frameEvents),
      ])
    } else if (isEndScreen(model.phase)) {
      return advanceEndScreen(clampFrameDelta(deltaTime))
    } else if (isScreenAnimated(model.phase)) {
      return toModel(
        modifyFields(model, {
          screenMs: screenMs => screenMs + clampFrameDelta(deltaTime),
        }),
      )
    } else {
      return unchanged
    }
  })

// KEYS

// NOTE: a key, or a controller's button by its code (src/input/gamepad.ts),
// pressed on the device it came from.
type ButtonPress = Readonly<{ code: string; device: InputDevice }>

const pressedButton = ({ code, device }: ButtonPress) =>
  makeStep(model => {
    const keyed = useDevice(model, device)
    if (isCouchKey(keyed, code)) {
      return toModel(
        withInput(pressCouchKey(keyed, code), input => pressKey(input, code)),
      )
    }
    if (isRunCardKey(keyed)) {
      return Update.combineSteps([
        toModel(toggleAudioFromKey(keyed, code)),
        runCardFromKey(code),
        unlockAudio,
      ])
    }
    if (isLobbyOpen(keyed)) {
      return Update.combineSteps([
        toModel(keyed),
        unlockAudio,
        lobbyFromKey(code),
      ])
    }
    if (isCoopOpen(keyed)) {
      return Update.combineSteps([
        toModel(keyed),
        unlockAudio,
        pressCoopKey(code),
      ])
    }

    if (isDebutCardBlocking(keyed)) {
      return Update.combineSteps([
        toModel(
          withInput(
            toggleAudioFromKey(debutCardFromKey(keyed, code), code),
            input => pressKey(input, code),
          ),
        ),
        unlockAudio,
      ])
    }

    if (isCaseCardBlocking(keyed)) {
      return Update.combineSteps([
        toModel(
          withInput(
            toggleAudioFromKey(caseCardFromKey(keyed, code), code),
            input => pressKey(input, code),
          ),
        ),
        unlockAudio,
      ])
    }

    if (isPocketCardBlocking(keyed)) {
      return Update.combineSteps([
        toModel(
          withInput(toggleAudioFromKey(foldPocketCard(keyed), code), input =>
            pressKey(input, code),
          ),
        ),
        unlockAudio,
      ])
    }

    if (isArriving(keyed.phase)) {
      return Update.combineSteps([
        toModel(toggleAudioFromKey(skipIntro(keyed), code)),
        unlockAudio,
      ])
    }

    if (isBeatSkipKey(keyed, code)) {
      return Update.combineSteps([
        toModel(toggleAudioFromKey(skipBeat(keyed), code)),
        unlockAudio,
      ])
    }

    const phased = phaseFromKey(keyed, code)
    const pressed = learnSwapWhen(
      model,
      learnStartWaveWhen(
        model,
        withInput(swapFromKey(toggleAudioFromKey(phased, code), code), input =>
          hasResumed(model, phased) ? input : pressKey(input, code),
        ),
      ),
    )
    return Update.combineSteps([
      toModel(pressed),
      unlockAudio,
      profileFromKey(code),
      coopFromKey(code),
      playFromKey(code),
      menuFromKey(code),
      homeFocusFromKey(code),
      homeFromKey(code),
      leaveRunFromPad(code),
      trapFromKey(code),
      reloadFromKey(code),
      callMedicFromKey(code),
      playStartSoundWhen(startsRun(model, pressed)),
      playSwapSoundWhen(changedWeapon(model, pressed)),
    ])
  })

export const pressedKey = (code: string) =>
  pressedButton({ code, device: 'KeyboardMouse' })

// CONTROLLERS

// NOTE: a polled controller is kept in the input, and once stirred it is
// the device, with the mouse's spot forgotten so a resting right stick
// never aims at a cursor left behind. Moving the mouse takes it back.
export const notePad: {
  (pad: Gamepad): (model: Model) => Model
  (model: Model, pad: Gamepad): Model
} = Function.dual(2, (model: Model, pad: Gamepad): Model => {
  const noted = withInput(model, input =>
    modifyFields(input, { maybeGamepad: () => Option.some(pad) }),
  )
  return isPadStirred(pad)
    ? withInput(useDevice(noted, 'Gamepad'), input =>
        modifyFields(input, { maybeMouseInView: () => Option.none() }),
      )
    : noted
})

// NOTE: the buttons this poll pressed, read before the pad is kept.
export const padPresses: {
  (pad: Gamepad): (model: Model) => ReadonlyArray<string>
  (model: Model, pad: Gamepad): ReadonlyArray<string>
} = Function.dual(2, (model: Model, pad: Gamepad): ReadonlyArray<string> =>
  newlyPressed(model.input.maybeGamepad, pad),
)

// NOTE: each new press goes the keys' way, as the pad's: the key table
// (src/input/keyActions.ts) turns it into the seat's action. A release
// needs nothing: what is held is read off the kept pad.
export const polledPad = (pad: Gamepad) =>
  makeStep(model =>
    Update.combineSteps([
      toModel(notePad(model, pad)),
      ...Array.map(padPresses(model, pad), code =>
        pressedButton({ code, device: 'Gamepad' }),
      ),
    ]),
  )

const isPadAt = (model: Model, index: number): boolean =>
  Option.exists(model.input.maybeGamepad, pad => pad.index === index)

export const forgetPad = (model: Model): Model =>
  withInput(model, input =>
    modifyFields(input, { maybeGamepad: () => Option.none() }),
  )

// NOTE: a controller unplugged, or out of battery, mid-round pauses it, as
// a blur does; plugged back in, its first poll is a fresh pad.
export const padGone = (index: number) =>
  makeStep(model =>
    isPadAt(model, index)
      ? Update.combineSteps([modelStep(forgetPad), pauseWhenAway])
      : unchanged,
  )

export const releasedKey = (code: string) =>
  makeStep(model => {
    const released = withInput(model, input => releaseKey(input, code))
    return isCoopOpen(released)
      ? Update.combineSteps([toModel(released), releaseCoopKey(code)])
      : toModel(released)
  })

// GUNS AND TRAPS

const drawFromButton =
  (draw: (model: Model) => Model): UpdateStep =>
  model => {
    const drawn = learnSwapWhen(model, refreshIntent(draw(model)))
    return combine(drawn, [
      unlockAudio,
      playSwapSoundWhen(changedWeapon(model, drawn)),
    ])
  }

export const swapFromButton: UpdateStep = drawFromButton(swapGun)

// NOTE: a tap on the held gun reloads it; on the other gun, or on either
// with the knife out, it puts that gun in hand.
export const pressGunSlot = (slot: GunSlot): UpdateStep =>
  stepWhen(
    model => !isCardHolding(model),
    model => {
      const action = gunSlotAction(focusOf(model).player, slot)
      return SeatAction.isAnyOf(['Reload'])(action)
        ? combine(model, [unlockAudio, reloadHeldGun])
        : drawFromButton(actInHand(action))(model)
    },
  )

// NOTE: the touch HUD's reload button: R's reload, so with the knife out
// it puts the last gun back in hand and reloads that.
export const reloadFromButton: UpdateStep = stepWhen(
  model => !isCardHolding(model),
  model => combine(model, [unlockAudio, reloadHeldGun]),
)

// NOTE: a press on a HUD gun or knife slot. With a mouse mid-wave it is a
// shot at the world beneath, like a click anywhere else, so a zombie behind
// the slots still gets shot; keyboard players swap with Q, F, and R. A
// touch, or a mouse in a break, leaves the slot's click to act.
export const isSlotPressAShot: {
  (device: PointerDevice): (model: Model) => boolean
  (model: Model, device: PointerDevice): boolean
} = Function.dual(
  2,
  (model: Model, device: PointerDevice): boolean =>
    device === 'Mouse' && Phase.isAnyOf(['Wave'])(model.phase),
)

export const withSlotClick: {
  (slotClick: SlotClick): (model: Model) => Model
  (model: Model, slotClick: SlotClick): Model
} = Function.dual(2, (model: Model, slotClick: SlotClick): Model =>
  withInput(model, input =>
    modifyFields(input, { slotClick: () => slotClick }),
  ),
)

export const isSlotClickPassingThrough = (model: Model): boolean =>
  model.input.slotClick === 'PassesThrough'

// NOTE: a tap on the knife slot draws the knife; on the knife in hand it
// does nothing.
export const pressMeleeSlot: UpdateStep = stepWhen(
  model => !isCardHolding(model) && !isWieldingMelee(focusOf(model).player),
  drawFromButton(equipMelee),
)

// NOTE: the new zombie card and the display case's hold the round's buttons.
const isTrapButtonHeld = (model: Model): boolean => isCardHolding(model)

const startWaveFromButton: UpdateStep = model => ({
  model: learnStartWaveWhen(model, startWave(model)),
})

// NOTE: START WAVE and the trap buttons wait while a card holds the
// round's buttons.
export const clickStartWave = makeStep(model =>
  isTrapButtonHeld(model)
    ? unchanged
    : Update.combineSteps([startWaveFromButton, unlockAudio]),
)

export const clickPlaceTrap = makeStep(model =>
  isTrapButtonHeld(model)
    ? unchanged
    : Update.combineSteps([unlockAudio, placeSelectedTrap]),
)

export const clickNextTrap = makeStep(model =>
  isTrapButtonHeld(model)
    ? unchanged
    : Update.combineSteps([unlockAudio, nextTrap]),
)
