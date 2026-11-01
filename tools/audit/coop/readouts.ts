// Co-op audit (tools/audit/coop.ts): the room's World and link as each page
// draws them.

import { Schema } from 'effect'
import type { Page } from 'playwright-core'

import { type Readout, ReadoutJson } from '@game/coop/readout'
import { Vector } from '@game/entitySchema'

import { evaluateAs } from '../page'

// THE ROOM'S WORLD, AS THE PAGE DRAWS IT

// NOTE: the readout src/coop/seam.ts `readoutOf` writes on the arena, in
// the Schema both sides share (src/coop/readout.ts).
export type Seat = Readout['players'][number]

const Net = Schema.Struct({
  slot: Schema.Number,
  lookedHits: Schema.Number,
  confirmedHits: Schema.Number,
  delayMs: Schema.Number,
  rttMs: Schema.Number,
  bytesIn: Schema.Number,
  framesIn: Schema.Number,
  inputsOut: Schema.Number,
  nowMs: Schema.Number,
  corrections: Schema.Number,
  correctionPx: Schema.Number,
  stalls: Schema.Number,
  longestStallMs: Schema.Number,
  resyncs: Schema.Number,
})
type Net = typeof Net.Type

export const netOf = (page: Page): Promise<Net | undefined> =>
  evaluateAs(page, Schema.UndefinedOr(Net), () => {
    const element = document.querySelector<HTMLElement>('.coop-net')
    if (element === null) {
      return undefined
    }
    const number = (key: string) => Number(element.dataset[key] ?? 0)
    return {
      slot: number('slot'),
      lookedHits: number('lookedHits'),
      confirmedHits: number('confirmedHits'),
      delayMs: number('delay'),
      rttMs: number('rtt'),
      bytesIn: number('bytesIn'),
      framesIn: number('framesIn'),
      inputsOut: number('inputsOut'),
      nowMs: number('now'),
      corrections: number('corrections'),
      correctionPx: number('correctionPx'),
      stalls: number('stalls'),
      longestStallMs: number('longestStall'),
      resyncs: number('resyncs'),
    }
  })

// NOTE: read at once, never waited for: off the arena (a party wipe sends
// the room back to its lobby) there is no readout, and a locator would
// wait 30 s for it on every poll.
export const readoutOf = (page: Page): Promise<Readout | undefined> =>
  evaluateAs(page, Schema.UndefinedOr(ReadoutJson), () => {
    const text =
      document.querySelector<HTMLElement>('.coop-net')?.dataset['world']
    return text === undefined || text === '' ? undefined : text
  })

export const isOnArena = async (page: Page): Promise<boolean> =>
  (await page.locator('.coop[data-screen="Arena"]').count()) === 1

export const slotOf = async (page: Page): Promise<number> =>
  (await netOf(page))?.slot ?? -1

export const ownSeatOf = async (page: Page): Promise<Seat | undefined> => {
  const [readout, slot] = [await readoutOf(page), await slotOf(page)]
  return readout?.players.find(seat => seat.slot === slot)
}

// NOTE: the parlour fills the 320 by 180 view while the kitchen is shut,
// so the camera stands still and a world point is a fixed point on the
// game canvas.
export const toClient = async (page: Page, x: number, y: number) =>
  evaluateAs(
    page,
    Vector,
    ([worldX, worldY]) => {
      const canvas = document.querySelector('.game-canvas')
      if (canvas === null) {
        return { x: 0, y: 0 }
      }
      const box = canvas.getBoundingClientRect()
      const scale = Math.min(box.width / 320, box.height / 180)
      return {
        x: box.left + (box.width - 320 * scale) / 2 + worldX * scale,
        y: box.top + (box.height - 180 * scale) / 2 + worldY * scale,
      }
    },
    [x, y] as const,
  )
