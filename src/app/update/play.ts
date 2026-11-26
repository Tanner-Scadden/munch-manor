import { Array, Function, Option } from 'effect'

import { UiStruct } from '@effect/ui'

import { positionVariation } from '../../audio/audio'
import { isRunOn } from '../../domain/onlineRun'
import { isEndScreen } from '../../domain/run'
import {
  agePocketCard,
  closeDareCard,
  foldPocketCard,
  isDareCardKey,
  isDareCardToggling,
  isPocketCardBlocking,
  toggleDareCard,
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
import { advanceGame, clampFrameDelta, refreshIntent } from '../frame'
import { isLobbyOpen, isPanelOpen } from '../menuState'
import { type GunSlot, type Model, Phase } from '../model'
import { startWave } from '../runFlow'
import { actAsLead } from './action'
import { beatCardFromKey } from './beatMyRun'
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
  playPlaced,
  playSounds,
  playStartSoundWhen,
  playSwapSoundWhen,
  pocketScratchCues,
  strikeCues,
  thunderCues,
  toggleAudioFromKey,
  unlockAudio,
} from './sound'
import {
  type UpdateStep,
  combine,
  modelStep,
  releaseInput,
  toModel,
  withInput,
} from './step'
import { nextTrap, placeSelectedTrap, trapFromKey } from './traps'
import { checkForUpdate } from './version'

export const useDevice: {
  (device: InputDevice): (model: Model) => Model
  (model: Model, device: InputDevice): Model
} = Function.dual(2, (model: Model, device: InputDevice): Model =>
  model.lastDevice === device
    ? model
    : UiStruct.evolve(model, { lastDevice: () => device }),
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

const resumeFromKey = (model: Model, code: string): Model =>
  isPauseKey(code) && !isPanelOpen(model, 'LeaveRun')
    ? startWhenAllowed(model, model.mode)
    : model

const actInHand =
  (action: SeatAction) =>
  (model: Model): Model =>
    isCardHolding(model) ? model : actAsLead(model, action)

const swapGun = actInHand(SeatAction.Swap())

const equipMelee = actInHand(SeatAction.Melee())

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

export const isDebutCardBlocking = (model: Model): boolean =>
  isFighting(model.phase) && isDebutCardUp(model) && !isCoop(model)

export const skipDebutCardWhenUp = (model: Model): Model =>
  isDebutCardBlocking(model) ? skipDebutCard(model) : model

export const isCardHolding = (model: Model): boolean =>
  isDebutCardBlocking(model) || isCaseCardBlocking(model)

const isDareListTaking = (model: Model): boolean =>
  !isCardHolding(model) && isDareCardToggling(model)

const toggleDareList = modelStep(model =>
  isRunOn(model)
    ? toggleDareCard(model)
    : withInput(toggleDareCard(model), releaseAll),
)

export const clickDareList: UpdateStep = stepWhen(
  isDareListTaking,
  combine([unlockAudio, toggleDareList]),
)

export const isDareListKey: {
  (code: string): (model: Model) => boolean
  (model: Model, code: string): boolean
} = Function.dual(
  2,
  (model: Model, code: string): boolean =>
    isDareCardKey(code) && isDareListTaking(model),
)

export const dareListFromKey = (code: string): UpdateStep =>
  stepWhen(
    (model: Model) => isDareListKey(model, code),
    combine([unlockAudio, toggleDareList]),
  )

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
    LeftEarly: () => endFromKey(model, code),
    GameOver: () => endFromKey(model, code),
  })

const hasResumed = (before: Model, after: Model): boolean =>
  isPaused(before.phase) && !isPaused(after.phase)

const hasBegunReload = (before: Model, after: Model): boolean =>
  !isReloading(focusOf(before).player) && isReloading(focusOf(after).player)

const dropMagazine: UpdateStep = $ =>
  $.combine(
    modelStep(dropClip),
    playSounds([
      {
        sound: 'MagOut',
        variation: positionVariation(
          focusOf($.model).player.x,
          focusOf($.model).player.y,
        ),
      },
    ]),
  )

const reloadHeldGun: UpdateStep = $ => {
  const reloaded = actInHand(SeatAction.Reload())($.model)
  return hasBegunReload($.model, reloaded)
    ? $.combine(toModel(reloaded), dropMagazine)
    : reloaded
}

const reloadFromKey = (code: string): UpdateStep =>
  stepWhen((model: Model) => isKeyFor(model, code, ['Reload']), reloadHeldGun)

const callMedic = modelStep(actInHand(SeatAction.CallMedic()))

const callMedicFromKey = (code: string): UpdateStep =>
  stepWhen((model: Model) => isKeyFor(model, code, ['CallMedic']), callMedic)

export const clickMedic: UpdateStep = combine([unlockAudio, callMedic])

const pauseRound = modelStep(model =>
  withInput(pause(closeDareCard(model)), releaseAll),
)

export const clickPause: UpdateStep = stepWhen(
  (model: Model) => isRoundActive(model.phase),
  combine([unlockAudio, pauseRound]),
)

export const pauseWhenAway: UpdateStep = $ =>
  isRoundActive($.model.phase) ? pauseRound($) : releaseInput($)

export const notePageVisibility =
  (visibility: PageVisibility): UpdateStep =>
  $ =>
    $.combine(
      modelStep(model =>
        UiStruct.evolve(model, { pageVisibility: () => visibility }),
      ),
      visibility === 'Hidden' ? pauseWhenAway : checkForUpdate,
    )

export const tickFrame =
  (deltaTime: number): UpdateStep =>
  $ => {
    const model = $.model
    if (isDebutCardBlocking(model)) {
      return ageDebutCard(model, clampFrameDelta(deltaTime))
    } else if (isPocketCardBlocking(model)) {
      const aged = agePocketCard(model, clampFrameDelta(deltaTime))
      return $.combine(
        toModel(aged),
        playSounds(pocketScratchCues(model, aged)),
      )
    } else if (isCaseCardBlocking(model)) {
      return ageCaseCard(model, clampFrameDelta(deltaTime))
    } else if (isArriving(model.phase)) {
      return advanceIntro(deltaTime)($)
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
      return $.combine(
        toModel(advanced),
        playSounds([
          ...frameSoundCues(advanced.frameEvents),
          ...ammoTickCues(advanced),
          ...fridgeLandCues(model, advanced),
          ...mendCues(model, advanced),
          ...strikeCues(model, advanced),
          ...kitchenCues(model, advanced),
          ...thunderCues(model, advanced),
          ...pocketScratchCues(model, advanced),
        ]),
        playPlaced(model, advanced),
        rumbleFor(advanced.frameEvents),
      )
    } else if (isEndScreen(model.phase)) {
      return advanceEndScreen(clampFrameDelta(deltaTime))($)
    } else if (isScreenAnimated(model.phase)) {
      return $.evolve({
        screenMs: screenMs => screenMs + clampFrameDelta(deltaTime),
      })
    } else {
      return model
    }
  }

type ButtonPress = Readonly<{ code: string; device: InputDevice }>

const pressedButton =
  ({ code, device }: ButtonPress): UpdateStep =>
  $ => {
    const model = $.model
    const keyed = useDevice(model, device)
    if (isCouchKey(keyed, code)) {
      return withInput(pressCouchKey(keyed, code), input =>
        pressKey(input, code),
      )
    }
    if (isRunCardKey(keyed)) {
      return $.combine(
        toModel(toggleAudioFromKey(keyed, code)),
        runCardFromKey(code),
        unlockAudio,
      )
    }
    if (isLobbyOpen(keyed)) {
      return $.combine(toModel(keyed), unlockAudio, lobbyFromKey(code))
    }
    if (isCoopOpen(keyed)) {
      return $.combine(toModel(keyed), unlockAudio, pressCoopKey(code))
    }

    if (isDebutCardBlocking(keyed)) {
      return $.combine(
        toModel(
          withInput(
            toggleAudioFromKey(debutCardFromKey(keyed, code), code),
            input => pressKey(input, code),
          ),
        ),
        unlockAudio,
      )
    }

    if (isCaseCardBlocking(keyed)) {
      return $.combine(
        toModel(
          withInput(
            toggleAudioFromKey(caseCardFromKey(keyed, code), code),
            input => pressKey(input, code),
          ),
        ),
        unlockAudio,
      )
    }

    if (isDareListKey(keyed, code)) {
      return $.combine(toModel(keyed), dareListFromKey(code))
    }

    if (isPocketCardBlocking(keyed)) {
      return $.combine(
        toModel(
          withInput(toggleAudioFromKey(foldPocketCard(keyed), code), input =>
            pressKey(input, code),
          ),
        ),
        unlockAudio,
      )
    }

    if (isArriving(keyed.phase)) {
      return $.combine(
        toModel(toggleAudioFromKey(skipIntro(keyed), code)),
        unlockAudio,
      )
    }

    if (isBeatSkipKey(keyed, code)) {
      return $.combine(
        toModel(toggleAudioFromKey(skipBeat(keyed), code)),
        unlockAudio,
      )
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
    return $.combine(
      toModel(pressed),
      unlockAudio,
      profileFromKey(code),
      coopFromKey(code),
      playFromKey(code),
      menuFromKey(code),
      homeFocusFromKey(code),
      homeFromKey(code),
      beatCardFromKey(code),
      leaveRunFromPad(code),
      trapFromKey(code),
      reloadFromKey(code),
      callMedicFromKey(code),
      playStartSoundWhen(startsRun(model, pressed)),
      playSwapSoundWhen(changedWeapon(model, pressed)),
    )
  }

export const pressedKey = (code: string): UpdateStep =>
  pressedButton({ code, device: 'KeyboardMouse' })

export const pressedPadKey = (code: string): UpdateStep =>
  pressedButton({ code, device: 'Gamepad' })

export const notePad: {
  (pad: Gamepad): (model: Model) => Model
  (model: Model, pad: Gamepad): Model
} = Function.dual(2, (model: Model, pad: Gamepad): Model => {
  const noted = withInput(model, input =>
    UiStruct.evolve(input, { maybeGamepad: () => Option.some(pad) }),
  )
  return isPadStirred(pad)
    ? withInput(useDevice(noted, 'Gamepad'), input =>
        UiStruct.evolve(input, { maybeMouseInView: () => Option.none() }),
      )
    : noted
})

export const padPresses: {
  (pad: Gamepad): (model: Model) => ReadonlyArray<string>
  (model: Model, pad: Gamepad): ReadonlyArray<string>
} = Function.dual(2, (model: Model, pad: Gamepad): ReadonlyArray<string> =>
  newlyPressed(model.input.maybeGamepad, pad),
)

export const polledPad =
  (pad: Gamepad): UpdateStep =>
  $ =>
    $.combine(
      toModel(notePad($.model, pad)),
      ...Array.map(padPresses($.model, pad), code =>
        pressedButton({ code, device: 'Gamepad' }),
      ),
    )

const isPadAt = (model: Model, index: number): boolean =>
  Option.exists(model.input.maybeGamepad, pad => pad.index === index)

export const forgetPad = (model: Model): Model =>
  withInput(model, input =>
    UiStruct.evolve(input, { maybeGamepad: () => Option.none() }),
  )

export const padGone = (index: number): UpdateStep =>
  stepWhen(
    (model: Model) => isPadAt(model, index),
    combine([modelStep(forgetPad), pauseWhenAway]),
  )

export const releasedKey =
  (code: string): UpdateStep =>
  $ => {
    const released = withInput($.model, input => releaseKey(input, code))
    return isCoopOpen(released)
      ? $.combine(toModel(released), releaseCoopKey(code))
      : released
  }

const drawFromButton =
  (draw: (model: Model) => Model): UpdateStep =>
  $ => {
    const drawn = learnSwapWhen($.model, refreshIntent(draw($.model)))
    return $.combine(
      toModel(drawn),
      unlockAudio,
      playSwapSoundWhen(changedWeapon($.model, drawn)),
    )
  }

export const swapFromButton: UpdateStep = drawFromButton(swapGun)

export const pressGunSlot = (slot: GunSlot): UpdateStep =>
  stepWhen(
    (model: Model) => !isCardHolding(model),
    $ => {
      const action = gunSlotAction(focusOf($.model).player, slot)
      return SeatAction.isAnyOf(['Reload'])(action)
        ? $.combine(unlockAudio, reloadHeldGun)
        : drawFromButton(actInHand(action))($)
    },
  )

export const reloadFromButton: UpdateStep = stepWhen(
  (model: Model) => !isCardHolding(model),
  combine([unlockAudio, reloadHeldGun]),
)

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
    UiStruct.evolve(input, { slotClick: () => slotClick }),
  ),
)

export const isSlotClickPassingThrough = (model: Model): boolean =>
  model.input.slotClick === 'PassesThrough'

export const pressMeleeSlot: UpdateStep = stepWhen(
  (model: Model) =>
    !isCardHolding(model) && !isWieldingMelee(focusOf(model).player),
  drawFromButton(equipMelee),
)

const isTrapButtonHeld = (model: Model): boolean => isCardHolding(model)

const startWaveFromButton = modelStep(model =>
  learnStartWaveWhen(model, startWave(model)),
)

const isTrapButtonFree = (model: Model): boolean => !isTrapButtonHeld(model)

export const clickStartWave: UpdateStep = stepWhen(
  isTrapButtonFree,
  combine([startWaveFromButton, unlockAudio]),
)

export const clickPlaceTrap: UpdateStep = stepWhen(
  isTrapButtonFree,
  combine([unlockAudio, placeSelectedTrap]),
)

export const clickNextTrap: UpdateStep = stepWhen(
  isTrapButtonFree,
  combine([unlockAudio, nextTrap]),
)
