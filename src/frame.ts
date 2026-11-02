import { Array, Option, Result } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { assistAim } from './aimAssist'
import { COUNTER_LINES, isCounterOpen } from './ammoCounter'
import { levelOf } from './arena'
import { crewBotSlots, isBotCrew } from './bots'
import { cameraOf, leanCamera, screenCameraOf } from './camera'
import {
  FIXED_STEP_MS,
  MAX_FRAME_DELTA_MS,
  MS_PER_SECOND,
  SHOP_NEAR_PX,
  STEP_EPSILON_MS,
} from './constants'
import { couchInputs, isCouchPlay } from './couch'
import { ageFlight, launchPrize } from './fridgeReveal'
import { clamp } from './geometry'
import { advanceTells } from './heroTells'
import { withBests } from './home'
import { deriveIntent } from './input'
import { advanceJuice } from './juice'
import {
  type Callout,
  CounterSale,
  type Difficulty,
  GameEvent,
  type Intent,
  type Model,
  Phase,
  type PickupKind,
  ShopState,
  TrapNotice,
  type Vector,
  idleIntent,
} from './model'
import { raiseDebutCardFrom } from './onboarding'
import { advanceParticles } from './particles'
import { CALLOUT_LIFETIME_MS } from './powerups'
import { STALL_BOX } from './shop'
import { type InputsByPlayer, soloInputs, stepWorld } from './stepWorld'
import { applyBotPresses, botInputs } from './teammateBot'
import { isEndless, isRoundActive, roundWave } from './waves'
import { withWorld } from './world'

// The client's frame: the display's time becomes whole 60 Hz ticks of the
// world, each fed the intent the client derives from its own input and
// camera, and the frame's cosmetics follow from the events of its ticks.

export const clampFrameDelta = (deltaTime: number): number =>
  clamp(deltaTime, 0, MAX_FRAME_DELTA_MS)

// NOTE: on a touch phone, upright or on its side, a held trigger's aim
// bends onto the zombie it is almost on (src/aimAssist.ts). The last input
// decides, as it does the phone's zoom, so a mouse never gets it. It is part
// of the intent, so the world steps the same with or without it, given the
// same intent.
const withAimAssist = (model: Model, intent: Intent): Intent =>
  model.lastDevice === 'Touch' && intent.trigger === 'Held'
    ? modifyFields(intent, {
        maybeAim: Option.map(aim =>
          assistAim(
            levelOf(model),
            cameraOf(model),
            model.player,
            model.zombies,
            aim,
          ),
        ),
      })
    : intent

// NOTE: the client turns raw input into intent: aim goes through the
// camera, which only this device knows. A player at the stall's counter
// intends nothing.
export const refreshIntent = (model: Model): Model =>
  modifyFields(model, {
    intent: () =>
      ShopState.isAnyOf(['Browsing'])(model.shop)
        ? idleIntent
        : withAimAssist(
            model,
            deriveIntent(model.input, model.player, screenCameraOf(model)),
          ),
  })

type Ticks = Readonly<{ count: number; carryMs: number }>

// NOTE: every seat's intent for a tick: the human's from the client, the
// couch players' from their keys, and each teammate bot's from its brain
// (src/teammateBot.ts).
const inputsOf = (model: Model): InputsByPlayer => {
  const players = isCouchPlay(model)
    ? couchInputs(model, model.intent)
    : soloInputs(model.intent)
  return isBotCrew(model)
    ? new Map([...players, ...botInputs(model, crewBotSlots(model))])
    : players
}

// NOTE: the bots' presses for the tick, as their seats' own actions, before
// the step: a reload in a lull, buying at the stall, READY.
const botsPressed = (model: Model): Model =>
  isBotCrew(model)
    ? withWorld(model, world => applyBotPresses(world, crewBotSlots(model)))
    : model

// NOTE: a 60 Hz frame on an empty carry is exactly one tick and leaves
// exactly zero, so a 60 Hz display steps as it did before the fixed step.
const ticksIn = (carryMs: number, count = 0): Ticks =>
  carryMs >= FIXED_STEP_MS - STEP_EPSILON_MS
    ? ticksIn(carryMs - FIXED_STEP_MS, count + 1)
    : { count, carryMs: Math.max(0, carryMs) }

type Stepped = Readonly<{
  model: Model
  events: ReadonlyArray<GameEvent>
  worldMs: number
}>

// NOTE: a tick that ends the round ends the frame's ticks.
const runTicks = (stepped: Stepped, count: number): Stepped => {
  if (count <= 0 || !isRoundActive(stepped.model.phase)) {
    return stepped
  }
  const intended = botsPressed(refreshIntent(stepped.model))
  const ticked = stepWorld(intended, inputsOf(intended))
  return runTicks(
    {
      model: withWorld(intended, () => ticked.world),
      events: [...stepped.events, ...ticked.events],
      worldMs: stepped.worldMs + ticked.worldMs,
    },
    count - 1,
  )
}

// NOTE: a refused placement's notice fades on world time, on the client.
const ageTrapNotice = (model: Model, worldMs: number): Model =>
  TrapNotice.isAnyOf(['Quiet'])(model.trapNotice)
    ? model
    : modifyFields(model, {
        trapNotice: notice =>
          TrapNotice.match(notice, {
            Quiet: () => notice,
            Refused: ({ reason, remainingMs }) =>
              remainingMs > worldMs
                ? TrapNotice.Refused({
                    reason,
                    remainingMs: remainingMs - worldMs,
                  })
                : TrapNotice.Quiet(),
          }),
      })

const CALLOUT_MAX = 1

const ageCallouts = (model: Model, deltaMs: number): Model =>
  Array.isReadonlyArrayEmpty(model.callouts)
    ? model
    : modifyFields(model, {
        callouts: callouts =>
          Array.filterMap(callouts, callout =>
            callout.ageMs + deltaMs < CALLOUT_LIFETIME_MS[callout.look]
              ? Result.succeed(
                  modifyFields(callout, { ageMs: ageMs => ageMs + deltaMs }),
                )
              : Result.failVoid,
          ),
      })

// NOTE: a kind is explained once, ever: the save keeps the kinds seen, so a
// returning player only sees the name pop. The list keeps its reference
// when nothing new is seen, so the save check sees nothing changed.
const calloutFor = (model: Model, kind: PickupKind): Model => {
  const isSeen = Array.contains(model.seenPowerUps, kind)
  const callout: Callout = {
    kind,
    look: isSeen ? 'Named' : 'Explained',
    x: model.player.x,
    y: model.player.y,
    ageMs: 0,
  }
  return modifyFields(model, {
    seenPowerUps: seen => (isSeen ? seen : Array.append(seen, kind)),
    callouts: callouts => Array.takeRight([...callouts, callout], CALLOUT_MAX),
  })
}

// NOTE: a cosmetic, made after the step from the frame's grabs. Callouts
// hold still while the shop is open, as the pickups do.
const advanceCallouts = (model: Model, worldMs: number): Model => {
  const called = Array.reduce(model.frameEvents, model, (current, event) =>
    GameEvent.isAnyOf(['PickupGrabbed'])(event)
      ? calloutFor(current, event.kind)
      : current,
  )
  return ShopState.isAnyOf(['Browsing'])(called.shop)
    ? called
    : ageCallouts(called, worldMs)
}

const COUNTER_SALE_MS = 1400

const isBesideStall = ({ x, y }: Vector): boolean =>
  Math.hypot(
    Math.max(STALL_BOX.left - x, 0, x - STALL_BOX.right),
    Math.max(STALL_BOX.top - y, 0, y - STALL_BOX.bottom),
  ) <= SHOP_NEAR_PX

// NOTE: a cosmetic, made after the step from the frame's events: a buy
// beside the stall mid-wave is a sale at the window, so Rattles wakes, slides
// the rounds across, and says a line, a different one each sale.
const advanceCounterSale = (model: Model, frameMs: number): Model => {
  const isSale =
    isCounterOpen(model) &&
    Array.some(
      model.frameEvents,
      event => GameEvent.isAnyOf(['Purchased'])(event) && isBesideStall(event),
    )
  if (isSale) {
    return modifyFields(model, {
      counterSale: () =>
        CounterSale.Selling({
          ageMs: 0,
          line: model.stats.purchases % COUNTER_LINES.length,
        }),
    })
  }
  return CounterSale.match(model.counterSale, {
    Quiet: () => model,
    Selling: sale =>
      modifyFields(model, {
        counterSale: () =>
          sale.ageMs + frameMs >= COUNTER_SALE_MS
            ? CounterSale.Quiet()
            : CounterSale.Selling({ ...sale, ageMs: sale.ageMs + frameMs }),
      }),
  })
}

// NOTE: what the frame looks like once its ticks ran: the camera lean,
// particles, the walking dust, callouts, and the juice, all from the
// frame's events and the cosmetic stream, so they never touch the World.
export const advanceCosmetics = (
  model: Model,
  frameMs: number,
  worldMs: number,
): Model =>
  advanceCounterSale(
    ageFlight(
      advanceJuice(
        advanceCallouts(
          ageTrapNotice(
            advanceTells(
              worldMs > 0
                ? advanceParticles(model, worldMs / MS_PER_SECOND, worldMs)
                : model,
              worldMs,
            ),
            worldMs,
          ),
          worldMs,
        ),
        frameMs,
        worldMs,
      ),
      frameMs,
    ),
    frameMs,
  )

// NOTE: the camera leans toward the aim on the display's own time.
export const leanFor = (model: Model, frameMs: number): Model =>
  modifyFields(model, {
    cameraLean: lean => leanCamera(lean, model.intent.maybeAim, frameMs),
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
          modifyFields(bests, {
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

// NOTE: the client's half of a round ending on a tick: the end screen's
// clock starts, and a lost endless run records its best wave, under the
// difficulty it was played on (an online co-op run's is the room's).
export const endRoundOnClient = (
  before: Model,
  after: Model,
  played: Difficulty = after.difficulty.chosen,
): Model => {
  if (
    !isRoundActive(before.phase) ||
    !Phase.isAnyOf(['Victory', 'GameOver'])(after.phase)
  ) {
    return after
  }
  const shown = modifyFields(after, { screenMs: () => 0 })
  return Phase.isAnyOf(['GameOver'])(after.phase)
    ? recordBestWave(shown, roundWave(after.phase), played)
    : shown
}

// NOTE: the client's half of what the ticks did to the round: a wave that
// started raises the new zombie card, and a round that ended starts its
// end screen.
const followRound = (before: Model, after: Model): Model =>
  endRoundOnClient(before, raiseDebutCardFrom(before, after))

// NOTE: a frame runs the whole ticks its time owes and carries the rest,
// then makes its cosmetics. Its `frameEvents` are every tick's events in
// order, so the cosmetics, sounds, stats, and lessons see each one.
export const advanceGame = (model: Model, deltaTime: number): Model => {
  const frameMs = clampFrameDelta(deltaTime)
  const ticks = ticksIn(model.stepCarryMs + frameMs)
  const stepped = runTicks(
    {
      model: modifyFields(model, {
        stepCarryMs: () => ticks.carryMs,
        frameEvents: () => [],
      }),
      events: [],
      worldMs: 0,
    },
    ticks.count,
  )
  return launchPrize(
    model,
    advanceCosmetics(
      leanFor(
        followRound(
          model,
          modifyFields(stepped.model, { frameEvents: () => stepped.events }),
        ),
        frameMs,
      ),
      frameMs,
      stepped.worldMs,
    ),
  )
}
