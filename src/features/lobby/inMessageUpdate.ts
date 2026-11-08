import { pipe } from 'effect'
import { Update } from 'foldkit'

import { makeStep } from './block'
import { LobbyComposition } from './composition'
import { LOBBY_KEYS } from './lobby'
import {
  heroOpenedFrom,
  open,
  openHero,
  pressKey,
  showHeroOutcome,
} from './steps'

// NOTE: the root's requests and answers, with its picks as context. Y opens
// the hero picker here, as the hero card's tap does in update.ts; every
// other key is `pressKey`'s.
export const inMessageUpdate = LobbyComposition.makeInMessageUpdate.withContext(
  picks => ({
    RequestedOpen: open,

    RequestedPressKey: (model, { code }) =>
      code === LOBBY_KEYS.Hero.code
        ? pipe(openHero(model), Update.withOutMessage(heroOpenedFrom(model)))
        : makeStep(current => pressKey(code)(current, picks))(model),

    InformedOfHeroOutcome: (model, { outcome }) =>
      showHeroOutcome(outcome)(model),
  }),
)
