// @vitest-environment happy-dom
import { Array, Effect, Option } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

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
import {
  FetchBuild,
  RegisterServiceWorker,
  UpdateServiceWorker,
  recordRemoteBuild,
  registerServiceWorkerAfterSplash,
} from '../../app/update/version'
import { FIXED_STEP_MS, RESTART_GRACE_MS } from '../../shared/constants'
import { WAVE_3_BREAK, fighting } from '../../test/model.fixture'
import { APPLICATION, showDialog, throughIntro } from '../../test/testing'
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
  modifyFields(initialModel, { phase: () => phase })

describe('checking for a new build', () => {
  it.effect('the page coming back into view fetches the live build', () =>
    Story.story(
      APPLICATION,
      Story.given(initialModel),
      Story.message(Message.ChangedPageVisibility({ visibility: 'Hidden' })),
      Story.Command.expectNone(),
      Story.message(Message.ChangedPageVisibility({ visibility: 'Visible' })),
      Story.Command.expectExact(FetchBuild),
      Story.Command.resolve(
        FetchBuild,
        Message.CompletedFetchBuild({ build: NEWER_BUILD }),
      ),
      Story.model(current => {
        expect(current.maybeNewerBuild).toStrictEqual(Option.some(NEWER_BUILD))
      }),
    ),
  )

  it.effect(
    'focus, a page restored from the cache, and the timer all fetch',
    () =>
      Story.story(
        APPLICATION,
        Story.given(initialModel),
        Story.message(Message.FocusedWindow()),
        Story.Command.expectExact(FetchBuild),
        Story.Command.resolve(
          FetchBuild,
          Message.CompletedFetchBuild({ build: RUNNING_BUILD }),
        ),
        Story.message(Message.RestoredPageFromCache()),
        Story.Command.expectExact(FetchBuild),
        Story.Command.resolve(
          FetchBuild,
          Message.CompletedFetchBuild({ build: RUNNING_BUILD }),
        ),
        Story.message(Message.TickedUpdateCheck()),
        Story.Command.expectExact(FetchBuild),
        Story.Command.resolve(
          FetchBuild,
          Message.CompletedFetchBuild({ build: RUNNING_BUILD }),
        ),
      ),
  )

  it.effect('the build already running records nothing', () =>
    Story.story(
      APPLICATION,
      Story.given(initialModel),
      Story.message(Message.CompletedFetchBuild({ build: RUNNING_BUILD })),
      Story.model(current => {
        expect(current.maybeNewerBuild).toStrictEqual(Option.none())
      }),
    ),
  )

  it.effect('a failed or offline check changes nothing', () =>
    Story.story(
      APPLICATION,
      Story.given(initialModel),
      Story.message(Message.FailedFetchBuild({ reason: 'Failed to fetch' })),
      Story.model(current => {
        expect(current).toStrictEqual(initialModel)
      }),
      Story.message(Message.CompletedFetchBuild({ build: NEWER_BUILD })),
      Story.message(Message.FailedFetchBuild({ reason: 'timed out' })),
      Story.model(current => {
        expect(current.maybeNewerBuild).toStrictEqual(Option.some(NEWER_BUILD))
      }),
    ),
  )

  it.effect('a new build found mid-wave is kept, and the wave goes on', () =>
    Story.story(
      APPLICATION,
      Story.given(fighting),
      Story.message(Message.CompletedFetchBuild({ build: NEWER_BUILD })),
      Story.Command.expectNone(),
      Story.model(current => {
        expect(current.phase).toStrictEqual(fighting.phase)
        expect(current.maybeNewerBuild).toStrictEqual(Option.some(NEWER_BUILD))
      }),
    ),
  )

  it.effect(
    'tapping the gift unwraps it once, then reloads onto the newer build',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          modifyFields(initialModel, {
            maybeNewerBuild: () => Option.some(NEWER_BUILD),
          }),
        ),
        Story.message(Message.ClickedUpdateButton()),
        Story.model(current => {
          expect(current.updateGift).toBe('Unwrapping')
        }),
        Story.Command.expectExact(WaitForUnwrap),
        Story.Command.resolve(WaitForUnwrap, Message.CompletedWaitForUnwrap()),
        Story.Command.expectExact(ReloadPage({ build: NEWER_BUILD })),
        Story.Command.resolve(ReloadPage, Message.CompletedReloadPage()),
      ),
  )

  it.effect('a second tap while it unwraps changes nothing', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(initialModel, {
          maybeNewerBuild: () => Option.some(NEWER_BUILD),
          updateGift: () => 'Unwrapping',
        }),
      ),
      Story.message(Message.ClickedUpdateButton()),
      Story.Command.expectNone(),
    ),
  )

  it.effect('the gift does nothing off the home menu', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(fighting, {
          maybeNewerBuild: () => Option.some(NEWER_BUILD),
        }),
      ),
      Story.message(Message.ClickedUpdateButton()),
      Story.model(current => {
        expect(current.updateGift).toBe('Wrapped')
      }),
      Story.Command.expectNone(),
    ),
  )

  it.effect('the greeting opens only for the build the reload asked for', () =>
    Effect.gen(function* () {
      yield* Story.story(
        APPLICATION,
        Story.given(initialModel),
        Story.message(
          Message.CompletedReadUpdateMarker({
            maybeBuild: Option.some(RUNNING_BUILD),
          }),
        ),
        Story.model(current => {
          expect(current.updateGreeting.isOpen).toBe(true)
        }),
        showDialog(),
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
      return Story.story(
        APPLICATION,
        Story.given(initialModel),
        Story.message(pageVisibilityMessage('hidden')),
        Story.Command.expectNone(),
        Story.message(visible),
        Story.Command.expectExact(FetchBuild),
        Story.Command.resolve(
          FetchBuild,
          Message.FailedFetchBuild({ reason: 'offline' }),
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
    modifyFields(onPhase(phase), {
      screenMs: () => screenMs,
      maybeNewerBuild: () => Option.some(NEWER_BUILD),
    })

  it.effect.each([
    { name: 'Game Over', phase: Phase.GameOver({ wave: 3 }) },
    { name: 'An escape', phase: Phase.Escaped({ wave: 10 }) },
  ])('$name turns Enter into MENU and ignores E and K', ({ phase }) =>
    Story.story(
      APPLICATION,
      Story.given(waiting(phase, RESTART_GRACE_MS)),
      Story.message(Message.PressedKey({ code: 'KeyE' })),
      Story.message(Message.PressedKey({ code: 'KeyK' })),
      Story.message(Message.ClickedCampaignButton()),
      Story.model(current => {
        expect(current.phase).toStrictEqual(phase)
      }),
      Story.message(Message.PressedKey({ code: 'Enter' })),
      Story.model(current => {
        expect(Phase.guards.Ready(current.phase)).toBe(true)
        expect(current.maybeNewerBuild).toStrictEqual(Option.some(NEWER_BUILD))
      }),
    ),
  )

  it.effect('Enter waits out the restart grace', () => {
    const phase = Phase.GameOver({ wave: 3 })
    return Story.story(
      APPLICATION,
      Story.given(waiting(phase, RESTART_GRACE_MS - 1)),
      Story.message(Message.PressedKey({ code: 'Enter' })),
      Story.model(current => {
        expect(current.phase).toStrictEqual(phase)
      }),
      Story.message(Message.TickedFrame({ deltaTime: FIXED_STEP_MS })),
      Story.Command.expectExact(FocusEndMenuButton),
      Story.Command.resolve(
        FocusEndMenuButton,
        Message.CompletedFocusEndMenuButton(),
      ),
      Story.message(Message.PressedKey({ code: 'Enter' })),
      Story.model(current => {
        expect(Phase.guards.Ready(current.phase)).toBe(true)
      }),
    )
  })

  it.effect(
    'without a new version, Enter still starts a campaign from Game Over',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          modifyFields(onPhase(Phase.GameOver({ wave: 3 })), {
            screenMs: () => RESTART_GRACE_MS,
          }),
        ),
        Story.message(Message.PressedKey({ code: 'Enter' })),
        throughIntro,
        Story.model(current => {
          expect(Phase.guards.Preparation(current.phase)).toBe(true)
        }),
      ),
  )
})

// NOTE: each Command invocation carries its own Effect, so Commands compare
// by name and args.
const namesOf = (
  commands: ReadonlyArray<Readonly<{ name: string; args?: unknown }>> = [],
) => Array.map(commands, ({ name, args }) => [name, args])

describe('the service worker', () => {
  const PRODUCTION_BUILD = 'abc123'

  test('only production builds use one, never dev, tests, or the harness', () => {
    expect(isUsingServiceWorker(PRODUCTION_BUILD)).toBe(true)
    expect(isUsingServiceWorker('dev')).toBe(false)
    expect(isUsingServiceWorker('test')).toBe(false)
    expect(isUsingServiceWorker(RUNNING_BUILD)).toBe(false)
  })

  test('a production build registers it once the splash is gone', () => {
    expect(
      namesOf(
        registerServiceWorkerAfterSplash(initialModel, PRODUCTION_BUILD)
          .commands,
      ),
    ).toStrictEqual(namesOf([RegisterServiceWorker()]))
    expect(
      registerServiceWorkerAfterSplash(initialModel, 'dev').commands ?? [],
    ).toHaveLength(0)
  })

  test('a newer build asks the worker to fetch it in the background', () => {
    const found = recordRemoteBuild(initialModel, PRODUCTION_BUILD, NEWER_BUILD)
    expect(found.model.maybeNewerBuild).toStrictEqual(Option.some(NEWER_BUILD))
    expect(namesOf(found.commands)).toStrictEqual(
      namesOf([UpdateServiceWorker()]),
    )

    const same = recordRemoteBuild(
      initialModel,
      PRODUCTION_BUILD,
      PRODUCTION_BUILD,
    )
    expect(same.model.maybeNewerBuild).toStrictEqual(Option.none())
    expect(same.commands ?? []).toHaveLength(0)

    const onDev = recordRemoteBuild(initialModel, 'dev', NEWER_BUILD)
    expect(onDev.model.maybeNewerBuild).toStrictEqual(Option.some(NEWER_BUILD))
    expect(onDev.commands ?? []).toHaveLength(0)
  })

  it.effect('a failed worker command changes nothing', () =>
    Story.story(
      APPLICATION,
      Story.given(initialModel),
      Story.message(
        Message.FailedRegisterServiceWorker({ reason: 'insecure' }),
      ),
      Story.message(Message.FailedUpdateServiceWorker({ reason: 'offline' })),
      Story.model(current => {
        expect(current).toStrictEqual(initialModel)
      }),
    ),
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
