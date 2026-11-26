import { Array, Function, Option, String, pipe } from 'effect'

import { type Seeded, nextRandom } from '../shared/prng'

export const MAX_NAME_LENGTH = 12

export const DEFAULT_NAME = 'Survivor'

const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu
const SPACES = /\s+/g

const codePoints = (text: string): ReadonlyArray<string> =>
  Array.fromIterable(text)

const firstCodePoints = (text: string, count: number): string =>
  Array.join(Array.take(codePoints(text), count), '')

export const draftName = (raw: string): string =>
  firstCodePoints(
    pipe(
      raw,
      String.replace(SPACES, ' '),
      String.replace(UNPRINTABLE, ''),
      String.replace(SPACES, ' '),
      String.trimStart,
    ),
    MAX_NAME_LENGTH,
  )

export const cleanName = (raw: string): string => String.trimEnd(draftName(raw))

export const nameLength = (name: string): number => codePoints(name).length

export const shownName = (name: string): string =>
  String.isEmpty(name) ? DEFAULT_NAME : name

export const joinName = (model: Readonly<{ playerName: string }>): string =>
  model.playerName

export const GOOFY_NAMES: Array.NonEmptyReadonlyArray<string> = [
  'Snackula',
  'Dr. Chomp',
  'Lil Gnaw',
  'Munchhausen',
  'Sir Nibbles',
  'Count Nibula',
  'Gravy Dave',
  'Chompers',
  'Ghoul Friend',
  'Bonehead Ed',
  'Fang Shui',
  'Rot Rascal',
  'Lady Gnasher',
  'Slurp Derp',
  'Elbow Grease',
  'Crusty Pete',
  'Big Biscuit',
  'Pickle Fist',
  'Noodle Arms',
  'Sgt. Splat',
  'Baron Burp',
  'Mrs. Munch',
  'Moaning Lisa',
  'Kid Gnarly',
  'Spud Muncher',
  'Tot Terror',
  'Worm Burner',
  'Bitey McBite',
  'Grandma Gore',
  'Zed Head',
  'Squishy Sue',
  'Denture Dan',
  'Hambone',
  'Lumpy Larry',
  'Eyeball Al',
  'Gobbler',
  'Toe Jam Tom',
  'Mister Mash',
  'Brainiac Jr',
  'Sloppy Jo',
]

export const rollName: {
  (current: string): (state: number) => Seeded<string>
  (state: number, current: string): Seeded<string>
} = Function.dual(2, (state: number, current: string): Seeded<string> => {
  const others = Array.filter(GOOFY_NAMES, name => name !== current)
  const { value, nextState } = nextRandom(state)
  const index = Math.min(others.length - 1, Math.floor(value * others.length))
  return [
    nextState,
    pipe(
      Array.get(others, index),
      Option.getOrElse(() => Array.headNonEmpty(GOOFY_NAMES)),
    ),
  ]
})
