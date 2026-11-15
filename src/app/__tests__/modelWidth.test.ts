import { Record } from 'effect'
import { describe, expect, test } from 'vitest'

import { World } from '../../world/schema/worldSchema'
import { Model, initialModel } from '../model'

// NOTE: V8 and JavaScriptCore copy an object of more than 128 properties
// about 17 times slower than one of 128 or fewer (about 4 us against 0.2 us
// at 164 fields), and the frame copies the Model and the World with
// `{ ...model }` many times over. A new client field joins one of the
// Model's groups (`settings`, `cosmetics`, `saving`, ...) rather than its
// top level once the Model is near the limit (AGENTS.md "Keep the frame
// cheap").
const MOST_FIELDS = 128

describe('the Model and the World stay narrow enough to copy fast', () => {
  test('the Model has at most 128 fields', () => {
    expect(Record.keys(Model.fields).length).toBeLessThanOrEqual(MOST_FIELDS)
  })

  test('a fresh Model has at most 128 fields', () => {
    expect(Record.keys(initialModel).length).toBeLessThanOrEqual(MOST_FIELDS)
  })

  test('the World has at most 128 fields', () => {
    expect(Record.keys(World.fields).length).toBeLessThanOrEqual(MOST_FIELDS)
  })
})
