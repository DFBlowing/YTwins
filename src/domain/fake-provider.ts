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
 * Ticket 07 adds the two ends of recall, scripted the same way. Ticket 03 makes
 * answering scriptable **per attempt**, which is what lets a test walk the
 * "check → regenerate once → degrade" path, and offers the reply that
 * deliberately breaks the rules as a script of its own.
 *
 * @module domain/fake-provider
 */

import type {
  AiProvider,
  ComposeAnswerRequest,
  ComposeAnswerResult,
  ExtractRequest,
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

/**
 * A reply that deliberately breaks the parent-voice rules.
 *
 * Offered as a script rather than kept inside one test because walking the
 * "check → regenerate once → degrade" path is a promise of the product, not a
 * quirk of one check: the fake has to be able to hand the domain a reply that
 * must never reach the user, and this is it. It breaks several rules at once on
 * purpose — it asks why, uses a pet name, tells the user how to feel, and undoes
 * itself with a contrast — because the point is that no part of it is shown.
 */
export const REPLY_THAT_BREAKS_THE_RULES: RespondScript = {
  kind: 'reply',
  reply: '你为什么这么想？宝贝，别想那么多，不过你至少试过了。',
};

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
  /**
   * What to answer on the first, second, … attempt for one body.
   *
   * The last entry repeats, so a script can say "always this" with one element
   * and "this, then that" with two. Needed because the domain asks a second time
   * when the first reply breaks the rules, and a fake that answered the same
   * thing twice could not tell the two paths apart.
   */
  readonly respondAttempts?: Readonly<Record<string, readonly RespondScript[]>>;
  /**
   * Observe each answer as it is asked for.
   *
   * A callback rather than a log, for the same reason as `onCompose`: what a
   * test needs is what the provider was told — the situation, the rules, what
   * the last attempt broke — and those only exist per call.
   */
  readonly onRespond?: (request: RespondRequest) => void;
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

function runRespond(script: RespondScript | undefined): Promise<RespondResult> {
  if (script === undefined) {
    // Unscripted input still gets an answer, and it is a plain acknowledgement
    // rather than an echo of the drop: an echo grows past the reply's length
    // limit on a long fragment, so the fake's own default would break a rule
    // every real reply has to keep.
    //
    // Deliberately not the same sentence as the domain's own fallback line. A
    // default that coincided with it could not be told apart from it, and the
    // fake would be quietly standing in for behaviour it does not have.
    return Promise.resolve({ reply: '记下了。' });
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
  /** How many times each body has been answered, which picks its attempt script. */
  const answered = new Map<string, number>();
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
      script.onRespond?.(request);

      const previous = answered.get(request.body) ?? 0;
      answered.set(request.body, previous + 1);
      const attempts = script.respondAttempts?.[request.body];
      // The last entry repeats, so "always this" is a one-element script.
      const scripted =
        attempts === undefined
          ? undefined
          : attempts[Math.min(previous, attempts.length - 1)];
      return runRespond(scripted ?? script.byBody?.[request.body] ?? script.fallback);
    },
    extract(request: ExtractRequest): Promise<ExtractResult> {
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
