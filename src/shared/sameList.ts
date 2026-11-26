import { Function } from 'effect'

const isSameList = <A>(
  current: ReadonlyArray<A>,
  next: ReadonlyArray<A>,
): boolean => {
  if (current.length !== next.length) {
    return false
  }
  for (let index = 0; index < next.length; index++) {
    if (!Object.is(current[index], next[index])) {
      return false
    }
  }
  return true
}

export const sameIfUnchanged: {
  <L extends ReadonlyArray<unknown>>(next: L): (current: L) => L
  <L extends ReadonlyArray<unknown>>(current: L, next: L): L
} = Function.dual(
  2,
  <L extends ReadonlyArray<unknown>>(current: L, next: L): L =>
    isSameList(current, next) ? current : next,
)

export const appendOrSame: {
  <A>(more: ReadonlyArray<A>): (list: ReadonlyArray<A>) => ReadonlyArray<A>
  <A>(list: ReadonlyArray<A>, more: ReadonlyArray<A>): ReadonlyArray<A>
} = Function.dual(
  2,
  <A>(list: ReadonlyArray<A>, more: ReadonlyArray<A>): ReadonlyArray<A> =>
    more.length === 0 ? list : [...list, ...more],
)

export const emptied = <A>(list: ReadonlyArray<A>): ReadonlyArray<A> =>
  list.length === 0 ? list : []
