// @vitest-environment happy-dom
import { Effect, Option } from 'effect'
import { FetchHttpClient } from 'effect/http'

import { Component, UiStruct } from '@effect/ui'
import { Story } from '@effect/ui/testing'
import { describe, expect, it, test } from '@effect/vitest'

import { ApplicationDef } from '../../app/definition'
import { Message } from '../../app/message'
import { type Model, Phase } from '../../app/model'
import { initialModel } from '../../app/pureApp'
import {
  maybePageShowMessage,
  maybeWindowFocusMessage,
  pageVisibilityMessage,
  updateCheckActivity,
} from '../../app/subscriptions'
import {
  FocusEndMenuButton,
  ReloadPage,
  WaitForUnwrap,
} from '../../app/update/home'
import type { UpdateStep } from '../../app/update/step'
import {
  FetchBuild,
  RegisterServiceWorker,
  UpdateServiceWorker,
  recordRemoteBuild,
  registerServiceWorkerAfterSplash,
} from '../../app/update/version'
import { FIXED_STEP_MS, RESTART_GRACE_MS } from '../../shared/constants'
import { WAVE_3_BREAK, fighting } from '../../test/model.fixture'
import {
  checkModel,
  modelAfter,
  send,
  steps,
  throughIntro,
  withAudioAsked,
} from '../../test/testing'
import { pause } from '../../world/waves/waves'
import { isUsingServiceWorker } from '../serviceWorker'
import {
  RUNNING_BUILD,
  fetchRemoteBuild,
  isCheckingForUpdates,
  isGreetingDue,
} from '../version'

const NEWER_BUILD = 'newer-build'

const onPhase = (phase: Phase): Model =>
  UiStruct.evolve(initialModel, { phase: () => phase })

describe('checking for a new build', () => {
  it.effect('the page coming back into view fetches the live build', () =>
    modelAfter(
      initialModel,
      steps(
        send(Message.ChangedPageVisibility({ visibility: 'Hidden' })),
        s => s.expectNone(),
        send(Message.ChangedPageVisibility({ visibility: 'Visible' })),
        s => s.expectExact(FetchBuild),
        s =>
          s.resolve(
            FetchBuild,
            Message.CompletedFetchBuild({ build: NEWER_BUILD }),
          ),
        checkModel(current => {
          expect(current.release.maybeNewerBuild).toStrictEqual(
            Option.some(NEWER_BUILD),
          )
        }),
      ),
    ),
  )

  it.effect(
    'focus, a page restored from the cache, and the timer all fetch',
    () =>
      modelAfter(
        initialModel,
        steps(
          send(Message.FocusedWindow()),
          s => s.expectExact(FetchBuild),
          s =>
            s.resolve(
              FetchBuild,
              Message.CompletedFetchBuild({ build: RUNNING_BUILD }),
            ),
          send(Message.RestoredPageFromCache()),
          s => s.expectExact(FetchBuild),
          s =>
            s.resolve(
              FetchBuild,
              Message.CompletedFetchBuild({ build: RUNNING_BUILD }),
            ),
          send(Message.TickedUpdateCheck()),
          s => s.expectExact(FetchBuild),
          s =>
            s.resolve(
              FetchBuild,
              Message.CompletedFetchBuild({ build: RUNNING_BUILD }),
            ),
        ),
      ),
  )

  it.effect('the build already running records nothing', () =>
    modelAfter(
      initialModel,
      steps(
        send(Message.CompletedFetchBuild({ build: RUNNING_BUILD })),
        checkModel(current => {
          expect(current.release.maybeNewerBuild).toStrictEqual(Option.none())
        }),
      ),
    ),
  )

  it.effect('a failed or offline check changes nothing', () =>
    modelAfter(
      initialModel,
      steps(
        send(Message.FailedFetchBuild({ reason: 'Failed to fetch' })),
        checkModel(current => {
          expect(current).toStrictEqual(withAudioAsked(initialModel))
        }),
        send(Message.CompletedFetchBuild({ build: NEWER_BUILD })),
        send(Message.FailedFetchBuild({ reason: 'timed out' })),
        checkModel(current => {
          expect(current.release.maybeNewerBuild).toStrictEqual(
            Option.some(NEWER_BUILD),
          )
        }),
      ),
    ),
  )

  it.effect('a new build found mid-wave is kept, and the wave goes on', () =>
    modelAfter(
      fighting,
      steps(
        send(Message.CompletedFetchBuild({ build: NEWER_BUILD })),
        s => s.expectNone(),
        checkModel(current => {
          expect(current.phase).toStrictEqual(fighting.phase)
          expect(current.release.maybeNewerBuild).toStrictEqual(
            Option.some(NEWER_BUILD),
          )
        }),
      ),
    ),
  )

  it.effect(
    'tapping the gift unwraps it once, then reloads onto the newer build',
    () =>
      modelAfter(
        UiStruct.evolve(initialModel, {
          release: UiStruct.evolve({
            maybeNewerBuild: () => Option.some(NEWER_BUILD),
          }),
        }),
        steps(
          send(Message.ClickedUpdateButton()),
          checkModel(current => {
            expect(current.release.updateGift).toBe('Unwrapping')
          }),
          s => s.expectExact(WaitForUnwrap),
          s => s.resolve(WaitForUnwrap, Message.CompletedWaitForUnwrap()),
          s => s.expectExact(ReloadPage.make({ build: NEWER_BUILD })),
          s => s.resolve(ReloadPage, Component.noop),
        ),
      ),
  )

  it.effect('a second tap while it unwraps changes nothing', () =>
    modelAfter(
      UiStruct.evolve(initialModel, {
        release: UiStruct.evolve({
          maybeNewerBuild: () => Option.some(NEWER_BUILD),
          updateGift: () => 'Unwrapping',
        }),
      }),
      steps(send(Message.ClickedUpdateButton()), s => s.expectNone()),
    ),
  )

  it.effect('the gift does nothing off the home menu', () =>
    modelAfter(
      UiStruct.evolve(fighting, {
        release: UiStruct.evolve({
          maybeNewerBuild: () => Option.some(NEWER_BUILD),
        }),
      }),
      steps(
        send(Message.ClickedUpdateButton()),
        checkModel(current => {
          expect(current.release.updateGift).toBe('Wrapped')
        }),
        s => s.expectNone(),
      ),
    ),
  )

  it.effect('the greeting opens only for the build the reload asked for', () =>
    Effect.gen(function* () {
      yield* modelAfter(
        initialModel,
        steps(
          send(
            Message.CompletedReadUpdateMarker({
              maybeBuild: Option.some(RUNNING_BUILD),
            }),
          ),
          checkModel(current => {
            expect(current.updateGreeting.isOpen).toBe(true)
          }),
        ),
      )
      expect(isGreetingDue(RUNNING_BUILD, Option.some(RUNNING_BUILD))).toBe(
        true,
      )
      expect(isGreetingDue(RUNNING_BUILD, Option.some('older'))).toBe(false)
      expect(isGreetingDue(RUNNING_BUILD, Option.none())).toBe(false)
    }),
  )
})

describe('the update check subscriptions', () => {
  it.effect(
    'visibility turning visible becomes a check, hidden does not',
    () => {
      const visible = pageVisibilityMessage('visible')
      expect(visible).toStrictEqual(
        Message.ChangedPageVisibility({ visibility: 'Visible' }),
      )
      return modelAfter(
        initialModel,
        steps(
          send(pageVisibilityMessage('hidden')),
          s => s.expectNone(),
          send(visible),
          s => s.expectExact(FetchBuild),
          s =>
            s.resolve(
              FetchBuild,
              Message.FailedFetchBuild({ reason: 'offline' }),
            ),
        ),
      )
    },
  )

  test('only a page restored from the back forward cache checks', () => {
    expect(maybePageShowMessage({ persisted: true })).toStrictEqual(
      Option.some(Message.RestoredPageFromCache()),
    )
    expect(maybePageShowMessage({ persisted: false })).toStrictEqual(
      Option.none(),
    )
  })

  test('only the window itself gaining focus checks', () => {
    expect(maybeWindowFocusMessage({ target: window })).toStrictEqual(
      Option.some(Message.FocusedWindow()),
    )
    expect(
      maybeWindowFocusMessage({ target: document.createElement('button') }),
    ).toStrictEqual(Option.none())
  })

  test('the five minute timer runs on quiet screens, never mid-wave', () => {
    expect(updateCheckActivity(initialModel)).toBe('Active')
    expect(updateCheckActivity(onPhase(WAVE_3_BREAK))).toBe('Active')
    expect(updateCheckActivity(onPhase(Phase.GameOver({ wave: 3 })))).toBe(
      'Active',
    )
    expect(updateCheckActivity(onPhase(Phase.Escaped({ wave: 10 })))).toBe(
      'Active',
    )
    expect(updateCheckActivity(pause(fighting))).toBe('Active')
    expect(updateCheckActivity(fighting)).toBe('Idle')
  })

  test('the dev server never checks', () => {
    expect(isCheckingForUpdates('dev')).toBe(false)
    expect(isCheckingForUpdates(RUNNING_BUILD)).toBe(true)
  })
})

describe('the end screens with a new version waiting', () => {
  const waiting = (phase: Phase, screenMs: number): Model =>
    UiStruct.evolve(onPhase(phase), {
      screenMs: () => screenMs,
      release: UiStruct.evolve({
        maybeNewerBuild: () => Option.some(NEWER_BUILD),
      }),
    })

  it.effect.each([
    { name: 'Game Over', phase: Phase.GameOver({ wave: 3 }) },
    { name: 'An escape', phase: Phase.Escaped({ wave: 10 }) },
  ])('$name turns Enter into MENU and ignores E and K', ({ phase }) =>
    modelAfter(
      waiting(phase, RESTART_GRACE_MS),
      steps(
        send(Message.PressedKey({ code: 'KeyE' })),
        send(Message.PressedKey({ code: 'KeyK' })),
        send(Message.ClickedCampaignButton()),
        checkModel(current => {
          expect(current.phase).toStrictEqual(phase)
        }),
        send(Message.PressedKey({ code: 'Enter' })),
        checkModel(current => {
          expect(Phase.guards.Ready(current.phase)).toBe(true)
          expect(current.release.maybeNewerBuild).toStrictEqual(
            Option.some(NEWER_BUILD),
          )
        }),
      ),
    ),
  )

  it.effect('Enter waits out the restart grace', () => {
    const phase = Phase.GameOver({ wave: 3 })
    return modelAfter(
      waiting(phase, RESTART_GRACE_MS - 1),
      steps(
        send(Message.PressedKey({ code: 'Enter' })),
        checkModel(current => {
          expect(current.phase).toStrictEqual(phase)
        }),
        // NOTE: the early press only skips the end beat to its last frame,
        // which puts MENU up and focuses it; the next Enter takes it.
        s => s.expectExact(FocusEndMenuButton),
        s => s.resolve(FocusEndMenuButton, Component.noop),
        send(Message.TickedFrame({ deltaTime: FIXED_STEP_MS })),
        send(Message.PressedKey({ code: 'Enter' })),
        checkModel(current => {
          expect(Phase.guards.Ready(current.phase)).toBe(true)
        }),
      ),
    )
  })

  it.effect(
    'without a new version, Enter still starts a campaign from Game Over',
    () =>
      modelAfter(
        UiStruct.evolve(onPhase(Phase.GameOver({ wave: 3 })), {
          screenMs: () => RESTART_GRACE_MS,
        }),
        steps(
          send(Message.PressedKey({ code: 'Enter' })),
          throughIntro,
          checkModel(current => {
            expect(Phase.guards.Preparation(current.phase)).toBe(true)
          }),
        ),
      ),
  )
})

// NOTE: a root whose whole update is one Step, so a Story sees the
// Commands it runs for a build other than the one the tests run as.
const stepRoot = (step: UpdateStep) =>
  ApplicationDef.make({
    init: ApplicationDef.init($ => $.set(initialModel)),
    update: $ => step($),
    view: h => h.div([]),
  })

// NOTE: the Model and Commands one Step leaves from the start Model.
const afterStep = (step: UpdateStep) =>
  Effect.map(Story.make(stepRoot(step), {}), s =>
    s.given(initialModel).send(Message.TickedUpdateCheck()),
  )

describe('the service worker', () => {
  const PRODUCTION_BUILD = 'abc123'

  test('only production builds use one, never dev, tests, or the harness', () => {
    expect(isUsingServiceWorker(PRODUCTION_BUILD)).toBe(true)
    expect(isUsingServiceWorker('dev')).toBe(false)
    expect(isUsingServiceWorker('test')).toBe(false)
    expect(isUsingServiceWorker(RUNNING_BUILD)).toBe(false)
  })

  it.effect('a production build registers it once the splash is gone', () =>
    Effect.gen(function* () {
      const production = yield* afterStep(
        registerServiceWorkerAfterSplash(PRODUCTION_BUILD),
      )
      production
        .expectExact(RegisterServiceWorker.make())
        .resolve(RegisterServiceWorker, Component.noop)
      const dev = yield* afterStep(registerServiceWorkerAfterSplash('dev'))
      dev.expectNone()
    }),
  )

  it.effect('a newer build asks the worker to fetch it in the background', () =>
    Effect.gen(function* () {
      const found = yield* afterStep(
        recordRemoteBuild(PRODUCTION_BUILD, NEWER_BUILD),
      )
      expect(found.model.release.maybeNewerBuild).toStrictEqual(
        Option.some(NEWER_BUILD),
      )
      found
        .expectExact(UpdateServiceWorker.make())
        .resolve(UpdateServiceWorker, Component.noop)

      const same = yield* afterStep(
        recordRemoteBuild(PRODUCTION_BUILD, PRODUCTION_BUILD),
      )
      expect(same.model.release.maybeNewerBuild).toStrictEqual(Option.none())
      same.expectNone()

      const onDev = yield* afterStep(recordRemoteBuild('dev', NEWER_BUILD))
      expect(onDev.model.release.maybeNewerBuild).toStrictEqual(
        Option.some(NEWER_BUILD),
      )
      onDev.expectNone()
    }),
  )
})

describe('fetching version.json', () => {
  interface Seen {
    readonly url: URL
    readonly init: RequestInit | undefined
  }

  const fetchWith = (response: () => Response) => {
    const seen: Array<Seen> = []
    const fetch: typeof globalThis.fetch = (input, init) => {
      seen.push({
        url: new URL(input instanceof Request ? input.url : String(input)),
        init,
      })
      return Promise.resolve(response())
    }
    const exit = Effect.exit(
      fetchRemoteBuild.pipe(
        Effect.provideService(FetchHttpClient.Fetch, fetch),
      ),
    )
    return { seen, exit }
  }

  it.effect('asks past every cache and reads the build', () =>
    Effect.gen(function* () {
      const { seen, exit } = fetchWith(() =>
        Response.json({ build: NEWER_BUILD }),
      )
      const exit_1 = yield* exit
      expect(exit_1).toEqual(
        expect.objectContaining({ _tag: 'Success', value: NEWER_BUILD }),
      )
      expect(seen).toHaveLength(1)
      expect(seen[0]?.url.pathname).toMatch(/version\.json$/)
      expect(seen[0]?.url.searchParams.get('at')).toMatch(/^\d+$/)
      expect(seen[0]?.init?.cache).toBe('no-store')
      expect(new Headers(seen[0]?.init?.headers).has('traceparent')).toBe(false)
    }),
  )

  it.effect('a missing file fails the check', () =>
    Effect.gen(function* () {
      const { exit } = fetchWith(() =>
        Response.json({ build: NEWER_BUILD }, { status: 404 }),
      )
      expect((yield* exit)._tag).toBe('Failure')
    }),
  )

  it.effect('a file without a build fails the check', () =>
    Effect.gen(function* () {
      const { exit } = fetchWith(() => Response.json({ commit: 'abc' }))
      expect((yield* exit)._tag).toBe('Failure')
    }),
  )
})
