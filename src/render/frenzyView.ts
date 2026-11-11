import { Function } from 'effect'

import { Frenzy, type Zombie } from '../world/schema/worldSchema'
import { isLastZombie } from '../world/zombies/lastZombie'

// The rage face on a walking zombie: a frenzied one's, blinking as its
// frenzy fades, and the wave's last zombie's.

const FADE_BLINK_MS = 110

// NOTE: the wave's last zombie, hurrying in (src/world/zombies/lastZombie.ts),
// wears the rage face too.
export const isRaging: {
  (loneMs: number): (zombie: Zombie) => boolean
  (zombie: Zombie, loneMs: number): boolean
} = Function.dual(
  2,
  (zombie: Zombie, loneMs: number): boolean =>
    isLastZombie(zombie, loneMs) ||
    Frenzy.match(zombie.frenzy, {
      Calm: () => false,
      Frenzied: () => true,
      Fading: ({ remainingMs }) =>
        Math.floor(remainingMs / FADE_BLINK_MS) % 2 === 0,
      Spent: () => false,
    }),
)
