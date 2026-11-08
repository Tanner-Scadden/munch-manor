import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { LobbyBinding } from '../../../app/bindings'
import { Message } from '../../../app/message'
import { type Model, Phase } from '../../../app/model'
import { Message as HeroPickerMessage } from '../../../features/heroes/message'
import { Message as LobbyMessage } from '../../../features/lobby/message'
import { RESTART_GRACE_MS } from '../../../shared/constants'
import { heroesBoughtBy, readyModel } from '../../../test/model.fixture'
import {
  APPLICATION,
  closeDialog,
  openLobbyByKey,
  press,
  resolveFocusLobby,
  showDialog,
  startedRun,
} from '../../../test/testing'
import { pointsForRank } from '../../../world/heroes/rank'
import { atSeatBy, playersOf } from '../../../world/party/party'
import { SOLO_SLOT } from '../../../world/schema/worldSchema'
import { HeroPickerBinding } from '../../lobby/bindings'
import { isHeroPickerUp } from '../../lobby/model'
import { earnRank } from '../../rank/rankRun'

// Teammate bots in the single player lobby (src/features/bots/bots.ts, src/features/lobby/update.ts):
// + BOT seats one, the x sends it home, its hero card picks its hero, START
// runs with them seated, and RETRY keeps them.

const ranked = modifyFields(readyModel, {
  rank: rank => ({ ...rank, earnedPoints: pointsForRank(15) }),
  boughtCosmetics: () => heroesBoughtBy(15),
})

const addOne = [
  Story.messageIn(LobbyBinding, LobbyMessage.ClickedAddBotButton()),
  resolveFocusLobby(),
] as const

describe('+ BOT', () => {
  it.effect(
    'seats a bot with a goofy name and a hero, and moves focus to START',
    () =>
      Story.story(
        APPLICATION,
        Story.given(readyModel),
        openLobbyByKey,
        ...addOne,
        Story.model(current => {
          expect(current.home.bots).toHaveLength(1)
          const [bot] = current.home.bots
          expect(bot?.name).not.toBe('')
          expect(bot?.calling).toBe('You')
          expect(current.lobby.maybeFocus).toEqual(Option.some('Start'))
        }),
      ),
  )

  it.effect('B does the same from the keyboard', () =>
    Story.story(
      APPLICATION,
      Story.given(readyModel),
      openLobbyByKey,
      press('KeyB'),
      resolveFocusLobby(),
      Story.model(current => {
        expect(current.home.bots).toHaveLength(1)
      }),
    ),
  )

  it.effect(
    'fills up to three seats with three different names, and no more',
    () =>
      Story.story(
        APPLICATION,
        Story.given(readyModel),
        openLobbyByKey,
        ...addOne,
        ...addOne,
        ...addOne,
        ...addOne,
        Story.model(current => {
          expect(current.home.bots).toHaveLength(3)
          const names = Array.map(current.home.bots, bot => bot.name)
          expect(new Set(names).size).toBe(3)
        }),
      ),
  )

  it.effect(
    'a bot picks its hero from the heroes the player has unlocked',
    () =>
      Story.story(
        APPLICATION,
        Story.given(ranked),
        openLobbyByKey,
        ...addOne,
        ...addOne,
        ...addOne,
        Story.model(current => {
          expect(current.home.bots).toHaveLength(3)
        }),
      ),
  )

  it.effect('does nothing outside the lobby', () =>
    Story.story(
      APPLICATION,
      Story.given(readyModel),
      Story.messageIn(LobbyBinding, LobbyMessage.ClickedAddBotButton()),
      Story.model(current => {
        expect(current.home.bots).toHaveLength(0)
      }),
    ),
  )
})

describe('the x on a bot', () => {
  it.effect('sends it home and leaves the others seated', () =>
    Story.story(
      APPLICATION,
      Story.given(readyModel),
      openLobbyByKey,
      ...addOne,
      ...addOne,
      Story.model(current => {
        expect(current.home.bots).toHaveLength(2)
      }),
      Story.messageIn(
        LobbyBinding,
        LobbyMessage.ClickedDropBotButton({ index: 0 }),
      ),
      resolveFocusLobby(),
      Story.model(current => {
        expect(current.home.bots).toHaveLength(1)
      }),
    ),
  )
})

describe("a bot's hero card", () => {
  it.effect(
    'opens the hero picker for that bot, and a pick changes only its hero',
    () =>
      Story.story(
        APPLICATION,
        Story.given(ranked),
        openLobbyByKey,
        ...addOne,
        Story.messageIn(
          LobbyBinding,
          LobbyMessage.ClickedBotHeroButton({ index: 0 }),
        ),
        showDialog(),
        Story.model(current => {
          expect(isHeroPickerUp(current.lobby)).toBe(true)
          expect(current.lobby.maybePickingBot).toEqual(Option.some(0))
        }),
        Story.messageIn(
          [LobbyBinding, HeroPickerBinding],
          HeroPickerMessage.ClickedCard({ calling: 'LineCook' }),
        ),
        closeDialog(),
        Story.model(current => {
          expect(current.home.bots[0]?.calling).toBe('LineCook')
          expect(current.calling).toBe(readyModel.calling)
          expect(current.lobby.maybePickingBot).toEqual(Option.none())
        }),
      ),
  )

  it.effect('your own hero card still picks your hero', () =>
    Story.story(
      APPLICATION,
      Story.given(ranked),
      openLobbyByKey,
      ...addOne,
      Story.messageIn(LobbyBinding, LobbyMessage.ClickedHeroButton()),
      showDialog(),
      Story.messageIn(
        [LobbyBinding, HeroPickerBinding],
        HeroPickerMessage.ClickedCard({ calling: 'Handyman' }),
      ),
      closeDialog(),
      Story.model(current => {
        expect(current.calling).toBe('Handyman')
        expect(current.home.bots[0]?.calling).not.toBe(undefined)
      }),
    ),
  )

  it.effect('cannot pick a hero the rank has not reached', () =>
    Story.story(
      APPLICATION,
      Story.given(readyModel),
      openLobbyByKey,
      ...addOne,
      Story.messageIn(
        LobbyBinding,
        LobbyMessage.ClickedBotHeroButton({ index: 0 }),
      ),
      showDialog(),
      Story.messageIn(
        [LobbyBinding, HeroPickerBinding],
        HeroPickerMessage.ClickedCard({ calling: 'LineCook' }),
      ),
      Story.model(current => {
        expect(current.home.bots[0]?.calling).toBe('You')
      }),
    ),
  )
})

describe('the arrow keys with bots', () => {
  it.effect('stop on the + BOT tile, then on a seated bot and its x', () =>
    Story.story(
      APPLICATION,
      Story.given(readyModel),
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
      Story.messageIn(LobbyBinding, LobbyMessage.ClickedAddBotButton()),
      resolveFocusLobby(),
      press('ArrowLeft'),
      resolveFocusLobby('Glass'),
    ),
  )

  it.effect('walk a seated bot, its x, then the next empty seat', () =>
    Story.story(
      APPLICATION,
      Story.given(readyModel),
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
    ),
  )
})

describe('START with bots', () => {
  const withCrew: Model = modifyFields(ranked, {
    calling: () => 'Handyman',
  })

  it.effect(
    'seats them as a crew of the heroes they picked, and RETRY keeps them',
    () =>
      Story.story(
        APPLICATION,
        Story.given(withCrew),
        openLobbyByKey,
        ...addOne,
        ...addOne,
        Story.messageIn(
          LobbyBinding,
          LobbyMessage.ClickedBotHeroButton({ index: 1 }),
        ),
        showDialog(),
        Story.messageIn(
          [LobbyBinding, HeroPickerBinding],
          HeroPickerMessage.ClickedCard({ calling: 'TrackStar' }),
        ),
        closeDialog(),
        Story.messageIn(LobbyBinding, LobbyMessage.ClickedStartButton()),
        Story.model(current => {
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
        Story.message(Message.TickedFrame({ deltaTime: 16 })),
        Story.model(current => {
          expect(current.phase._tag).not.toBe('Ready')
        }),
      ),
  )

  it.effect('a run with no bots is single player, as ever', () =>
    Story.story(
      APPLICATION,
      Story.given(readyModel),
      openLobbyByKey,
      press('Enter'),
      Story.model(current => {
        expect(Phase.guards.Preparation(current.phase)).toBe(true)
        expect(current.party._tag).toBe('Solo')
        expect(current.crewBots).toHaveLength(0)
      }),
    ),
  )

  it.effect(
    'the crowd is the co-op crowd: more zombies planned for a bigger crew',
    () =>
      Effect.gen(function* () {
        const spawnsOf = (bots: number) =>
          startedRun(
            modifyFields(withCrew, {
              home: home =>
                modifyFields(home, {
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
      )
      return yield* Story.story(
        APPLICATION,
        Story.given(
          modifyFields(run, {
            phase: () => Phase.GameOver({ wave: 2 }),
            screenMs: () => RESTART_GRACE_MS,
          }),
        ),
        Story.message(Message.ClickedRetryButton()),
        Story.model(current => {
          expect(Phase.guards.Preparation(current.phase)).toBe(true)
          expect(playersOf(current)).toHaveLength(2)
          expect(current.crewBots[0]?.name).toBe('Gizmo')
          expect(playersOf(current)[1]?.player.calling).toBe('LineCook')
        }),
      )
    }),
  )
})

describe('rank for a run with bots', () => {
  // NOTE: a run started with three bots seated.
  const botted = startedRun(
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
  )

  const revivedFour = (run: Model) =>
    modifyFields(run, {
      seats: atSeatBy(SOLO_SLOT, state =>
        modifyFields(state, {
          seat: seat => modifyFields(seat, { revives: () => 4 }),
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
        modifyFields(run, { phase: () => Phase.GameOver({ wave: 3 }) }),
      ).rank.earnedPoints
      expect(pointsOf(run, run)).toBe(withoutRevives)
    }),
  )

  it.effect('the same revives in a crew of people do pay', () =>
    Effect.gen(function* () {
      const run = yield* botted
      const people = modifyFields(run, { crewBots: () => [] })
      expect(pointsOf(run, people)).toBeGreaterThan(pointsOf(run, run))
    }),
  )
})
