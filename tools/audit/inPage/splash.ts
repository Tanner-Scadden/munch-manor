export const watchSplash = () => {
  const times: Record<string, number> = {}
  const longTasks: Array<[number, number]> = []
  window.__splashTimes = times
  window.__longTasks = longTasks
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) {
      longTasks.push([entry.startTime, entry.duration])
    }
  }).observe({ type: 'longtask', buffered: true })
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) {
      if (entry.name.startsWith('load:')) {
        times[entry.name] ??= entry.startTime
      }
    }
  }).observe({ type: 'mark', buffered: true })
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) {
      times[entry.name] ??= entry.startTime
    }
  }).observe({ type: 'paint', buffered: true })
  new MutationObserver(() => {
    const splash = document.getElementById('splash')
    if (splash !== null) {
      times['splash in DOM'] ??= performance.now()
      const share = splash.style.getPropertyValue('--splash-progress')
      if (share !== '') {
        times[`bar at ${Math.round(Number(share) * 100)}%`] ??=
          performance.now()
      }
    }
    if (splash?.classList.contains('is-gone') === true) {
      times['splash hiding'] ??= performance.now()
    }
    if (splash === null && times['splash in DOM'] !== undefined) {
      times['splash removed'] ??= performance.now()
    }
    if (document.querySelector('.world-view') !== null) {
      times['game canvas'] ??= performance.now()
    }
  }).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
  })
}
