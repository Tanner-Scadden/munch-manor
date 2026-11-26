import { Array, Effect } from 'effect'

import { UiStruct, type View } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { FIXED_STEP_MS } from '../../shared/constants'
import {
  DISTANT_SPAWN,
  homeAfterRead,
  inPortrait,
} from '../../test/model.fixture'
import {
  APPLICATION,
  PHONE_LANDSCAPE,
  PHONE_PORTRAIT,
  send,
  settleRunCommands,
  storyOf,
  tick,
} from '../../test/testing'
import { asVeteran } from '../../test/veteran'
import { Message } from '../message'
import { type Model, Phase } from '../model'
import { initialModel } from '../pureApp'

// NOTE: a lazy view (`h.lazy`) hands the renderer the very node it drew
// last frame. Unkeyed siblings pair by position, so when such a list
// changes a cached node could be paired with the wrong element: the page
// keeps a stale copy while the cache points at a detached one. That is how
// co-op once left two shop dialogs in the page. These tests render two
// frames and hold every node the second frame reuses from the first to a
// key.

type NodeLike = Readonly<{
  _tag: string
  tag?: string | undefined
  elementKey?: string | undefined
  children?: ReadonlyArray<NodeLike> | undefined
}>

const nodesIn = (root: NodeLike): ReadonlyArray<NodeLike> => [
  root,
  ...Array.flatMap(root.children ?? [], nodesIn),
]

// NOTE: the nodes of `next` that are the very objects of `previous`, at the
// top of each reused subtree (the renderer skips what is under one).
const reusedRoots = (
  previous: NodeLike,
  next: NodeLike,
): ReadonlyArray<NodeLike> => {
  const before = new Set(nodesIn(previous))
  const found: Array<NodeLike> = []
  const visit = (node: NodeLike) => {
    if (before.has(node)) {
      found.push(node)
      return
    }
    Array.forEach(node.children ?? [], visit)
  }
  visit(next)
  return found
}

const describeNode = (node: NodeLike): string => node.tag ?? node._tag

// NOTE: renders the model, then one more frame, and hands back the reused
// nodes' keys and the tags of any reused node without one. A Scene keeps
// no `h.lazy` nodes between its renders, so the root's view is drawn here
// as the page's host draws it, with one store kept across the two frames,
// from the Models a Story leaves.
const reuseAcrossAFrame = Effect.fnUntraced(function* (
  model: Model,
  surface: typeof PHONE_LANDSCAPE,
) {
  const store: View.LazyStore = { lazy: undefined }
  const draw = (current: Model): NodeLike =>
    APPLICATION.view(
      current,
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      store,
    )
  const s = yield* storyOf(model)
  s.pipe(send(Message.MeasuredGameSurface(surface)))
  const previous = draw(s.model)
  s.pipe(tick(FIXED_STEP_MS), settleRunCommands)
  const next = draw(s.model)
  const reused = reusedRoots(previous, next)
  return {
    keys: Array.flatMap(reused, node =>
      node.elementKey === undefined ? [] : [node.elementKey],
    ),
    unkeyed: Array.map(
      Array.filter(reused, node => node.elementKey === undefined),
      describeNode,
    ),
  }
})

const fighting: Model = UiStruct.evolve(asVeteran(initialModel), {
  lastDevice: () => 'Touch',
  phase: () =>
    Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [DISTANT_SPAWN] }),
})

describe('cached nodes', () => {
  it.effect('on the home menu, every node a frame reuses is keyed', () =>
    Effect.gen(function* () {
      const { unkeyed } = yield* reuseAcrossAFrame(
        homeAfterRead,
        PHONE_LANDSCAPE,
      )
      expect(unkeyed).toEqual([])
    }),
  )

  it.effect('in a landscape fight, every node a frame reuses is keyed', () =>
    Effect.gen(function* () {
      const { keys, unkeyed } = yield* reuseAcrossAFrame(
        fighting,
        PHONE_LANDSCAPE,
      )
      expect(unkeyed).toEqual([])
      expect(keys).toEqual(expect.arrayContaining(['overlay-layer']))
    }),
  )

  it.effect(
    'in a portrait fight, the thumb area and every other reused node is keyed',
    () =>
      Effect.gen(function* () {
        const { keys, unkeyed } = yield* reuseAcrossAFrame(
          inPortrait(fighting),
          PHONE_PORTRAIT,
        )
        expect(unkeyed).toEqual([])
        expect(keys).toEqual(
          expect.arrayContaining(['overlay-layer', 'thumb-area']),
        )
      }),
  )
})
