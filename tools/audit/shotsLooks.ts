// The look sheet: every option of every part on the classic look (both
// bodies in a tee, a dress, and overalls with the Rainbow print, a beard,
// and glasses), every outfit in every print, then walk frames, facings, and
// the hit flash for four mixed looks, as `slooks-<TAG>-<viewport>.png`, the
// whole sheet, on a desktop, a landscape phone, and an upright phone.
//   TAG=after bun run heavy -- bun tools/audit/shotsLooks.ts
import { Console, Effect } from 'effect'

import { runHarnessAudit } from './harnessServer'
import {
  SHOTS_DIR,
  auditTag,
  closePage,
  gotoScene,
  harnessUrl,
  openBrowser,
  openPage,
  shotViewports,
} from './lib'
import { attempt } from './page'

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* shotViewports
    const browser = yield* openBrowser
    for (const viewport of viewports) {
      const page = yield* openPage(browser, viewport)
      yield* gotoScene(page, harnessUrl('looksheet', 'freeze=10'))
      // NOTE: the page never scrolls, so the shot grows the screen to the
      // sheet's height instead, keeping its width.
      const height = yield* attempt(() =>
        page.evaluate(
          () =>
            document.querySelector('.look-sheet')?.getBoundingClientRect()
              .bottom ?? 0,
        ),
      )
      yield* attempt(() =>
        page.setViewportSize({
          width: viewport.width,
          height: Math.max(viewport.height, Math.ceil(height) + 16),
        }),
      )
      const path = `${SHOTS_DIR}/slooks-${tag}-${viewport.name}.png`
      yield* attempt(() =>
        page.screenshot({ path, fullPage: true, animations: 'disabled' }),
      )
      yield* Console.log(path)
      yield* closePage(page)
    }
  }),
)
