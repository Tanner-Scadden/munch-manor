import {
  Context,
  Effect,
  Layer,
  Option,
  Ref,
  Stream,
  SubscriptionRef,
  pipe,
} from 'effect'

import { toBrowserError } from './describeError'
import type { InstallOffer, InstallOutcome } from './model'

// SERVICE

// NOTE: Chrome's install prompt, as one Effect service. Chrome fires
// beforeinstallprompt once, any time after load, and its event is the only
// handle that can show the prompt later. The layer listens from the moment
// the runtime starts and holds the event here, outside the Model: the
// installOffers Subscription tells update what is on offer, and the
// ShowInstallPrompt Command asks this service to show it. Tests and the
// audit harness swap in a quiet one.
export class InstallPrompt extends Context.Service<
  InstallPrompt,
  {
    readonly offers: Stream.Stream<InstallOffer>
    readonly prompt: Effect.Effect<InstallOutcome>
  }
>()('munch-manor/install/InstallPrompt') {}

// LIVE

type UserChoice = Readonly<{ outcome: string }>

type DeferredPrompt = Event &
  Readonly<{
    prompt: () => Promise<void>
    userChoice: Promise<UserChoice>
  }>

const isDeferredPrompt = (event: Event): event is DeferredPrompt =>
  typeof Reflect.get(event, 'prompt') === 'function' &&
  Reflect.get(event, 'userChoice') instanceof Promise

const showPrompt = (deferred: DeferredPrompt) =>
  pipe(
    Effect.tryPromise({
      try: () => deferred.prompt().then(() => deferred.userChoice),
      catch: toBrowserError,
    }),
    Effect.map(({ outcome }): InstallOutcome =>
      outcome === 'accepted' ? 'Accepted' : 'Dismissed',
    ),
    Effect.orElseSucceed((): InstallOutcome => 'Unavailable'),
  )

export const layer: Layer.Layer<InstallPrompt> = Layer.effect(
  InstallPrompt,
  Effect.gen(function* () {
    const scope = yield* Effect.scope
    const offer = yield* SubscriptionRef.make<InstallOffer>('None')
    const held = yield* Ref.make(Option.none<DeferredPrompt>())

    const offered = pipe(
      Stream.fromEventListener<Event>(window, 'beforeinstallprompt'),
      Stream.filter(isDeferredPrompt),
      Stream.runForEach(event =>
        Effect.andThen(
          Effect.sync(() => event.preventDefault()),
          Effect.andThen(
            Ref.set(held, Option.some(event)),
            SubscriptionRef.set(offer, 'Ready'),
          ),
        ),
      ),
    )
    const installed = pipe(
      Stream.fromEventListener<Event>(window, 'appinstalled'),
      Stream.runForEach(() =>
        Effect.andThen(
          Ref.set(held, Option.none()),
          SubscriptionRef.set(offer, 'Installed'),
        ),
      ),
    )
    yield* Effect.forkIn(offered, scope)
    yield* Effect.forkIn(installed, scope)

    // NOTE: Chrome lets an event prompt once, so the offer is spent the
    // moment it is used, whatever the player picks.
    const prompt = Effect.gen(function* () {
      const maybeDeferred = yield* Ref.getAndSet(held, Option.none())
      if (Option.isNone(maybeDeferred)) {
        return 'Unavailable' satisfies InstallOutcome
      }
      yield* SubscriptionRef.set(offer, 'None')
      return yield* showPrompt(maybeDeferred.value)
    })

    return InstallPrompt.of({ offers: SubscriptionRef.changes(offer), prompt })
  }),
)

// QUIET

// NOTE: for tests and the audit harness: nothing is ever offered, and a
// prompt asked for anyway is turned down.
export const quietLayer: Layer.Layer<InstallPrompt> = Layer.succeed(
  InstallPrompt,
  InstallPrompt.of({
    offers: Stream.never,
    prompt: Effect.succeed('Dismissed'),
  }),
)
