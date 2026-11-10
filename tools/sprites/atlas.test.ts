import { Array, Context, Effect, Layer, Option, Record } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { modifyFields } from 'foldkit/struct'

import * as NodeServices from '@effect/platform-node/NodeServices'
import { expect, layer } from '@effect/vitest'

import { sceneShapes } from '../../src/app/layers'
import { type Model, Phase } from '../../src/app/model'
import { initialModel } from '../../src/app/pureApp'
import { standInKeyOf } from '../../src/art/spriteAtlas'
import { occludersOf } from '../../src/render/occluders'
import { roomShapes } from '../../src/render/room/room'
import { fighting, withActors } from '../../src/test/model.fixture'
import {
  SURFACE,
  imagesIn,
  openFloorSpot,
  zombieOf,
} from '../../src/test/testing'
import { levelOf } from '../../src/world/level/arena'
import {
  ZOMBIE_KINDS,
  ZOMBIE_KIND_ORDER,
} from '../../src/world/zombies/zombies'
import { decodeJson } from '../json'
import { SpriteKeys } from './manifest'

// NOTE: the atlas holds what ./build.ts finds: every sprite built
// as the modules load, and the ones src/art/spritePrecompile.ts builds. A sprite
// first built while drawing a scene would miss the atlas and be encoded on
// the main thread mid-game, so these scenes must draw only sprites the
// generator found. The generator runs in its own process, so the keys it
// lists do not depend on what other tests built.
class GeneratorKeys extends Context.Service<
  GeneratorKeys,
  ReadonlySet<string>
>()('munch-manor/tools/sprites/atlas.test/GeneratorKeys') {}

// NOTE: a failed run prints nothing, so its keys fail to decode.
const GeneratorKeysLayer = Layer.effect(
  GeneratorKeys,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const stdout = yield* spawner.string(
      ChildProcess.make('bun', ['tools/sprites/build.ts', '--keys']),
    )
    return new Set(decodeJson(SpriteKeys)(stdout))
  }),
).pipe(Layer.provide(NodeServices.layer))

const keysDrawnIn = (model: Model): ReadonlyArray<string> => {
  const level = levelOf(model)
  return Array.getSomes(
    Array.map(
      imagesIn([
        ...roomShapes(level),
        ...Array.flatMap(occludersOf(level), ({ shapes }) => shapes),
        ...sceneShapes(model),
      ]),
      ({ src }) => standInKeyOf(src),
    ),
  )
}

const measured = (model: Model): Model =>
  modifyFields(model, { maybeSurface: () => Option.some(SURFACE) })

const HEALTH_SHARES: ReadonlyArray<number> = [1, 0.7, 0.4, 0.15]

// NOTE: every kind at every wear stage, standing in the room.
const everyKindWorn: Model = withActors(
  measured(fighting),
  Array.flatMap(ZOMBIE_KIND_ORDER, (kind, kindIndex) =>
    Array.map(HEALTH_SHARES, (share, shareIndex) => {
      const id = kindIndex * HEALTH_SHARES.length + shareIndex
      const { x, y } = openFloorSpot(id)
      const maxHp = ZOMBIE_KINDS[kind].hp
      return zombieOf(kind, id, x, y, {
        hp: Math.max(1, Math.round(maxHp * share)),
        maxHp,
      })
    }),
  ),
)

const SCENES: Readonly<Record<string, Model>> = {
  home: measured(initialModel),
  fight: everyKindWorn,
  paused: modifyFields(measured(fighting), {
    phase: () =>
      Phase.Paused({
        round: { _tag: 'Wave', wave: 3, elapsedMs: 4000, spawns: [] },
      }),
  }),
  gameOver: modifyFields(measured(fighting), {
    phase: () => Phase.GameOver({ wave: 3 }),
  }),
  victory: modifyFields(measured(fighting), {
    phase: () => Phase.Escaped({ wave: 10 }),
  }),
  break: modifyFields(measured(initialModel), {
    phase: () =>
      Phase.Preparation({
        wave: 2,
        remainingMs: 15_000,
        durationMs: 20_000,
        spawns: [],
      }),
  }),
}

layer(GeneratorKeysLayer, { timeout: 30_000 })('the sprite atlas', it => {
  it.effect('finds the sprites the game builds as it loads', () =>
    Effect.gen(function* () {
      const keys = yield* GeneratorKeys
      expect(keys.size).toBeGreaterThan(1000)
    }),
  )

  for (const [name, model] of Record.toEntries(SCENES)) {
    it.effect(`holds every sprite the ${name} scene draws`, () =>
      Effect.gen(function* () {
        const keys = yield* GeneratorKeys
        const missing = Array.filter(keysDrawnIn(model), key => !keys.has(key))
        expect(Array.dedupe(missing)).toEqual([])
      }),
    )
  }
})
