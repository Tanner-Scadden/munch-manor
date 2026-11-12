import { checkEveryLevel } from './pathing.flat.fixture'

// NOTE: the Narrow half of every level, apart from the Wide half
// (pathing.flat.wide.sim.test.ts) so CI's shards can run the two at once.
checkEveryLevel('Narrow')
