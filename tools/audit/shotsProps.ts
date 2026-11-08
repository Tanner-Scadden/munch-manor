// The props close up: every calling's prop on both bodies and every hair
// style, standing and mid stride, drawn from the player's own pixel maps at
// 12 pixels a pixel, as `s48-<TAG>-props.png`. It checks nothing but pixels,
// so look at it: a prop should sit on the head with no gap and no head
// showing through it.
//   TAG=after bun run heavy -- --shared bun tools/audit/shotsProps.ts
import { Array, Effect } from 'effect'

import { type Appearance, defaultAppearance } from '@game/app/model'
import { playerPalette, playerPixels } from '@game/art/appearance'
import { pixelIconUrl } from '@game/art/icons'
import { HairStyle } from '@game/shared/playerData'
import { CALLINGS } from '@game/world/heroes/calling'

import { auditTag, finish, openBrowser, runAudit, shot } from './lib'
import { attempt } from './page'

const SCALE = 8

const cell = (look: Appearance, calling: (typeof CALLINGS)[number]) => {
  const pixels = playerPixels(look, calling)
  const palette = playerPalette(look)
  return Array.map(
    [...pixels.idle, ...pixels.walk.slice(0, 2)],
    rows =>
      `<span class="frame" style='background-image:${pixelIconUrl(rows, palette)}'></span>`,
  )
}

const looks = Array.flatMap(['Broad', 'Slim'] as const, body =>
  Array.map(HairStyle.literals, (hairStyle): Appearance => ({
    ...defaultAppearance,
    body,
    hairStyle,
  })),
)

const html = `<style>
body { background: #3a1e26; margin: 8px; font: 12px monospace; color: #f4f1de; }
.row { display: flex; align-items: flex-end; gap: 14px; margin-bottom: 10px; }
.group { display: flex; gap: 2px; align-items: flex-end; }
.frame { display: inline-block; width: ${8 * SCALE}px; height: ${13 * SCALE}px; background: center / contain no-repeat; image-rendering: pixelated; }
</style>${Array.join(
  Array.map(
    looks,
    look =>
      `<div class="row"><span style="width:90px">${look.body} ${look.hairStyle}</span>${Array.join(
        Array.map(
          CALLINGS,
          calling =>
            `<span class="group">${Array.join(cell(look, calling), '')}</span>`,
        ),
        '',
      )}</div>`,
  ),
  '',
)}`

runAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const browser = yield* openBrowser
    const page = yield* attempt(() =>
      browser.newPage({
        viewport: { width: 2300, height: 1450 },
      }),
    )
    yield* attempt(() => page.setContent(html))
    yield* shot(page, `s48-${tag}-props`)
    yield* finish([], 'The prop sheet is shot: look at it.')
  }),
)
