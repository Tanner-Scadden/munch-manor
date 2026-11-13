import { Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { defineHandlers } from './step'

// Today's day in UTC, kept on the Model as it arrives (src/platform/today.ts):
// the end of a run reads it for the day's first run paying double Bones
// (src/features/end/rankRun.ts), and a daily reward after it can too. Until
// the first one arrives nothing pays by the day.

export const todayHandlers = defineHandlers({
  ChangedToday: (model, { day }) => ({
    model: modifyFields(model, { maybeToday: () => Option.some(day) }),
  }),
})
