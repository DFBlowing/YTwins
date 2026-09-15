/**
 * The AI provider port — the single external-dependency seam.
 *
 * Every non-deterministic intelligent call leaves the domain through here, so
 * that real and fake implementations are interchangeable and the domain's tests
 * are fully deterministic. Ticket 01 needed only `respond`; ticket 02 adds
 * `extract`, which is what turns a drop into **items** and a **record**.
 * Ticket 03 gives `respond` the **situation** it is answering and the
 * parent-voice rules, and has the domain check what comes back rather than
 * trusting it. Ticket 07 adds the two ends of **recall** — parsing a question,
 * and composing its answer. Embeddings and link judging arrive with their own
 * tickets.
 *
 * Note what recall does *not* put here: choosing which records answer a
 * question. That selection is ordinary code inside the domain, so "found
 * nothing" is a fact about the data rather than a model's opinion, and the same
 * question recalls the same records every time. Only the two ends that
 * genuinely need a model cross this seam. *
 * The real implementation talks to a cloud LLM; the fake one is scripted by the
 * test. The domain never learns which it got.
 *
 * @module domain/ai-provider
 */

import type { InputType, RecallSource } from './interface.ts';

/** What the provider is asked to say something about. */
export interface RespondRequest {
  /** The drop's original text. */
  readonly body: string;
  /**
   * What the reply is being asked for, as ordinary code read it.
   *
   * Deliberately only the readings a provider can act on. Whether the user
   * **asked to stop** is a third reading, and it never reaches here: a drop like
   * that is answered by code, because "leave only the shortest statement of
   * presence" is not something a string check can hold a model to (see
   * `parent-voice.ts` and `core.ts`). An instruction the provider cannot act on
   * is worse than no instruction: it invites an answer nobody wants.
   */
  readonly brief: ReplyBrief;
  /**
   * The rules this reply must obey, in the product's own words.
   *
   * They are sent rather than left to the implementation because they are a
   * hard product constraint rather than a prompt-tuning choice: an
   * implementation puts them in its instructions, and the domain's own code
   * checks the same rules afterwards (`parent-voice.ts`). Two places, one list.
   */
  readonly instructions: readonly string[];
  /**
   * Which rules the previous attempt broke, when this is the one regeneration.
   *
   * Absent on a first attempt. Named by `checkReply`; the port treats them as
   * opaque labels to put in front of the model, which is why they are plain
   * strings here rather than a type this module would have to own.
   *
   * A retry that is not told what was wrong is a reroll, and a model asked to
   * try again at random is no likelier to succeed.
   */
  readonly violations?: readonly string[];
}

/**
 * What a reply is being asked for, as the provider is told it.
 *
 * Two readings, not three: see `RespondRequest.brief`.
 */
export interface ReplyBrief {
  /** The text carries a feeling, so the reply's first sentence must name one. */
  readonly emotionPresent: boolean;
  /** The user asked what to do, so advice is licensed this turn. */
  readonly adviceRequested: boolean;
}

/** The provider's answer to one drop. */
export interface RespondResult {
  /** The reply text. The domain validates it against the parent-voice rules. */
  readonly reply: string;
}

/** A drop the provider is asked to read. */
export interface ExtractRequest {
  /** The drop's original text. */
  readonly body: string;
}

/**
 * One thing worth doing later, as the provider read it out of the drop.
 *
 * Note what is *absent*: no id, no link back to the drop, no storage detail.
 * The provider reads meaning; identity and ownership are the domain's to mint.
 */
export interface ExtractedItem {
  /** The thing to do, in the user's own words — not rewritten into a category. */
  readonly text: string;
  /**
   * When it is due as an ISO-8601 string, or null when the drop gave no time.
   *
   * Null is a legitimate reading, not a failure: "下周三交提纲" has a time and
   * "想去学吉他" does not, and both are items. The provider is expected to say
   * so rather than invent a date to look useful.
   */
  readonly dueAt: string | null;
}

/** The provider's reading of one drop. */
export interface ExtractResult {
  /** The items found in the drop. Empty is normal — most drops contain none. */
  readonly items: readonly ExtractedItem[];
  /**
   * What kind of input this was, as the provider judged it.
   *
   * Recorded internally and never shown. It exists so the product can decide
   * what to do with a drop; it is not a label for the user to browse, and no
   * part of the product may ask the user to pick one.
   */
  readonly inputType: InputType;
}

/** A question the user asked of their records. */
export interface ParseQuestionRequest {
  /** The question as typed, verbatim. */
  readonly question: string;
}

/** What the provider made of a question. */
export interface ParseQuestionResult {
  /**
   * The text to look for in the records.
   *
   * Deliberately plain strings rather than anything cleverer: the domain turns
   * them into a substring lookup, so a hit is a match the user can check by eye.
   * Named for the mechanic rather than for a domain concept, because it is one —
   * the product's own words for what a question is about do not exist yet, and
   * inventing one here would be language the project does not use.
   *
   * An empty list means the question yielded nothing to look for, which the
   * domain reports as "found nothing" rather than asking a model to phrase the
   * absence. Blank entries are the domain's to discard, not the provider's.
   */
  readonly matchText: readonly string[];
}

/** A request to compose the answer to one question. */
export interface ComposeAnswerRequest {
  /** The question as typed. */
  readonly question: string;
  /**
   * The records that answered it, oldest first. Never empty.
   *
   * The same type the result cites as its sources — the composer is handed
   * exactly what the user will be shown, so the two cannot drift apart.
   */
  readonly records: readonly RecallSource[];
  /**
   * The moment to answer *as of*, as an ISO-8601 string.
   *
   * This is what makes the demo's "a few days later" viewpoint possible without
   * waiting: the composer phrases time references ("下周三") relative to this.
   * It affects wording only — it never selects records, so pinning a different
   * basis can change how an answer reads but never what is recalled.
   */
  readonly now: string;
}

/** The composed answer. */
export interface ComposeAnswerResult {
  /**
   * The answer sentence.
   *
   * The domain rejects a blank one: an empty answer beside a source is the
   * confusion this result shape exists to prevent.
   */
  readonly answer: string;
}

/**
 * The port. Implementations live outside the domain core — the domain holds the
 * interface, never a concrete provider.
 */
export interface AiProvider {
  /**
   * Compose the reply to one drop.
   *
   * Implementations may throw or take their time; the domain treats both as
   * ordinary, because a drop succeeds whether or not the provider answers. What
   * they may **not** do is decide how long a reply is or whether it asks a
   * question: those are checked afterwards, and a reply that breaks them is
   * thrown away and asked for once more.
   *
   * @param request - the drop, the situation it presents, and the rules.
   * @returns the reply text.
   */
  respond(request: RespondRequest): Promise<RespondResult>;

  /**
   * Read one drop for **items** and its **input type**.
   *
   * The same tolerance applies as for `respond`: throwing, hanging, or
   * returning nonsense all leave the drop itself untouched. The original text
   * is already stored by the time this is called, so nothing here can lose it,
   * and a failure only means the drop can be read again later.
   *
   * @param request - the drop being read.
   * @returns the items it contains, and what kind of input it was.
   */
  extract(request: ExtractRequest): Promise<ExtractResult>;

  /**
   * Work out what to look for when the user asks about their records.
   *
   * The same tolerance applies as everywhere else on this port: a provider that
   * throws, hangs, or returns nonsense leaves the user told that the question
   * could not be put to their records — never with an invented answer, and never
   * told that their records lack something nobody looked for.
   *
   * @param request - the question being asked.
   * @returns the text to look for in the records.
   */
  parseQuestion(request: ParseQuestionRequest): Promise<ParseQuestionResult>;

  /**
   * Turn the records that matched into an answer sentence.
   *
   * Only ever called when something matched: with no evidence there is nothing
   * to compose, and the domain says so itself rather than asking a model to
   * phrase an absence it cannot check.
   *
   * @param request - the question, the matching records, and the moment to answer as of.
   * @returns the answer text. A blank answer is rejected by the domain.
   */
  composeAnswer(request: ComposeAnswerRequest): Promise<ComposeAnswerResult>;
}
