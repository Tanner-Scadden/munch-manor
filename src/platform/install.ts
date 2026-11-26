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

import { toBrowserError } from '../shared/describeError'
import type { InstallOffer, InstallOutcome } from './deviceSchema'

export class InstallPrompt extends Context.Service<
  InstallPrompt,
  {
    readonly offers: Stream.Stream<InstallOffer>
    readonly prompt: Effect.Effect<InstallOutcome>
  }
>()('munch-manor/platform/install/InstallPrompt') {}

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

export const quietLayer: Layer.Layer<InstallPrompt> = Layer.succeed(
  InstallPrompt,
  InstallPrompt.of({
    offers: Stream.never,
    prompt: Effect.succeed('Dismissed'),
  }),
)
