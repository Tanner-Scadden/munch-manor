import { Array, Option, pipe } from 'effect'

import type { ZombieKind } from '../model'
import {
  type Facing,
  type Palette,
  type Sprite,
  type SpriteFrames,
  type SpriteSet,
  TRANSPARENT,
  facingSprites,
  frameAt,
  spriteFrames,
  spriteSet,
  spriteShapes,
  spriteWidth,
} from '../sprite'
import {
  BOSS_ENRAGED_PALETTE,
  BOSS_ICON_PIXELS,
  BOSS_LEGS_PLANTED,
  BOSS_PALETTE,
  BOSS_WEAR,
  BOSS_WIDTH,
  bossPixels,
  bossWalkPixels,
} from './bossArt'
import { type FramePixels, firstFrame } from './wear'
import {
  CHUCKER_ICON_PIXELS,
  CHUCKER_PALETTE,
  CHUCKER_WALK_WEAR,
  CRAWLER_ICON_PIXELS,
  CRAWLER_PALETTE,
  CRAWLER_WEAR,
  EXPLODER_FUSE_BASE,
  EXPLODER_ICON_PIXELS,
  EXPLODER_LIT_PALETTE,
  EXPLODER_PALETTE,
  EXPLODER_WEAR,
  FRENZY_EYE,
  GROANER_HIGH_WEAR,
  RUNNER_HEAD_WEAR,
  RUNNER_ICON_PIXELS,
  RUNNER_PALETTE,
  SHAMBLER_ICON_PIXELS,
  TANK_ARMOR,
  TANK_ICON_PIXELS,
  TANK_PALETTE,
  ZOMBIE_BODY_WIDTH,
  ZOMBIE_PALETTE,
  ZOMBIE_SWAY_ROOM,
  chuckerHeftPixels,
  chuckerTauntPixels,
  chuckerWalkPixels,
  crawlerWalkPixels,
  exploderWalkPixels,
  groanerWalkPixels,
  runnerWalkPixels,
  tankWalkPixels,
} from './zombieArt'

const GROANER_ANCHOR_X = ZOMBIE_SWAY_ROOM + ZOMBIE_BODY_WIDTH / 2

const EXPLODER_ANCHOR_X = ZOMBIE_SWAY_ROOM + 6

const BOSS_ANCHOR_X = BOSS_WIDTH / 2

const CHUCKER_ANCHOR_X = 6

const CRAWLER_ANCHOR_X = 6

export type WornFrames = Readonly<{
  walk: SpriteFrames
  lit: SpriteFrames
  gape: SpriteSet
  litGape: SpriteSet
  rage: SpriteFrames
  rageGape: SpriteSet
  taunt: SpriteSet
}>

type ZombieSprites = Readonly<{
  walk: SpriteFrames
  lit: SpriteFrames
  icon: Sprite
  height: number
  stages: Array.NonEmptyReadonlyArray<WornFrames>
}>

type WearArt = Readonly<{
  stageCount: number
  pixelsAt: (stage: number) => FramePixels
  gapeAt: (stage: number) => ReadonlyArray<string>
  palette: Palette
  litPalette: Palette
  ragePalette: Palette
  anchorX: number
  icon: ReadonlyArray<string>
  maybeTauntAt: Option.Option<(stage: number) => ReadonlyArray<string>>
}>

// NOTE: a frenzied zombie's eyes glow red, so its rage frames are its walk
// frames with the eye color swapped.
const withRedEyes = (palette: Palette, eye: string): Palette => ({
  ...palette,
  [eye]: FRENZY_EYE,
})

const wornFrames =
  (art: WearArt) =>
  (stage: number): WornFrames => {
    const pixels = art.pixelsAt(stage)
    const walk = spriteFrames(pixels, art.palette, art.anchorX)
    const gape = spriteSet(art.palette, art.anchorX)(art.gapeAt(stage))
    const isLitSame = art.litPalette === art.palette
    return {
      walk,
      lit: isLitSame ? walk : spriteFrames(pixels, art.litPalette, art.anchorX),
      gape,
      litGape: isLitSame
        ? gape
        : spriteSet(art.litPalette, art.anchorX)(art.gapeAt(stage)),
      rage: spriteFrames(pixels, art.ragePalette, art.anchorX),
      rageGape: spriteSet(art.ragePalette, art.anchorX)(art.gapeAt(stage)),
      taunt: Option.match(art.maybeTauntAt, {
        onNone: () => gape,
        onSome: tauntAt => spriteSet(art.palette, art.anchorX)(tauntAt(stage)),
      }),
    }
  }

const zombieSprites = (art: WearArt): ZombieSprites => {
  const stages = Array.map(Array.range(0, art.stageCount), wornFrames(art))
  const fresh = Array.headNonEmpty(stages)
  return {
    walk: fresh.walk,
    lit: fresh.lit,
    icon: spriteShapes(art.icon, art.palette),
    height: firstFrame(0, art.pixelsAt).length,
    stages,
  }
}

export const ZOMBIE_SPRITES: Readonly<Record<ZombieKind, ZombieSprites>> = {
  Shambler: zombieSprites({
    stageCount: GROANER_HIGH_WEAR.length,
    pixelsAt: groanerWalkPixels,
    gapeAt: stage => firstFrame(stage, groanerWalkPixels),
    palette: ZOMBIE_PALETTE,
    litPalette: ZOMBIE_PALETTE,
    ragePalette: withRedEyes(ZOMBIE_PALETTE, 'R'),
    anchorX: GROANER_ANCHOR_X,
    icon: SHAMBLER_ICON_PIXELS,
    maybeTauntAt: Option.none(),
  }),
  Runner: zombieSprites({
    stageCount: RUNNER_HEAD_WEAR.length,
    pixelsAt: runnerWalkPixels,
    gapeAt: stage => firstFrame(stage, runnerWalkPixels),
    palette: RUNNER_PALETTE,
    litPalette: RUNNER_PALETTE,
    ragePalette: withRedEyes(RUNNER_PALETTE, 'W'),
    anchorX: 5,
    icon: RUNNER_ICON_PIXELS,
    maybeTauntAt: Option.none(),
  }),
  Tank: zombieSprites({
    stageCount: TANK_ARMOR.length,
    pixelsAt: tankWalkPixels,
    gapeAt: stage => firstFrame(stage, tankWalkPixels),
    palette: TANK_PALETTE,
    litPalette: TANK_PALETTE,
    ragePalette: withRedEyes(TANK_PALETTE, 'E'),
    anchorX: 9,
    icon: TANK_ICON_PIXELS,
    maybeTauntAt: Option.none(),
  }),
  Exploder: zombieSprites({
    stageCount: EXPLODER_WEAR.length,
    pixelsAt: exploderWalkPixels,
    gapeAt: stage => firstFrame(stage, exploderWalkPixels),
    palette: EXPLODER_PALETTE,
    litPalette: EXPLODER_LIT_PALETTE,
    ragePalette: withRedEyes(EXPLODER_PALETTE, 'E'),
    anchorX: EXPLODER_ANCHOR_X,
    icon: EXPLODER_ICON_PIXELS,
    maybeTauntAt: Option.none(),
  }),
  Thrower: zombieSprites({
    stageCount: CHUCKER_WALK_WEAR.length,
    pixelsAt: chuckerWalkPixels,
    gapeAt: chuckerHeftPixels,
    palette: CHUCKER_PALETTE,
    litPalette: CHUCKER_PALETTE,
    ragePalette: withRedEyes(CHUCKER_PALETTE, 'E'),
    anchorX: CHUCKER_ANCHOR_X,
    icon: CHUCKER_ICON_PIXELS,
    maybeTauntAt: Option.some(chuckerTauntPixels),
  }),
  Crawler: zombieSprites({
    stageCount: CRAWLER_WEAR.length,
    pixelsAt: crawlerWalkPixels,
    gapeAt: stage => firstFrame(stage, crawlerWalkPixels),
    palette: CRAWLER_PALETTE,
    litPalette: CRAWLER_PALETTE,
    ragePalette: withRedEyes(CRAWLER_PALETTE, 'E'),
    anchorX: CRAWLER_ANCHOR_X,
    icon: CRAWLER_ICON_PIXELS,
    maybeTauntAt: Option.none(),
  }),
  Boss: zombieSprites({
    stageCount: BOSS_WEAR.length,
    pixelsAt: bossWalkPixels,
    gapeAt: stage => bossPixels(BOSS_LEGS_PLANTED, stage, true),
    palette: BOSS_PALETTE,
    litPalette: BOSS_ENRAGED_PALETTE,
    ragePalette: BOSS_ENRAGED_PALETTE,
    anchorX: BOSS_ANCHOR_X,
    icon: BOSS_ICON_PIXELS,
    maybeTauntAt: Option.none(),
  }),
}

export const wornFramesAt = (kind: ZombieKind, stage: number): WornFrames => {
  const { stages } = ZOMBIE_SPRITES[kind]
  return Option.getOrElse(
    Array.get(stages, Math.min(stage, stages.length - 1)),
    () => Array.headNonEmpty(stages),
  )
}

export const BOSS_ICON = ZOMBIE_SPRITES.Boss.icon

// KABOOMER FUSE

const EXPLODER_FRAME_HEIGHT = firstFrame(0, exploderWalkPixels).length
const EXPLODER_FRAME_WIDTH = spriteWidth(firstFrame(0, exploderWalkPixels))
const FUSE_HEADROOM = 3
const WALK_SWAYS: ReadonlyArray<number> = [0, 1, 0, -1]

const FUSE_PATH: Array.NonEmptyReadonlyArray<
  Readonly<{ x: number; y: number }>
> = [
  { x: 0, y: 0 },
  { x: 0, y: -1 },
  { x: 1, y: -2 },
  { x: 1, y: -3 },
  { x: 2, y: -4 },
  { x: 3, y: -4 },
]

export const KABOOMER_FUSE_MAX = FUSE_PATH.length

const FUSE_PALETTE: Palette = { f: '#ecd59a', d: '#b08a52' }

const swayAt = (frameIndex: number): number =>
  Option.getOrElse(
    Array.get(WALK_SWAYS, frameIndex % WALK_SWAYS.length),
    () => 0,
  )

const fuseCell = (frameIndex: number, step: number) => {
  const point = Option.getOrElse(Array.get(FUSE_PATH, step), () =>
    Array.headNonEmpty(FUSE_PATH),
  )
  return {
    x: EXPLODER_FUSE_BASE.x + point.x + ZOMBIE_SWAY_ROOM + swayAt(frameIndex),
    y: EXPLODER_FUSE_BASE.y + point.y + FUSE_HEADROOM,
  }
}

const fusePixels = (
  length: number,
  frameIndex: number,
): ReadonlyArray<string> => {
  const cells = Array.makeBy(length, step => fuseCell(frameIndex, step))
  return Array.makeBy(EXPLODER_FRAME_HEIGHT + FUSE_HEADROOM, y =>
    Array.join(
      Array.makeBy(EXPLODER_FRAME_WIDTH, x =>
        Option.match(
          Array.findFirstIndex(cells, cell => cell.x === x && cell.y === y),
          {
            onNone: () => TRANSPARENT,
            onSome: step => (step % 2 === 0 ? 'f' : 'd'),
          },
        ),
      ),
      '',
    ),
  )
}

const FUSE_SPRITES: ReadonlyArray<
  ReadonlyArray<Readonly<Record<Facing, Sprite>>>
> = Array.makeBy(KABOOMER_FUSE_MAX + 1, length =>
  Array.makeBy(WALK_SWAYS.length, frameIndex =>
    facingSprites(
      fusePixels(length, frameIndex),
      FUSE_PALETTE,
      EXPLODER_ANCHOR_X,
    ),
  ),
)

const NO_FUSE: Readonly<Record<Facing, Sprite>> = { Left: [], Right: [] }

// NOTE: the fuse is one prebuilt image for each length and walk frame, laid
// over the Kaboomer's sprite in the same frame of reference, so it sways and
// mirrors with him.
export const kaboomerFuseSprite = (
  length: number,
  frameIndex: number,
  facing: Facing,
): Sprite =>
  pipe(
    Array.get(FUSE_SPRITES, length),
    Option.flatMap(frames => Array.get(frames, frameIndex % WALK_SWAYS.length)),
    Option.getOrElse(() => NO_FUSE),
  )[facing]

export const kaboomerFuseTip = (
  length: number,
  frameIndex: number,
  facing: Facing,
): Readonly<{ x: number; y: number }> => {
  const cell = fuseCell(frameIndex, Math.max(0, length - 1))
  const x = cell.x - EXPLODER_ANCHOR_X
  return {
    x: facing === 'Right' ? x : -x - 1,
    y: cell.y - EXPLODER_FRAME_HEIGHT - FUSE_HEADROOM,
  }
}

// NOTE: a zombie walking outside the room, on the new zombie card or in the
// title parade, with its props: the Kaboomer carries his fuse at full length.
export const showcaseWalk = (
  kind: ZombieKind,
  stride: number,
  facing: Facing,
): Sprite => [
  ...frameAt(ZOMBIE_SPRITES[kind].walk, stride).Normal[facing],
  ...(kind === 'Exploder'
    ? kaboomerFuseSprite(KABOOMER_FUSE_MAX, stride, facing)
    : []),
]
