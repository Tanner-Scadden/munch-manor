import { Array, Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../../app/message'
import { type Model, Phase } from '../../../app/model'
import { LobbyMessage } from '../../../features/lobby/message'
import { RESTART_GRACE_MS } from '../../../shared/constants'
import { heroesBoughtBy, readyModel } from '../../../test/model.fixture'
import {
  checkModel,
  openLobbyByKey,
  press,
  resolveFocusLobby,
  send,
  startedRun,
  steps,
  storyOf,
  tapLobbyHero,
  throughIntro,
} from '../../../test/testing'
import { pointsForRank } from '../../../world/heroes/rank'
import { atSeatBy, playersOf } from '../../../world/party/party'
import { SOLO_SLOT } from '../../../world/schema/worldSchema'
import { earnRank } from '../../end/rankRun'
import { isHeroPickerUp } from '../../lobby/model'

// Teammate bots in the single player lobby (src/domain/bots.ts, src/features/lobby/update.ts):
// + BOT seats one, the x sends it home, its hero card picks its hero, START
// runs with them seated, and RETRY keeps them.

const ranked = UiStruct.evolve(readyModel, {
  rank: rank => ({ ...rank, earnedPoints: pointsForRank(15) }),
  boughtCosmetics: () => heroesBoughtBy(15),
})

const addOne = steps(
  send(LobbyMessage.RequestedAddLobbyBot()),
  resolveFocusLobby(),
)

describe('+ BOT', () => {
  it.effect(
    'seats a bot with a goofy name and a hero, and moves focus to START',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(readyModel)
        s.pipe(
          openLobbyByKey,
          addOne,
          checkModel(current => {
            expect(current.home.bots).toHaveLength(1)
            const [bot] = current.home.bots
            expect(bot?.name).not.toBe('')
            expect(bot?.calling).toBe('You')
            expect(current.lobby.maybeFocus).toEqual(Option.some('Start'))
          }),
        )
      }),
  )

  it.effect('B does the same from the keyboard', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(readyModel)
      s.pipe(
        openLobbyByKey,
        press('KeyB'),
        resolveFocusLobby(),
        checkModel(current => {
          expect(current.home.bots).toHaveLength(1)
        }),
      )
    }),
  )

  it.effect(
    'fills up to three seats with three different names, and no more',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(readyModel)
        s.pipe(
          openLobbyByKey,
          addOne,
          addOne,
          addOne,
          addOne,
          checkModel(current => {
            expect(current.home.bots).toHaveLength(3)
            const names = Array.map(current.home.bots, bot => bot.name)
            expect(new Set(names).size).toBe(3)
          }),
        )
      }),
  )

  it.effect(
    'a bot picks its hero from the heroes the player has unlocked',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(ranked)
        s.pipe(
          openLobbyByKey,
          addOne,
          addOne,
          addOne,
          checkModel(current => {
            expect(current.home.bots).toHaveLength(3)
          }),
        )
      }),
  )

  it.effect('does nothing outside the lobby', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(readyModel)
      s.pipe(
        send(LobbyMessage.RequestedAddLobbyBot()),
        checkModel(current => {
          expect(current.home.bots).toHaveLength(0)
        }),
      )
    }),
  )
})

describe('the x on a bot', () => {
  it.effect('sends it home and leaves the others seated', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(readyModel)
      s.pipe(
        openLobbyByKey,
        addOne,
        addOne,
        checkModel(current => {
          expect(current.home.bots).toHaveLength(2)
        }),
        send(LobbyMessage.RequestedDropLobbyBot({ index: 0 })),
        resolveFocusLobby(),
        checkModel(current => {
          expect(current.home.bots).toHaveLength(1)
        }),
      )
    }),
  )
})

describe("a bot's hero card", () => {
  it.effect(
    'opens the hero picker for that bot, and a pick changes only its hero',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(ranked)
        s.pipe(
          openLobbyByKey,
          addOne,
          send(LobbyMessage.RequestedLobbyBotHeroPicker({ index: 0 })),
          checkModel(current => {
            expect(isHeroPickerUp(current.lobby)).toBe(true)
            expect(current.lobby.maybePickingBot).toEqual(Option.some(0))
          }),
          tapLobbyHero('LineCook'),
          checkModel(current => {
            expect(current.home.bots[0]?.calling).toBe('LineCook')
            expect(current.calling).toBe(readyModel.calling)
            expect(current.lobby.maybePickingBot).toEqual(Option.none())
          }),
        )
      }),
  )

  it.effect('your own hero card still picks your hero', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(ranked)
      s.pipe(
        openLobbyByKey,
        addOne,
        send(LobbyMessage.RequestedLobbyHeroPicker()),
        tapLobbyHero('Handyman'),
        checkModel(current => {
          expect(current.calling).toBe('Handyman')
          expect(current.home.bots[0]?.calling).not.toBe(undefined)
        }),
      )
    }),
  )

  it.effect('cannot pick a hero the rank has not reached', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(readyModel)
      s.pipe(
        openLobbyByKey,
        addOne,
        send(LobbyMessage.RequestedLobbyBotHeroPicker({ index: 0 })),
        tapLobbyHero('LineCook'),
        checkModel(current => {
          expect(current.home.bots[0]?.calling).toBe('You')
        }),
      )
    }),
  )
})

describe('the arrow keys with bots', () => {
  it.effect('stop on the + BOT tile, then on a seated bot and its x', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(readyModel)
      s.pipe(
        openLobbyByKey,
        press('ArrowRight'),
        resolveFocusLobby('Back'),
        press('ArrowRight'),
        resolveFocusLobby('Hero'),
        press('ArrowRight'),
        resolveFocusLobby('Bot1'),
        press('ArrowRight'),
        resolveFocusLobby('Campaign'),
        press('ArrowLeft'),
        resolveFocusLobby('Bot1'),
        send(LobbyMessage.RequestedAddLobbyBot()),
        resolveFocusLobby(),
        press('ArrowLeft'),
        resolveFocusLobby('Glass'),
      )
    }),
  )

  it.effect('walk a seated bot, its x, then the next empty seat', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(readyModel)
      s.pipe(
        openLobbyByKey,
        addOne,
        press('ArrowRight'),
        resolveFocusLobby('Back'),
        press('ArrowRight'),
        resolveFocusLobby('Hero'),
        press('ArrowRight'),
        resolveFocusLobby('Bot1'),
        press('ArrowRight'),
        resolveFocusLobby('Drop1'),
        press('ArrowRight'),
        resolveFocusLobby('Bot2'),
      )
    }),
  )
})

describe('START with bots', () => {
  const withCrew: Model = UiStruct.evolve(ranked, {
    calling: () => 'Handyman',
  })

  it.effect(
    'seats them as a crew of the heroes they picked, and RETRY keeps them',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(withCrew)
        s.pipe(
          openLobbyByKey,
          addOne,
          addOne,
          send(LobbyMessage.RequestedLobbyBotHeroPicker({ index: 1 })),
          tapLobbyHero('TrackStar'),
          send(LobbyMessage.RequestedStartFromLobby()),
          throughIntro,
          checkModel(current => {
            expect(Phase.guards.Preparation(current.phase)).toBe(true)
            expect(current.party._tag).toBe('Crew')
            expect(playersOf(current)).toHaveLength(3)
            expect(current.runStart.crewBots).toHaveLength(2)
            const callings = Array.map(
              playersOf(current),
              ({ player }) => player.calling,
            )
            expect(callings[0]).toBe('Handyman')
            expect(callings[2]).toBe('TrackStar')
          }),
          send(Message.TickedFrame({ deltaTime: 16 })),
          checkModel(current => {
            expect(current.phase._tag).not.toBe('Ready')
          }),
        )
      }),
  )

  it.effect('a run with no bots is single player, as ever', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(readyModel)
      s.pipe(
        openLobbyByKey,
        press('Enter'),
        throughIntro,
        checkModel(current => {
          expect(Phase.guards.Preparation(current.phase)).toBe(true)
          expect(current.party._tag).toBe('Solo')
          expect(current.runStart.crewBots).toHaveLength(0)
        }),
      )
    }),
  )

  it.effect(
    'the crowd is the co-op crowd: more zombies planned for a bigger crew',
    () =>
      Effect.gen(function* () {
        const spawnsOf = (bots: number) =>
          startedRun(
            UiStruct.evolve(withCrew, {
              home: home =>
                UiStruct.evolve(home, {
                  bots: () =>
                    Array.makeBy(bots, () => ({
                      name: 'Bolts',
                      calling: 'You' as const,
                      look: withCrew.appearance,
                    })),
                }),
            }),
          ).pipe(
            Effect.map(({ phase }) =>
              phase._tag === 'Preparation' ? phase.spawns.length : 0,
            ),
          )
        const crowd = yield* spawnsOf(3)
        const alone = yield* spawnsOf(0)
        expect(crowd).toBeGreaterThan(alone)
      }),
  )

  it.effect('RETRY plays with the same bots and heroes', () =>
    Effect.gen(function* () {
      const run = yield* startedRun(
        UiStruct.evolve(withCrew, {
          home: home =>
            UiStruct.evolve(home, {
              bots: () => [
                {
                  name: 'Gizmo',
                  calling: 'LineCook',
                  look: withCrew.appearance,
                },
              ],
            }),
        }),
      )
      const s = yield* storyOf(
        UiStruct.evolve(run, {
          phase: () => Phase.GameOver({ wave: 2 }),
          screenMs: () => RESTART_GRACE_MS,
        }),
      )
      s.pipe(
        send(Message.ClickedRetryButton()),
        throughIntro,
        checkModel(current => {
          expect(Phase.guards.Preparation(current.phase)).toBe(true)
          expect(playersOf(current)).toHaveLength(2)
          expect(current.runStart.crewBots[0]?.name).toBe('Gizmo')
          expect(playersOf(current)[1]?.player.calling).toBe('LineCook')
        }),
      )
    }),
  )
})

describe('rank for a run with bots', () => {
  // NOTE: a run started with three bots seated.
  const botted = startedRun(
    UiStruct.evolve(readyModel, {
      home: home =>
        UiStruct.evolve(home, {
          bots: () =>
            Array.makeBy(3, index => ({
              name: `Bot${index}`,
              calling: 'You' as const,
              look: readyModel.appearance,
            })),
        }),
    }),
  )

  const revivedFour = (run: Model) =>
    UiStruct.evolve(run, {
      seats: atSeatBy(SOLO_SLOT, state =>
        UiStruct.evolve(state, {
          seat: seat => UiStruct.evolve(seat, { revives: () => 4 }),
        }),
      ),
      phase: () => Phase.GameOver({ wave: 3 }),
    })

  const pointsOf = (start: Model, run: Model) =>
    earnRank(start, revivedFour(run)).rank.earnedPoints

  it.effect('pays no revive points: a bot is not a teammate to farm', () =>
    Effect.gen(function* () {
      const run = yield* botted
      const withoutRevives = earnRank(
        run,
        UiStruct.evolve(run, { phase: () => Phase.GameOver({ wave: 3 }) }),
      ).rank.earnedPoints
      expect(pointsOf(run, run)).toBe(withoutRevives)
    }),
  )

  it.effect('the same revives in a crew of people do pay', () =>
    Effect.gen(function* () {
      const run = yield* botted
      const people = UiStruct.evolve(run, {
        runStart: UiStruct.evolve({ crewBots: () => [] }),
      })
      expect(pointsOf(run, people)).toBeGreaterThan(pointsOf(run, run))
    }),
  )
})
