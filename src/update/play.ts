import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { noteAmmoTip } from '../ammoWarning'
import { positionVariation } from '../audio'
import { isCouchKey, pressCouchKey } from '../couch'
import { makeStep } from '../definition'
import { skipBeat } from '../endBeat'
import { advanceQuest } from '../firstBreakQuest'
import { advanceGame, clampFrameDelta, refreshIntent } from '../frame'
import { isEndScreen } from '../home'
import {
  type PointerPress,
  isKnifeKey,
  isPauseKey,
  isReloadKey,
  isStartKey,
  isStartWaveKey,
  isSwapKey,
  pressKey,
  releaseAll,
  releaseKey,
} from '../input'
import { advanceKitchenTour } from '../kitchenTour'
import {
  type GunSlot,
  type InputDevice,
  type Model,
  type Orientation,
  type PageVisibility,
  Phase,
  type PointerDevice,
  type SlotClick,
} from '../model'
import {
  ageDebutCard,
  isDebutCardUp,
  learnFromFrame,
  learnStartWave,
  learnSwap,
  moveHintBand,
  skipDebutCard,
} from '../onboarding'
import { dropClip } from '../particles'
import { isCoop } from '../party'
import { isInteractTaken } from '../purchase'
import { startWave } from '../runFlow'
import { isAtCounter, isBrowsing } from '../shop'
import { tallyFrame } from '../stats'
import { stepWhen } from '../stepWhen'
import { SeatAction, gunSlotAction } from '../stepWorld'
import { isRoundActive, pause } from '../waves'
import { inHandOf, isReloading, isWieldingMelee } from '../weapons'
import { actAsLead } from './action'
import { coopFromKey, isCoopOpen, pressCoopKey, releaseCoopKey } from './coop'
import {
  advanceEndScreen,
  endFromKey,
  isBeatSkipKey,
  isRunCardKey,
  runCardFromKey,
  shareFromKey,
} from './end'
import {
  difficultyCardFromKey,
  homeFocusFromKey,
  homeFromKey,
  homeStartFromKey,
  isAskingDifficultyFirst,
  menuFromKey,
} from './home'
import { profileFromKey } from './profile'
import { isPaused, isScreenAnimated, startWhenAllowed, startsRun } from './run'
import { closeShop, syncShopDialog } from './shop'
import {
  ammoTickCues,
  frameSoundCues,
  fridgeLandCues,
  playSounds,
  playStartSoundWhen,
  playSwapSoundWhen,
  toggleAudioFromKey,
  uiCue,
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

// The Steps the root's handlers (src/main.ts) are made of: the frame, the
// keys and pointers, the guns and traps, pausing, and the build check.

const START_SOUND_GRACE_MS = 1000

export const useDevice = (model: Model, device: InputDevice): Model =>
  model.lastDevice === device
    ? model
    : modifyFields(model, { lastDevice: () => device })

export const asAllowedPress = (
  model: Model,
  press: PointerPress,
): PointerPress =>
  press.device === 'Touch' && model.touchControls === 'Blocked'
    ? { ...press, device: 'Mouse' }
    : press

export const orientationOf = (width: number, height: number): Orientation =>
  height > width ? 'Portrait' : 'Landscape'

export const resumeFromPointer = (model: Model): Model =>
  isPaused(model.phase) ? startWhenAllowed(model, model.mode) : model

const hasStartedWave = (before: Model, after: Model): boolean =>
  Phase.isAnyOf(['Preparation'])(before.phase) &&
  Phase.isAnyOf(['Wave'])(after.phase)

const learnStartWaveWhen = (before: Model, after: Model): Model =>
  hasStartedWave(before, after) ? learnStartWave(after) : after

const learnSwapWhen = (before: Model, after: Model): Model =>
  changedWeapon(before, after) ? learnSwap(after) : after

// NOTE: at a purchasable the interact key holds to buy (src/purchase.ts),
// so the same key starts the wave only away from one.
const preparationFromKey = (model: Model, code: string): Model => {
  if (isPauseKey(code)) {
    return pause(model)
  } else if (isStartWaveKey(code) && !isInteractTaken(model)) {
    return startWave(model)
  } else {
    return model
  }
}

const resumeFromKey = (model: Model, code: string): Model =>
  isPauseKey(code) ? startWhenAllowed(model, model.mode) : model

// NOTE: a press of the hand, unless the new zombie card holds the game.
// The rule is the seat action's (src/stepWorld.ts).
const actInHand =
  (action: SeatAction) =>
  (model: Model): Model =>
    isDebutCardBlocking(model) ? model : actAsLead(model, action)

// NOTE: Q switches guns, or with the knife out goes back to the last gun.
const swapGun = actInHand(SeatAction.Swap())

// NOTE: F, or a tap on the knife slot: the knife in hand (GAME_DESIGN.md,
// "The knife and two gun slots").
const equipMelee = actInHand(SeatAction.Melee())

const swapFromKey = (model: Model, code: string): Model => {
  if (isSwapKey(code)) {
    return swapGun(model)
  } else if (isKnifeKey(code)) {
    return equipMelee(model)
  } else {
    return model
  }
}

const changedWeapon = (before: Model, after: Model): boolean =>
  inHandOf(before.player) !== inHandOf(after.player)

const isFighting = Phase.isAnyOf(['Wave'])

// NOTE: in co-op the new zombie card shows without stopping the game
// (decided row 9), so only single player waits on it.
export const isDebutCardBlocking = (model: Model): boolean =>
  isFighting(model.phase) && isDebutCardUp(model) && !isCoop(model)

export const skipDebutCardWhenUp = (model: Model): Model =>
  isDebutCardBlocking(model) ? skipDebutCard(model) : model

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
    Ready: () =>
      isAskingDifficultyFirst(model) ? model : homeStartFromKey(model, code),
    Preparation: () => preparationFromKey(model, code),
    Wave: () => (isPauseKey(code) ? pause(model) : model),
    Paused: () => resumeFromKey(model, code),
    Victory: () => endFromKey(model, code),
    GameOver: () => endFromKey(model, code),
  })

const hasResumed = (before: Model, after: Model): boolean =>
  isPaused(before.phase) && !isPaused(after.phase)

// MENU TAPS

// NOTE: a soft pop on the home menu's own buttons, so a tap feels pressed.
export const tapSound: UpdateStep = playSounds([uiCue('Pop')])

// RELOAD

const hasBegunReload = (before: Model, after: Model): boolean =>
  !isReloading(before.player) && isReloading(after.player)

const dropMagazine: UpdateStep = model =>
  playSounds([
    {
      sound: 'MagOut',
      variation: positionVariation(model.player.x, model.player.y),
    },
  ])(dropClip(model))

// NOTE: with the knife out, R puts the last gun back in hand to reload it.
const reloadHeldGun: UpdateStep = model => {
  const reloaded = actInHand(SeatAction.Reload())(model)
  return stepWhen(() => hasBegunReload(model, reloaded), dropMagazine)(reloaded)
}

const reloadFromKey = (code: string): UpdateStep =>
  stepWhen(() => isReloadKey(code), reloadHeldGun)

// PAUSE

const pauseRound = makeStep(() =>
  Update.combineSteps([
    closeShop,
    modelStep(model => withInput(pause(model), releaseAll)),
  ]),
)

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

export const isFreshRun = (model: Model): boolean =>
  Phase.isAnyOf(['Preparation'])(model.phase) &&
  model.elapsedMs < START_SOUND_GRACE_MS

// FRAME

// NOTE: one frame of single player. An online run's room runs the World,
// so there its frames are TickedRoomFrame (orInRun in src/update/coopRun.ts).
export const tickFrame = (deltaTime: number) =>
  makeStep(model => {
    if (isDebutCardBlocking(model)) {
      return toModel(ageDebutCard(model, clampFrameDelta(deltaTime)))
    } else if (isRoundActive(model.phase)) {
      const framed = moveHintBand(
        advanceKitchenTour(
          advanceQuest(
            noteAmmoTip(
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
      )
      const advanced = isCoop(framed)
        ? ageDebutCard(framed, clampFrameDelta(deltaTime))
        : framed
      return Update.combineSteps([
        toModel(advanced),
        playSounds([
          ...frameSoundCues(advanced.frameEvents),
          ...ammoTickCues(advanced),
          ...fridgeLandCues(model, advanced),
        ]),
        syncShopDialog(isBrowsing(model.shop)),
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

export const pressedKey = (code: string) =>
  makeStep(model => {
    const keyed = useDevice(model, 'KeyboardMouse')
    if (isCouchKey(keyed, code)) {
      return toModel(
        withInput(pressCouchKey(keyed, code), input => pressKey(input, code)),
      )
    }
    if (isRunCardKey(keyed)) {
      return Update.combineSteps([
        toModel(toggleAudioFromKey(runCardFromKey(keyed, code), code)),
        unlockAudio,
        shareFromKey(code),
      ])
    }
    if (isCoopOpen(keyed)) {
      return Update.combineSteps([
        toModel(keyed),
        unlockAudio,
        pressCoopKey(code),
      ])
    }

    if (isAtCounter(keyed.shop)) {
      return Update.combineSteps([
        toModel(
          withInput(toggleAudioFromKey(keyed, code), input =>
            pressKey(input, code),
          ),
        ),
        unlockAudio,
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
      difficultyCardFromKey(code),
      menuFromKey(code),
      homeFocusFromKey(code),
      homeFromKey(code),
      trapFromKey(code),
      reloadFromKey(code),
      shareFromKey(code),
      playStartSoundWhen(startsRun(model, pressed)),
      playSwapSoundWhen(changedWeapon(model, pressed)),
    ])
  })

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
    model => !isDebutCardBlocking(model),
    model => {
      const action = gunSlotAction(model.player, slot)
      return SeatAction.isAnyOf(['Reload'])(action)
        ? combine(model, [unlockAudio, reloadHeldGun])
        : drawFromButton(actInHand(action))(model)
    },
  )

// NOTE: the touch HUD's reload button: R's reload, so with the knife out
// it puts the last gun back in hand and reloads that.
export const reloadFromButton: UpdateStep = stepWhen(
  model => !isDebutCardBlocking(model),
  model => combine(model, [unlockAudio, reloadHeldGun]),
)

// NOTE: a press on a HUD gun or knife slot. With a mouse mid-wave it is a
// shot at the world beneath, like a click anywhere else, so a zombie behind
// the slots still gets shot; keyboard players swap with Q, F, and R. A
// touch, or a mouse in a break, leaves the slot's click to act.
export const isSlotPressAShot = (
  model: Model,
  device: PointerDevice,
): boolean => device === 'Mouse' && Phase.isAnyOf(['Wave'])(model.phase)

export const withSlotClick = (model: Model, slotClick: SlotClick): Model =>
  withInput(model, input => modifyFields(input, { slotClick: () => slotClick }))

export const isSlotClickPassingThrough = (model: Model): boolean =>
  model.input.slotClick === 'PassesThrough'

// NOTE: a tap on the knife slot draws the knife; on the knife in hand it
// does nothing.
export const pressMeleeSlot: UpdateStep = stepWhen(
  model => !isDebutCardBlocking(model) && !isWieldingMelee(model.player),
  drawFromButton(equipMelee),
)

// NOTE: the counter and the new zombie card hold the round's buttons.
const isTrapButtonHeld = (model: Model): boolean =>
  isAtCounter(model.shop) || isDebutCardBlocking(model)

const startWaveFromButton: UpdateStep = model => ({
  model: learnStartWaveWhen(model, startWave(model)),
})

// NOTE: START WAVE and the trap buttons wait while the counter or the new
// zombie card holds the round's buttons.
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
