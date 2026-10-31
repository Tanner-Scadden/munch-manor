import { Effect, Option, Schedule, pipe } from 'effect'

// NOTE: the splash is plain HTML and CSS in index.html, outside the Foldkit
// root, so it paints before any script runs. These effects are its only
// readers and writers, and run from Commands once the game reports progress.

const SPLASH_ID = 'splash'
const PROGRESS_PROPERTY = '--splash-progress'
const GONE_CLASS = 'is-gone'
const FADE_MS = 220

const maybeSplash = (): Option.Option<HTMLElement> =>
  Option.fromNullishOr(document.getElementById(SPLASH_ID))

const markProgress = (splash: HTMLElement, share: number): void => {
  splash.dataset['progress'] = 'Known'
  splash.style.setProperty(PROGRESS_PROPERTY, String(share))
}

export const showSplashProgress = (loaded: number, total: number) =>
  Effect.try(() => {
    const maybeElement = maybeSplash()
    if (Option.isSome(maybeElement)) {
      markProgress(maybeElement.value, total > 0 ? loaded / total : 1)
    }
  })

const fadeOut = (splash: HTMLElement): HTMLElement => {
  splash.classList.add(GONE_CLASS)
  splash.setAttribute('aria-busy', 'false')
  return splash
}

export const hideSplash = pipe(
  Effect.try(() => Option.map(maybeSplash(), fadeOut)),
  Effect.tap(() => Effect.sleep(FADE_MS)),
  Effect.flatMap(maybeElement =>
    Effect.try(() => {
      if (Option.isSome(maybeElement)) {
        maybeElement.value.remove()
      }
    }),
  ),
)

export const nextAnimationFrame: Effect.Effect<void> = Effect.callback<void>(
  resume => {
    const handle = requestAnimationFrame(() => resume(Effect.void))
    return Effect.sync(() => cancelAnimationFrame(handle))
  },
)

export const awaitFirstFrame: Effect.Effect<void> = Effect.andThen(
  nextAnimationFrame,
  nextAnimationFrame,
)

const STYLES_ID = 'game-styles'
const STYLES_POLL_MS = 50
const STYLES_GIVE_UP_MS = 20_000

const areStylesApplied = (): boolean => {
  const link = document.getElementById(STYLES_ID)
  return (
    !(link instanceof HTMLLinkElement) ||
    (link.rel === 'stylesheet' && link.sheet !== null)
  )
}

export const loadStyles = pipe(
  Effect.sync(areStylesApplied),
  Effect.repeat({
    until: isApplied => isApplied,
    schedule: Schedule.spaced(STYLES_POLL_MS),
  }),
  Effect.timeout(STYLES_GIVE_UP_MS),
  Effect.asVoid,
)

const decodeImage = (src: string) =>
  Effect.tryPromise(() => {
    const image = new Image()
    image.src = src
    return image.decode()
  })

// NOTE: an image that fails to decode still counts as done, so one bad
// sprite never holds the game behind the splash.
export const decodeImages = (
  sources: ReadonlyArray<string>,
): Effect.Effect<void> =>
  Effect.forEach(sources, source => Effect.ignore(decodeImage(source)), {
    concurrency: 'unbounded',
    discard: true,
  })

export const loadFonts = Effect.asVoid(
  Effect.tryPromise(() => document.fonts.ready),
)

// NOTE: a `load:<step>` performance mark as each load step finishes, which
// tools/audit/splash.ts reads to time the steps behind the splash.
export const markLoadStep = (step: string): Effect.Effect<void> =>
  Effect.ignore(Effect.try(() => performance.mark(`load:${step}`)))
