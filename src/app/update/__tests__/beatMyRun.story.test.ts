import { Effect, Option, String } from 'effect'

import { Component, UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import {
  BeatMyRun,
  type FriendsDare,
  addressWithoutDare,
  dareCodeOf,
  readBeatLink,
} from '../../../domain/beatLink'
import {
  maybeBeatComparisonOf,
  shareUrlOf,
} from '../../../features/end/beatRun'
import { LobbyMessage } from '../../../features/lobby/message'
import { readyModel } from '../../../test/model.fixture'
import {
  checkModel,
  foldLobby,
  modelAfter,
  press,
  resolveFocusLobby,
  send,
  startedRun,
  steps,
  throughIntro,
} from '../../../test/testing'
import { maybeOpenerOf } from '../../../world/dare/milestones'
import { noModifiers } from '../../../world/run/modifiers'
import { Message } from '../../message'
import { type Model, Phase } from '../../model'
import { ForgetBeatLink } from '../beatMyRun'
import { FocusHomeButton } from '../home'

const FRIEND_SEED = 1_234_567
const OWN_SEED = 7_654_321

const NAPKIN_OPENER = Option.getOrElse(maybeOpenerOf('NapkinRing'), () => '')

const friendHome: Model = UiStruct.evolve(readyModel, {
  rngState: () => FRIEND_SEED,
  difficulty: setting => UiStruct.evolve(setting, { chosen: () => 'Hard' }),
  modifiers: () => ({ ...noModifiers, broke: true }),
  journal: journal =>
    UiStruct.evolve(journal, { milestones: () => [NAPKIN_OPENER] }),
})

const ownHome: Model = UiStruct.evolve(readyModel, {
  rngState: () => OWN_SEED,
  difficulty: setting => UiStruct.evolve(setting, { chosen: () => 'Normal' }),
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
  UiStruct.evolve(model, { beatMyRun: () => BeatMyRun.Offered({ dare }) })

const takeFromCard = steps(
  send(Message.ClickedBeatMyRunButton()),
  resolveFocusLobby(),
)

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
    expect(readBeatLink(`?dare=${String.slice(0, 10)(code)}`)).toEqual(
      Option.none(),
    )
    expect(readBeatLink('')).toEqual(Option.none())
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
    modelAfter(
      readyModel,
      steps(
        send(
          Message.CompletedReadBeatLink({
            maybeDare: readBeatLink('?dare=garbage'),
          }),
        ),
        checkModel(({ beatMyRun }) => {
          expect(BeatMyRun.isAnyOf(['None'])(beatMyRun)).toBe(true)
        }),
      ),
    ),
  )

  it.effect('a good link read at start offers its dare', () =>
    modelAfter(
      readyModel,
      steps(
        send(
          Message.CompletedReadBeatLink({
            maybeDare: readBeatLink(linkOf(DARE)),
          }),
        ),
        checkModel(({ beatMyRun }) => {
          expect(beatMyRun).toEqual(BeatMyRun.Offered({ dare: DARE }))
        }),
        s => s.expectExact(ForgetBeatLink.make()),
        s => s.resolve(ForgetBeatLink.make(), Component.noop),
      ),
    ),
  )

  it('the address loses its dare and keeps the rest', () => {
    expect(
      addressWithoutDare(
        `https://munchmanor.com/${linkOf(DARE)}&room=ABCD#top`,
      ),
    ).toBe('https://munchmanor.com/?room=ABCD#top')
    expect(addressWithoutDare('https://munchmanor.com/?room=ABCD')).toBe(
      'https://munchmanor.com/?room=ABCD',
    )
  })

  it.effect(
    "SHARE's link carries a lone run's seed, picks, pool, and result",
    () =>
      Effect.gen(function* () {
        const running = yield* startedRun(friendHome)
        const munched = UiStruct.evolve(running, {
          phase: () => Phase.GameOver({ wave: 3 }),
        })
        const shared = readBeatLink(new URL(shareUrlOf(munched)).search).pipe(
          Option.getOrThrow,
        )
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
    modelAfter(
      offered(ownHome),
      steps(
        takeFromCard,
        checkModel(current => {
          expect(current.lobby.status).toBe('Open')
          expect(current.difficulty.chosen).toBe('Hard')
          expect(current.modifiers.broke).toBe(true)
        }),
        send(LobbyMessage.PickedLobbyDifficulty({ difficulty: 'Easy' })),
        checkModel(({ difficulty }) => {
          expect(difficulty.chosen).toBe('Hard')
        }),
      ),
    ),
  )

  it.effect('the x lets it go, and the own picks stay', () =>
    modelAfter(
      offered(ownHome),
      steps(
        send(Message.ClickedDismissBeatMyRunButton()),
        s =>
          s.resolve(FocusHomeButton.make({ button: 'Play' }), Component.noop),
        checkModel(({ beatMyRun, difficulty }) => {
          expect(BeatMyRun.isAnyOf(['None'])(beatMyRun)).toBe(true)
          expect(difficulty.chosen).toBe('Normal')
        }),
      ),
    ),
  )

  it.effect('Escape lets it go as the x does', () =>
    modelAfter(
      offered(ownHome),
      steps(
        press('Escape'),
        s =>
          s.resolve(FocusHomeButton.make({ button: 'Play' }), Component.noop),
        checkModel(({ beatMyRun, difficulty }) => {
          expect(BeatMyRun.isAnyOf(['None'])(beatMyRun)).toBe(true)
          expect(difficulty.chosen).toBe('Normal')
        }),
      ),
    ),
  )

  it.effect('BACK from a dare brings the own picks back', () =>
    modelAfter(
      offered(ownHome),
      steps(
        takeFromCard,
        send(LobbyMessage.RequestedLeaveLobby()),
        s =>
          s.resolve(FocusHomeButton.make({ button: 'Play' }), Component.noop),
        foldLobby,
        checkModel(({ beatMyRun, difficulty, modifiers }) => {
          expect(beatMyRun).toEqual(BeatMyRun.Offered({ dare: DARE }))
          expect(difficulty.chosen).toBe('Normal')
          expect(modifiers.broke).toBe(false)
        }),
      ),
    ),
  )

  it.effect(
    "START plays the friend's house: the same rooms, list, and rolls",
    () =>
      Effect.gen(function* () {
        const friendRun = yield* startedRun(friendHome)
        const dare: FriendsDare = {
          ...DARE,
          seed: friendRun.runStart.runSeed,
          pool: friendRun.runStart.runPool,
        }
        const ownRun = yield* modelAfter(
          offered(ownHome, dare),
          steps(
            takeFromCard,
            send(LobbyMessage.RequestedStartFromLobby()),
            throughIntro,
          ),
        )
        expect(ownRun.runStart.runPool).toEqual(['NapkinRing'])
        expect(houseOf(ownRun)).toEqual(houseOf(friendRun))
        expect(ownRun.elapsedMs).toBe(friendRun.elapsedMs)
        expect(ownRun.rngState).toBe(friendRun.rngState)
      }),
  )
})

describe('the end card', () => {
  const taken = (model: Model): Model =>
    UiStruct.evolve(model, {
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
    const munched = UiStruct.evolve(taken(readyModel), {
      phase: () => Phase.GameOver({ wave: 2 }),
    })
    expect(
      Option.map(maybeBeatComparisonOf(munched), ({ verdict }) => verdict),
    ).toEqual(Option.some('NotYet'))
  })

  it('an escape BEATS IT', () => {
    const escaped = UiStruct.evolve(taken(readyModel), {
      phase: () => Phase.Escaped({ wave: 3 }),
    })
    expect(
      Option.map(maybeBeatComparisonOf(escaped), ({ verdict }) => verdict),
    ).toEqual(Option.some('BeatIt'))
  })

  it('a run that is no dare compares nothing', () => {
    expect(
      maybeBeatComparisonOf(
        UiStruct.evolve(readyModel, {
          phase: () => Phase.GameOver({ wave: 9 }),
        }),
      ),
    ).toEqual(Option.none())
  })
})
