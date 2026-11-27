import { Option } from 'effect'

import { defineHandlers } from './step.ts'

export const todayHandlers = defineHandlers({
  ChangedToday: ($, { day }) => $.evolve({ maybeToday: Option.some(day) }),
})
