import { Array, Option } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { RESTART_GRACE_MS } from './constants'
import { update } from './main'
import { Message } from './message'
import { type Model, Phase } from './model'
import { heroesBoughtBy, readyModel } from './model.fixture'
import { playersOf } from './party'
import { pointsForRank } from './rank'
import { earnRank } from './rankRun'
import {
  closeDialog,
  openLobbyByKey,
  press,
  resolveFocusLobby,
  showDialog,
} from './testing'

// Teammate bots in the single player lobby (src/bots.ts, src/update/lobby.ts):
// + BOT seats one, the x sends it home, its hero card picks its hero, START
// runs with them seated, and RETRY keeps them.

const ranked = modifyFields(readyModel, {
  rank: rank => ({ ...rank, earnedPoints: pointsForRank(15) }),
  boughtCosmetics: () => heroesBoughtBy(15),
})

const addOne = [
  message(Message.ClickedLobbyAddBotButton()),
  resolveFocusLobby(),
] as const

describe('+ BOT', () => {
  test('seats a bot with a goofy name and a hero, and moves focus to START', () => {
    story(
      update,
      given(readyModel),
      openLobbyByKey,
      ...addOne,
      model(current => {
        expect(current.home.bots).toHaveLength(1)
        const [bot] = current.home.bots
        expect(bot?.name).not.toBe('')
        expect(bot?.calling).toBe('You')
        expect(current.home.maybeLobbyFocus).toEqual(Option.some('Start'))
      }),
    )
  })

  test('B does the same from the keyboard', () => {
    story(
      update,
      given(readyModel),
      openLobbyByKey,
      press('KeyB'),
      resolveFocusLobby(),
      model(current => {
        expect(current.home.bots).toHaveLength(1)
      }),
    )
  })

  test('fills up to three seats with three different names, and no more', () => {
    story(
      update,
      given(readyModel),
      openLobbyByKey,
      ...addOne,
      ...addOne,
      ...addOne,
      ...addOne,
      model(current => {
        expect(current.home.bots).toHaveLength(3)
        const names = Array.map(current.home.bots, bot => bot.name)
        expect(new Set(names).size).toBe(3)
      }),
    )
  })

  test('a bot picks its hero from the heroes the player has unlocked', () => {
    story(
      update,
      given(ranked),
      openLobbyByKey,
      ...addOne,
      ...addOne,
      ...addOne,
      model(current => {
        expect(current.home.bots).toHaveLength(3)
      }),
    )
  })

  test('does nothing outside the lobby', () => {
    story(
      update,
      given(readyModel),
      message(Message.ClickedLobbyAddBotButton()),
      model(current => {
        expect(current.home.bots).toHaveLength(0)
      }),
    )
  })
})

describe('the x on a bot', () => {
  test('sends it home and leaves the others seated', () => {
    story(
      update,
      given(readyModel),
      openLobbyByKey,
      ...addOne,
      ...addOne,
      model(current => {
        expect(current.home.bots).toHaveLength(2)
      }),
      message(Message.ClickedLobbyDropBotButton({ index: 0 })),
      resolveFocusLobby(),
      model(current => {
        expect(current.home.bots).toHaveLength(1)
      }),
    )
  })
})

describe("a bot's hero card", () => {
  test('opens the hero picker for that bot, and a pick changes only its hero', () => {
    story(
      update,
      given(ranked),
      openLobbyByKey,
      ...addOne,
      message(Message.ClickedLobbyBotHeroButton({ index: 0 })),
      showDialog(),
      model(current => {
        expect(current.panel).toBe('Calling')
        expect(current.home.maybePickingBot).toEqual(Option.some(0))
      }),
      message(Message.ClickedCallingCardButton({ calling: 'LineCook' })),
      closeDialog(),
      model(current => {
        expect(current.home.bots[0]?.calling).toBe('LineCook')
        expect(current.calling).toBe(readyModel.calling)
        expect(current.home.maybePickingBot).toEqual(Option.none())
      }),
    )
  })

  test('your own hero card still picks your hero', () => {
    story(
      update,
      given(ranked),
      openLobbyByKey,
      ...addOne,
      message(Message.ClickedLobbyHeroButton()),
      showDialog(),
      message(Message.ClickedCallingCardButton({ calling: 'Handyman' })),
      closeDialog(),
      model(current => {
        expect(current.calling).toBe('Handyman')
        expect(current.home.bots[0]?.calling).not.toBe(undefined)
      }),
    )
  })

  test('cannot pick a hero the rank has not reached', () => {
    story(
      update,
      given(readyModel),
      openLobbyByKey,
      ...addOne,
      message(Message.ClickedLobbyBotHeroButton({ index: 0 })),
      showDialog(),
      message(Message.ClickedCallingCardButton({ calling: 'LineCook' })),
      model(current => {
        expect(current.home.bots[0]?.calling).toBe('You')
      }),
    )
  })
})

describe('the arrow keys with bots', () => {
  test('stop on the + BOT tile, then on a seated bot and its x', () => {
    story(
      update,
      given(readyModel),
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
      message(Message.ClickedLobbyAddBotButton()),
      resolveFocusLobby(),
      press('ArrowLeft'),
      resolveFocusLobby('Nightmare'),
    )
  })

  test('walk a seated bot, its x, then the next empty seat', () => {
    story(
      update,
      given(readyModel),
      openLobbyByKey,
      ...addOne,
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
  })
})

describe('START with bots', () => {
  const withCrew: Model = modifyFields(ranked, {
    calling: () => 'Handyman',
  })

  test('seats them as a crew of the heroes they picked, and RETRY keeps them', () => {
    story(
      update,
      given(withCrew),
      openLobbyByKey,
      ...addOne,
      ...addOne,
      message(Message.ClickedLobbyBotHeroButton({ index: 1 })),
      showDialog(),
      message(Message.ClickedCallingCardButton({ calling: 'TrackStar' })),
      closeDialog(),
      message(Message.ClickedLobbyStartButton()),
      model(current => {
        expect(Phase.guards.Preparation(current.phase)).toBe(true)
        expect(current.party._tag).toBe('Crew')
        expect(playersOf(current)).toHaveLength(3)
        expect(current.crewBots).toHaveLength(2)
        const callings = Array.map(
          playersOf(current),
          ({ player }) => player.calling,
        )
        expect(callings[0]).toBe('Handyman')
        expect(callings[2]).toBe('TrackStar')
      }),
      message(Message.TickedFrame({ deltaTime: 16 })),
      model(current => {
        expect(current.phase._tag).not.toBe('Ready')
      }),
    )
  })

  test('a run with no bots is single player, as ever', () => {
    story(
      update,
      given(readyModel),
      openLobbyByKey,
      press('Enter'),
      model(current => {
        expect(Phase.guards.Preparation(current.phase)).toBe(true)
        expect(current.party._tag).toBe('Solo')
        expect(current.crewBots).toHaveLength(0)
      }),
    )
  })

  test('the crowd is the co-op crowd: more zombies planned for a bigger crew', () => {
    const spawnsOf = (bots: number) => {
      let current = withCrew
      current = Array.reduce(Array.range(1, bots), current, step =>
        modifyFields(step, {
          home: home =>
            modifyFields(home, {
              bots: list => [
                ...list,
                { name: 'Bolts', calling: 'You', look: step.appearance },
              ],
            }),
        }),
      )
      const started = update(
        current,
        Message.PressedKey({ code: 'Enter' }),
      ).model
      const run = update(started, Message.PressedKey({ code: 'Enter' })).model
      return run.phase._tag === 'Preparation' ? run.phase.spawns.length : 0
    }
    expect(spawnsOf(3)).toBeGreaterThan(spawnsOf(0))
  })

  test('RETRY plays with the same bots and heroes', () => {
    const ended = modifyFields(
      update(
        update(
          modifyFields(withCrew, {
            home: home =>
              modifyFields(home, {
                bots: () => [
                  {
                    name: 'Gizmo',
                    calling: 'LineCook',
                    look: withCrew.appearance,
                  },
                ],
              }),
          }),
          Message.PressedKey({ code: 'Enter' }),
        ).model,
        Message.PressedKey({ code: 'Enter' }),
      ).model,
      {
        phase: () => Phase.GameOver({ wave: 2 }),
        screenMs: () => RESTART_GRACE_MS,
      },
    )
    story(
      update,
      given(ended),
      message(Message.ClickedRetryButton()),
      model(current => {
        expect(Phase.guards.Preparation(current.phase)).toBe(true)
        expect(playersOf(current)).toHaveLength(2)
        expect(current.crewBots[0]?.name).toBe('Gizmo')
        expect(playersOf(current)[1]?.player.calling).toBe('LineCook')
      }),
    )
  })
})

describe('rank for a run with bots', () => {
  const botted = update(
    update(
      modifyFields(readyModel, {
        home: home =>
          modifyFields(home, {
            bots: () =>
              Array.makeBy(3, index => ({
                name: `Bot${index}`,
                calling: 'You' as const,
                look: readyModel.appearance,
              })),
          }),
      }),
      Message.PressedKey({ code: 'Enter' }),
    ).model,
    Message.PressedKey({ code: 'Enter' }),
  ).model

  const revivedFour = (run: typeof botted) =>
    modifyFields(run, {
      party: party =>
        party._tag === 'Crew'
          ? { ...party, lead: { ...party.lead, revives: 4 } }
          : party,
      phase: () => Phase.GameOver({ wave: 3 }),
    })

  const pointsOf = (run: typeof botted) =>
    earnRank(botted, revivedFour(run)).rank.earnedPoints

  test('pays no revive points: a bot is not a teammate to farm', () => {
    const withoutRevives = earnRank(
      botted,
      modifyFields(botted, { phase: () => Phase.GameOver({ wave: 3 }) }),
    ).rank.earnedPoints
    expect(pointsOf(botted)).toBe(withoutRevives)
  })

  test('the same revives in a crew of people do pay', () => {
    const people = modifyFields(botted, { crewBots: () => [] })
    expect(pointsOf(people)).toBeGreaterThan(pointsOf(botted))
  })
})
