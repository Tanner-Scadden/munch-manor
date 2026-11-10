import { Array, Function, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import type { Model } from '../../app/model'
import { KitchenCall, Tour } from '../../domain/clientSchema'
import type { SoundEffect } from '../../shared/soundEffect'
import { isKitchenOpen } from '../../world/kitchen/kitchen'
import { levelOf } from '../../world/level/arena'
import {
  KITCHEN_EXIT,
  exitBoxOf,
  isExitOfferOpenFor,
} from '../../world/level/exits'
import { focusOf } from '../../world/party/party'
import {
  Boss,
  GameEvent,
  Phase,
  type Vector,
} from '../../world/schema/worldSchema'
import { distanceBetween } from '../../world/step/geometry'
import { isRoundActive } from '../../world/waves/waves'

// NOTE: from the owner (2026-11-01), players were not finding the kitchen.
// Rattles hollers about the boarded door once in each break from the one
// where it first goes on sale, until it is open. It is a client cue read
// off the World's phase and level, so the World's rules never change, and
// it runs for every player's own view, solo and co-op. The boards also
// leak a smell: now and then a pot rattles or simmers when the player is
// near (never in a boss fight), a sound read from the elapsed time.
export const CALL_MS = 6000

const OPENED_CAP_MS = 60_000

const isBoardsUp = (model: Model): boolean =>
  !isKitchenOpen(levelOf(model)) &&
  Option.isSome(exitBoxOf(levelOf(model), KITCHEN_EXIT))

// NOTE: the kitchen tour (src/features/onboarding/kitchenTour.ts) points at the same boards
// with its own gift bubble, so Rattles keeps quiet while it runs.
const isCallDue = (model: Model, wave: number): boolean =>
  Phase.isAnyOf(['Preparation'])(model.phase) &&
  isExitOfferOpenFor(model.phase) &&
  isBoardsUp(model) &&
  !Tour.isAnyOf(['Running', 'Done'])(model.kitchenTour) &&
  KitchenCall.match(model.kitchenCall, {
    Quiet: ({ calledWave }) => calledWave < wave,
    Calling: () => false,
    Opened: () => false,
  })

const quietAt = (wave: number): KitchenCall =>
  KitchenCall.Quiet({ calledWave: wave })

const waveOf = (model: Model): number =>
  Phase.isAnyOf(['Preparation', 'Wave'])(model.phase) ? model.phase.wave : 0

// NOTE: only the kitchen's boards coming down quiet the holler: the
// parlour's are another exit.
const isOpenedThisFrame = (model: Model): boolean =>
  Array.some(model.frameEvents, GameEvent.isAnyOf(['ExitOpened'])) &&
  isKitchenOpen(levelOf(model)) &&
  !KitchenCall.isAnyOf(['Opened'])(model.kitchenCall)

export const advanceKitchenCall: {
  (frameMs: number): (model: Model) => Model
  (model: Model, frameMs: number): Model
} = Function.dual(2, (model: Model, frameMs: number): Model => {
  if (!isRoundActive(model.phase)) {
    return model
  }
  const wave = waveOf(model)
  if (isOpenedThisFrame(model)) {
    return modifyFields(model, {
      kitchenCall: () => KitchenCall.Opened({ ageMs: 0 }),
    })
  }
  return KitchenCall.match(model.kitchenCall, {
    Opened: ({ ageMs }) =>
      modifyFields(model, {
        kitchenCall: () =>
          KitchenCall.Opened({
            ageMs: Math.min(ageMs + frameMs, OPENED_CAP_MS),
          }),
      }),
    Quiet: () =>
      isCallDue(model, wave)
        ? modifyFields(model, {
            kitchenCall: () =>
              KitchenCall.Calling({ wave, remainingMs: CALL_MS }),
          })
        : model,
    Calling: ({ wave: calledWave, remainingMs }) =>
      remainingMs - frameMs <= 0 ||
      !Phase.isAnyOf(['Preparation'])(model.phase) ||
      wave !== calledWave ||
      !isBoardsUp(model)
        ? modifyFields(model, { kitchenCall: () => quietAt(calledWave) })
        : modifyFields(model, {
            kitchenCall: () =>
              KitchenCall.Calling({
                wave: calledWave,
                remainingMs: remainingMs - frameMs,
              }),
          }),
  })
})

// NOTE: where the bubble's tail points: the top of the boards.
export const maybeCallTarget = (model: Model): Option.Option<Vector> =>
  KitchenCall.isAnyOf(['Calling'])(model.kitchenCall)
    ? Option.map(exitBoxOf(levelOf(model), KITCHEN_EXIT), box => ({
        x: Math.round((box.left + box.right) / 2),
        y: box.top,
      }))
    : Option.none()

// NOTE: Rattles' goofy lines, one for each break by its wave.
export const CALL_LINES: Array.NonEmptyReadonlyArray<string> = [
  'SMELLS LIKE SOUP!',
  'SOUP! I SMELL SOUP!',
  'SOMETHING IS COOKING!',
]

export const callLineIndex = (model: Model): number =>
  waveOf(model) % CALL_LINES.length

// SMELL

const SMELL_REACH_PX = 80
const SMELL_BEAT_MS = 7000

// NOTE: every seventh second is a beat; two beats in three make a sound,
// alternating a rattle and a simmer, so the kitchen is heard now and then,
// never in a pattern.
const beatOf = (elapsedMs: number): number =>
  Math.floor(elapsedMs / SMELL_BEAT_MS)

const SMELL_SOUNDS: Array.NonEmptyReadonlyArray<SoundEffect> = [
  'PotClatter',
  'Simmer',
]

export const maybeKitchenSound: {
  (after: Model): (before: Model) => Option.Option<SoundEffect>
  (before: Model, after: Model): Option.Option<SoundEffect>
} = Function.dual(
  2,
  (before: Model, after: Model): Option.Option<SoundEffect> => {
    const beat = beatOf(after.elapsedMs)
    return beat !== beatOf(before.elapsedMs) &&
      beat % 3 !== 0 &&
      isRoundActive(after.phase) &&
      Boss.isAnyOf(['Absent'])(after.boss) &&
      isBoardsUp(after)
      ? Option.flatMap(exitBoxOf(levelOf(after), KITCHEN_EXIT), box =>
          distanceBetween(focusOf(after).player, {
            x: (box.left + box.right) / 2,
            y: (box.top + box.bottom) / 2,
          }) <= SMELL_REACH_PX
            ? Array.get(SMELL_SOUNDS, beat % SMELL_SOUNDS.length)
            : Option.none(),
        )
      : Option.none()
  },
)
