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
 * widened it from one operation to two: a drop is both answered and read.
 * Ticket 07 adds the two ends of recall, scripted the same way.
 *
 * @module domain/fake-provider
 */

import type {
  AiProvider,
  ComposeAnswerRequest,
  ComposeAnswerResult,
  ExtractResult,
  ParseQuestionRequest,
  ParseQuestionResult,
  RespondRequest,
  RespondResult,
} from './ai-provider.ts';
import type { InputType } from './interface.ts';

/**
 * How a scripted call fails or stalls.
 *
 * Shared by every operation on the port, because the domain's tolerance for a
 * broken provider is the same for all of them and the tests should not be able
 * to prove it for one and not the rest.
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

/** What the fake should make of one question. */
export type ParseQuestionScript =
  | FailureScript
  | { readonly kind: 'match'; readonly matchText: readonly string[] };

/** What the fake should answer, once records have been found. */
export type ComposeScript = FailureScript | { readonly kind: 'answer'; readonly answer: string };

/** Every script this fake understands, so the failure guard can see them all. */
export type AnyScript = RespondScript | ExtractScript | ParseQuestionScript | ComposeScript;

/** Configure the fake: a default, plus per-body overrides. */
export interface FakeProviderScript {
  readonly fallback?: RespondScript;
  readonly byBody?: Readonly<Record<string, RespondScript>>;
  /** What to read out of a drop. Omitting it means every drop reads as empty. */
  readonly extractFallback?: ExtractScript;
  readonly extractByBody?: Readonly<Record<string, ExtractScript>>;
  /** What to make of a question. Omitting it means every question yields no cues. */
  readonly parseQuestionFallback?: ParseQuestionScript;
  readonly parseQuestionByQuestion?: Readonly<Record<string, ParseQuestionScript>>;
  /** How to answer, once records have been found. */
  readonly composeFallback?: ComposeScript;
  /**
   * Observe each composition as it happens.
   *
   * A callback rather than a recorded log, because what a test needs to assert
   * about composition is usually *what the composer was handed* — the records,
   * the pinned moment — and those only exist per call.
   */
  readonly onCompose?: (request: ComposeAnswerRequest) => void;
}

/** A handle on the fake, so tests can observe what it was asked. */
export interface FakeProvider extends AiProvider {
  /** Every body the domain asked it to answer, in order. */
  readonly seen: readonly string[];
  /** Every body the domain asked it to read, in order. */
  readonly read: readonly string[];
  /** Every question the domain asked it to parse, in order. */
  readonly askedQuestions: readonly string[];
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

/**
 * Whether a script means "this call fails".
 *
 * Written as an allow-list of the *failure* kinds rather than of the success
 * kinds, so the two mistakes are not equally likely: adding a new failure kind
 * and forgetting it here fails loudly (the script stops failing), while adding a
 * new success kind needs no edit at all and can never silently turn into a
 * throw. The parameter stays the full union, so callers keep narrowing.
 */
function isFailure(script: AnyScript): script is FailureScript {
  return script.kind === 'hang' || script.kind === 'fail' || script.kind === 'throw';
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
 * What an unscripted question yields.
 *
 * No match text at all, which the domain reads as "nothing to look for" and
 * reports as `not-found`. A fake that invented something to look for would
 * quietly answer questions the test never set up, and a test asserting "found
 * nothing" would then pass for the wrong reason.
 */
const UNSCRIPTED_MATCH: ParseQuestionResult = { matchText: [] };

function runParseQuestion(script: ParseQuestionScript | undefined): Promise<ParseQuestionResult> {
  if (script === undefined) return Promise.resolve(UNSCRIPTED_MATCH);
  if (isFailure(script)) return fail(script);
  return Promise.resolve({ matchText: script.matchText });
}

function runCompose(script: ComposeScript | undefined): Promise<ComposeAnswerResult> {
  if (script === undefined) {
    // Unscripted composition **fails** rather than answering. Composing is the
    // one call whose output is a sentence presented to the user as fact, so a
    // fake that defaulted to some placeholder would be inventing an answer —
    // the single outcome the domain promises never to produce. Tests that reach
    // this call script it explicitly.
    return Promise.reject(new Error('no compose script: the fake will not invent an answer'));
  }
  if (isFailure(script)) return fail(script);
  return Promise.resolve({ answer: script.answer });
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
  const askedQuestions: string[] = [];
  return {
    seen,
    read,
    askedQuestions,
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
    parseQuestion(request: ParseQuestionRequest): Promise<ParseQuestionResult> {
      askedQuestions.push(request.question);
      return runParseQuestion(
        script.parseQuestionByQuestion?.[request.question] ?? script.parseQuestionFallback,
      );
    },
    composeAnswer(request: ComposeAnswerRequest): Promise<ComposeAnswerResult> {
      script.onCompose?.(request);
      return runCompose(script.composeFallback);
    },
  };
}
