import { Option } from 'effect'
import { describe, expect, it } from 'vitest'

import { problemOf } from './folderRules'

// NOTE: AGENTS.md "Folders": where a file of src may sit.
describe('a file in src', () => {
  it('is fine in its folder, and a test in __tests__/ beside it', () => {
    expect(Option.isNone(problemOf('world/step/firing.ts'))).toBe(true)
    expect(
      Option.isNone(problemOf('world/step/__tests__/contact.story.test.ts')),
    ).toBe(true)
    expect(
      Option.isNone(problemOf('world/zombies/__tests__/boss.fixture.ts')),
    ).toBe(true)
    expect(Option.isNone(problemOf('test/model.fixture.ts'))).toBe(true)
    expect(Option.isNone(problemOf('features/shop/shop.css'))).toBe(true)
    expect(Option.isNone(problemOf('vite-env.d.ts'))).toBe(true)
  })

  it('fails straight in src or in a folder that is not a layer', () => {
    expect(Option.isSome(problemOf('firing.ts'))).toBe(true)
    expect(Option.isSome(problemOf('update/shop.ts'))).toBe(true)
  })

  it('fails as a test or fixture outside __tests__/', () => {
    expect(Option.isSome(problemOf('world/step/contact.story.test.ts'))).toBe(
      true,
    )
    expect(Option.isSome(problemOf('features/shop/shop.fixture.ts'))).toBe(true)
    expect(
      Option.isSome(problemOf('world/__tests__/step/contact.story.test.ts')),
    ).toBe(true)
  })

  it('fails as a module in __tests__/', () => {
    expect(Option.isSome(problemOf('features/shop/__tests__/helpers.ts'))).toBe(
      true,
    )
  })
})
