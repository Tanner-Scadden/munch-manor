// Tests that tell a dual function's data-first call from its data-last one
// when a parameter is optional, so the count of arguments cannot. Each reads
// one argument's `typeof`, cheap enough for code that runs every frame.

// NOTE: data-first starts with the subject, an object; the data-last form
// starts with something else (a string, a number, a function, or nothing).
export const isObjectFirst = (args: IArguments): boolean =>
  typeof args[0] === 'object'

// NOTE: data-first takes two objects (a Model before and after, say); the
// data-last form takes one, then maybe a string or a number.
export const isObjectSecond = (args: IArguments): boolean =>
  typeof args[1] === 'object'
