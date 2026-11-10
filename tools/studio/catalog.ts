// What the art studio shows: the game's own sprites, built by the same
// modules the game draws with, grouped by tab. Each entry names where its
// pixels live, so a note about it says which file to change.
import {
  Array,
  Function,
  Match,
  Option,
  Record,
  Schema,
  String,
  pipe,
} from 'effect'
import type { Canvas } from 'foldkit'

import { playerSprites } from '../../src/art/appearance'
import {
  MOOD_FACES,
  type Mood,
  RATTLES_PALETTE,
  rattlesPixels,
} from '../../src/art/rattlesArt'
import { SEAT_LOOKS } from '../../src/art/seatLooks'
import {
  type Facing,
  type Sprite,
  type SpriteFrames,
  type SpriteSet,
  spriteShapes,
} from '../../src/art/sprite'
import { gunIcon, gunSprite, knifeSprite } from '../../src/art/sprites/guns'
import { HEART_SPRITE } from '../../src/art/sprites/hearts'
import { PICKUP_SPRITES } from '../../src/art/sprites/pickups'
import {
  BARRICADE_SPRITES,
  GNOME_SPRITES,
  TRAP_ICONS,
} from '../../src/art/sprites/traps'
import { ZOMBIE_SPRITES } from '../../src/art/sprites/zombies'
import { defaultAppearance } from '../../src/domain/clientSchema'
import {
  RATTLES_LOOKS,
  rattlesShapes,
} from '../../src/features/rattles/rattlesSpot'
import { CELLAR_BULB_SPRITE } from '../../src/render/room/cellarArt'
import { CHANDELIER_SPRITES } from '../../src/render/room/diningArt'
import { SHELF_SPRITES } from '../../src/render/room/libraryArt'
import { Hat, Outfit } from '../../src/shared/playerData'
import { CALLINGS } from '../../src/world/heroes/calling'
import {
  CALLING_NAMES,
  HAT_NAMES,
  PICKUP_NAMES,
  TRAP_NAMES,
  ZOMBIE_NAMES,
  gunTierName,
} from '../../src/world/names'
import { WeaponKind, ZombieKind } from '../../src/world/schema/entitySchema'

// TABS AND LOOKS

export const Tab = Schema.Literals([
  'Zombies',
  'Heroes',
  'Looks',
  'Rattles',
  'Items',
  'Rooms',
])
export type Tab = typeof Tab.Type

export const Tone = Schema.Literals(['Normal', 'Flash', 'Lit', 'Rage'])
export type Tone = typeof Tone.Type

export const FacingChoice = Schema.Literals(['Right', 'Left'])

// NOTE: what every entry is drawn with: the controls over the gallery and the
// clock the animation runs on.
export type Look = Readonly<{ facing: Facing; tone: Tone; clockMs: number }>

export type Entry = Readonly<{
  id: string
  title: string
  source: string
  frameMs: number
  frames: (look: Look) => Array.NonEmptyReadonlyArray<Sprite>
  // NOTE: drawn from the clock itself (the stall's glow and dozing), not
  // stepped frame by frame.
  isClockDriven?: boolean
}>

export type Section = Readonly<{
  title: string
  entries: ReadonlyArray<Entry>
}>

const WALK_FRAME_MS = 160
const STILL_MS = 1

// NOTE: a set's sprite as the controls ask: Flash swaps the palette to the
// hit flash, any other tone keeps the set's own colors.
const setSprite = (set: SpriteSet, look: Look): Sprite =>
  set[look.tone === 'Flash' ? 'Flash' : 'Normal'][look.facing]

const framesSprites = (
  frames: SpriteFrames,
  look: Look,
): Array.NonEmptyReadonlyArray<Sprite> =>
  Array.map(frames, set => setSprite(set, look))

const still = (sprite: Sprite): Array.NonEmptyReadonlyArray<Sprite> => [sprite]

// ZOMBIES

const ZOMBIE_SOURCE = 'src/art/sprites/zombieArt.ts (boss: bossArt.ts)'

const zombieSection = (kind: ZombieKind): Section => {
  const sprites = ZOMBIE_SPRITES[kind]
  const name = ZOMBIE_NAMES[kind]
  const stages = Array.map(sprites.stages, (stage, index) => ({
    id: `zombie/${kind}/wear-${index}`,
    title: index === 0 ? `${name} walk` : `${name} worn ${index}`,
    source: ZOMBIE_SOURCE,
    frameMs: WALK_FRAME_MS,
    frames: (look: Look) =>
      framesSprites(
        look.tone === 'Lit'
          ? stage.lit
          : look.tone === 'Rage'
            ? stage.rage
            : stage.walk,
        look,
      ),
  }))
  const fresh = Array.headNonEmpty(sprites.stages)
  return {
    title: name,
    entries: [
      ...stages,
      {
        id: `zombie/${kind}/gape`,
        title: `${name} gape`,
        source: ZOMBIE_SOURCE,
        frameMs: STILL_MS,
        frames: look => still(setSprite(fresh.gape, look)),
      },
      {
        id: `zombie/${kind}/taunt`,
        title: `${name} taunt`,
        source: ZOMBIE_SOURCE,
        frameMs: STILL_MS,
        frames: look => still(setSprite(fresh.taunt, look)),
      },
      {
        id: `zombie/${kind}/icon`,
        title: `${name} icon`,
        source: ZOMBIE_SOURCE,
        frameMs: STILL_MS,
        frames: () => still(sprites.icon),
      },
    ],
  }
}

// HEROES AND LOOKS

const PLAYER_SOURCE = 'src/art/appearance.ts'

const heroesSections = (): ReadonlyArray<Section> =>
  Array.map(CALLINGS, calling => {
    const sprites = playerSprites(defaultAppearance, calling)
    const name = CALLING_NAMES[calling]
    return {
      title: name,
      entries: [
        {
          id: `hero/${calling}/walk`,
          title: `${name} walk`,
          source: `${PLAYER_SOURCE}, props in src/art/callingArt.ts`,
          frameMs: WALK_FRAME_MS,
          frames: (look: Look) => framesSprites(sprites.walk, look),
        },
        {
          id: `hero/${calling}/idle`,
          title: `${name} idle`,
          source: `${PLAYER_SOURCE}, props in src/art/callingArt.ts`,
          frameMs: WALK_FRAME_MS * 3,
          frames: (look: Look) => framesSprites(sprites.idle, look),
        },
      ],
    }
  })

const lookEntry = (
  id: string,
  title: string,
  source: string,
  appearance: typeof defaultAppearance,
): Entry => ({
  id,
  title,
  source,
  frameMs: WALK_FRAME_MS,
  frames: look => framesSprites(playerSprites(appearance).walk, look),
})

const looksSections = (): ReadonlyArray<Section> => [
  {
    title: 'Co-op seat looks',
    entries: Array.map(SEAT_LOOKS, (appearance, seat) =>
      lookEntry(
        `look/seat-${seat}`,
        `Seat ${seat + 1}`,
        'src/art/seatLooks.ts',
        appearance,
      ),
    ),
  },
  {
    title: 'Outfits',
    entries: Array.map(Outfit.literals, outfit =>
      lookEntry(`look/outfit/${outfit}`, outfit, PLAYER_SOURCE, {
        ...defaultAppearance,
        outfit,
      }),
    ),
  },
  {
    title: 'Hats',
    entries: Array.map(Hat.literals, hat =>
      lookEntry(
        `look/hat/${hat}`,
        HAT_NAMES[hat],
        'src/art/sprites/hatArt.ts',
        {
          ...defaultAppearance,
          hat,
        },
      ),
    ),
  },
]

// RATTLES

const MOODS: Array.NonEmptyReadonlyArray<Mood> = [
  'Grinning',
  'Delighted',
  'Sad',
  'Shrugging',
]

const rattlesSections = (): ReadonlyArray<Section> => [
  {
    title: 'Rattles',
    entries: Array.map(MOODS, mood => {
      const sprite = spriteShapes(
        rattlesPixels(MOOD_FACES[mood]),
        RATTLES_PALETTE,
      )
      return {
        id: `rattles/${mood}`,
        title: mood,
        source: 'src/art/rattlesArt.ts',
        frameMs: STILL_MS,
        frames: () => still(sprite),
      }
    }),
  },
  {
    title: "Rattles' trunk",
    entries: Array.map(RATTLES_LOOKS, rattlesLook => ({
      id: `rattles-spot/${rattlesLook}`,
      title: rattlesLook,
      source: 'src/features/rattles/rattlesSpot.ts',
      frameMs: STILL_MS,
      isClockDriven: true,
      frames: (look: Look) => still(rattlesShapes(rattlesLook, look.clockMs)),
    })),
  },
]

// ITEMS

const TIERS: Array.NonEmptyReadonlyArray<number> = [0, 1, 2, 3]

const stillEntry = (
  id: string,
  title: string,
  source: string,
  sprite: Sprite,
): Entry => ({
  id,
  title,
  source,
  frameMs: STILL_MS,
  frames: () => still(sprite),
})

const itemsSections = (): ReadonlyArray<Section> => [
  {
    title: 'Guns',
    entries: [
      ...Array.flatMap(WeaponKind.literals, kind =>
        Array.map(TIERS, tier =>
          stillEntry(
            `gun/${kind}/tier-${tier}`,
            gunTierName(kind, tier),
            'src/art/sprites/guns.ts',
            gunSprite(kind, tier, 0),
          ),
        ),
      ),
      stillEntry(
        'gun/Knife',
        'Knife',
        'src/art/sprites/guns.ts',
        knifeSprite(0),
      ),
    ],
  },
  {
    title: 'Power-ups',
    entries: [
      ...Array.map(Record.toEntries(PICKUP_SPRITES), ([kind, sprite]) =>
        stillEntry(
          `pickup/${kind}`,
          PICKUP_NAMES[kind],
          'src/art/sprites/pickups.ts',
          sprite,
        ),
      ),
      stillEntry('heart', 'Heart', 'src/art/sprites/hearts.ts', HEART_SPRITE),
    ],
  },
  {
    title: 'Traps',
    entries: [
      {
        id: 'trap/Turret',
        title: TRAP_NAMES.Turret,
        source: 'src/art/sprites/traps.ts',
        frameMs: STILL_MS,
        frames: look => still(setSprite(GNOME_SPRITES, look)),
      },
      ...Array.flatMap(Record.toEntries(BARRICADE_SPRITES), ([lay, stages]) =>
        Array.map(Record.toEntries(stages), ([stage, tones]) =>
          stillEntry(
            `trap/Barricade/${lay}/${stage}`,
            `${TRAP_NAMES.Barricade} ${lay} ${stage}`,
            'src/art/sprites/traps.ts',
            tones.Normal,
          ),
        ),
      ),
      ...Array.map(Record.toEntries(TRAP_ICONS), ([kind, sprite]) =>
        stillEntry(
          `trap/${kind}/icon`,
          `${TRAP_NAMES[kind]} icon`,
          'src/art/sprites/traps.ts',
          sprite,
        ),
      ),
    ],
  },
  {
    title: 'Room pieces',
    entries: [
      ...Array.map(Record.toEntries(CHANDELIER_SPRITES), ([state, sprite]) =>
        stillEntry(
          `piece/Chandelier/${state}`,
          `Chandelier, ${String.toLowerCase(state)}`,
          'src/render/room/diningArt.ts',
          sprite,
        ),
      ),
      ...Array.map(Record.toEntries(SHELF_SPRITES.West), ([state, sprite]) =>
        stillEntry(
          `piece/SecretShelf/${state}`,
          `Secret shelf, ${String.toLowerCase(state)}`,
          'src/render/room/libraryArt.ts',
          sprite,
        ),
      ),
      stillEntry(
        'piece/CellarBulb',
        'Cellar bulb',
        'src/render/room/cellarArt.ts',
        CELLAR_BULB_SPRITE,
      ),
    ],
  },
]

const buildSections = (tab: Tab): ReadonlyArray<Section> =>
  Match.value(tab).pipe(
    Match.when('Zombies', () => Array.map(ZombieKind.literals, zombieSection)),
    Match.when('Heroes', heroesSections),
    Match.when('Looks', looksSections),
    Match.when('Rattles', rattlesSections),
    Match.when('Items', itemsSections),
    Match.when('Rooms', () => []),
    Match.exhaustive,
  )

const sectionCache = new Map<Tab, ReadonlyArray<Section>>()

// NOTE: each tab's sections are built once and kept, so an entry is the same
// object on every render and the gallery's lazy cards can skip it. The Rooms
// tab draws the level itself (see ./room.ts), not a gallery.
export const sectionsOf = (tab: Tab): ReadonlyArray<Section> =>
  Option.getOrElse(Option.fromNullishOr(sectionCache.get(tab)), () => {
    const built = buildSections(tab)
    sectionCache.set(tab, built)
    return built
  })

export const entryById = (id: string): Option.Option<Entry> =>
  pipe(
    Tab.literals,
    Array.flatMap(tab => sectionsOf(tab)),
    Array.flatMap(section => section.entries),
    Array.findFirst(entry => entry.id === id),
  )

// NOTE: the tab an entry sits in, for a note that opens it.
export const tabOfEntry = (id: string): Option.Option<Tab> =>
  Array.findFirst(Tab.literals, tab =>
    Array.some(sectionsOf(tab), section =>
      Array.some(section.entries, entry => entry.id === id),
    ),
  )

// BOUNDS

export type Bounds = Readonly<{
  left: number
  top: number
  right: number
  bottom: number
}>

const EMPTY_BOUNDS: Bounds = {
  left: Infinity,
  top: Infinity,
  right: -Infinity,
  bottom: -Infinity,
}

const joinBounds = (a: Bounds, b: Bounds): Bounds => ({
  left: Math.min(a.left, b.left),
  top: Math.min(a.top, b.top),
  right: Math.max(a.right, b.right),
  bottom: Math.max(a.bottom, b.bottom),
})

const boxBounds = (
  x: number,
  y: number,
  width: number,
  height: number,
): Bounds => ({ left: x, top: y, right: x + width, bottom: y + height })

const shiftBounds = (bounds: Bounds, x: number, y: number): Bounds => ({
  left: bounds.left + x,
  top: bounds.top + y,
  right: bounds.right + x,
  bottom: bounds.bottom + y,
})

// NOTE: the box a list of shapes covers, in their own coordinates. Paths
// and text are left out: no sprite is made of them.
export const boundsOf = (shapes: ReadonlyArray<Canvas.Shape>): Bounds =>
  Array.reduce(shapes, EMPTY_BOUNDS, (bounds: Bounds, shape): Bounds =>
    joinBounds(
      bounds,
      Match.valueTags(shape, {
        Rect: ({ x, y, width, height }) => boxBounds(x, y, width, height),
        Image: ({ x, y, width, height }) => boxBounds(x, y, width, height),
        Circle: ({ x, y, radius }) =>
          boxBounds(x - radius, y - radius, radius * 2, radius * 2),
        Group: group =>
          shiftBounds(
            boundsOf(group.shapes),
            group.translate?.x ?? 0,
            group.translate?.y ?? 0,
          ),
        Path: () => EMPTY_BOUNDS,
        Text: () => EMPTY_BOUNDS,
      }),
    ),
  )

// THE CREW

// NOTE: who stands beside a sprite in the big view's "next to the crew", so
// its size reads against the player and the plainest zombie, frame for frame.
export const crewOf: {
  (frame: number): (look: Look) => ReadonlyArray<Sprite>
  (look: Look, frame: number): ReadonlyArray<Sprite>
} = Function.dual(2, (look: Look, frame: number): ReadonlyArray<Sprite> => {
  const plain = { ...look, tone: 'Normal' as const }
  const player = playerSprites(defaultAppearance).walk
  const groaner = ZOMBIE_SPRITES.Shambler.walk
  return [
    setSprite(
      pipe(
        player,
        Array.get(frame % player.length),
        Option.getOrElse(() => Array.headNonEmpty(player)),
      ),
      plain,
    ),
    setSprite(
      pipe(
        groaner,
        Array.get(frame % groaner.length),
        Option.getOrElse(() => Array.headNonEmpty(groaner)),
      ),
      plain,
    ),
  ]
})

// TAB ICONS

// NOTE: a little house for the Rooms tab, which has no sprite of its own.
const HOUSE_PIXELS: ReadonlyArray<string> = [
  '....RR....',
  '...RRRR...',
  '..RRRRRR..',
  '.RRRRRRRR.',
  'RRRRRRRRRR',
  '.WWWWWWWW.',
  '.WYYWWDDW.',
  '.WYYWWDDW.',
  '.WWWWWDDW.',
  '.WWWWWDDW.',
]

const HOUSE_PALETTE = {
  R: '#c8463c',
  W: '#e9dcc0',
  Y: '#ffd23f',
  D: '#6b4a32',
}

// NOTE: each tab's icon in the sidebar, drawn from the game's own art.
export const tabIconOf = (tab: Tab): Sprite =>
  Match.value(tab).pipe(
    Match.when('Zombies', () => ZOMBIE_SPRITES.Shambler.icon),
    Match.when('Heroes', () =>
      setSprite(Array.headNonEmpty(playerSprites(defaultAppearance).idle), {
        facing: 'Right',
        tone: 'Normal',
        clockMs: 0,
      }),
    ),
    Match.when('Looks', () =>
      setSprite(
        Array.headNonEmpty(
          playerSprites({ ...defaultAppearance, hat: 'TopHat' }).idle,
        ),
        { facing: 'Right', tone: 'Normal', clockMs: 0 },
      ),
    ),
    Match.when('Rattles', () =>
      spriteShapes(rattlesPixels(MOOD_FACES.Grinning), RATTLES_PALETTE),
    ),
    Match.when('Items', () => gunIcon('Cooker', 0)),
    Match.when('Rooms', () => spriteShapes(HOUSE_PIXELS, HOUSE_PALETTE)),
    Match.exhaustive,
  )
