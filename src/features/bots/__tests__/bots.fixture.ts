import { type Bot, Phase } from '../../../app/model'
import { DISTANT_SPAWN, crewInWave } from '../../../test/model.fixture'

// What the teammate bots' tests start from: the bot seated beside the human,
// and a long break.

export const BOT: Bot = {
  name: 'Gizmo',
  calling: 'You',
  look: crewInWave(1).appearance,
}

export const BREAK = Phase.Preparation({
  wave: 3,
  remainingMs: 60_000,
  durationMs: 60_000,
  spawns: [DISTANT_SPAWN],
})
