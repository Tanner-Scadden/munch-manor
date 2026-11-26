import { Function } from 'effect'

import { Frenzy, type Zombie } from '../world/schema/worldSchema'
import { isLastZombie } from '../world/zombies/lastZombie'

const FADE_BLINK_MS = 110

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
