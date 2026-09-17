/**
 * The one failure type the real provider raises on purpose.
 *
 * Every call on the port may fail — it goes over a network to a model that can
 * be down, rate-limited, slow, or simply wrong about the format it was asked
 * for — and the domain treats all of that as ordinary (it has a line to fall
 * back on, a retry, or a silence). What the domain cannot do is tell the user
 * *why*, so the reason is carried here, in a message a person can act on:
 * which call, what came back, and what the model was supposed to produce.
 *
 * It is thrown rather than returned because throwing is what the port already
 * promises its implementations may do, and because every caller already has to
 * survive it.
 *
 * @module ai/errors
 */

/** A call to a model failed, and here is what to say about it. */
export class ProviderCallError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = 'ProviderCallError';
  }
}

/** How much of a bad answer is quoted back inside an error message. */
export const SNIPPET_CHARACTERS = 180;

/**
 * One line of what came back, short enough to read in a log.
 *
 * Shared by everything that reports a failure, because the point of quoting the
 * model at all is that someone can recognize what went wrong — a message with
 * half a page of raw output in it is one nobody reads, and one that quotes
 * nothing is one nobody can act on.
 *
 * @param text - whatever came back.
 * @param limit - how many characters to keep.
 * @returns the text on one line, truncated with an ellipsis when it was long.
 */
export function shorten(text: string, limit = SNIPPET_CHARACTERS): string {
  const flat = text.replace(/\s+/gu, ' ').trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit)}…`;
}

/**
 * Whether a rejected `fetch` was this call's own timeout.
 *
 * Both names are real and both mean the call is over: `AbortSignal.timeout`
 * makes `fetch` reject with a `TimeoutError`, and an abort of any other kind
 * arrives as `AbortError`. Shared by the two callers that talk over HTTP — the
 * chat half and the cloud embedding — because a timeout reported as a
 * mysterious network failure is the same puzzle twice.
 *
 * @param error - whatever `fetch` rejected with.
 * @returns whether the call ran out of time.
 */
export function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}
