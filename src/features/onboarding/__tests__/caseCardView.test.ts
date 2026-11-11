import { describe, expect, test } from 'vitest'

import { Feat } from '../../../world/schema/worldSchema'
import { featLabelOf } from '../caseCardView'

describe('featLabelOf', () => {
  test('says the deed in a few words, with the count', () => {
    expect(featLabelOf(Feat.Kills({ count: 1 }))).toBe('1 KILL')
    expect(featLabelOf(Feat.Kills({ count: 12 }))).toBe('12 KILLS')
    expect(featLabelOf(Feat.KillsWith({ armament: 'Knife', count: 3 }))).toBe(
      '3 KILLS WITH KNIFE',
    )
    expect(featLabelOf(Feat.NoHitWave({ count: 1 }))).toBe('1 WAVE NO HITS')
    expect(featLabelOf(Feat.OpenedRoom({ count: 2 }))).toBe('OPEN 2 ROOMS')
    expect(featLabelOf(Feat.LitFire())).toBe('LIGHT THE FIRE')
  })
})
