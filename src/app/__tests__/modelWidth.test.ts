import { Record } from 'effect'
import { describe, expect, test } from 'vitest'

import { Model, initialModel } from '#app/model.ts'
import { World } from '#world/schema/worldSchema.ts'

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
