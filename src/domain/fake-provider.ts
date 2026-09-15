/**
 * The scripted fake AI provider.
 *
 * The domain's tests are deterministic because this implementation returns
 * whatever the test pre-set, keyed by the input it is asked about — no network,
 * no model, no timing luck. It can also be scripted to be slow or to fail,
 * which is how the "a drop survives a broken provider" behaviour is asserted.
 *
 * This is a test double, but it lives beside the domain rather than inside the
 * test file because later tickets drive their tests through it too.
 *
 * @module domain/fake-provider
 */

import type { AiProvider, RespondRequest, RespondResult } from './ai-provider.ts';

/** What the fake should do for one input. */
export type RespondScript =
  /** Answer with this exact text. */
  | { readonly kind: 'reply'; readonly reply: string }
  /** Never settle — models an extraction that is still running. */
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

/** Configure the fake: a default, plus per-body overrides. */
export interface FakeProviderScript {
  readonly fallback?: RespondScript;
  readonly byBody?: Readonly<Record<string, RespondScript>>;
}

/** A handle on the fake, so tests can observe what it was asked. */
export interface FakeProvider extends AiProvider {
  /** Every body the domain sent, in order. */
  readonly seen: readonly string[];
}

function run(script: RespondScript | undefined, body: string): Promise<RespondResult> {
  switch (script?.kind) {
    case 'reply':
      return Promise.resolve({ reply: script.reply });
    case 'fail':
      return Promise.reject(new Error(script.reason));
    case 'throw':
      // Deliberately synchronous: this throw happens before any promise exists.
      throw new Error(script.reason);
    case 'hang':
      return new Promise<RespondResult>(() => {});
    default:
      // Unscripted input still gets an answer: the fake's job is to be
      // deterministic, not to model every real-world case.
      return Promise.resolve({ reply: `接住了：${body}` });
  }
}

/**
 * Build a fake provider.
 *
 * @param script - the default behaviour and any per-body overrides.
 * @returns the provider, plus the log of what it was asked.
 */
export function createFakeProvider(script: FakeProviderScript = {}): FakeProvider {
  const seen: string[] = [];
  return {
    seen,
    // Deliberately NOT `async`. An `async` method would turn the `throw` script
    // into a rejected promise, and the whole point of that script is to hand the
    // domain a genuinely synchronous throw — the shape that a naive
    // `provider.respond(...).catch(...)` in the caller would not survive.
    respond(request: RespondRequest): Promise<RespondResult> {
      seen.push(request.body);
      const chosen = script.byBody?.[request.body] ?? script.fallback;
      return run(chosen, request.body);
    },
  };
}
