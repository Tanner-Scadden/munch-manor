import { Array, Record } from 'effect'
import { describe, expect, test } from 'vitest'

import { Message, dialogCases, frameCases } from '#app/message.ts'
import { soundCases } from '#audio/message.ts'
import { coopCases } from '#features/coop/message.ts'
import { endCases } from '#features/end/message.ts'
import { homeCases } from '#features/home/message.ts'
import { lobbyCases } from '#features/lobby/message.ts'
import { helpCases } from '#features/menus/message.ts'
import { missionCases } from '#features/missions/message.ts'
import { onboardingCases } from '#features/onboarding/message.ts'
import { profileCases } from '#features/profile/message.ts'
import { whatsNewCases } from '#features/whatsNew/message.ts'
import { inputCases, runButtonCases } from '#input/message.ts'
import {
  analyticsCases,
  dayCases,
  deviceCases,
  installCases,
  loadCases,
  pageCases,
  recordingCases,
  saveCases,
  versionCases,
} from '#platform/message.ts'

const GROUPS = [
  frameCases,
  dialogCases,
  inputCases,
  runButtonCases,
  pageCases,
  versionCases,
  deviceCases,
  installCases,
  loadCases,
  saveCases,
  analyticsCases,
  dayCases,
  recordingCases,
  soundCases,
  homeCases,
  helpCases,
  whatsNewCases,
  endCases,
  onboardingCases,
  profileCases,
  missionCases,
  lobbyCases,
  coopCases,
]

const tagsOf = (group: object): ReadonlyArray<string> => Record.keys(group)

describe("the root's Message union", () => {
  test('no two groups name the same tag', () => {
    const tags = Array.flatMap(GROUPS, tagsOf)
    expect(Array.dedupe(tags)).toEqual(tags)
  })

  test('is exactly its groups, joined', () => {
    const tags = Array.flatMap(GROUPS, tagsOf)
    expect(Message.ast.types).toHaveLength(tags.length)
  })
})
