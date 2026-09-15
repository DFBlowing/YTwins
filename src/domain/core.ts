/**
 * The domain core.
 *
 * Holds the interface declared in `interface.ts` and everything behind it.
 * Its internal split — parsing, distillation, surfacing, scheduling, recall,
 * parent-voice enforcement — is *not* a seam: tests never reach through it.
 *
 * Ticket 01 gives it one operation — recording a **drop** — and that operation
 * fixes the shape the whole product rests on: **extraction is asynchronous to
 * recording**. The original text is stored and the user is answered before any
 * AI call settles, so a slow or broken provider costs the user nothing.
 *
 * @module domain/core
 */

import type { AiProvider } from './ai-provider.ts';
import type { Domain, DropResult, DropSummary } from './interface.ts';
import type { DropStore } from './storage.ts';

/**
 * The reply used when no provider could answer.
 *
 * A drop must never be silent, and a provider failure must never surface as the
 * user's problem. This is the plain acknowledgement that the drop was caught.
 */
const RECORDED_REPLY = '接住了。';

/** What the core needs to run. */
export interface DomainCoreOptions {
  /** Where drops are persisted. */
  readonly store: DropStore;
  /**
   * The AI provider port. Optional: the product must work before any provider
   * is configured, and ticket 01's tests drive both with and without one.
   */
  readonly provider?: AiProvider;
}

/**
 * Build the domain core.
 *
 * @param options - the store, and optionally an AI provider.
 * @returns the domain interface.
 */
export function createDomain(options: DomainCoreOptions): Domain {
  const { store, provider } = options;

  return {
    async drop(body: string): Promise<DropResult> {
      // Record first. The faithful original is what makes the drop a success,
      // and it is the only thing the user is promised.
      const stored = await store.appendDrop(body);

      // Ask the provider to answer, but do *not* await it. This is the decision
      // the whole product is shaped around: a drop returns in the time it takes
      // to write one row, so a provider that is slow, down, or still thinking
      // cannot delay the user.
      //
      // The provider is called through `Promise.resolve().then(...)` rather than
      // directly, because a port implementation is allowed to throw
      // synchronously — and a bare call would then throw past this method and
      // reject a drop that had already succeeded. Routing the call through a
      // promise makes the synchronous and asynchronous failure shapes identical.
      //
      // The reply handed back here is therefore always the plain
      // acknowledgement. Composing a *styled* reply the user actually sees is
      // ticket 03's job, and it will surface that reply by updating the drop
      // once the provider answers — not by blocking this call. Until then the
      // outcome is observed only so that no rejection goes unhandled.
      if (provider !== undefined) {
        Promise.resolve()
          .then(() => provider.respond({ body }))
          .catch(() => {
            // Expected when the provider is down or refuses. The drop already
            // succeeded, so there is nothing to report and nothing to undo.
          });
      }

      return { body: stored.body, reply: RECORDED_REPLY };
    },

    async listDrops(): Promise<readonly DropSummary[]> {
      return store.listDrops();
    },
  };
}
