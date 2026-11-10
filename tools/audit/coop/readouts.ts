// Co-op audit (tools/audit/coop.ts): the room's World and link as each page
// draws them.

import { Effect, Function, Schema } from 'effect'
import type { Page } from 'playwright-core'

import { type Readout, ReadoutJson } from '@game/features/coop/readout'
import { Vector } from '@game/world/schema/entitySchema'

import { type AuditFailed, attempt, decodedFrom, evaluateAs } from '../page'

// THE ROOM'S WORLD, AS THE PAGE DRAWS IT

// NOTE: the readout src/features/coop/auditReadout.ts `readoutOf` writes on the arena, in
// the Schema both sides share (src/features/coop/readout.ts).
export type Seat = Readout['players'][number]

const Net = Schema.Struct({
  slot: Schema.Finite,
  lookedHits: Schema.Finite,
  confirmedHits: Schema.Finite,
  delayMs: Schema.Finite,
  rttMs: Schema.Finite,
  bytesIn: Schema.Finite,
  framesIn: Schema.Finite,
  inputsOut: Schema.Finite,
  nowMs: Schema.Finite,
  corrections: Schema.Finite,
  correctionPx: Schema.Finite,
  stalls: Schema.Finite,
  longestStallMs: Schema.Finite,
  resyncs: Schema.Finite,
})
type Net = typeof Net.Type

export const netOf = (
  page: Page,
): Effect.Effect<Net | undefined, AuditFailed | Schema.SchemaError> =>
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
export const readoutOf = (
  page: Page,
): Effect.Effect<Readout | undefined, AuditFailed | Schema.SchemaError> =>
  evaluateAs(page, Schema.UndefinedOr(ReadoutJson), () => {
    const text =
      document.querySelector<HTMLElement>('.coop-net')?.dataset['world']
    return text === undefined || text === '' ? undefined : text
  })

export const isOnArena = (page: Page) =>
  attempt(() => page.locator('.coop[data-screen="Arena"]').count()).pipe(
    Effect.map(count => count === 1),
  )

export const slotOf = (page: Page) =>
  Effect.map(netOf(page), net => net?.slot ?? -1)

type ClientPoint = Readonly<{ x: number; y: number }>

// NOTE: the parlour fills the 320 by 180 view while the kitchen is shut,
// so the camera stands still and a world point is a fixed point on the
// game canvas.
export const toClient: {
  (
    x: number,
    y: number,
  ): (
    page: Page,
  ) => Effect.Effect<ClientPoint, AuditFailed | Schema.SchemaError>
  (
    page: Page,
    x: number,
    y: number,
  ): Effect.Effect<ClientPoint, AuditFailed | Schema.SchemaError>
} = Function.dual(
  3,
  (
    page: Page,
    x: number,
    y: number,
  ): Effect.Effect<ClientPoint, AuditFailed | Schema.SchemaError> =>
    decodedFrom(Vector, () =>
      page.evaluate(
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
      ),
    ),
)
