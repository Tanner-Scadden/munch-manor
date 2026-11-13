import { Array, Function, Option } from 'effect'
import type { Canvas } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import type { Model } from '../../app/model'
import { textShapes, textWidth } from '../../art/font'
import {
  MOOD_FACES,
  RATTLES_PALETTE,
  rattlesPixels,
} from '../../art/rattlesArt'
import { placeAt, spriteShapes } from '../../art/sprite'
import { ZOMBIE_SPRITES } from '../../art/sprites/zombies'
import type { DeathTip } from '../../domain/clientSchema'
import { isObjectSecond } from '../../shared/dualArgs'
import type { Difficulty } from '../../shared/playerData'
import { pickLine } from '../../shared/prng'
import { DEATH_TIPS } from '../../world/names'
import { isCoop } from '../../world/party/party'
import type { ZombieKind } from '../../world/schema/entitySchema'
import { Phase } from '../../world/schema/worldSchema'

// The death tip: on a lone player's end card after a loss, Rattles says one
// short line about the zombie that landed the last bite, with its picture.
// Drawn from the cosmetic stream, never the line shown last. Once the
// player has escaped on the difficulty played, Rattles keeps quiet: they
// know the house.

const isMunched = (model: Model): boolean =>
  Phase.isAnyOf(['GameOver'])(model.phase)

// NOTE: escaped on a difficulty: the first escape's mark, or a win from
// before it, kept as the fastest win.
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
  Option.match(model.maybeDeathTip, {
    onNone: () => '',
    onSome: ({ line }) => line,
  })

// NOTE: on the frame a run is lost, the tip it ends with, or none. `played`
// is the run's difficulty, as for the records.
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
          onNone: () => modifyFields(after, { maybeDeathTip: Option.none }),
          onSome: kind => {
            const [state, line] = pickLine(
              after.cosmeticRngState,
              DEATH_TIPS[kind],
              lastLineOf(after),
            )
            const tip: DeathTip = { kind, line }
            return modifyFields(after, {
              cosmeticRngState: () => state,
              maybeDeathTip: () => Option.some(tip),
            })
          },
        })
      : after,
)

// VIEW

// NOTE: Rattles' head, his hat down to his jaw, with a knowing look.
const HEAD_ROWS = 8
const HEAD_PX = 9
const ICON_PX = 7
const GAP_PX = 3
const RATTLES_HEAD = spriteShapes(
  rattlesPixels(MOOD_FACES.Shrugging).slice(0, HEAD_ROWS),
  RATTLES_PALETTE,
)

// NOTE: the tip on the line over the tally, centered on `centerX` at the
// text's top `y`: Rattles, the line, then the zombie it is about.
export const deathTipShapes: {
  (centerX: number, y: number): (tip: DeathTip) => ReadonlyArray<Canvas.Shape>
  (tip: DeathTip, centerX: number, y: number): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  3,
  (tip: DeathTip, centerX: number, y: number): ReadonlyArray<Canvas.Shape> => {
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
