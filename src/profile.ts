import { Array, Option, String, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { Tabs } from '@foldkit/ui'

import type { Model, ProfileFx, ProfileTab } from './model'
import { type Seeded, nextRandom } from './prng'

// TABS

// NOTE: the tabs as data, in the order they stand down the side (across the
// top in portrait). Stats would be one more entry here and one
// more literal in ProfileTab.
export const PROFILE_TABS: Array.NonEmptyReadonlyArray<ProfileTab> = [
  'Look',
  'Name',
  'Account',
  'Settings',
]

export const ProfileTabsBlock = Tabs.makeBlock<ProfileTab>()

// NOTE: plays an effect in the Profile. The count moves on every time, so
// the view swaps the element and the CSS animation starts over.
export const withProfileFx = (model: Model, fx: ProfileFx): Model =>
  modifyFields(model, {
    profile: profile =>
      modifyFields(profile, {
        fx: () => fx,
        fxCount: count => count + 1,
      }),
  })

// NAME

// NOTE: a display name is up to 12 characters, not unique, as MULTIPLAYER.md
// says. Characters are counted as code points, so an emoji is never split.
export const MAX_NAME_LENGTH = 12

export const DEFAULT_NAME = 'Survivor'

export const NAME_INPUT_ID = 'profile-name-input'

const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu
const SPACES = /\s+/g

const codePoints = (text: string): ReadonlyArray<string> =>
  Array.fromIterable(text)

const firstCodePoints = (text: string, count: number): string =>
  Array.join(Array.take(codePoints(text), count), '')

// NOTE: the name as it is typed: any white space a plain space, no control
// or invisible characters, one space at a time, none in front, and no more
// than 12 characters. A space at the end stays, so a second word can follow.
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

// NOTE: the name as it is kept: the draft with no space at the end. The co-op
// server cleans a name the same way, so what the player sees is what
// teammates see.
export const cleanName = (raw: string): string => String.trimEnd(draftName(raw))

export const nameLength = (name: string): number => codePoints(name).length

export const shownName = (name: string): string =>
  String.isEmpty(name) ? DEFAULT_NAME : name

// NOTE: the hook for the co-op client: the name a join request carries. An
// empty name is sent as it is, and the room seats the player as "Player N".
export const joinName = (model: Model): string => model.playerName

// THE NAME DICE

// NOTE: goofy names of our own for the dice, each 12 characters or fewer.
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

// NOTE: a roll draws from the Model's seeded generator and never lands on
// the name already showing.
export const rollName = (state: number, current: string): Seeded<string> => {
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
}
