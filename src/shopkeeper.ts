import { Array, Option, String } from 'effect'

import {
  type Model,
  Phase,
  ShopChatter,
  type ShopItemId,
  type TrapKind,
} from './model'
import { focusSlotOf } from './party'
import {
  ShopGood,
  Verdict,
  shopItem,
  totalAffordable,
  verdictFor,
} from './shop'

// MOOD

export type Mood = 'Grinning' | 'Delighted' | 'Sad' | 'Shrugging'

// LOOK

// NOTE: Rattles is one pixel map: the stall draws it at the room's scale,
// and the shop's portrait is the same map scaled up, cropped at his bow tie,
// so the two never drift apart. A mood swaps only his eyes and mouth.
export const RATTLES_PALETTE: Readonly<Record<string, string>> = {
  P: '#5b3f8c',
  Q: '#7a5ab0',
  W: '#f4f1de',
  S: '#c9c3b0',
  E: '#2a1418',
  G: '#9be36a',
  Y: '#ffd23f',
  R: '#e8333a',
  T: '#6fc3ff',
  C: '#2f4a6b',
  D: '#223650',
}

export type RattlesFace = Readonly<{
  eyes: string
  nose: string
  teeth: string
  jaw: string
}>

const RATTLES_HAT: ReadonlyArray<string> = [
  '...PPP...',
  '..PQPPP..',
  '.PPPPPPP.',
  '..WWWWW..',
]

const RATTLES_SUIT: ReadonlyArray<string> = [
  '.CCRWRCC.',
  'CCDWDWDCC',
  'CCWDWDWCC',
  'CDDWDWDDC',
  'CCCCCCCCC',
  'CDCCCCCDC',
]

const NOSE = '.WSWEWSW.'

export const AWAKE_FACE: RattlesFace = {
  eyes: '.WGEWGEW.',
  nose: NOSE,
  teeth: '..WEWEW..',
  jaw: '...WWW...',
}

export const BLINK_FACE: RattlesFace = { ...AWAKE_FACE, eyes: '.WEEWEEW.' }

export const MOOD_FACES: Readonly<Record<Mood, RattlesFace>> = {
  Grinning: AWAKE_FACE,
  Delighted: {
    eyes: '.WYEWYEW.',
    nose: NOSE,
    teeth: '..EEEEE..',
    jaw: '...WRW...',
  },
  Sad: {
    eyes: '.WEGWEGW.',
    nose: '.TSWEWSW.',
    teeth: '..WWEWW..',
    jaw: '...EWE...',
  },
  Shrugging: {
    eyes: '.WGEWEEW.',
    nose: NOSE,
    teeth: '..WEEEW..',
    jaw: '...WWW...',
  },
}

export const rattlesPixels = (face: RattlesFace): ReadonlyArray<string> => [
  ...RATTLES_HAT,
  face.eyes,
  face.nose,
  face.teeth,
  face.jaw,
  ...RATTLES_SUIT,
]

// NOTE: the portrait's rows: his hat down to the top of his suit.
export const RATTLES_BUST_ROWS = RATTLES_HAT.length + 6

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

const TRAP_QUIPS: Readonly<
  Record<TrapKind, Array.NonEmptyReadonlyArray<string>>
> = {
  Barricade: ['Board it up!', 'Splinters for them!'],
  Turret: ['He bites. Lovingly.', 'Grumpy and loyal!'],
}

type Lines = Array.NonEmptyReadonlyArray<string>

const GUN_QUIPS: Lines = ['Loud end goes that way!', 'Ooh, a beauty!']
const AMMO_QUIPS: Lines = ['More boom!', 'Lock and load!']
const UPGRADE_QUIPS: Lines = ['Shiny! Hits harder!', 'Fancy!']
const HEART_QUIPS: Lines = ['Freshly pickled!', "Don't ask whose."]
const REPAIR_QUIPS: Lines = ['Good as new-ish!', 'Glued!']
const SIGHT_QUIPS: Lines = ['Pew, precisely!', 'Mind the dot.']

const boughtLines = (item: ShopItemId): Lines =>
  ShopGood.match(shopItem(item).good, {
    Gun: () => GUN_QUIPS,
    Ammo: () => AMMO_QUIPS,
    Upgrade: () => UPGRADE_QUIPS,
    Heart: () => HEART_QUIPS,
    Trap: ({ kind }) => TRAP_QUIPS[kind],
    Repair: () => REPAIR_QUIPS,
    Sight: () => SIGHT_QUIPS,
  })

const GREETING_MOOD: Mood = 'Grinning'
const BROKE_MOOD: Mood = 'Sad'
const BOUGHT_MOOD: Mood = 'Delighted'
const REFUSED_MOOD: Mood = 'Shrugging'

export const moodOf = (model: Model): Mood =>
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

const wavesSeen = (model: Model): number =>
  Phase.isAnyOf(['Preparation'])(model.phase) ? model.phase.wave : 0

export const chatterLine = (model: Model): string => {
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
