import { Array, Context, Effect, Layer, Option, Record } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

import * as NodeServices from '@effect/platform-node/NodeServices'
import { UiStruct } from '@effect/ui'
import { expect, layer } from '@effect/vitest'

import { sceneShapes } from '../../src/app/layers'
import { type Model, Phase } from '../../src/app/model'
import { initialModel } from '../../src/app/pureApp'
import { standInKeyOf } from '../../src/art/spriteAtlas'
import { roomShapes } from '../../src/render/room/room'
import { fighting, withActors } from '../../src/test/model.fixture'
import { SURFACE, openFloorSpot, zombieOf } from '../../src/test/testing'
import { imagesIn } from '../../src/test/viewReading'
import { levelOf } from '../../src/world/level/arena'
import { BreakClock } from '../../src/world/schema/worldSchema'
import {
  ZOMBIE_KINDS,
  ZOMBIE_KIND_ORDER,
} from '../../src/world/zombies/zombies'
import { decodeJson } from '../json'
import { SpriteKeys } from './manifest'

class GeneratorKeys extends Context.Service<
  GeneratorKeys,
  ReadonlySet<string>
>()('munch-manor/tools/sprites/atlas.test/GeneratorKeys') {}

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
      imagesIn([...roomShapes(level), ...sceneShapes(model)]),
      ({ src }) => standInKeyOf(src),
    ),
  )
}

const measured = (model: Model): Model =>
  UiStruct.evolve(model, { maybeSurface: () => Option.some(SURFACE) })

const HEALTH_SHARES: ReadonlyArray<number> = [1, 0.7, 0.4, 0.15]

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
  paused: UiStruct.evolve(measured(fighting), {
    phase: () =>
      Phase.Paused({
        round: { _tag: 'Wave', wave: 3, elapsedMs: 4000, spawns: [] },
      }),
  }),
  gameOver: UiStruct.evolve(measured(fighting), {
    phase: () => Phase.GameOver({ wave: 3 }),
  }),
  victory: UiStruct.evolve(measured(fighting), {
    phase: () => Phase.Escaped({ wave: 10 }),
  }),
  break: UiStruct.evolve(measured(initialModel), {
    phase: () =>
      Phase.Preparation({
        clock: BreakClock.Counting(),
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
