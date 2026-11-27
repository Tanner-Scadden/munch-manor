import { Effect } from 'effect'

import { UiStruct } from '@effect/ui'
import { HtmlLocator } from '@effect/ui/html/testing'
import { Locator } from '@effect/ui/testing'
import { describe, it } from '@effect/vitest'

import { Arsenal, type Model } from '#app/model.ts'
import { roomsOf } from '#domain/run.ts'
import { gunAt } from '#test/arsenals.ts'
import { fighting, withDareThings, withKeys } from '#test/model.fixture.ts'
import {
  ackHudSlots,
  byClass,
  emitPressedKey,
  measureHud,
  measureSurface,
  pausePressRuns,
} from '#test/sceneTesting.ts'
import { sceneOf } from '#test/testing.ts'
import { DareThingState } from '#world/dare/dareSchema.ts'
import { levelOf, openExitIn } from '#world/level/arena.ts'
import { KITCHEN_EXIT } from '#world/level/exits.ts'
import { modifyFocus } from '#world/party/party.ts'
import { pause } from '#world/waves/waves.ts'

const onTheHunt = (device: Model['lastDevice']): Model =>
  withKeys(
    UiStruct.evolve(
      withDareThings(fighting, [
        {
          id: 0,
          kind: 'SilverSpoon',
          state: DareThingState.Found({ slot: 0 }),
        },
        {
          id: 1,
          kind: 'MusicBox',
          state: DareThingState.Hidden({ x: 40, y: 40, workedMs: 0 }),
        },
      ]),
      {
        lastDevice: () => device,
        level: level => openExitIn(level, KITCHEN_EXIT),
      },
    ),
    4,
  )

const progress = HtmlLocator.role('group', { name: 'Progress' })
const thing = (name: string) => HtmlLocator.role('listitem', { name })
const dareList = HtmlLocator.role('list', { name: 'The dare' })
const gunList = HtmlLocator.role('list', { name: 'Your guns' })
const inDare = (locator: Locator.Locator) => Locator.inside(dareList, locator)
const inGuns = (locator: Locator.Locator) => Locator.inside(gunList, locator)
const checkFor = (isFound: boolean) =>
  Locator.inside(
    Locator.attr('data-found', isFound ? 'true' : 'false'),
    byClass('pause-thing-check'),
  )

const ROOMS = roomsOf(levelOf(onTheHunt('KeyboardMouse')))

describe('the pause screen shows the run so far', () => {
  it.effect('Esc shows each thing found or not, the keys, and the rooms', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(onTheHunt('KeyboardMouse'))
      s.pipe(measureHud)
        .expect(progress)
        .toBeAbsent()
        .pipe(emitPressedKey('Escape'), pausePressRuns)
        .expect(inDare(HtmlLocator.role('listitem')))
        .toHaveCount(2)
        .expect(inDare(thing('Silver Spoon: found')))
        .toExist()
        .expect(inDare(thing('Music Box: not found')))
        .toExist()
        .expect(inDare(checkFor(true)))
        .toExist()
        .expect(inDare(checkFor(false)))
        .toBeAbsent()
        .expect(thing('4 skeleton keys'))
        .toExist()
        .expect(thing(`${ROOMS.found} of ${ROOMS.total} rooms open`))
        .toExist()
        .pipe(emitPressedKey('Escape'), ackHudSlots)
        .expect(progress)
        .toBeAbsent()
    }),
  )

  it.effect.each(['Landscape', 'Portrait'] as const)(
    'on a phone in %s it shows the same list',
    orientation =>
      Effect.gen(function* () {
        const s = yield* sceneOf(
          pause(
            UiStruct.evolve(onTheHunt('Touch'), {
              orientation: () => orientation,
            }),
          ),
        )
        s.pipe(measureSurface, pausePressRuns)
          .expect(progress)
          .toExist()
          .expect(thing('Silver Spoon: found'))
          .toExist()
          .expect(thing('Music Box: not found'))
          .toExist()
          .expect(thing('4 skeleton keys'))
          .toExist()
      }),
  )

  it.effect(
    'a run with no list, as in Endless, shows only the keys and rooms',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(pause(withKeys(fighting, 1)))
        s.pipe(measureSurface, pausePressRuns)
          .expect(progress)
          .toExist()
          .expect(dareList)
          .toBeAbsent()
          .expect(thing('1 skeleton key'))
          .toExist()
          .expect(byClass('pause-tally'))
          .toHaveCount(2)
      }),
  )

  it.effect(
    'each gun carried shows its name, tier, and kills toward the next level',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(
          pause(
            modifyFocus(fighting, {
              player: player =>
                UiStruct.evolve(player, {
                  arsenal: () =>
                    Arsenal.HoldingSecond({
                      first: gunAt('Pistol', 3, 260),
                      second: gunAt('Smg', 1, 70),
                    }),
                }),
            }),
          ),
        )
        s.pipe(measureSurface, pausePressRuns)
          .expect(inGuns(HtmlLocator.role('listitem')))
          .toHaveCount(2)
          .expect(
            inGuns(
              thing('Beefy Chatterbox: 70 of 120 kills to the next level'),
            ),
          )
          .toExist()
          .expect(
            inGuns(
              Locator.inside(
                Locator.attr('data-maxed', 'true'),
                byClass('pause-gun-fill'),
              ),
            ),
          )
          .toExist()
      }),
  )
})
