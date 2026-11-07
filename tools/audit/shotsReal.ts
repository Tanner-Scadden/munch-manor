// The picked calling on the real build (not the harness): a save with a
// rank and a calling is put in localStorage, which the game imports on its
// first load, and the home menu, the Profile's Look tab, and a started run
// are shot, as `s49-<TAG>-<viewport>-<scene>.png`. The home hero, the look
// preview, and the player in play must all wear the calling's prop.
//   bun run build && bunx vite preview --port 4173 --strictPort
//   TAG=after bun run heavy -- --shared bun tools/audit/shotsReal.ts
// CALLING picks the calling (Handyman by default).
import { Config, Effect, Option, Schema } from 'effect'

import { initialModel } from '@game/model'
import { Calling } from '@game/playerData'
import { pointsForRank } from '@game/rank'
import { SAVE_KEY, encodeSave, saveOf } from '@game/save'

import {
  DESKTOP_1280,
  GAME,
  PHONE_844,
  UPRIGHT_390,
  auditTag,
  closePage,
  finish,
  openBrowser,
  openPage,
  runAudit,
  shot,
  wait,
} from './lib'
import { attempt } from './page'

const saveFor = (calling: Calling) =>
  Option.getOrThrow(
    encodeSave({
      ...saveOf(initialModel),
      calling,
      rank: {
        earnedPoints: pointsForRank(16),
        earnedBones: 0,
        veteranPoints: 0,
        veteranBones: 0,
        isVeteranGranted: true,
        spentBones: 0,
      },
    }),
  )

runAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const callingName = yield* Config.String('CALLING').pipe(
      Config.withDefault('Handyman'),
    )
    const calling = yield* Schema.decodeUnknownEffect(Calling)(callingName)
    const save = saveFor(calling)
    const browser = yield* openBrowser
    const problems: Array<string> = []
    for (const viewport of [
      { ...DESKTOP_1280, name: 'd1280' },
      { ...PHONE_844, name: 'l844' },
      { ...UPRIGHT_390, name: 'p390' },
    ]) {
      const page = yield* openPage(browser, viewport)
      yield* attempt(() =>
        page.addInitScript(
          ([key, json]) => {
            localStorage.setItem(key ?? '', json ?? '')
          },
          [SAVE_KEY, save],
        ),
      )
      yield* attempt(() => page.goto(GAME))
      yield* attempt(() =>
        page.waitForSelector('#home-play', { timeout: 20000 }),
      ).pipe(
        Effect.catch(() =>
          Effect.sync(() => {
            problems.push(`${viewport.name}: the home menu never showed PLAY`)
          }),
        ),
      )
      yield* wait(1500)
      yield* shot(page, `s49-${tag}-${viewport.name}-home`)
      if (!viewport.isPhone) {
        yield* attempt(() => page.keyboard.press('KeyC'))
        yield* attempt(() =>
          page.locator('.look-tab').waitFor({ state: 'visible' }),
        )
        yield* wait(1500)
        yield* shot(page, `s49-${tag}-${viewport.name}-look`)
      }
      yield* closePage(page)
    }
    yield* finish(problems, 'The real build shows the picked calling.')
  }),
)
