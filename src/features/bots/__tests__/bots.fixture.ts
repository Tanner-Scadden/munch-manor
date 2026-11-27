import { type Bot, BreakClock, Phase } from '#app/model.ts'
import { DISTANT_SPAWN, crewInWave } from '#test/model.fixture.ts'

export const BOT: Bot = {
  name: 'Gizmo',
  calling: 'You',
  look: crewInWave(1).appearance,
}

export const BREAK = Phase.Preparation({
  clock: BreakClock.Counting(),
  wave: 3,
  remainingMs: 60_000,
  durationMs: 60_000,
  spawns: [DISTANT_SPAWN],
})
