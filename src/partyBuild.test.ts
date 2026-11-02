import { describe, expect, test } from 'vitest'

import { Screen, screenInRoom } from './coop/model'
import { freshRoom } from './coop/roomState'

describe('values built without validating', () => {
  test('Screen.InRoom from screenInRoom matches the validating constructor', () => {
    const room = freshRoom('ABCDE', 2)
    const built = screenInRoom(room)
    const validated = Screen.InRoom({ room })
    expect(built).toStrictEqual(validated)
    expect(Object.keys(built)).toStrictEqual(Object.keys(validated))
  })
})
