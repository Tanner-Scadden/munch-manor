// NOTE: the analytics and sync Worker's origin is baked in at build time
// through VITE_API_ORIGIN, which infra/alchemy.run.ts sets for each stage. A
// build without it, such as `bun dev`, the tests, or an itch.io zip, sends
// nothing. It lives on its own so the early SQLite chunk can read it without
// the rest of the game.
export const API_ORIGIN: string = import.meta.env.VITE_API_ORIGIN ?? ''
