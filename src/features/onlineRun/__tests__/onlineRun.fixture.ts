import { modifyFields } from 'foldkit/struct'

import { Lesson, type Model } from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { asVeteran } from '../../../test/veteran'
import {
  DEFAULT_ROOM_SETTINGS,
  pastArrival,
  startRoomWorld,
} from '../../../world/net/roomWorld'

// What this folder's online run tests start from: a veteran past the open
// break lesson, and a two seat room's World past its intro, this player in
// slot 1.

export const OWN_SLOT = 1

export const graduated: Model = modifyFields(asVeteran(initialModel), {
  lessons: lessons =>
    modifyFields(lessons, { openBreak: () => Lesson.Learned({ atMs: 0 }) }),
})

export const roomWorld = pastArrival(
  startRoomWorld([0, OWN_SLOT], 7, DEFAULT_ROOM_SETTINGS),
)
