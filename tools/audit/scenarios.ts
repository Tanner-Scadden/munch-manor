import { wait } from './lib'

export type Scenario = Readonly<{
  q: string
  warm: () => Promise<unknown>
  bot: boolean
}>

export const SCENARIOS: Record<string, Scenario> = {
  idle: { q: '?wave=2&prep=60000', warm: () => wait(1500), bot: false },
  busy: {
    q: '?wave=6&start=wave&god&gun=smg',
    warm: () => wait(12000),
    bot: true,
  },
  worst: {
    q: '?wave=8&start=wave&god&gun=smg&fill&crowd=30',
    warm: () => wait(4000),
    bot: true,
  },
  endlessCap: {
    q: '?wave=15&mode=endless&start=wave&god&fill&crowd=20&tough',
    warm: () => wait(6000),
    bot: true,
  },
  gasbags: {
    q: '?wave=6&start=wave&god&gun=smg&fill&gasroom=16',
    warm: () => wait(4000),
    bot: true,
  },
  // The kitchen open, with the player in it by the ovens and the room full,
  // so the bigger level, its ovens, and its soup are on screen.
  kitchen: {
    q: '?wave=8&start=wave&god&gun=smg&kitchen&fill&crowd=30&px=96&py=-46&ovens=belch&slip',
    warm: () => wait(4000),
    bot: true,
  },
  // The co-op arena staged with three players and a network that never
  // answers, so it measures the online run's view of a still World.
  coopArena: { q: '?coop=arena', warm: () => wait(1500), bot: false },
  // A co-op client in a live room: four seats in a room run in a Worker
  // (harness/liveRoom.worker.ts), three of them scripted players, and the
  // page's own seat played by the bot, with 40 zombies that never die, so
  // the World moves and stays the same size.
  coopLive: {
    q: '?coop=live&seats=4&crowd=40',
    warm: () => wait(4000),
    bot: true,
  },
  endless15: {
    q: '?wave=15&mode=endless&start=wave&god&gun=smg&tier=3&fill',
    warm: () => wait(15000),
    bot: true,
  },
}
