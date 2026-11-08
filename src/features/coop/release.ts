// NOTE: co-op shows only in builds made with VITE_COOP=On: preview stages
// (infra/alchemy.run.ts), a local build against workerd, and the tests.
// Production turns it on once co-op is announced on the Workers Paid plan
// (MULTIPLAYER.md, decision 8).
export const IS_COOP_RELEASED: boolean = import.meta.env.VITE_COOP === 'On'
