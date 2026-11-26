export const cacheEntries = async (prefix: string) => {
  const names = (await caches.keys()).filter(name => name.startsWith(prefix))
  const entriesOf = async (name: string) => ({
    name,
    entries: (await (await caches.open(name)).keys()).length,
  })
  return Promise.all(names.map(entriesOf))
}

export const workerStateOf = async () => {
  if (!('serviceWorker' in navigator)) {
    return { support: false }
  }
  const registration = await navigator.serviceWorker.getRegistration()
  return {
    support: true,
    registered: registration !== undefined,
    installing: registration?.installing?.state ?? null,
    waiting: registration?.waiting?.state ?? null,
    active: registration?.active?.state ?? null,
  }
}

export const scriptSources = () =>
  globalThis.Array.from(document.querySelectorAll('script[src]'), script =>
    script.getAttribute('src'),
  ).join(' ')

export const framesWithin = (duration: number) =>
  new Promise<number>(done => {
    const start = performance.now()
    let frames = 0
    const step = (now: number) => {
      frames += 1
      if (now - start < duration) {
        requestAnimationFrame(step)
      } else {
        done(frames)
      }
    }
    requestAnimationFrame(step)
  })

export const fetchVersion = () =>
  fetch(`version.json?at=${Date.now()}`, { cache: 'no-store' }).then(
    () => 'answered',
    () => 'failed',
  )
