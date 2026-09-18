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
 * deliberately breaks the rules as a script of its own. Ticket 04 adds the two
 * ends of linking: a vector per text, and a verdict per pair — both scripted,
 * so a link's existence and strength are numbers the check chose. Ticket 05 adds
 * the one thing settling needs a model for: a sentence for a matter that has
 * crossed the threshold, scripted per feeling so a check can tell which feelings
 * the domain decided a matter was about. Ticket 11 adds the asked-for **answer**
 * as a script of its own, so a check can make the assembly fail while every
 * single matter still composes — which is what "an answer nobody could compose
 * did not become an invented one" is asserted with. Ticket 15 adds the judgement
 * the fused page needs: what one piece of text was addressed to. It is scripted
 * per body like the rest, and deliberately **unscripted by default** — the fake
 * will not decide the routing a check meant to pin.
 *
 * @module domain/fake-provider
 */

import type {
  AiProvider,
  ComposeAnswerRequest,
  ComposeAnswerResult,
  ComposeConclusionRequest,
  ComposeConclusionResult,
  ComposeRecallAnswerRequest,
  ComposeRecallAnswerResult,
  EmbedRequest,
  EmbedResult,
  ExtractRequest,
  ExtractResult,
  JudgeLinkRequest,
  JudgeLinkResult,
  JudgeQuestionRequest,
  JudgeQuestionResult,
  ParseQuestionRequest,
  ParseQuestionResult,
  RespondRequest,
  RespondResult,
} from './ai-provider.ts';
import type { InputType } from './interface.ts';
import { pairKey } from './linking.ts';
import type { QuestionTarget } from './routing.ts';

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
  /**
   * The terms it read out, in the user's own words. Optional and defaulting to
   * none, because a fragment with nothing worth bringing up again is the honest
   * default — a check that wants terms asks for them.
   */
  readonly terms?: readonly string[];
  /**
   * Which of those terms carries the feeling or decision, if any.
   *
   * Optional and defaulting to none, for the same reason as `terms`: a fragment
   * that is about nothing in particular is the honest default, and a check that
   * wants a matter to accumulate has to ask for one.
   */
  readonly anchor?: string | null;
}

/** What the fake should do for one input, when reading. */
export type ExtractScript = FailureScript | { readonly kind: 'read'; readonly reading: ExtractReading };

/** What the fake should hand back for the texts it was asked to encode. */
export type EmbedScript =
  | FailureScript
  | { readonly kind: 'vectors'; readonly vectors: readonly (readonly number[])[] };

/** What the fake should rule about one pair of terms. */
export type JudgeLinkScript = FailureScript | { readonly kind: 'verdict'; readonly related: boolean };

/** What the fake should make of one question. */
export type ParseQuestionScript =
  | FailureScript
  | { readonly kind: 'match'; readonly matchText: readonly string[] };

/**
 * What the fake should make of words that could be a question.
 *
 * Three scripts rather than a boolean, because "not a question" and "nobody could
 * say" are different facts and ticket 15 turns on the difference: the first is a
 * reading, the second is the arm the domain has to fall back to
 * (`判不出是问题，就不当问题`). `FailureScript` is how a check pins the second.
 */
export type JudgeQuestionScript =
  | FailureScript
  | { readonly kind: 'asking'; readonly about: QuestionTarget }
  | { readonly kind: 'not-asking' };

/** What the fake should answer, once records have been found. */
export type ComposeScript = FailureScript | { readonly kind: 'answer'; readonly answer: string };

/** What the fake should say about one matter, as one sentence. */
export type ComposeConclusionScript =
  | FailureScript
  | { readonly kind: 'sentence'; readonly text: string };

/**
 * What the fake should say when several conclusions are brought together.
 *
 * Its own script rather than a second use of `ComposeConclusionScript`, because
 * the two calls answer different questions and a check has to be able to fail
 * one without failing the other — which is how "the answer could not be composed,
 * and one real line stood in its place" is pinned.
 */
export type AnswerScript = FailureScript | { readonly kind: 'sentence'; readonly text: string };

/** Every script this fake understands, so the failure guard can see them all. */
export type AnyScript =
  | RespondScript
  | ExtractScript
  | ParseQuestionScript
  | JudgeQuestionScript
  | ComposeScript
  | EmbedScript
  | JudgeLinkScript
  | ComposeConclusionScript
  | AnswerScript;

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
  /**
   * What to make of words that could be a question. Keyed by the body itself,
   * so a check can script one sentence as a question about the records and
   * another as a question about the user.
   *
   * Omitting it makes the call **fail**, like the other readings: whether the
   * words are a question is a judgement, and a fake that defaulted one would be
   * inventing the routing the check meant to pin. The domain reads the failure
   * as 「not a question」, which is the outcome it promises for a judgement nobody
   * could make.
   */
  readonly judgeQuestionFallback?: JudgeQuestionScript;
  readonly judgeQuestionByBody?: Readonly<Record<string, JudgeQuestionScript>>;
  /** How to reply to a question, once records have been found. */
  readonly composeFallback?: ComposeScript;
  /**
   * Observe each composition as it happens.
   *
   * A callback rather than a recorded log, because what a test needs to assert
   * about composition is usually *what the composer was handed* — the records,
   * the pinned moment — and those only exist per call.
   */
  readonly onCompose?: (request: ComposeRecallAnswerRequest) => void;
  /**
   * What to encode a text as. Keyed by the text itself, so the same term always
   * gets the same vector and the resulting similarity is a number the check
   * chose rather than one it hopes for. A text with no entry fails the whole
   * call rather than getting an invented vector.
   */
  readonly embedFallback?: EmbedScript;
  readonly embedByText?: Readonly<Record<string, EmbedScript>>;
  /**
   * What to rule about a pair. Keyed by both texts in the one order a pair has
   * (`pairKey`), so a check does not have to know which end the domain happens
   * to call `from` — the two ends are interchangeable and the key says so.
   */
  readonly judgeLinkFallback?: JudgeLinkScript;
  readonly judgeLinkByPair?: Readonly<Record<string, JudgeLinkScript>>;
  /**
   * What to say about a matter. Keyed by the feeling it is about, so a check can
   * script "a matter about 好烦 reads like this" and then assert which feeling
   * the domain decided a matter was about — the answer to a question the term
   * list alone cannot settle.
   */
  readonly composeConclusionFallback?: ComposeConclusionScript;
  readonly composeConclusionByAnchor?: Readonly<Record<string, ComposeConclusionScript>>;
  /**
   * What to say on the first, second, … attempt for one feeling.
   *
   * The last entry repeats, so a script can say "always this" with one element.
   * Needed because the domain asks again when the first sentence breaks the
   * rules, and a fake that answered the same thing twice could not tell the two
   * paths apart.
   */
  readonly composeConclusionAttempts?: Readonly<Record<string, readonly ComposeConclusionScript[]>>;
  /**
   * Observe each sentence as it is asked for.
   *
   * A callback, like the other observations: what a check needs is what the
   * provider was *told* — the newest feeling, the terms, the band — and those
   * only exist per call.
   */
  readonly onComposeConclusion?: (request: ComposeConclusionRequest) => void;
  /**
   * What to say when several conclusions are brought together. Omitting it makes
   * the call **fail**, like the other compositions: an answer is a judgement, and
   * a fake that defaulted to one would be inventing it.
   */
  readonly answerFallback?: AnswerScript;
  /**
   * What to say on the first, second, … attempt for one assembly.
   *
   * The last entry repeats, so "always this" is a one-element script. Needed
   * because the domain asks again when the first sentence breaks the rules, and a
   * fake that answered the same thing twice could not tell the two paths apart.
   */
  readonly answerAttempts?: readonly AnswerScript[];
}

/** One pair put to `judgeLink`, as the fake saw it. */
export interface JudgedPair {
  readonly from: string;
  readonly to: string;
}

/** A handle on the fake, so tests can observe what it was asked. */
export interface FakeProvider extends AiProvider {
  /** Every body the domain asked it to answer, in order. */
  readonly seen: readonly string[];
  /** Every body the domain asked it to read, in order. */
  readonly read: readonly string[];
  /** Every question the domain asked it to parse, in order. */
  readonly askedQuestions: readonly string[];
  /**
   * Every piece of text the domain asked it to judge as a question, in order.
   *
   * The observation ticket 15's checks are built on: a routing that never asked
   * and a routing that asked and got "no" produce the same delivery, and only
   * this tells them apart.
   */
  readonly classified: readonly JudgeQuestionRequest[];
  /** Every text the domain asked it to encode, in order. */
  readonly embedded: readonly string[];
  /** Every pair the domain put to `judgeLink`, in the order it asked. */
  readonly judged: readonly JudgedPair[];
  /** Every matter the domain asked it to put into a sentence, in order. */
  readonly composed: readonly ComposeConclusionRequest[];
  /** Every assembly the domain asked it for, in order. */
  readonly answers: readonly ComposeAnswerRequest[];
}

/**
 * What an unscripted drop reads as.
 *
 * Empty items and an `item` type: the fake's job is to be deterministic, not to
 * model every real-world case, and a drop that turns out to contain nothing is
 * the honest default — a test that wants items asks for them explicitly.
 */
const UNSCRIPTED_READING: ExtractResult = { inputType: 'item', items: [], terms: [], anchor: null };

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
  return Promise.resolve({
    inputType: script.reading.inputType,
    items: script.reading.items,
    terms: script.reading.terms ?? [],
    // A reading that names an anchor it did not list is not repaired here: the
    // fake hands over what it was scripted with, and the domain is the one that
    // decides what a contradictory reading means.
    anchor: script.reading.anchor ?? null,
  });
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

/**
 * What an unscripted judgement of "is this a question" does.
 *
 * It **fails**, and that is the honest default rather than a convenient one: a
 * fake that answered "not a question" on its own would be making the routing
 * decision the check meant to make, and a check asserting "a fragment gets no
 * judgement" would then pass for a reason it never set up. The domain reads the
 * failure as a fragment, which is the same outcome — so nothing is harder to
 * write, and the arm that says "nobody could say" stays reachable.
 */
function runJudgeQuestion(script: JudgeQuestionScript | undefined): Promise<JudgeQuestionResult> {
  if (script === undefined) {
    return Promise.reject(
      new Error('no question script: the fake will not decide what the words were addressed to'),
    );
  }
  if (isFailure(script)) return fail(script);
  return Promise.resolve(
    script.kind === 'asking' ? { asks: true, about: script.about } : { asks: false },
  );
}

function runCompose(script: ComposeScript | undefined): Promise<ComposeRecallAnswerResult> {
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
 * What an unscripted matter reads as.
 *
 * Nothing, and it **fails** rather than answering, for the same reason
 * composition does: the whole point of a conclusion is that it is the product's
 * own judgement, and a fake that defaulted to a placeholder sentence would be
 * putting words in its mouth that no check ever scripted. A check that wants a
 * conclusion asks for one.
 */
function runComposeConclusion(script: ComposeConclusionScript | undefined): Promise<ComposeConclusionResult> {
  if (script === undefined) {
    return Promise.reject(
      new Error('no conclusion script: the fake will not invent a judgement'),
    );
  }
  if (isFailure(script)) return fail(script);
  return Promise.resolve({ text: script.text });
}

/**
 * What an unscripted answer reads as.
 *
 * Nothing, and it **fails** rather than answering, for the same reason
 * composition does: an answer is the product's own judgement drawn from the
 * user's material, and a fake that defaulted to a placeholder would be putting
 * words in its mouth that no check ever scripted.
 */
function runComposeAnswer(script: AnswerScript | undefined): Promise<ComposeAnswerResult> {
  if (script === undefined) {
    return Promise.reject(new Error('no answer script: the fake will not invent an answer'));
  }
  if (isFailure(script)) return fail(script);
  return Promise.resolve({ text: script.text });
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
  const classified: JudgeQuestionRequest[] = [];
  const embedded: string[] = [];
  const judged: JudgedPair[] = [];
  const composed: ComposeConclusionRequest[] = [];
  const answers: ComposeAnswerRequest[] = [];
  /** How many times each body has been answered, which picks its attempt script. */
  const answered = new Map<string, number>();
  /** How many times each matter has been asked about, for the same reason. */
  const concluded = new Map<string, number>();
  /** How many times an assembly has been asked for, for the same reason. */
  let assembled = 0;
  return {
    seen,
    read,
    askedQuestions,
    classified,
    embedded,
    judged,
    composed,
    answers,
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
    judgeQuestion(request: JudgeQuestionRequest): Promise<JudgeQuestionResult> {
      classified.push(request);
      return runJudgeQuestion(
        script.judgeQuestionByBody?.[request.body] ?? script.judgeQuestionFallback,
      );
    },
    composeRecallAnswer(
      request: ComposeRecallAnswerRequest,
    ): Promise<ComposeRecallAnswerResult> {
      script.onCompose?.(request);
      return runCompose(script.composeFallback);
    },
    composeConclusion(request: ComposeConclusionRequest): Promise<ComposeConclusionResult> {
      composed.push(request);
      script.onComposeConclusion?.(request);
      const previous = concluded.get(request.anchor) ?? 0;
      concluded.set(request.anchor, previous + 1);
      const attempts = script.composeConclusionAttempts?.[request.anchor];
      const scripted =
        attempts === undefined ? undefined : attempts[Math.min(previous, attempts.length - 1)];
      return runComposeConclusion(
        scripted ?? script.composeConclusionByAnchor?.[request.anchor] ?? script.composeConclusionFallback,
      );
    },
    composeAnswer(request: ComposeAnswerRequest): Promise<ComposeAnswerResult> {
      answers.push(request);
      // The last entry repeats, so "always this" is a one-element script.
      const attempts = script.answerAttempts;
      const scripted =
        attempts === undefined ? undefined : attempts[Math.min(assembled, attempts.length - 1)];
      assembled += 1;
      return runComposeAnswer(scripted ?? script.answerFallback);
    },
    // Not `async`, for the same reason as `respond`: `fail` may throw
    // synchronously, and hiding that behind a promise would make the fake
    // unable to reproduce the shape the domain has to survive.
    embed(request: EmbedRequest): Promise<EmbedResult> {
      const vectors: (readonly number[])[] = [];
      for (const text of request.texts) {
        embedded.push(text);
        const scripted = script.embedByText?.[text] ?? script.embedFallback;
        if (scripted === undefined) {
          // Unscripted encoding **fails** rather than inventing a vector, for
          // the same reason composition does: a made-up vector would be a
          // made-up judgement about the user's material, and a check asserting
          // links would then pass for a reason it never set up.
          return Promise.reject(new Error(`no embed script for ${text}: the fake will not invent a vector`));
        }
        if (isFailure(scripted)) return fail(scripted);
        const [vector] = scripted.vectors;
        if (vector === undefined) {
          return Promise.reject(new Error(`the embed script for ${text} offered no vector`));
        }
        vectors.push(vector);
      }
      return Promise.resolve({ vectors });
    },
    judgeLink(request: JudgeLinkRequest): Promise<JudgeLinkResult> {
      judged.push({ from: request.from, to: request.to });
      // One lookup, in the pair's one order: the domain may hand the two ends
      // over either way round, and a check should not have to guess which.
      const scripted =
        script.judgeLinkByPair?.[pairKey(request.from, request.to)] ?? script.judgeLinkFallback;
      if (scripted === undefined) {
        // Same rule again: a verdict is a judgement, and a fake that defaulted
        // to one would be deciding links the check never asked it to decide.
        return Promise.reject(new Error('no judge script: the fake will not invent a verdict'));
      }
      if (isFailure(scripted)) return fail(scripted);
      return Promise.resolve({ related: scripted.related });
    },
  };
}
