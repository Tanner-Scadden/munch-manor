import { Array, Record } from 'effect'
import { describe, expect, test } from 'vitest'

import { soundCases } from '../../audio/message'
import { endCases } from '../../features/end/message'
import { homeCases } from '../../features/home/message'
import { helpCases } from '../../features/menus/message'
import { onboardingCases } from '../../features/onboarding/message'
import { whatsNewCases } from '../../features/whatsNew/message'
import { inputCases, runButtonCases } from '../../input/message'
import {
  analyticsCases,
  deviceCases,
  installCases,
  loadCases,
  pageCases,
  saveCases,
  versionCases,
} from '../../platform/message'
import { Message, frameCases } from '../message'

const GROUPS = [
  frameCases,
  inputCases,
  runButtonCases,
  pageCases,
  versionCases,
  deviceCases,
  installCases,
  loadCases,
  saveCases,
  analyticsCases,
  soundCases,
  homeCases,
  helpCases,
  whatsNewCases,
  endCases,
  onboardingCases,
]

const tagsOf = (group: object): ReadonlyArray<string> => Record.keys(group)

describe("the root's Message union", () => {
  // NOTE: the root union spreads its groups into one record, where a tag
  // two groups both name would silently keep only the last.
  test('no two groups name the same tag', () => {
    const tags = Array.flatMap(GROUPS, tagsOf)
    expect(Array.dedupe(tags)).toEqual(tags)
  })

  test('is exactly its groups, joined', () => {
    const tags = Array.flatMap(GROUPS, tagsOf)
    expect(Message.ast.types).toHaveLength(tags.length)
  })
})
