/**
 * The composition root's one decision: which implementation answers the port.
 *
 * Two are possible, and the difference is the point of the whole port:
 *
 *  - **the real provider** (`src/ai/`) — a cloud or local language model beside
 *    a local or cloud embedding, chosen by configuration. This is what the
 *    product runs, and it is the default.
 *  - **the demo stand-in** (`demo-provider.ts`) — the scripted, preset material
 *    tickets 01–11 ran on. It is kept, but only as something a person asks for
 *    by name (`YTwins_PROVIDER=demo`): a demo that must run on preset data is a
 *    real need, and turning the stand-in into an implicit fallback would make
 *    "the model is not configured" and "the model is a script" look the same
 *    from the outside, which is exactly the confusion this ticket exists to end.
 *
 * It lives here rather than in `src/ai/` because it is the only module that
 * knows both sides exist, and the dependency direction has to stay one way:
 * `src/web/` may import `src/ai/` and `src/domain/`, never the reverse.
 *
 * @module web/provider
 */

import type { AiProvider } from '../domain/ai-provider.ts';
import type { ProviderConfig } from '../ai/config.ts';
import { createRealProvider } from '../ai/real-provider.ts';
import { createDemoProvider } from './demo-provider.ts';

/** The provider to wire up, and what to say about it at startup. */
export interface ConfiguredProvider {
  readonly provider: AiProvider;
  /** One Chinese line each, for the server's log. Never contains a key. */
  readonly notes: readonly string[];
}

/**
 * Build the provider the configuration asks for.
 *
 * @param config - the resolved configuration.
 * @param options - the transport and clock, injected by checks so nothing has to
 *   reach a network or a model to be asserted.
 * @returns the provider, and the notes to log.
 */
export function createConfiguredProvider(
  config: ProviderConfig,
  options: {
    readonly fetch?: typeof globalThis.fetch | undefined;
    readonly now?: (() => Date) | undefined;
  } = {},
): ConfiguredProvider {
  if (config.choice === 'demo') {
    return {
      provider: createDemoProvider(),
      notes: [
        'YTwins_PROVIDER=demo：用的是 01–11 的预置假 provider，回答全部来自写死的素材，不联网、不花 key。',
      ],
    };
  }

  return createRealProvider({
    config,
    fetch: options.fetch,
    now: options.now,
  });
}
