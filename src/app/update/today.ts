import { Option } from 'effect'

import { defineHandlers } from './step'

export const todayHandlers = defineHandlers({
  ChangedToday: ($, { day }) => $.evolve({ maybeToday: Option.some(day) }),
})
