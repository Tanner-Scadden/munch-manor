import { Array, Function, Option, String } from 'effect'

import { UiStruct } from '@effect/ui'

import type { Model } from '#app/model.ts'
import { seatLook } from '#art/seatLooks.ts'
import type { Calling } from '#shared/playerData.ts'
import { nextRandom } from '#shared/prng.ts'
import { ownedCallings } from '#world/heroes/calling.ts'
import { seatedAs } from '#world/heroes/callingPlayer.ts'
import { BOT_NAMES } from '#world/names.ts'
import { COOP_RULES, isCoop, modifySeat } from '#world/party/party.ts'
import type { World } from '#world/schema/world.ts'
import type { PlayerSlot } from '#world/schema/worldSchema.ts'

import type { Bot } from './clientSchema.ts'

const MAX_BOTS = COOP_RULES.maxPlayers - 1

export const botSeatsFor = (model: Model): number =>
  Math.max(0, Math.min(MAX_BOTS, COOP_RULES.maxPlayers - model.localPlayers))

export const activeBots = (model: Model): ReadonlyArray<Bot> =>
  Array.take(model.home.bots, botSeatsFor(model))

export const botSlotOf: {
  (index: number): (model: Model) => PlayerSlot
  (model: Model, index: number): PlayerSlot
} = Function.dual(
  2,
  (model: Model, index: number): PlayerSlot => model.localPlayers + index,
)

export const isBotCrew = (model: Model): boolean =>
  Array.isReadonlyArrayNonEmpty(model.runStart.crewBots)

export const isHumanCrew = (model: Model): boolean =>
  isCoop(model) && !isBotCrew(model)

export const maybeCrewBotAt: {
  (slot: PlayerSlot): (model: Model) => Option.Option<Bot>
  (model: Model, slot: PlayerSlot): Option.Option<Bot>
} = Function.dual(2, (model: Model, slot: PlayerSlot): Option.Option<Bot> =>
  Array.get(model.runStart.crewBots, slot - model.localPlayers),
)

export const crewBotSlots = (model: Model): ReadonlyArray<PlayerSlot> =>
  Array.map(model.runStart.crewBots, (_bot, index) => botSlotOf(model, index))

export const seatCallings: {
  (
    firstSlot: PlayerSlot,
    callings: ReadonlyArray<Calling>,
  ): (world: World) => World
  (world: World, firstSlot: PlayerSlot, callings: ReadonlyArray<Calling>): World
} = Function.dual(
  3,
  (
    world: World,
    firstSlot: PlayerSlot,
    callings: ReadonlyArray<Calling>,
  ): World =>
    Array.reduce(callings, world, (current, calling, index) =>
      modifySeat(current, firstSlot + index, {
        player: player => seatedAs(player, calling),
      }),
    ),
)

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

export const addBot = (model: Model): Model => {
  if (model.home.bots.length >= botSeatsFor(model)) {
    return model
  }
  const [afterName, name] = pickFrom(
    model.cosmetics.cosmeticRngState,
    unusedNamesOf(model),
  )
  const [afterHero, calling] = pickFrom(afterName, heroChoicesOf(model))
  const bot: Bot = {
    name,
    calling,
    look: seatLook(botSlotOf(model, model.home.bots.length)),
  }
  return UiStruct.evolve(model, {
    home: home =>
      UiStruct.evolve(home, { bots: bots => Array.append(bots, bot) }),
    cosmetics: UiStruct.evolve({ cosmeticRngState: () => afterHero }),
  })
}

export const removeBot: {
  (index: number): (model: Model) => Model
  (model: Model, index: number): Model
} = Function.dual(2, (model: Model, index: number): Model =>
  UiStruct.evolve(model, {
    home: home =>
      UiStruct.evolve(home, {
        bots: bots => Array.remove(bots, index),
      }),
  }),
)

export const setBotCalling: {
  (index: number, calling: Calling): (model: Model) => Model
  (model: Model, index: number, calling: Calling): Model
} = Function.dual(3, (model: Model, index: number, calling: Calling): Model =>
  Array.contains(ownedCallings(model.boughtCosmetics), calling)
    ? UiStruct.evolve(model, {
        home: home =>
          UiStruct.evolve(home, {
            bots: bots =>
              Array.map(bots, (bot, at) =>
                at === index
                  ? UiStruct.evolve(bot, { calling: () => calling })
                  : bot,
              ),
          }),
      })
    : model,
)

export const botNameOf = (bot: Bot): string => String.toUpperCase(bot.name)
