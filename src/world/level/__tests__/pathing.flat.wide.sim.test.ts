import { checkEveryLevel } from './pathing.flat.fixture'

// NOTE: the Wide half of every level, apart from the Narrow half
// (pathing.flat.narrow.sim.test.ts) so CI's shards can run the two at once.
checkEveryLevel('Wide')
