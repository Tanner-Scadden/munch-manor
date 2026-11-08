import { startStoreEarly } from './storeEarly'

// NOTE: index.html loads this before src/app/entry.ts, so it runs before any of
// the game's modules. See src/platform/storeEarly.ts.
startStoreEarly()
