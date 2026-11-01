import { Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { randomAppearance } from '../appearance'
import * as Character from '../character'
import { type GearTap, gearTapOf, priceOf } from '../closet'
import type { ClosetCueKind, LookPart, LookToggle, Model } from '../model'
import { type CosmeticKind, cosmeticIdOf } from '../playerData'
import { withProfileFx } from '../profile'
import { rankOf, totalPointsOf } from '../rank'
import { playSounds, uiCue } from './sound'
import type { UpdateReturn, UpdateStep } from './step'

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

type GearReturn = (
  model: Model,
  part: LookPart,
  value: string,
  kind: CosmeticKind,
) => UpdateReturn

const GEAR_TAPS: Readonly<Record<GearTap, GearReturn>> = {
  Stay: model => ({ model }),
  Wear: (model, part, value) =>
    playSounds([uiCue('Pop')])(
      withProfileFx(wearing(model, part, value), 'Poof'),
    ),
  Buy: (model, part, value, kind) =>
    playSounds([uiCue('Purchase')])(
      withProfileFx(
        withCue(
          wearing(spentOn(model, kind, value), part, value),
          part,
          value,
          'Bought',
        ),
        'Poof',
      ),
    ),
  Short: (model, part, value) =>
    playSounds([uiCue('Denied')])(withCue(model, part, value, 'Short')),
  Locked: (model, part, value) =>
    playSounds([uiCue('Denied')])(withCue(model, part, value, 'Short')),
}

// NOTE: a pick in the Look tab. A free part is put on. An earned one is put
// on if it is owned, bought and put on if it is for sale and the Bones cover
// it, and otherwise leaves the look as it was and shakes the price (or the
// padlock): a locked or unaffordable look is never the one selected.
export const chooseLook =
  (part: LookPart, value: string): UpdateStep =>
  stepModel =>
    Option.match(Character.gearOf(part), {
      onNone: () =>
        playSounds([uiCue('Pop')])(
          withProfileFx(wearing(stepModel, part, value), 'Poof'),
        ),
      onSome: ({ kind, worn }) =>
        GEAR_TAPS[
          gearTapOf(
            kind,
            value,
            worn(stepModel.appearance),
            stepModel.boughtCosmetics,
            stepModel.rank,
            rankOf(totalPointsOf(stepModel.rank)),
          )
        ](stepModel, part, value, kind),
    })

export const flipLook =
  (toggle: LookToggle): UpdateStep =>
  stepModel =>
    playSounds([uiCue('Pop')])(
      withProfileFx(
        modifyFields(stepModel, {
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
      modifyFields(stepModel, {
        cosmeticRngState: () => rngState,
        appearance: () => appearance,
      }),
      'Spin',
    ),
  )
}
