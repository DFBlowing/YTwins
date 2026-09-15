/**
 * The scripted fake AI provider.
 *
 * The domain's tests are deterministic because this implementation returns
 * whatever the test pre-set, keyed by the input it is asked about — no network,
 * no model, no timing luck. It can also be scripted to be slow or to fail,
 * which is how "a drop survives a broken provider" is asserted.
 *
 * This is a test double, but it lives beside the domain rather than inside the
 * test file because later tickets drive their tests through it too. Ticket 02
 * widens it from one operation to two: a drop is both answered and read.
 *
 * @module domain/fake-provider
 */

import type {
  AiProvider,
  ExtractResult,
  RespondRequest,
  RespondResult,
} from './ai-provider.ts';
import type { InputType } from './interface.ts';

/**
 * How a scripted call fails or stalls.
 *
 * Shared by both operations, because the domain's tolerance for a broken
 * provider is the same for both and the tests should not be able to prove it
 * for one and not the other.
 */
export type FailureScript =
  /** Never settle — models a call that is still running. */
  | { readonly kind: 'hang' }
  /** Reject — models a provider that is down or refuses. */
  | { readonly kind: 'fail'; readonly reason: string }
  /**
   * Throw *synchronously* before returning any promise — models a provider that
   * blows up while setting up (bad credentials, a missing SDK, a thrown
   * constructor). Distinct from `fail` on purpose: a caller that only guards
   * against rejected promises still dies on this shape.
   */
  | { readonly kind: 'throw'; readonly reason: string };

/** What the fake should do for one input, when answering. */
export type RespondScript = FailureScript | { readonly kind: 'reply'; readonly reply: string };

/** What the fake should read out of one input. */
export interface ExtractReading {
  readonly inputType: InputType;
  readonly items: readonly { readonly text: string; readonly dueAt: string | null }[];
}

/** What the fake should do for one input, when reading. */
export type ExtractScript = FailureScript | { readonly kind: 'read'; readonly reading: ExtractReading };

/** Configure the fake: a default, plus per-body overrides. */
export interface FakeProviderScript {
  readonly fallback?: RespondScript;
  readonly byBody?: Readonly<Record<string, RespondScript>>;
  /** What to read out of a drop. Omitting it means every drop reads as empty. */
  readonly extractFallback?: ExtractScript;
  readonly extractByBody?: Readonly<Record<string, ExtractScript>>;
}

/** A handle on the fake, so tests can observe what it was asked. */
export interface FakeProvider extends AiProvider {
  /** Every body the domain asked it to answer, in order. */
  readonly seen: readonly string[];
  /** Every body the domain asked it to read, in order. */
  readonly read: readonly string[];
}

/**
 * What an unscripted drop reads as.
 *
 * Empty items and an `item` type: the fake's job is to be deterministic, not to
 * model every real-world case, and a drop that turns out to contain nothing is
 * the honest default — a test that wants items asks for them explicitly.
 */
const UNSCRIPTED_READING: ExtractReading = { inputType: 'item', items: [] };

function fail(script: FailureScript): never {
  switch (script.kind) {
    case 'fail':
      return Promise.reject(new Error(script.reason)) as never;
    case 'throw':
      // Deliberately synchronous: this throw happens before any promise exists.
      throw new Error(script.reason);
    case 'hang':
      return new Promise<never>(() => {}) as never;
  }
}

function isFailure(script: RespondScript | ExtractScript): script is FailureScript {
  return script.kind !== 'reply' && script.kind !== 'read';
}

function runRespond(script: RespondScript | undefined, body: string): Promise<RespondResult> {
  if (script === undefined) {
    // Unscripted input still gets an answer: the fake's job is to be
    // deterministic, not to model every real-world case.
    return Promise.resolve({ reply: `接住了：${body}` });
  }
  if (isFailure(script)) return fail(script);
  return Promise.resolve({ reply: script.reply });
}

function runExtract(script: ExtractScript | undefined): Promise<ExtractResult> {
  if (script === undefined) return Promise.resolve(UNSCRIPTED_READING);
  if (isFailure(script)) return fail(script);
  return Promise.resolve(script.reading);
}

/**
 * Build a fake provider.
 *
 * @param script - the default behaviour and any per-body overrides.
 * @returns the provider, plus the log of what it was asked.
 */
export function createFakeProvider(script: FakeProviderScript = {}): FakeProvider {
  const seen: string[] = [];
  const read: string[] = [];
  return {
    seen,
    read,
    // Deliberately NOT `async`. An `async` method would turn the `throw` script
    // into a rejected promise, and the whole point of that script is to hand the
    // domain a genuinely synchronous throw — the shape that a naive
    // `provider.respond(...).catch(...)` in the caller would not survive.
    respond(request: RespondRequest): Promise<RespondResult> {
      seen.push(request.body);
      return runRespond(script.byBody?.[request.body] ?? script.fallback, request.body);
    },
    extract(request: RespondRequest): Promise<ExtractResult> {
      read.push(request.body);
      return runExtract(script.extractByBody?.[request.body] ?? script.extractFallback);
    },
  };
}
