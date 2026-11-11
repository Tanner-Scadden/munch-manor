import { Scene } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, it } from '@effect/vitest'

import { Message } from '../../../app/message'
import type { Model } from '../../../app/model'
import { roomsOf } from '../../../domain/run'
import { fighting, withDareThings, withKeys } from '../../../test/model.fixture'
import {
  APPLICATION,
  SCENE_SUBSCRIPTIONS,
  measureSurface,
} from '../../../test/testing'
import { DareThingState } from '../../../world/dare/dareSchema'
import { levelOf, openExitIn } from '../../../world/level/arena'
import { KITCHEN_EXIT } from '../../../world/level/exits'
import { pause } from '../../../world/waves/waves'

// The pause screen's progress (src/features/menus/pauseProgress.ts): the
// dare's things found and not, the hat last, the keys held, and the rooms
// opened, read the same with keyboard and touch, in landscape and portrait.

const onTheHunt = (device: Model['lastDevice']): Model =>
  withKeys(
    modifyFields(
      withDareThings(fighting, [
        {
          id: 0,
          kind: 'SilverSpoon',
          isAsked: true,
          state: DareThingState.Found({ slot: 0 }),
        },
        {
          id: 1,
          kind: 'MusicBox',
          isAsked: true,
          state: DareThingState.Hidden({ x: 40, y: 40 }),
        },
      ]),
      {
        lastDevice: () => device,
        level: level => openExitIn(level, KITCHEN_EXIT),
      },
    ),
    4,
  )

const progress = Scene.role('group', { name: 'Progress' })
const thing = (name: string) => Scene.role('listitem', { name })

const ROOMS = roomsOf(levelOf(onTheHunt('KeyboardMouse')))

describe('the pause screen shows the run so far', () => {
  it.effect(
    'Esc shows each thing found or not, the hat last, the keys, and the rooms',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(onTheHunt('KeyboardMouse')),
        measureSurface,
        Scene.expect(progress).toBeAbsent(),
        Scene.Subscription.emit(
          SCENE_SUBSCRIPTIONS.keyboard,
          Message.PressedKey({ code: 'Escape' }),
        ),
        Scene.inside(
          Scene.role('list', { name: 'The dare' }),
          Scene.expectAll(Scene.all.role('listitem')).toHaveCount(3),
          Scene.expect(thing('Silver Spoon: found')).toExist(),
          Scene.expect(thing('Music Box: not found')).toExist(),
          Scene.expect(thing("Uncle Chunk's Party Hat: not found")).toExist(),
          Scene.expect(
            Scene.selector('[data-found="true"] .pause-thing-check'),
          ).toExist(),
          Scene.expect(
            Scene.selector('[data-found="false"] .pause-thing-check'),
          ).toBeAbsent(),
        ),
        Scene.expect(thing('4 skeleton keys')).toExist(),
        Scene.expect(
          thing(`${ROOMS.found} of ${ROOMS.total} rooms open`),
        ).toExist(),
        Scene.Subscription.emit(
          SCENE_SUBSCRIPTIONS.keyboard,
          Message.PressedKey({ code: 'Escape' }),
        ),
        Scene.expect(progress).toBeAbsent(),
      ),
  )

  it.effect.each(['Landscape', 'Portrait'] as const)(
    'on a phone in %s it shows the same list',
    orientation =>
      Scene.scene(
        APPLICATION,
        Scene.given(
          pause(
            modifyFields(onTheHunt('Touch'), {
              orientation: () => orientation,
            }),
          ),
        ),
        measureSurface,
        Scene.expect(progress).toExist(),
        Scene.expect(thing('Silver Spoon: found')).toExist(),
        Scene.expect(thing('Music Box: not found')).toExist(),
        Scene.expect(thing('4 skeleton keys')).toExist(),
      ),
  )

  it.effect(
    'a run with no list, as in Endless, shows only the keys and rooms',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(pause(withKeys(fighting, 1))),
        measureSurface,
        Scene.expect(progress).toExist(),
        Scene.expect(Scene.role('list', { name: 'The dare' })).toBeAbsent(),
        Scene.expect(thing('1 skeleton key')).toExist(),
        Scene.expectAll(Scene.all.selector('.pause-tally')).toHaveCount(2),
      ),
  )
})
