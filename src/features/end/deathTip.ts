import { Array, Function, Option } from 'effect'

import { UiStruct } from '@effect/ui'

import type { Model } from '#app/model.ts'
import { textShapes, textWidth } from '#art/font.ts'
import { MOOD_FACES, RATTLES_PALETTE, rattlesPixels } from '#art/rattlesArt.ts'
import { placeAt, spriteShapes } from '#art/sprite.ts'
import { ZOMBIE_SPRITES } from '#art/sprites/zombies.ts'
import type { DeathTip } from '#domain/clientSchema.ts'
import type * as Draw from '#render/draw.ts'
import { isObjectSecond } from '#shared/dualArgs.ts'
import { pickLine } from '#shared/prng.ts'
import type { Difficulty } from '#shared/records/playerData.ts'
import { DEATH_TIPS } from '#world/names.ts'
import { isCoop } from '#world/party/party.ts'
import type { ZombieKind } from '#world/schema/entitySchema.ts'
import { Phase } from '#world/schema/worldSchema.ts'

const isMunched = (model: Model): boolean =>
  Phase.isAnyOf(['GameOver'])(model.phase)

const hasEscapedOn = (model: Model, played: Difficulty): boolean =>
  Array.contains(model.bonuses.escapedOn, played) ||
  Option.isSome(model.bests.byDifficulty[played].maybeFastestWinMs)

const tipKindOf = (
  model: Model,
  played: Difficulty,
): Option.Option<ZombieKind> =>
  isCoop(model) || hasEscapedOn(model, played)
    ? Option.none()
    : model.stats.maybeLastHurtBy

const lastLineOf = (model: Model): string =>
  Option.match(model.endCard.maybeDeathTip, {
    onNone: () => '',
    onSome: ({ line }) => line,
  })

export const noteDeathTip: {
  (after: Model, played?: Difficulty): (before: Model) => Model
  (before: Model, after: Model, played?: Difficulty): Model
} = Function.dual(
  isObjectSecond,
  (
    before: Model,
    after: Model,
    played: Difficulty = after.difficulty.chosen,
  ): Model =>
    !isMunched(before) && isMunched(after)
      ? Option.match(tipKindOf(after, played), {
          onNone: () =>
            UiStruct.evolve(after, {
              endCard: UiStruct.evolve({ maybeDeathTip: Option.none }),
            }),
          onSome: kind => {
            const [state, line] = pickLine(
              after.cosmetics.cosmeticRngState,
              DEATH_TIPS[kind],
              lastLineOf(after),
            )
            const tip: DeathTip = { kind, line }
            return UiStruct.evolve(after, {
              endCard: UiStruct.evolve({
                maybeDeathTip: () => Option.some(tip),
              }),
              cosmetics: UiStruct.evolve({ cosmeticRngState: () => state }),
            })
          },
        })
      : after,
)

const HEAD_ROWS = 8
const HEAD_PX = 9
const ICON_PX = 7
const GAP_PX = 3
const RATTLES_HEAD = spriteShapes(
  rattlesPixels(MOOD_FACES.Shrugging).slice(0, HEAD_ROWS),
  RATTLES_PALETTE,
)

export const deathTipShapes: {
  (centerX: number, y: number): (tip: DeathTip) => ReadonlyArray<Draw.Shape>
  (tip: DeathTip, centerX: number, y: number): ReadonlyArray<Draw.Shape>
} = Function.dual(
  3,
  (tip: DeathTip, centerX: number, y: number): ReadonlyArray<Draw.Shape> => {
    const width = HEAD_PX + GAP_PX + textWidth(tip.line) + GAP_PX + ICON_PX
    const left = Math.round(centerX - width / 2)
    const textLeft = left + HEAD_PX + GAP_PX
    const iconLeft = textLeft + textWidth(tip.line) + GAP_PX
    return [
      placeAt(left + Math.floor(HEAD_PX / 2), y + 2, RATTLES_HEAD),
      ...textShapes(tip.line, 'Prompt', textLeft, y, 'Left'),
      placeAt(
        iconLeft + Math.floor(ICON_PX / 2),
        y + 3,
        ZOMBIE_SPRITES[tip.kind].icon,
      ),
    ]
  },
)
