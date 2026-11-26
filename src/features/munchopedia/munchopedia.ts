import { Array, Function, Option, pipe } from 'effect'

import type { Model } from '#app/model.ts'
import { standaloneSource } from '#art/sprite.ts'
import { type WornFrames, ZOMBIE_SPRITES } from '#art/sprites/zombies.ts'
import type * as Draw from '#render/draw.ts'
import { JOURNAL_NAME, ZOMBIE_NAMES } from '#world/names.ts'
import type { ZombieKind } from '#world/schema/entitySchema.ts'
import type { KillCounts } from '#world/schema/worldSchema.ts'
import { ZOMBIE_KINDS } from '#world/zombies/zombies.ts'

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

export const munchopediaText = (
  model: Model,
): Readonly<{ title: string; blurb: string }> => ({
  title: JOURNAL_NAME,
  blurb: `${discoveredKinds(model.bests.killsByKind).length} of ${ENTRY_COUNT} discovered, ${countLabel(model.bests.totalKills)} zombies splatted`,
})

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

export type EntryFrame = Readonly<{
  src: string
  width: number
  height: number
}>

const spriteImageOf = (
  sprite: ReadonlyArray<Draw.Shape>,
): Option.Option<Draw.Image> =>
  Option.flatMap(Array.head(sprite), shape =>
    shape._tag === 'Image' ? Option.some(shape) : Option.none(),
  )

const imageOf = (
  sprite: ReadonlyArray<Draw.Shape>,
): Option.Option<EntryFrame> =>
  Option.map(spriteImageOf(sprite), shape => ({
    src: standaloneSource(shape),
    width: shape.width,
    height: shape.height,
  }))

const STRIDES_PER_STAGE = 4

const strideSprite = (stage: WornFrames, stride: number) =>
  Option.getOrElse(Array.get(stage.walk, stride % stage.walk.length), () =>
    Array.headNonEmpty(stage.walk),
  ).Normal.Right

const firstEntryFrames = new Map<ZombieKind, Option.Option<EntryFrame>>()

export const firstEntryFrame = (
  kind: ZombieKind,
): Option.Option<EntryFrame> => {
  const cached = firstEntryFrames.get(kind)
  if (cached !== undefined) {
    return cached
  }
  const frame = imageOf(
    strideSprite(Array.headNonEmpty(ZOMBIE_SPRITES[kind].stages), 0),
  )
  firstEntryFrames.set(kind, frame)
  return frame
}

const ENTRY_STRIDE_MS = 200

const plinthImagesOf = (kind: ZombieKind): ReadonlyArray<Draw.Image> =>
  pipe(
    ZOMBIE_SPRITES[kind].stages,
    Array.flatMap(stage =>
      Array.makeBy(STRIDES_PER_STAGE, stride =>
        spriteImageOf(strideSprite(stage, stride)),
      ),
    ),
    Array.getSomes,
  )

const plinthImagesByKind = new Map<ZombieKind, ReadonlyArray<Draw.Image>>()

export const plinthImageAt: {
  (screenMs: number): (kind: ZombieKind) => Option.Option<Draw.Image>
  (kind: ZombieKind, screenMs: number): Option.Option<Draw.Image>
} = Function.dual(
  2,
  (kind: ZombieKind, screenMs: number): Option.Option<Draw.Image> => {
    const images = plinthImagesByKind.get(kind) ?? plinthImagesOf(kind)
    plinthImagesByKind.set(kind, images)
    return Array.get(
      images,
      Math.floor(screenMs / ENTRY_STRIDE_MS) % Math.max(1, images.length),
    )
  },
)
