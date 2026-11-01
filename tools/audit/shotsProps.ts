// The props close up: every calling's prop on both bodies and every hair
// style, standing and mid stride, drawn from the player's own pixel maps at
// 12 pixels a pixel, as `s48-<TAG>-props.png`. It checks nothing but pixels,
// so look at it: a prop should sit on the head with no gap and no head
// showing through it.
//   TAG=after bun run heavy -- --shared bun tools/audit/shotsProps.ts
import { Array } from 'effect'

import { playerPalette, playerPixels } from '@game/appearance'
import { CALLINGS } from '@game/calling'
import { pixelIconUrl } from '@game/icons'
import { type Appearance, defaultAppearance } from '@game/model'
import { HairStyle } from '@game/playerData'

import { TAG, finish, launch, shot } from './lib'

const SCALE = 8

const cell = (look: Appearance, calling: (typeof CALLINGS)[number]) => {
  const pixels = playerPixels(look, calling)
  const palette = playerPalette(look)
  return [...pixels.idle, ...pixels.walk.slice(0, 2)].map(
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
</style>${Array.map(
  looks,
  look =>
    `<div class="row"><span style="width:90px">${look.body} ${look.hairStyle}</span>${Array.map(
      CALLINGS,
      calling => `<span class="group">${cell(look, calling).join('')}</span>`,
    ).join('')}</div>`,
).join('')}`

const browser = await launch()
const page = await browser.newPage({
  viewport: { width: 2300, height: 1450 },
})
await page.setContent(html)
await shot(page, `s48-${TAG}-props`)
await browser.close()
finish([], 'The prop sheet is shot: look at it.')
