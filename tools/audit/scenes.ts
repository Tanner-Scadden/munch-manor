// NOTE: harness queries the shot scripts share (see harness/config.ts for
// what each part means).

// NOTE: every lesson learned, so no hint covers the picture.
export const LEARNED =
  'learned=move,fire,startWave,swap,pickup,timedBreaks,openBreak,dareTour,dareKey'

// NOTE: the break before wave 3, the kitchen open, $200, and the SMG.
export const BREAK = `wave=3&seen=all&kitchen&money=200&gun=smg&prep=14000&${LEARNED}`

// NOTE: 9 s into wave 4, standing in the kitchen.
export const IN_KITCHEN = `wave=4&seen=all&start=wave&elapsed=9000&kitchen&god&px=40&py=-12&${LEARNED}`

// NOTE: 9 s into wave 4 in the parlour.
export const FIGHTING = `wave=4&seen=all&start=wave&elapsed=9000&god&${LEARNED}`
