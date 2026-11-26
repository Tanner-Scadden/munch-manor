import { UiStruct } from '@effect/ui'

import { Lesson, type Model } from '#app/model.ts'
import { initialModel } from '#app/pureApp.ts'
import { byClass, withAttrs } from '#test/sceneTesting.ts'
import { asVeteran } from '#test/veteran.ts'
import {
  DEFAULT_ROOM_SETTINGS,
  pastArrival,
  startRoomWorld,
} from '#world/net/roomWorld.ts'

export const OWN_SLOT = 1

export const graduated: Model = UiStruct.evolve(asVeteran(initialModel), {
  lessons: lessons =>
    UiStruct.evolve(lessons, { openBreak: () => Lesson.Learned({ atMs: 0 }) }),
})

export const roomWorld = pastArrival(
  startRoomWorld([0, OWN_SLOT], 7, DEFAULT_ROOM_SETTINGS),
)

export const coopScreen = (screen: string) =>
  withAttrs({ 'data-screen': screen })(byClass('coop'))
