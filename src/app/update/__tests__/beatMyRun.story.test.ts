import { Effect, Option, String } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import {
  BeatMyRun,
  type FriendsDare,
  addressWithoutDare,
  dareCodeOf,
  readBeatLink,
} from '../../../domain/beatLink'
import { maybeBeatComparisonOf, shareUrlOf } from '../../../features/end/beatRun'
import { Message as LobbyMessage } from '../../../features/lobby/message'
import { FoldLobby } from '../../../features/lobby/steps'
import { readyModel } from '../../../test/model.fixture'
import {
  APPLICATION,
  press,
  resolveFocusLobby,
  startedRun,
  throughIntro,
} from '../../../test/testing'
import { maybeOpenerOf } from '../../../world/dare/milestones'
import { noModifiers } from '../../../world/run/modifiers'
import { LobbyBinding } from '../../bindings'
import { Message } from '../../message'
import { type Model, Phase } from '../../model'
import { ForgetBeatLink } from '../beatMyRun'
import { FocusHomeButton } from '../home'

// Beat my run (src/domain/beatMyRun.ts): SHARE's link carries a lone
// player's run, a link read at start offers it on the home menu, taking it
// holds the lobby to the friend's picks, START plays the friend's house, and
// the end card says whether the run beat theirs.

const FRIEND_SEED = 1_234_567
const OWN_SEED = 7_654_321

const NAPKIN_OPENER = Option.getOrElse(maybeOpenerOf('NapkinRing'), () => '')

// NOTE: the friend, who has opened the napkin ring, on Hard with Broke on.
const friendHome: Model = modifyFields(readyModel, {
  rngState: () => FRIEND_SEED,
  difficulty: setting => modifyFields(setting, { chosen: () => 'Hard' }),
  modifiers: () => ({ ...noModifiers, broke: true }),
  journal: journal =>
    modifyFields(journal, { milestones: () => [NAPKIN_OPENER] }),
})

// NOTE: this player, who has not, on Normal with nothing on, and their own
// seed.
const ownHome: Model = modifyFields(readyModel, {
  rngState: () => OWN_SEED,
  difficulty: setting => modifyFields(setting, { chosen: () => 'Normal' }),
})

const DARE: FriendsDare = {
  seed: FRIEND_SEED,
  mode: 'Campaign',
  difficulty: 'Hard',
  modifiers: { ...noModifiers, broke: true },
  dareMark: 0,
  easyBreakSeconds: 0,
  pool: ['NapkinRing'],
  hero: 'Handyman',
  outcome: 'Munched',
  wave: 4,
  found: ['SilverSpoon'],
  runSeconds: 312,
}

const linkOf = (dare: FriendsDare): string =>
  `?dare=${Option.getOrElse(dareCodeOf(dare), () => '')}`

const offered = (model: Model, dare: FriendsDare = DARE): Model =>
  modifyFields(model, { beatMyRun: () => BeatMyRun.Offered({ dare }) })

const takeFromCard = Story.steps(
  Story.message(Message.ClickedBeatMyRunButton()),
  resolveFocusLobby(),
)

// NOTE: what decides the house, read off a run's start.
const houseOf = (model: Model) => ({
  arrangement: model.level.arrangement,
  list: model.dare.list,
  things: model.dareThings,
  cases: model.cases,
  crates: model.crates,
  difficulty: model.difficulty.chosen,
  modifiers: model.modifiers,
})

describe('the link', () => {
  it('reads back the run it was made from', () => {
    expect(readBeatLink(linkOf(DARE))).toEqual(Option.some(DARE))
  })

  it('ignores a bad, cut, or other version link', () => {
    const code = Option.getOrElse(dareCodeOf(DARE), () => '')
    expect(readBeatLink('?dare=not-a-run')).toEqual(Option.none())
    expect(readBeatLink(`?dare=${String.slice(0, 10)(code)}`)).toEqual(Option.none())
    expect(readBeatLink('')).toEqual(Option.none())
    // NOTE: version 2, and a wave past the wire's range.
    expect(readBeatLink('?dare=WzIsMSwwLDAsMCwwLDAsMCwwLDAsMSwwLDBd')).toEqual(
      Option.none(),
    )
    expect(
      readBeatLink(
        `?dare=${String.replaceAll('=', '')(btoa('[1,1,0,0,0,0,0,0,0,0,5000,0,0]'))}`,
      ),
    ).toEqual(Option.none())
  })

  it.effect('a bad link read at start offers nothing', () =>
    Story.story(
      APPLICATION,
      Story.given(readyModel),
      Story.message(
        Message.CompletedReadBeatLink({
          maybeDare: readBeatLink('?dare=garbage'),
        }),
      ),
      Story.model(({ beatMyRun }) => {
        expect(BeatMyRun.isAnyOf(['None'])(beatMyRun)).toBe(true)
      }),
    ),
  )

  it.effect('a good link read at start offers its dare', () =>
    Story.story(
      APPLICATION,
      Story.given(readyModel),
      Story.message(
        Message.CompletedReadBeatLink({ maybeDare: readBeatLink(linkOf(DARE)) }),
      ),
      Story.model(({ beatMyRun }) => {
        expect(beatMyRun).toEqual(BeatMyRun.Offered({ dare: DARE }))
      }),
      // NOTE: and the dare comes off the address, so a reload never offers
      // it again.
      Story.Command.expectExact(ForgetBeatLink()),
      Story.Command.resolve(ForgetBeatLink(), Message.CompletedForgetBeatLink()),
    ),
  )

  it('the address loses its dare and keeps the rest', () => {
    expect(
      addressWithoutDare(`https://munchmanor.com/${linkOf(DARE)}&room=ABCD#top`),
    ).toBe('https://munchmanor.com/?room=ABCD#top')
    expect(addressWithoutDare('https://munchmanor.com/?room=ABCD')).toBe(
      'https://munchmanor.com/?room=ABCD',
    )
  })

  it.effect("SHARE's link carries a lone run's seed, picks, pool, and result", () =>
    Effect.gen(function* () {
      const running = yield* startedRun(friendHome)
      const munched = modifyFields(running, {
        phase: () => Phase.GameOver({ wave: 3 }),
      })
      const shared = readBeatLink(
        new URL(shareUrlOf(munched)).search,
      ).pipe(Option.getOrThrow)
      expect(shared.seed).toBe(FRIEND_SEED)
      expect(shared.difficulty).toBe('Hard')
      expect(shared.modifiers.broke).toBe(true)
      expect(shared.pool).toEqual(['NapkinRing'])
      expect(shared.outcome).toBe('Munched')
      expect(shared.wave).toBe(3)
    }),
  )
})

describe('BEAT MY RUN', () => {
  it.effect('the card takes the dare into the lobby, its picks held', () =>
    Story.story(
      APPLICATION,
      Story.given(offered(ownHome)),
      takeFromCard,
      Story.model(current => {
        expect(current.lobby.status).toBe('Open')
        expect(current.difficulty.chosen).toBe('Hard')
        expect(current.modifiers.broke).toBe(true)
      }),
      // NOTE: a pick tapped on the held lobby changes nothing.
      Story.messageIn(
        LobbyBinding,
        LobbyMessage.ClickedDifficultyButton({ difficulty: 'Easy' }),
      ),
      Story.model(({ difficulty }) => {
        expect(difficulty.chosen).toBe('Hard')
      }),
    ),
  )

  it.effect('the x lets it go, and the own picks stay', () =>
    Story.story(
      APPLICATION,
      Story.given(offered(ownHome)),
      Story.message(Message.ClickedDismissBeatMyRunButton()),
      Story.Command.resolve(
        FocusHomeButton({ button: 'Play' }),
        Message.CompletedFocusHomeButton(),
      ),
      Story.model(({ beatMyRun, difficulty }) => {
        expect(BeatMyRun.isAnyOf(['None'])(beatMyRun)).toBe(true)
        expect(difficulty.chosen).toBe('Normal')
      }),
    ),
  )

  it.effect('Escape lets it go as the x does', () =>
    Story.story(
      APPLICATION,
      Story.given(offered(ownHome)),
      press('Escape'),
      Story.Command.resolve(
        FocusHomeButton({ button: 'Play' }),
        Message.CompletedFocusHomeButton(),
      ),
      Story.model(({ beatMyRun, difficulty }) => {
        expect(BeatMyRun.isAnyOf(['None'])(beatMyRun)).toBe(true)
        expect(difficulty.chosen).toBe('Normal')
      }),
    ),
  )

  it.effect('BACK from a dare brings the own picks back', () =>
    Story.story(
      APPLICATION,
      Story.given(offered(ownHome)),
      takeFromCard,
      Story.messageIn(LobbyBinding, LobbyMessage.ClickedBackButton()),
      Story.Command.resolve(
        FocusHomeButton({ button: 'Play' }),
        Message.CompletedFocusHomeButton(),
      ),
      Story.Command.resolve(FoldLobby(), LobbyMessage.CompletedFold()),
      Story.model(({ beatMyRun, difficulty, modifiers }) => {
        expect(beatMyRun).toEqual(BeatMyRun.Offered({ dare: DARE }))
        expect(difficulty.chosen).toBe('Normal')
        expect(modifiers.broke).toBe(false)
      }),
    ),
  )

  it.effect(
    "START plays the friend's house: the same rooms, list, and rolls",
    () =>
      Effect.gen(function* () {
        const friendRun = yield* startedRun(friendHome)
        const dare: FriendsDare = {
          ...DARE,
          seed: friendRun.runSeed,
          pool: friendRun.runPool,
        }
        const ownRun = yield* Story.story(
          APPLICATION,
          Story.given(offered(ownHome, dare)),
          takeFromCard,
          Story.messageIn(LobbyBinding, LobbyMessage.ClickedStartButton()),
          throughIntro,
        )
        // NOTE: the napkin ring is not this player's, but it is the
        // friend's dare's, so the list rolls from it all the same.
        expect(ownRun.runPool).toEqual(['NapkinRing'])
        expect(houseOf(ownRun)).toEqual(houseOf(friendRun))
        expect(ownRun.elapsedMs).toBe(friendRun.elapsedMs)
        expect(ownRun.rngState).toBe(friendRun.rngState)
      }),
  )
})

describe('the end card', () => {
  const taken = (model: Model): Model =>
    modifyFields(model, {
      beatMyRun: () =>
        BeatMyRun.Taken({
          dare: DARE,
          own: {
            mode: 'Campaign',
            difficulty: 'Normal',
            modifiers: noModifiers,
            dareMark: 0,
            easyBreakSeconds: 0,
            bots: [],
          },
        }),
    })

  it('a wave short of the friend is NOT YET', () => {
    const munched = modifyFields(taken(readyModel), {
      phase: () => Phase.GameOver({ wave: 2 }),
    })
    expect(
      Option.map(maybeBeatComparisonOf(munched), ({ verdict }) => verdict),
    ).toEqual(Option.some('NotYet'))
  })

  it('an escape BEATS IT', () => {
    const escaped = modifyFields(taken(readyModel), {
      phase: () => Phase.Escaped({ wave: 3 }),
    })
    expect(
      Option.map(maybeBeatComparisonOf(escaped), ({ verdict }) => verdict),
    ).toEqual(Option.some('BeatIt'))
  })

  it('a run that is no dare compares nothing', () => {
    expect(
      maybeBeatComparisonOf(
        modifyFields(readyModel, { phase: () => Phase.GameOver({ wave: 9 }) }),
      ),
    ).toEqual(Option.none())
  })
})
