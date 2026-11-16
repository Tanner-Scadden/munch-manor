// @vitest-environment happy-dom
import { Deferred, Effect, Fiber, Schema, Stream, String } from 'effect'
import { Block, Program } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'

import { expect, it } from '@effect/vitest'

// The patch to Foldkit (patches/README.md): a Subscription with no
// dependencies and no `when` starts its Stream once and never reads the Model
// again. Upstream wakes its fiber on every Model change for a Stream step and
// a Schema equivalence of `{}`, and the game's root has a dozen such entries:
// each frame woke them all for nothing. The `slow` option reports every
// dependency read past a budget of -1 ms, so the counts below are every read.

const MESSAGES = 30

const Message = defineMessageUnion({ Ticked: {} })
const Model = Schema.Struct({ count: Schema.Finite })

const CounterKey = Symbol('StaticSubscriptionsCounter')
const CounterBlock = Block.make('StaticSubscriptionsCounter', {
  key: CounterKey,
  InitArgs: Schema.Tuple([]),
  view: { kind: 'Document' },
  Model,
  Message,
})

const subscriptions = CounterBlock.makeSubscriptions(entry => ({
  ticks: entry('StaticTicks', {
    messages: [Message.Ticked],
    handler: function* () {
      return () =>
        Stream.range(1, MESSAGES).pipe(Stream.map(() => Message.Ticked()))
    },
  }),
  counted: entry(
    'CountedTicks',
    { isDone: Schema.Boolean },
    {
      messages: [],
      modelToDependencies: model => ({ isDone: model.count >= MESSAGES }),
      handler: function* () {
        return () => Stream.empty
      },
    },
  ),
}))

const Composition = CounterBlock.makeComposition()

const layer = CounterBlock.makeLayer({
  init: Composition.makeInit(() => ({ model: { count: 0 } })),
  update: Composition.makeUpdate({
    Ticked: model => ({ model: { count: model.count + 1 } }),
  }),
  view: Composition.makeView((model, h) => ({
    title: 'counter',
    body: h.div([], [globalThis.String(model.count)]),
  })),
  subscriptions,
  EffectsLayer: subscriptions.layer,
})

// NOTE: real time: the Program renders on animation frames and its
// Subscription fibers run on the page's own scheduler. It waits until the
// dynamic entry has read every Model the ticks made, then counts.
it.live('a static Subscription never reads the Model after it starts', () =>
  Effect.gen(function* () {
    const container = document.createElement('div')
    container.id = 'static-subscriptions'
    document.body.append(container)
    // NOTE: every dependency read, by the entry's key (`<block>/<entry>`).
    const reads = { ticks: 0, counted: 0 }
    const isCounted = Deferred.makeUnsafe<void>()
    const program = Program.make({
      block: CounterBlock,
      layer,
      container,
      slow: {
        show: 'Always',
        measuredPhases: ['SubscriptionDependencies'],
        thresholdOverrides: { SubscriptionDependencies: -1 },
        onSlow: context => {
          if (context._tag !== 'SubscriptionDependencies') {
            return
          }
          if (String.endsWith('/ticks')(context.subscriptionKey)) {
            reads.ticks++
          } else {
            reads.counted++
          }
          if (reads.counted > MESSAGES) {
            Deferred.doneUnsafe(isCounted, Effect.void)
          }
        },
      },
    })
    const fiber = yield* Effect.forkChild(program.start())
    yield* Deferred.await(isCounted).pipe(Effect.timeout('5 seconds'))
    yield* Fiber.interrupt(fiber)
    container.remove()
    expect(reads.ticks).toBeLessThanOrEqual(1)
  }),
)
