import { Array, Record } from 'effect'
import { describe, expect, test } from 'vitest'

import { soundCases } from '../../audio/message'
import { coopCases } from '../../features/coop/message'
import { endCases } from '../../features/end/message'
import { homeCases } from '../../features/home/message'
import { lobbyCases } from '../../features/lobby/message'
import { helpCases } from '../../features/menus/message'
import { missionCases } from '../../features/missions/message'
import { onboardingCases } from '../../features/onboarding/message'
import { profileCases } from '../../features/profile/message'
import { whatsNewCases } from '../../features/whatsNew/message'
import { inputCases, runButtonCases } from '../../input/message'
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
} from '../../platform/message'
import { Message, dialogCases, frameCases } from '../message'

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
