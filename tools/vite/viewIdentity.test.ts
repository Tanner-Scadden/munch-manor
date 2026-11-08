import { Array, Effect, FileSystem, Path, String } from 'effect'

import * as NodeServices from '@effect/platform-node/NodeServices'
import { expect, layer } from '@effect/vitest'

import { foldkitBrandingViews, isViewSource } from './viewIdentity'

const rootOf = Effect.map(Path.Path, path =>
  path.resolve(import.meta.dirname, '../..'),
)

const sourceOf = (relative: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* rootOf
    return yield* fs.readFileString(path.join(root, relative))
  })

const isViewFile = (relative: string) =>
  Effect.map(sourceOf(relative), isViewSource)

const VNODE_MAKERS = /\bh\.[a-zA-Z]+\(|\bCanvas\.view\(|\bdefineView\b/

layer(NodeServices.layer)(
  'which modules the view identity transform brands',
  it => {
    it.effect(
      'a view module, even one that imports its builder only as a type',
      () =>
        Effect.gen(function* () {
          const found = yield* Effect.forEach(
            [
              'src/features/home/homeView.ts',
              'src/app/layers.ts',
              'src/features/profile/blocks/look/view.ts',
            ],
            isViewFile,
          )
          expect(found).toStrictEqual([true, true, true])
        }),
    )

    it.effect(
      'not the simulation, the pathing, or a canvas shape builder',
      () =>
        Effect.gen(function* () {
          const found = yield* Effect.forEach(
            [
              'src/world/step/simulation.ts',
              'src/world/level/pathing.ts',
              'src/render/effectsView.ts',
            ],
            isViewFile,
          )
          expect(found).toStrictEqual([false, false, false])
        }),
    )

    it.effect('every module under src that makes a vnode', () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const root = yield* rootOf
        const listed = yield* fs.readDirectory(path.join(root, 'src'), {
          recursive: true,
        })
        const modules = Array.map(
          Array.filter(
            listed,
            file =>
              String.endsWith('.ts')(file) &&
              !String.endsWith('.test.ts')(file),
          ),
          file => `src/${file}`,
        )
        const unbranded = yield* Effect.filter(modules, file =>
          Effect.map(
            sourceOf(file),
            source => VNODE_MAKERS.test(source) && !isViewSource(source),
          ),
        )
        expect(unbranded).toStrictEqual([])
      }),
    )

    it.effect('wraps only the view identity plugin', () =>
      Effect.sync(() => {
        const names = Array.map(foldkitBrandingViews(), plugin => plugin.name)
        expect(names).toContain('foldkit:view-identity')
      }),
    )
  },
)
