import { Function } from 'effect'

// NOTE: a step that writes a list it rebuilt (mapped, partitioned, emptied,
// appended to) hands `modifyFields` a new array even when every element is
// the one it had, and `modifyFields` then copies the whole World or Model
// for nothing. These keep the list's own reference when nothing in it
// changed, so the copy is skipped and the steps after see identity.

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

// NOTE: `next`, or `current` itself when `next` holds exactly its elements
// in its order. It stops at the first element that differs, so a list of
// moving bodies costs one comparison.
export const sameIfUnchanged: {
  <L extends ReadonlyArray<unknown>>(next: L): (current: L) => L
  <L extends ReadonlyArray<unknown>>(current: L, next: L): L
} = Function.dual(
  2,
  <L extends ReadonlyArray<unknown>>(current: L, next: L): L =>
    isSameList(current, next) ? current : next,
)

// NOTE: `list` with `more` after it, or `list` itself when there is no more.
export const appendOrSame: {
  <A>(more: ReadonlyArray<A>): (list: ReadonlyArray<A>) => ReadonlyArray<A>
  <A>(list: ReadonlyArray<A>, more: ReadonlyArray<A>): ReadonlyArray<A>
} = Function.dual(
  2,
  <A>(list: ReadonlyArray<A>, more: ReadonlyArray<A>): ReadonlyArray<A> =>
    more.length === 0 ? list : [...list, ...more],
)

// NOTE: an empty list, `list` itself when it is empty already.
export const emptied = <A>(list: ReadonlyArray<A>): ReadonlyArray<A> =>
  list.length === 0 ? list : []
