import { Array, Option, String } from 'effect'

import type { Mood } from '../../art/rattlesArt'
import { focusSlotOf } from '../../world/party/party'
import {
  Phase,
  ShopChatter,
  type ShopItemId,
} from '../../world/schema/worldSchema'
import {
  ShopGood,
  Verdict,
  shopItem,
  totalAffordable,
  verdictFor,
} from '../../world/shop/shop'
import type { ShopScene } from './block'

// NOTE: Rattles says a few words at most. Each line is picked by how many
// things the player bought this run, so the same Messages give the same line.
const pick = (
  lines: Array.NonEmptyReadonlyArray<string>,
  index: number,
): string =>
  Option.getOrElse(Array.get(lines, index % lines.length), () =>
    Array.headNonEmpty(lines),
  )

const GREETINGS: Array.NonEmptyReadonlyArray<string> = [
  'Fresh meat! Er, customer.',
  'Bones half off. Not mine.',
  'Still breathing? Spend it!',
  'Everything is a bit haunted.',
]

const BROKE_GREETINGS: Array.NonEmptyReadonlyArray<string> = [
  'Empty pockets? Go pop heads.',
  'Just looking? I see.',
]

type Lines = Array.NonEmptyReadonlyArray<string>

const GUN_QUIPS: Lines = ['Loud end goes that way!', 'Ooh, a beauty!']
const SIGHT_QUIPS: Lines = ['Pew, precisely!', 'Mind the dot.']

const boughtLines = (item: ShopItemId): Lines =>
  ShopGood.match(shopItem(item).good, {
    Gun: () => GUN_QUIPS,
    Sight: () => SIGHT_QUIPS,
  })

const GREETING_MOOD: Mood = 'Grinning'
const BROKE_MOOD: Mood = 'Sad'
const BOUGHT_MOOD: Mood = 'Delighted'
const REFUSED_MOOD: Mood = 'Shrugging'

export const moodOf = (model: ShopScene): Mood =>
  ShopChatter.match(model.shopChatter, {
    Greeting: () =>
      totalAffordable(model, focusSlotOf(model)) === 0
        ? BROKE_MOOD
        : GREETING_MOOD,
    Bought: () => BOUGHT_MOOD,
    TooPricey: () => BROKE_MOOD,
    Refused: () => REFUSED_MOOD,
  })

const NEED_PREFIX = 'Need $'

const wavesSeen = (model: ShopScene): number =>
  Phase.isAnyOf(['Preparation'])(model.phase) ? model.phase.wave : 0

export const chatterLine = (model: ShopScene): string => {
  const index = model.stats.purchases
  return ShopChatter.match(model.shopChatter, {
    Greeting: () =>
      totalAffordable(model, focusSlotOf(model)) === 0
        ? pick(BROKE_GREETINGS, wavesSeen(model) + index)
        : pick(GREETINGS, wavesSeen(model) + index),
    Bought: ({ item }) => pick(boughtLines(item), index),
    TooPricey: ({ item }) =>
      Verdict.match(verdictFor(model, focusSlotOf(model), item), {
        Available: () => 'Now you can!',
        Refused: ({ reason }) =>
          String.startsWith(NEED_PREFIX)(reason)
            ? `${reason}. No IOUs!`
            : reason,
      }),
    Refused: ({ item }) =>
      Verdict.match(verdictFor(model, focusSlotOf(model), item), {
        Available: () => 'Go on, then!',
        Refused: ({ reason }) => reason,
      }),
  })
}
