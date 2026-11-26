import { Array, Function, Option, Result } from 'effect'

import { UiStruct } from '@effect/ui'

import { crewBotSlots, isBotCrew } from '../domain/bots'
import { withBests } from '../domain/run'
import { applyBotPresses, botInputs } from '../features/bots/teammateBot'
import { ageCloche, raiseCloche } from '../features/cloche/clocheReveal'
import { advanceDareHint } from '../features/dare/rattlesHint'
import { ageFlight, launchPrize } from '../features/fridge/fridgeReveal'
import { advanceBreakIdle } from '../features/hud/readyNudge'
import { advanceKitchenCall } from '../features/kitchen/kitchenCall'
import { raiseDebutCardFrom } from '../features/onboarding/onboarding'
import {
  AIM_ASSIST,
  type AimAssistStrength,
  assistAim,
} from '../input/aimAssist'
import { couchInputs, isCouchPlay } from '../input/couch'
import { aimReachOf, deriveIntent, seeFirePress } from '../input/input'
import { RunRecorder, noteTick } from '../platform/recording'
import { advanceActions } from '../render/actionFrame'
import {
  cameraFocus,
  cameraOf,
  leanCamera,
  screenCameraOf,
  worldWindowOf,
} from '../render/camera'
import { FINISHER_CINE_MS, cinePullOf, glideCamera } from '../render/cine'
import { advanceTells } from '../render/heroTells'
import { advanceJuice } from '../render/juice'
import { advanceParticles } from '../render/particles/particles'
import { screenOf } from '../render/screen'
import {
  FIXED_STEP_MS,
  MAX_FRAME_DELTA_MS,
  MS_PER_SECOND,
  STEP_EPSILON_MS,
} from '../shared/constants'
import { isObjectSecond } from '../shared/dualArgs'
import { emptied } from '../shared/sameList'
import {
  CALLOUT_LIFETIME_MS,
  LEVEL_CALLOUT_LIFETIME_MS,
} from '../world/gear/powerups'
import { TRAP_KIND_ORDER } from '../world/gear/traps'
import { levelOf } from '../world/level/arena'
import { focusOf, modifyFocus } from '../world/party/party'
import { isArriving, isRunUnderway } from '../world/run/arrival'
import { type World, withWorld, worldOf } from '../world/schema/world'
import { clamp } from '../world/step/geometry'
import {
  type InputsByPlayer,
  keptIntent,
  soloInputs,
  stepWorld,
} from '../world/step/stepWorld'
import { isEndless, isRoundActive, roundWave } from '../world/waves/waves'
import {
  type Callout,
  type Difficulty,
  GameEvent,
  type GunLeveled,
  type Intent,
  type LevelCallout,
  type Model,
  Phase,
  type PickupKind,
  TrapHint,
  TrapNotice,
} from './model'

export const clampFrameDelta = (deltaTime: number): number =>
  clamp(deltaTime, 0, MAX_FRAME_DELTA_MS)

const assistStrengthOf = (model: Model): Option.Option<AimAssistStrength> => {
  if (model.lastDevice === 'Touch') {
    return Option.some(AIM_ASSIST.Touch)
  } else if (model.lastDevice === 'Gamepad') {
    return Option.some(AIM_ASSIST.Gamepad)
  } else {
    return Option.none()
  }
}

const withAimAssist = (model: Model, intent: Intent): Intent =>
  Option.match(assistStrengthOf(model), {
    onNone: () => intent,
    onSome: strength =>
      intent.trigger === 'Held'
        ? UiStruct.evolve(intent, {
            maybeAim: Option.map(aim =>
              assistAim(
                levelOf(model),
                cameraOf(model),
                focusOf(model).player,
                model.zombies,
                aim,
                strength,
              ),
            ),
          })
        : intent,
  })

const intentOf = (model: Model): Intent =>
  withAimAssist(
    model,
    deriveIntent(model.input, focusOf(model).player, screenCameraOf(model)),
  )

export const refreshIntent = (model: Model): Model =>
  modifyFocus(model, { intent: () => intentOf(model) })

const recordedTick = (
  model: Model,
  before: Model,
  inputs: InputsByPlayer,
): Model =>
  RunRecorder.isAnyOf(['Recording'])(model.recorder)
    ? UiStruct.evolve(model, {
        recorder: noteTick({
          before,
          inputs,
          after: model,
          device: model.lastDevice,
        }),
      })
    : model

type Ticks = Readonly<{ count: number; carryMs: number }>

export const withFirePressSeen = (model: Model): Model =>
  model.input.firePress === 'Seen'
    ? model
    : UiStruct.evolve(model, { input: seeFirePress })

const inputsOf = (model: Model, intended: World): InputsByPlayer => {
  if (!isCouchPlay(model) && !isBotCrew(model)) {
    return soloInputs(focusOf(intended).intent)
  }
  const seen = withWorld(model, () => intended)
  const players = isCouchPlay(seen)
    ? couchInputs(seen, focusOf(seen).intent)
    : soloInputs(focusOf(seen).intent)
  return isBotCrew(seen)
    ? new Map([...players, ...botInputs(seen, crewBotSlots(seen))])
    : players
}

const intendedWorldOf = (model: Model): World => {
  const intended = modifyFocus(worldOf(model), {
    intent: intent => keptIntent(intent, intentOf(model)),
  })
  return isBotCrew(model)
    ? applyBotPresses(intended, crewBotSlots(model))
    : intended
}

const ticksIn = (carryMs: number, count = 0): Ticks =>
  carryMs >= FIXED_STEP_MS - STEP_EPSILON_MS
    ? ticksIn(carryMs - FIXED_STEP_MS, count + 1)
    : { count, carryMs: Math.max(0, carryMs) }

type Stepped = Readonly<{
  model: Model
  events: ReadonlyArray<GameEvent>
  worldMs: number
}>

const hasSlammed = (before: Phase, after: Phase): boolean =>
  isArriving(before) && !isArriving(after)

const runTicks = (stepped: Stepped, count: number): Stepped => {
  if (!isRunUnderway(stepped.model.phase)) {
    return { ...stepped, model: withFirePressSeen(stepped.model) }
  } else if (count <= 0) {
    return stepped
  }
  const intendedWorld = intendedWorldOf(stepped.model)
  const inputs = inputsOf(stepped.model, intendedWorld)
  const ticked = stepWorld(intendedWorld, inputs)
  const next = {
    model: recordedTick(
      withFirePressSeen(withWorld(stepped.model, () => ticked.world)),
      stepped.model,
      inputs,
    ),
    events: Array.isReadonlyArrayEmpty(stepped.events)
      ? ticked.events
      : [...stepped.events, ...ticked.events],
    worldMs: stepped.worldMs + ticked.worldMs,
  }
  return hasSlammed(stepped.model.phase, ticked.world.phase)
    ? next
    : runTicks(next, count - 1)
}

const ageTrapNotice = (notice: TrapNotice, worldMs: number): TrapNotice =>
  TrapNotice.match(notice, {
    Quiet: () => notice,
    Refused: ({ reason, remainingMs }) =>
      remainingMs > worldMs
        ? TrapNotice.Refused({
            reason,
            remainingMs: remainingMs - worldMs,
          })
        : TrapNotice.Quiet(),
  })

const CALLOUT_MAX = 1

const ageCallouts = (
  callouts: ReadonlyArray<Callout>,
  deltaMs: number,
): ReadonlyArray<Callout> =>
  Array.isReadonlyArrayEmpty(callouts)
    ? callouts
    : Array.filterMap(callouts, callout =>
        callout.ageMs + deltaMs < CALLOUT_LIFETIME_MS[callout.look]
          ? Result.succeed(
              UiStruct.evolve(callout, { ageMs: ageMs => ageMs + deltaMs }),
            )
          : Result.failVoid,
      )

const calloutFor = (model: Model, kind: PickupKind): Model => {
  const isSeen = Array.contains(model.seenPowerUps, kind)
  const callout: Callout = {
    kind,
    look: isSeen ? 'Named' : 'Explained',
    x: focusOf(model).player.x,
    y: focusOf(model).player.y,
    ageMs: 0,
  }
  return UiStruct.evolve(model, {
    seenPowerUps: seen => (isSeen ? seen : Array.append(seen, kind)),
    cosmetics: UiStruct.evolve({
      callouts: callouts =>
        Array.takeRight([...callouts, callout], CALLOUT_MAX),
    }),
  })
}

const levelCalloutFor = (model: Model, event: GunLeveled): Model =>
  event.slot === focusOf(model).seat.slot
    ? UiStruct.evolve(model, {
        cosmetics: UiStruct.evolve({
          levelCallouts: callouts =>
            Array.takeRight(
              [
                ...callouts,
                {
                  weapon: event.weapon,
                  tier: event.tier,
                  x: event.x,
                  y: event.y,
                  ageMs: 0,
                },
              ],
              CALLOUT_MAX,
            ),
        }),
      })
    : model

const ageLevelCallouts = (
  callouts: ReadonlyArray<LevelCallout>,
  deltaMs: number,
): ReadonlyArray<LevelCallout> =>
  Array.isReadonlyArrayEmpty(callouts)
    ? callouts
    : Array.filterMap(callouts, callout =>
        callout.ageMs + deltaMs < LEVEL_CALLOUT_LIFETIME_MS
          ? Result.succeed(
              UiStruct.evolve(callout, { ageMs: ageMs => ageMs + deltaMs }),
            )
          : Result.failVoid,
      )

const advanceCallouts = (model: Model, worldMs: number): Model => {
  const called = Array.reduce(model.frameEvents, model, (current, event) =>
    GameEvent.matchOrElse(
      event,
      {
        PickupGrabbed: ({ kind }) => calloutFor(current, kind),
        GunLeveled: leveled => levelCalloutFor(current, leveled),
      },
      () => current,
    ),
  )
  return UiStruct.evolve(called, {
    cosmetics: UiStruct.evolve({
      trapNotice: notice => ageTrapNotice(notice, worldMs),
      callouts: callouts => ageCallouts(callouts, worldMs),
      levelCallouts: callouts => ageLevelCallouts(callouts, worldMs),
    }),
  })
}

const advanceFlourishes = (
  model: Model,
  frameMs: number,
  worldMs: number,
): Model =>
  advanceDareHint(
    ageCloche(
      advanceKitchenCall(
        ageFlight(
          advanceJuice(
            advanceCallouts(
              advanceActions(
                advanceTells(
                  worldMs > 0
                    ? advanceParticles(model, worldMs / MS_PER_SECOND, worldMs)
                    : model,
                  worldMs,
                ),
              ),
              worldMs,
            ),
            frameMs,
            worldMs,
          ),
          frameMs,
        ),
        frameMs,
      ),
      frameMs,
    ),
    frameMs,
  )

const noticeFoundTrap = (model: Model): Model =>
  TrapHint.isAnyOf(['Unseen'])(model.trapHint) &&
  Array.some(TRAP_KIND_ORDER, kind => focusOf(model).trapStock[kind] > 0)
    ? UiStruct.evolve(model, { trapHint: () => TrapHint.Showing() })
    : model

const noteFinisher = (model: Model, frameMs: number): Model => {
  const cleared = Array.findFirst(
    model.frameEvents,
    GameEvent.isAnyOf(['WaveCleared']),
  )
  const spotOf = (fallback: Readonly<{ x: number; y: number }>) =>
    Option.getOrElse(
      Array.findLast(model.frameEvents, GameEvent.isAnyOf(['ZombieKilled'])),
      () => fallback,
    )
  return UiStruct.evolve(model, {
    maybeFinisher: maybeFinisher =>
      Option.match(cleared, {
        onSome: clear => {
          const { x, y } = spotOf(clear)
          return Option.some({ x, y, ageMs: 0 })
        },
        onNone: () =>
          Option.filter(
            Option.map(maybeFinisher, finisher => ({
              ...finisher,
              ageMs: finisher.ageMs + frameMs,
            })),
            ({ ageMs }) => ageMs < FINISHER_CINE_MS,
          ),
      }),
  })
}

export const advanceCosmetics: {
  (frameMs: number, worldMs: number): (model: Model) => Model
  (model: Model, frameMs: number, worldMs: number): Model
} = Function.dual(3, (model: Model, frameMs: number, worldMs: number): Model =>
  noticeFoundTrap(
    advanceBreakIdle(
      advanceFlourishes(noteFinisher(model, frameMs), frameMs, worldMs),
      worldMs,
    ),
  ),
)

export const leanFor: {
  (frameMs: number): (model: Model) => Model
  (model: Model, frameMs: number): Model
} = Function.dual(2, (model: Model, frameMs: number): Model => {
  const screen = screenOf(model)
  return UiStruct.evolve(model, {
    cameraLean: lean =>
      leanCamera(lean, aimReachOf(model.input, screenCameraOf(model)), frameMs),
    cameraGlide: glide =>
      glideCamera(
        glide,
        cinePullOf({
          model,
          focus: cameraFocus(model),
          window: worldWindowOf(screen),
        }),
        frameMs,
      ),
  })
})

const recordBestWave = (
  model: Model,
  wave: number,
  played: Difficulty,
): Model =>
  isEndless(model)
    ? withBests(
        model,
        bests =>
          UiStruct.evolve(bests, {
            maybeBestEndlessWave: maybeBest =>
              Option.some(
                Option.match(maybeBest, {
                  onNone: () => wave,
                  onSome: best => Math.max(best, wave),
                }),
              ),
          }),
        played,
      )
    : model

export const endRoundOnClient: {
  (after: Model, played?: Difficulty): (before: Model) => Model
  (before: Model, after: Model, played?: Difficulty): Model
} = Function.dual(
  isObjectSecond,
  (
    before: Model,
    after: Model,
    played: Difficulty = after.difficulty.chosen,
  ): Model => {
    if (
      !isRoundActive(before.phase) ||
      !Phase.isAnyOf(['Escaped', 'LeftEarly', 'GameOver'])(after.phase)
    ) {
      return after
    }
    const shown = UiStruct.evolve(after, { screenMs: () => 0 })
    return Phase.isAnyOf(['GameOver'])(after.phase)
      ? recordBestWave(shown, roundWave(after.phase), played)
      : shown
  },
)

const followRound = (before: Model, after: Model): Model =>
  endRoundOnClient(before, raiseDebutCardFrom(before, after))

export const advanceGame: {
  (deltaTime: number): (model: Model) => Model
  (model: Model, deltaTime: number): Model
} = Function.dual(2, (model: Model, deltaTime: number): Model => {
  const frameMs = clampFrameDelta(deltaTime)
  const ticks = ticksIn(model.stepCarryMs + frameMs)
  const stepped = runTicks(
    {
      model: RunRecorder.isAnyOf(['Recording'])(model.recorder)
        ? UiStruct.evolve(model, { frameEvents: emptied })
        : model,
      events: [],
      worldMs: 0,
    },
    ticks.count,
  )
  return raiseCloche(
    model,
    launchPrize(
      model,
      advanceCosmetics(
        leanFor(
          followRound(
            model,
            UiStruct.evolve(stepped.model, {
              stepCarryMs: () => ticks.carryMs,
              frameEvents: () => stepped.events,
            }),
          ),
          frameMs,
        ),
        frameMs,
        stepped.worldMs,
      ),
    ),
  )
})
