import { Effect, Option, Schema } from 'effect'
import { Dom } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { randomAppearance } from '../appearance'
import * as Character from '../character'
import { type GearTap, canAfford, gearTapOf, priceOf } from '../closet'
import { makeCommand } from '../definition'
import { Message } from '../message'
import {
  type ClosetCueKind,
  LookPart,
  type LookToggle,
  type Model,
} from '../model'
import { type CosmeticKind, cosmeticIdOf } from '../playerData'
import { withProfileFx } from '../profile'
import { rankOf, totalPointsOf } from '../rank'
import { lookUnlockId } from '../unlocks'
import { playSounds, uiCue } from './sound'
import { type UpdateReturn, type UpdateStep, combine } from './step'
import { withoutFresh } from './unlocks'

// NOTE: the Look tab's OutMessages, folded in src/composition.ts. The root
// owns the look, so each one changes it here and plays its poof or spin.

const wearing = (model: Model, part: LookPart, value: string): Model =>
  modifyFields(model, {
    appearance: appearance => Character.chooseLook(appearance, part, value),
  })

const withCue = (
  model: Model,
  part: LookPart,
  value: string,
  kind: ClosetCueKind,
): Model =>
  modifyFields(model, {
    profile: profile =>
      modifyFields(profile, {
        closetCue: cue => ({ part, value, kind, count: cue.count + 1 }),
      }),
  })

const spentOn = (model: Model, kind: CosmeticKind, value: string): Model =>
  modifyFields(model, {
    rank: rank =>
      modifyFields(rank, {
        spentBones: spent =>
          spent + Option.getOrElse(priceOf(kind, value), () => 0),
      }),
    boughtCosmetics: bought => [...bought, cosmeticIdOf(kind, value)],
  })

// NOTE: the try-on ends: the figure goes back to what is worn. The look
// itself was never changed, so nothing is saved.
const withoutPreview = (model: Model): Model =>
  modifyFields(model, {
    profile: profile =>
      modifyFields(profile, { maybePreview: () => Option.none() }),
  })

const previewing = (model: Model, part: LookPart, value: string): Model =>
  modifyFields(model, {
    profile: profile =>
      modifyFields(profile, {
        maybePreview: () => Option.some({ part, value }),
      }),
  })

type GearReturn = (model: Model, part: LookPart, value: string) => UpdateReturn

const GEAR_TAPS: Readonly<Record<GearTap, GearReturn>> = {
  Stay: model => ({ model: withoutPreview(model) }),
  Wear: (model, part, value) =>
    playSounds([uiCue('Pop')])(
      withProfileFx(wearing(withoutPreview(model), part, value), 'Poof'),
    ),
  Preview: (model, part, value) =>
    playSounds([uiCue('Pop')])(
      withProfileFx(previewing(model, part, value), 'Poof'),
    ),
  Locked: (model, part, value) =>
    playSounds([uiCue('Denied')])(
      withCue(withoutPreview(model), part, value, 'Short'),
    ),
}

// NOTE: a pick in the Look tab. A free part is put on. An earned one is put
// on if it is owned, tried on if it is for sale (the BUY pill buys it, see
// `buyPreview`), and leaves the look as it was and shakes the padlock if it
// is a gift not reached yet. Any pick ends an earlier try-on and clears the
// picked look's NEW badge.
export const chooseLook =
  (part: LookPart, value: string): UpdateStep =>
  stepModel =>
    Option.match(Character.gearOf(part), {
      onNone: () =>
        playSounds([uiCue('Pop')])(
          withProfileFx(
            wearing(withoutPreview(stepModel), part, value),
            'Poof',
          ),
        ),
      onSome: ({ kind, worn }) =>
        GEAR_TAPS[
          gearTapOf(
            kind,
            value,
            worn(stepModel.appearance),
            stepModel.boughtCosmetics,
            rankOf(totalPointsOf(stepModel.rank)),
          )
        ](withoutFresh(stepModel, lookUnlockId(kind, value)), part, value),
    })

export const FocusLookOption = makeCommand('FocusLookOption', {
  args: { part: LookPart, value: Schema.String },
  messages: [Message.CompletedFocusLookOption],
  handler: function* () {
    return ({ part, value }) =>
      Dom.focus(`[data-look-option="${part}.${value}"]`).pipe(
        Effect.ignore,
        Effect.as(Message.CompletedFocusLookOption()),
      )
  },
})

const bought = (
  model: Model,
  part: LookPart,
  value: string,
  kind: CosmeticKind,
): UpdateReturn =>
  combine(
    withProfileFx(
      withCue(
        wearing(spentOn(withoutPreview(model), kind, value), part, value),
        part,
        value,
        'Bought',
      ),
      'Poof',
    ),
    [
      playSounds([uiCue('Purchase')]),
      stepModel => ({
        model: stepModel,
        commands: [FocusLookOption({ part, value })],
      }),
    ],
  )

// NOTE: the BUY pill: spends the Bones on the look being tried on and keeps
// it on, then focuses its option, since the pill is gone. Short of Bones it
// shakes the price and stays. Nothing without a try-on, or if the look is
// no longer for sale, so a stale click buys nothing.
export const buyPreview: UpdateStep = stepModel =>
  Option.match(stepModel.profile.maybePreview, {
    onNone: () => ({ model: stepModel }),
    onSome: ({ part, value }) =>
      Option.match(Character.gearOf(part), {
        onNone: () => ({ model: withoutPreview(stepModel) }),
        onSome: ({ kind, worn }) =>
          gearTapOf(
            kind,
            value,
            worn(stepModel.appearance),
            stepModel.boughtCosmetics,
            rankOf(totalPointsOf(stepModel.rank)),
          ) !== 'Preview'
            ? { model: withoutPreview(stepModel) }
            : canAfford(stepModel.rank, kind, value)
              ? bought(stepModel, part, value, kind)
              : playSounds([uiCue('Denied')])(
                  withCue(stepModel, part, value, 'Short'),
                ),
      }),
  })

export const flipLook =
  (toggle: LookToggle): UpdateStep =>
  stepModel =>
    playSounds([uiCue('Pop')])(
      withProfileFx(
        modifyFields(withoutPreview(stepModel), {
          appearance: appearance => Character.flipLook(appearance, toggle),
        }),
        'Poof',
      ),
    )

export const rollLook: UpdateStep = stepModel => {
  const [rngState, appearance] = randomAppearance(
    stepModel.cosmeticRngState,
    stepModel.appearance,
    stepModel.boughtCosmetics,
    rankOf(totalPointsOf(stepModel.rank)),
  )
  return playSounds([uiCue('LootPop')])(
    withProfileFx(
      modifyFields(withoutPreview(stepModel), {
        cosmeticRngState: () => rngState,
        appearance: () => appearance,
      }),
      'Spin',
    ),
  )
}
