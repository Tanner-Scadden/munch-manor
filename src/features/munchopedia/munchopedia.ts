import { Array, Function, Option, pipe } from 'effect'
import type { Canvas } from 'foldkit'

import type { Model } from '../../app/model'
import { standaloneSource } from '../../art/sprite'
import { type WornFrames, ZOMBIE_SPRITES } from '../../art/sprites/zombies'
import { JOURNAL_NAME, ZOMBIE_NAMES } from '../../world/names'
import type { ZombieKind } from '../../world/schema/entitySchema'
import type { KillCounts } from '../../world/schema/worldSchema'
import { ZOMBIE_KINDS } from '../../world/zombies/zombies'

// ENTRIES

export type MunchopediaEntry = Readonly<{
  kind: ZombieKind
  bio: string
  behavior: string
  howToBeat: string
}>

export const MUNCHOPEDIA: Array.NonEmptyReadonlyArray<MunchopediaEntry> = [
  {
    kind: 'Shambler',
    bio: 'Came for dinner in 1925. Still waiting on dessert.',
    behavior: 'Shuffles straight at you, groaning about it the whole way.',
    howToBeat: 'He is slow. Back up and keep shooting.',
  },
  {
    kind: 'Runner',
    bio: 'Fastest kid in school. Dared to run straight through.',
    behavior: 'Zooms right at you the second the door opens.',
    howToBeat: 'Flimsy. One good shot drops it, so aim first.',
  },
  {
    kind: 'Tank',
    bio: 'Ate everything. Now he wears the kitchen too.',
    behavior: 'Plods in slow, soaks up lead, and loves a snack of planks.',
    howToBeat: 'Clang off the pan, then the pot. Keep your distance.',
  },
  {
    kind: 'Exploder',
    bio: 'Brought fireworks to scare everyone. It worked once.',
    behavior: 'Waddles up for a hug, then goes boom.',
    howToBeat: 'Pop him from far away. His boom splats his buddies too.',
  },
  {
    kind: 'Thrower',
    bio: 'Took the dare to prove a point. Still proving it.',
    behavior: `Hangs back and pitches ${ZOMBIE_NAMES.Shambler}s at your head.`,
    howToBeat: 'Get close. He hides behind a buddy, so shoot around it.',
  },
  {
    kind: 'Crawler',
    bio: "The house's pet. Lives under the floorboards, pays no rent.",
    behavior:
      'A zombie spider. Skitters up through the floor and grabs your ankles.',
    howToBeat: 'Watch for cracks in the floor. Two shots and it is done.',
  },
  {
    kind: 'Boss',
    bio: 'The host. The party ends when he says so.',
    behavior: 'Stomps up close. Run far and he charges and spits.',
    howToBeat: 'Stay close, step out of the red, and never stop shooting.',
  },
]

export const ENTRY_COUNT = MUNCHOPEDIA.length

export const entryOf = (kind: ZombieKind): MunchopediaEntry =>
  pipe(
    Array.findFirst(MUNCHOPEDIA, entry => entry.kind === kind),
    Option.getOrElse(() => Array.headNonEmpty(MUNCHOPEDIA)),
  )

export const entryName = (kind: ZombieKind): string => ZOMBIE_KINDS[kind].name

// DISCOVERY

// NOTE: Uncle Chunk is counted once each time he is beaten, so his kills are
// the times he was beaten and he unlocks the same way as the rest.
export const killsOf: {
  (kind: ZombieKind): (kills: KillCounts) => number
  (kills: KillCounts, kind: ZombieKind): number
} = Function.dual(
  2,
  (kills: KillCounts, kind: ZombieKind): number => kills[kind],
)

export const isDiscovered: {
  (kind: ZombieKind): (kills: KillCounts) => boolean
  (kills: KillCounts, kind: ZombieKind): boolean
} = Function.dual(
  2,
  (kills: KillCounts, kind: ZombieKind): boolean => killsOf(kills, kind) > 0,
)

export const discoveredKinds = (kills: KillCounts): ReadonlyArray<ZombieKind> =>
  pipe(
    MUNCHOPEDIA,
    Array.map(({ kind }) => kind),
    Array.filter(kind => isDiscovered(kills, kind)),
  )

export const newlyDiscovered: {
  (after: KillCounts): (before: KillCounts) => ReadonlyArray<ZombieKind>
  (before: KillCounts, after: KillCounts): ReadonlyArray<ZombieKind>
} = Function.dual(
  2,
  (before: KillCounts, after: KillCounts): ReadonlyArray<ZombieKind> =>
    Array.filter(discoveredKinds(after), kind => !isDiscovered(before, kind)),
)

export const unopenedKinds = (model: Model): ReadonlyArray<ZombieKind> =>
  Array.filter(
    discoveredKinds(model.bests.killsByKind),
    kind => !Array.contains(model.home.openedEntries, kind),
  )

export const hasUnopenedEntry = (model: Model): boolean =>
  Array.isReadonlyArrayNonEmpty(unopenedKinds(model))

// NOTE: the menu panel's title and blurb over the Dare Journal.
export const munchopediaText = (
  model: Model,
): Readonly<{ title: string; blurb: string }> => ({
  title: JOURNAL_NAME,
  blurb: `${discoveredKinds(model.bests.killsByKind).length} of ${ENTRY_COUNT} discovered, ${countLabel(model.bests.totalKills)} zombies splatted`,
})

// BADGES

type Badge = Readonly<{ threshold: number; name: string }>

export const BADGES: Array.NonEmptyReadonlyArray<Badge> = [
  { threshold: 10, name: 'Bronze' },
  { threshold: 100, name: 'Silver' },
  { threshold: 1000, name: 'Gold' },
]

export const earnedBadges = (count: number): ReadonlyArray<Badge> =>
  Array.filter(BADGES, ({ threshold }) => count >= threshold)

export const countLabel = (count: number): string =>
  count.toLocaleString('en-US')

// PICTURES

export type EntryFrame = Readonly<{
  src: string
  width: number
  height: number
}>

const imageOf = (
  sprite: ReadonlyArray<Canvas.Shape>,
): Option.Option<EntryFrame> =>
  pipe(
    Array.head(sprite),
    Option.flatMap(shape =>
      shape._tag === 'Image'
        ? Option.some({
            src: standaloneSource(shape),
            width: shape.width,
            height: shape.height,
          })
        : Option.none(),
    ),
  )

// NOTE: an entry walks through every wear stage in turn, a few strides each,
// facing right like the new zombie card.
const STRIDES_PER_STAGE = 4

const strideImage = (stage: WornFrames, stride: number) =>
  imageOf(
    Option.getOrElse(Array.get(stage.walk, stride % stage.walk.length), () =>
      Array.headNonEmpty(stage.walk),
    ).Normal.Right,
  )

const entryFramesOf = (kind: ZombieKind): ReadonlyArray<EntryFrame> =>
  pipe(
    ZOMBIE_SPRITES[kind].stages,
    Array.flatMap(stage =>
      Array.makeBy(STRIDES_PER_STAGE, stride => strideImage(stage, stride)),
    ),
    Array.getSomes,
  )

const entryFramesByKind = new Map<ZombieKind, ReadonlyArray<EntryFrame>>()

// NOTE: the pictures are <img> elements, which cannot crop a sprite out of
// the prebuilt atlas, so each frame gets an image of its own. They are built
// the first time the Munchopedia shows the kind, not as the game loads.
const entryFrames = (kind: ZombieKind): ReadonlyArray<EntryFrame> => {
  const cached = entryFramesByKind.get(kind)
  if (cached !== undefined) {
    return cached
  }
  const frames = entryFramesOf(kind)
  entryFramesByKind.set(kind, frames)
  return frames
}

const ENTRY_STRIDE_MS = 200

export const entryFrameAt: {
  (screenMs: number): (kind: ZombieKind) => Option.Option<EntryFrame>
  (kind: ZombieKind, screenMs: number): Option.Option<EntryFrame>
} = Function.dual(
  2,
  (kind: ZombieKind, screenMs: number): Option.Option<EntryFrame> => {
    const frames = entryFrames(kind)
    return Array.get(
      frames,
      Math.floor(screenMs / ENTRY_STRIDE_MS) % Math.max(1, frames.length),
    )
  },
)

export const firstEntryFrame = (kind: ZombieKind): Option.Option<EntryFrame> =>
  Array.head(entryFrames(kind))
