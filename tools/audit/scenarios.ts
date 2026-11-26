import type { Effect } from 'effect'

import { wait } from './lib'

export type Scenario = Readonly<{
  q: string
  warm: Effect.Effect<void>
  bot: boolean
}>

export const SCENARIOS: Record<string, Scenario> = {
  idle: { q: '?wave=2&prep=60000', warm: wait(1500), bot: false },
  busy: {
    q: '?wave=6&start=wave&god&gun=smg',
    warm: wait(12000),
    bot: true,
  },
  worst: {
    q: '?wave=8&start=wave&god&gun=smg&fill&crowd=30',
    warm: wait(4000),
    bot: true,
  },
  endlessCap: {
    q: '?wave=15&mode=endless&start=wave&god&fill&crowd=20&tough',
    warm: wait(6000),
    bot: true,
  },
  gasbags: {
    q: '?wave=6&start=wave&god&gun=smg&fill&gasroom=16',
    warm: wait(4000),
    bot: true,
  },
  kitchen: {
    q: '?wave=8&start=wave&god&gun=smg&kitchen&fill&crowd=30&px=96&py=-46&ovens=belch&slip',
    warm: wait(4000),
    bot: true,
  },
  cellar: {
    q: '?wave=8&start=wave&god&gun=smg&openexits=East,Far&fill&crowd=30&crowdx=680&px=760&py=125',
    warm: wait(4000),
    bot: true,
  },
  allRooms: {
    q: '?wave=8&start=wave&god&gun=smg&openexits=West,East,Far,Kitchen,Secret&kitchen&fill&crowd=30',
    warm: wait(4000),
    bot: true,
  },
  coopArena: { q: '?coop=arena', warm: wait(1500), bot: false },
  coopLive: {
    q: '?coop=live&seats=4&crowd=40',
    warm: wait(4000),
    bot: true,
  },
  endless15: {
    q: '?wave=15&mode=endless&start=wave&god&gun=smg&tier=3&fill',
    warm: wait(15000),
    bot: true,
  },
}
