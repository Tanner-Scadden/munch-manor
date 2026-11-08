import { Struct } from 'effect'
import { describe, expect, test } from 'vitest'

import { Screen, screenInRoom } from '../../../domain/coopRoom'
import { freshRoom } from '../../../features/coop/roomState'

describe('values built without validating', () => {
  test('Screen.InRoom from screenInRoom matches the validating constructor', () => {
    const room = freshRoom('ABCDE', 2)
    const built = screenInRoom(room)
    const validated = Screen.InRoom({ room })
    expect(built).toStrictEqual(validated)
    expect(Struct.keys(built)).toStrictEqual(Struct.keys(validated))
  })
})
