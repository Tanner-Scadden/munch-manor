import { Array, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { ownedCallings } from './calling'
import { seatedAs } from './callingPlayer'
import { seatLook } from './coop/looks'
import type { Bot, Model } from './model'
import { BOT_NAMES } from './names'
import { COOP_RULES, withSeat } from './party'
import type { Calling } from './playerData'
import { nextRandom } from './prng'
import type { World } from './world'
import type { PlayerSlot } from './worldSchema'

// Teammate bots in single player (GAME_DESIGN.md, "Teammate bots"): the
// single player lobby seats up to three, each a seat in the run's World with
// a hero, a goofy name, and a look. The roster rules here are pure; the
// lobby's Steps are in src/update/lobby.ts, the bot's brain in
// src/teammateBot.ts.

const MAX_BOTS = COOP_RULES.maxPlayers - 1

// NOTE: the seats a run can fill: the human takes slot 0, and a dev-only
// `?local=N` link seats N-1 couch players after them. The lobby's bots sit
// in the slots after those, as many as the room's four seats leave.
export const botSeatsFor = (model: Model): number =>
  Math.max(0, Math.min(MAX_BOTS, COOP_RULES.maxPlayers - model.localPlayers))

export const activeBots = (model: Model): ReadonlyArray<Bot> =>
  Array.take(model.home.bots, botSeatsFor(model))

export const botSlotOf = (model: Model, index: number): PlayerSlot =>
  model.localPlayers + index

// NOTE: whether this run has bots at its seats: a run started from the
// lobby with a crew. An online room's run never does.
export const isBotCrew = (model: Model): boolean =>
  Array.isReadonlyArrayNonEmpty(model.crewBots)

export const maybeCrewBotAt = (
  model: Model,
  slot: PlayerSlot,
): Option.Option<Bot> => Array.get(model.crewBots, slot - model.localPlayers)

export const crewBotSlots = (model: Model): ReadonlyArray<PlayerSlot> =>
  Array.map(model.crewBots, (_bot, index) => botSlotOf(model, index))

// NOTE: the seats from `firstSlot` on made over as these heroes, in order:
// their hearts and their gun, as the room seats a lobby's callings.
export const seatCallings = (
  world: World,
  firstSlot: PlayerSlot,
  callings: ReadonlyArray<Calling>,
): World =>
  Array.reduce(callings, world, (current, calling, index) =>
    withSeat(current, firstSlot + index, seatWorld =>
      modifyFields(seatWorld, { player: player => seatedAs(player, calling) }),
    ),
  )

// ROSTER

const pickFrom = <A>(
  state: number,
  choices: Array.NonEmptyReadonlyArray<A>,
): readonly [nextState: number, choice: A] => {
  const { value, nextState } = nextRandom(state)
  const index = Math.min(choices.length - 1, Math.floor(value * choices.length))
  return [
    nextState,
    Option.getOrElse(Array.get(choices, index), () =>
      Array.headNonEmpty(choices),
    ),
  ]
}

const unusedNamesOf = (model: Model): Array.NonEmptyReadonlyArray<string> => {
  const free = Array.filter(
    BOT_NAMES,
    name => !Array.some(model.home.bots, bot => bot.name === name),
  )
  return Array.isReadonlyArrayNonEmpty(free) ? free : BOT_NAMES
}

const heroChoicesOf = (model: Model): Array.NonEmptyReadonlyArray<Calling> => {
  const owned = ownedCallings(model.boughtCosmetics)
  return Array.isReadonlyArrayNonEmpty(owned) ? owned : ['You']
}

// NOTE: a bot joins the next empty seat: a goofy name nobody in the crew
// has, a hero picked at random from the ones this player owns (the
// seeded cosmetic generator), and the look of the seat it sits in.
export const addBot = (model: Model): Model => {
  if (model.home.bots.length >= botSeatsFor(model)) {
    return model
  }
  const [afterName, name] = pickFrom(
    model.cosmeticRngState,
    unusedNamesOf(model),
  )
  const [afterHero, calling] = pickFrom(afterName, heroChoicesOf(model))
  const bot: Bot = {
    name,
    calling,
    look: seatLook(botSlotOf(model, model.home.bots.length)),
  }
  return modifyFields(model, {
    cosmeticRngState: () => afterHero,
    home: home => modifyFields(home, { bots: bots => Array.append(bots, bot) }),
  })
}

export const removeBot = (model: Model, index: number): Model =>
  modifyFields(model, {
    home: home =>
      modifyFields(home, {
        bots: bots => Array.remove(bots, index),
        maybePickingBot: () => Option.none(),
      }),
  })

// NOTE: only a hero this player owns, as for their own pick.
export const setBotCalling = (
  model: Model,
  index: number,
  calling: Calling,
): Model =>
  Array.contains(ownedCallings(model.boughtCosmetics), calling)
    ? modifyFields(model, {
        home: home =>
          modifyFields(home, {
            bots: bots =>
              Array.map(bots, (bot, at) =>
                at === index
                  ? modifyFields(bot, { calling: () => calling })
                  : bot,
              ),
          }),
      })
    : model

// NOTE: a bot's name in the capitals a name tag and the crew board show.
export const botNameOf = (bot: Bot): string => bot.name.toUpperCase()
