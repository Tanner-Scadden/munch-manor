// @vitest-environment happy-dom
import { Effect, Option } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import { FIXED_STEP_MS, RESTART_GRACE_MS } from './constants'
import { update } from './main'
import { Message } from './message'
import { type Model, Phase, initialModel } from './model'
import { WAVE_3_BREAK, fighting } from './model.fixture'
import { isUsingServiceWorker } from './serviceWorker'
import {
  maybePageShowMessage,
  maybeWindowFocusMessage,
  pageVisibilityMessage,
  updateCheckActivity,
} from './subscriptions'
import { showDialog } from './testing'
import { FocusEndMenuButton, ReloadPage, WaitForUnwrap } from './update/home'
import {
  FetchBuild,
  RegisterServiceWorker,
  UpdateServiceWorker,
  recordRemoteBuild,
  registerServiceWorkerAfterSplash,
} from './update/version'
import {
  RUNNING_BUILD,
  fetchRemoteBuild,
  isCheckingForUpdates,
  isGreetingDue,
} from './version'
import { pause } from './waves'

const NEWER_BUILD = 'newer-build'

const onPhase = (phase: Phase): Model =>
  modifyFields(initialModel, { phase: () => phase })

describe('checking for a new build', () => {
  test('the page coming back into view fetches the live build', () => {
    story(
      update,
      given(initialModel),
      message(Message.ChangedPageVisibility({ visibility: 'Hidden' })),
      Command.expectNone(),
      message(Message.ChangedPageVisibility({ visibility: 'Visible' })),
      Command.expectExact(FetchBuild),
      Command.resolve(
        FetchBuild,
        Message.CompletedFetchBuild({ build: NEWER_BUILD }),
      ),
      model(current => {
        expect(current.maybeNewerBuild).toStrictEqual(Option.some(NEWER_BUILD))
      }),
    )
  })

  test('focus, a page restored from the cache, and the timer all fetch', () => {
    story(
      update,
      given(initialModel),
      message(Message.FocusedWindow()),
      Command.expectExact(FetchBuild),
      Command.resolve(
        FetchBuild,
        Message.CompletedFetchBuild({ build: RUNNING_BUILD }),
      ),
      message(Message.RestoredPageFromCache()),
      Command.expectExact(FetchBuild),
      Command.resolve(
        FetchBuild,
        Message.CompletedFetchBuild({ build: RUNNING_BUILD }),
      ),
      message(Message.TickedUpdateCheck()),
      Command.expectExact(FetchBuild),
      Command.resolve(
        FetchBuild,
        Message.CompletedFetchBuild({ build: RUNNING_BUILD }),
      ),
    )
  })

  test('the build already running records nothing', () => {
    story(
      update,
      given(initialModel),
      message(Message.CompletedFetchBuild({ build: RUNNING_BUILD })),
      model(current => {
        expect(current.maybeNewerBuild).toStrictEqual(Option.none())
      }),
    )
  })

  test('a failed or offline check changes nothing', () => {
    story(
      update,
      given(initialModel),
      message(Message.FailedFetchBuild({ reason: 'Failed to fetch' })),
      model(current => {
        expect(current).toStrictEqual(initialModel)
      }),
      message(Message.CompletedFetchBuild({ build: NEWER_BUILD })),
      message(Message.FailedFetchBuild({ reason: 'timed out' })),
      model(current => {
        expect(current.maybeNewerBuild).toStrictEqual(Option.some(NEWER_BUILD))
      }),
    )
  })

  test('a new build found mid-wave is kept, and the wave goes on', () => {
    story(
      update,
      given(fighting),
      message(Message.CompletedFetchBuild({ build: NEWER_BUILD })),
      Command.expectNone(),
      model(current => {
        expect(current.phase).toStrictEqual(fighting.phase)
        expect(current.maybeNewerBuild).toStrictEqual(Option.some(NEWER_BUILD))
      }),
    )
  })

  test('tapping the gift unwraps it once, then reloads onto the newer build', () => {
    story(
      update,
      given(
        modifyFields(initialModel, {
          maybeNewerBuild: () => Option.some(NEWER_BUILD),
        }),
      ),
      message(Message.ClickedUpdateButton()),
      model(current => {
        expect(current.updateGift).toBe('Unwrapping')
      }),
      Command.expectExact(WaitForUnwrap),
      Command.resolve(WaitForUnwrap, Message.CompletedWaitForUnwrap()),
      Command.expectExact(ReloadPage({ build: NEWER_BUILD })),
      Command.resolve(ReloadPage, Message.CompletedReloadPage()),
    )
  })

  test('a second tap while it unwraps changes nothing', () => {
    story(
      update,
      given(
        modifyFields(initialModel, {
          maybeNewerBuild: () => Option.some(NEWER_BUILD),
          updateGift: () => 'Unwrapping',
        }),
      ),
      message(Message.ClickedUpdateButton()),
      Command.expectNone(),
    )
  })

  test('the gift does nothing off the home menu', () => {
    story(
      update,
      given(
        modifyFields(fighting, {
          maybeNewerBuild: () => Option.some(NEWER_BUILD),
        }),
      ),
      message(Message.ClickedUpdateButton()),
      model(current => {
        expect(current.updateGift).toBe('Wrapped')
      }),
      Command.expectNone(),
    )
  })

  test('the greeting opens only for the build the reload asked for', () => {
    story(
      update,
      given(initialModel),
      message(
        Message.CompletedReadUpdateMarker({
          maybeBuild: Option.some(RUNNING_BUILD),
        }),
      ),
      model(current => {
        expect(current.updateGreeting.isOpen).toBe(true)
      }),
      showDialog(),
    )
    expect(isGreetingDue(RUNNING_BUILD, Option.some(RUNNING_BUILD))).toBe(true)
    expect(isGreetingDue(RUNNING_BUILD, Option.some('older'))).toBe(false)
    expect(isGreetingDue(RUNNING_BUILD, Option.none())).toBe(false)
  })
})

describe('the update check subscriptions', () => {
  test('visibility turning visible becomes a check, hidden does not', () => {
    const visible = pageVisibilityMessage('visible')
    const hidden = pageVisibilityMessage('hidden')
    expect(visible).toStrictEqual(
      Message.ChangedPageVisibility({ visibility: 'Visible' }),
    )
    expect(update(initialModel, visible).commands).toHaveLength(1)
    expect(update(initialModel, hidden).commands ?? []).toHaveLength(0)
  })

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
    expect(updateCheckActivity(onPhase(Phase.Victory()))).toBe('Active')
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

  test.each([
    ['Game Over', Phase.GameOver({ wave: 3 })],
    ['Victory', Phase.Victory()],
  ])('%s turns Enter into MENU and ignores E and K', (_name, phase) => {
    story(
      update,
      given(waiting(phase, RESTART_GRACE_MS)),
      message(Message.PressedKey({ code: 'KeyE' })),
      message(Message.PressedKey({ code: 'KeyK' })),
      message(Message.ClickedCampaignButton()),
      message(Message.ClickedKeepGoingButton()),
      model(current => {
        expect(current.phase).toStrictEqual(phase)
      }),
      message(Message.PressedKey({ code: 'Enter' })),
      model(current => {
        expect(Phase.guards.Ready(current.phase)).toBe(true)
        expect(current.maybeNewerBuild).toStrictEqual(Option.some(NEWER_BUILD))
      }),
    )
  })

  test('Enter waits out the restart grace', () => {
    const phase = Phase.GameOver({ wave: 3 })
    story(
      update,
      given(waiting(phase, RESTART_GRACE_MS - 1)),
      message(Message.PressedKey({ code: 'Enter' })),
      model(current => {
        expect(current.phase).toStrictEqual(phase)
      }),
      message(Message.TickedFrame({ deltaTime: FIXED_STEP_MS })),
      Command.expectExact(FocusEndMenuButton),
      Command.resolve(
        FocusEndMenuButton,
        Message.CompletedFocusEndMenuButton(),
      ),
      message(Message.PressedKey({ code: 'Enter' })),
      model(current => {
        expect(Phase.guards.Ready(current.phase)).toBe(true)
      }),
    )
  })

  test('without a new version, Enter still starts a campaign from Game Over', () => {
    story(
      update,
      given(
        modifyFields(onPhase(Phase.GameOver({ wave: 3 })), {
          screenMs: () => RESTART_GRACE_MS,
        }),
      ),
      message(Message.PressedKey({ code: 'Enter' })),
      model(current => {
        expect(Phase.guards.Preparation(current.phase)).toBe(true)
      }),
    )
  })
})

// NOTE: each Command invocation carries its own Effect, so Commands compare
// by name and args.
const namesOf = (
  commands: ReadonlyArray<Readonly<{ name: string; args?: unknown }>> = [],
) => commands.map(({ name, args }) => [name, args])

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

  test('a failed worker command changes nothing', () => {
    story(
      update,
      given(initialModel),
      message(Message.FailedRegisterServiceWorker({ reason: 'insecure' })),
      message(Message.FailedUpdateServiceWorker({ reason: 'offline' })),
      model(current => {
        expect(current).toStrictEqual(initialModel)
      }),
    )
  })
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
      expect(yield* exit).toEqual(
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
