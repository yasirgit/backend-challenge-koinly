/**
 * Anything can be thrown in JavaScript, and libraries take advantage of that. This normalizes the
 * `unknown` at a catch site into something with a stack, so a failure is diagnosable rather than
 * logged as `[object Object]`.
 */
export const toError = (value: unknown): Error => {
  if (value instanceof Error) {
    return value;
  }
  if (typeof value === 'string') {
    return new Error(value);
  }
  return new Error(JSON.stringify(value) ?? 'Unknown error');
};

export const formatError = (value: unknown): string => {
  const error = toError(value);
  return error.stack ?? error.message;
};
