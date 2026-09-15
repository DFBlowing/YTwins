/**
 * The AI provider port — the single external-dependency seam.
 *
 * Every non-deterministic intelligent call leaves the domain through here, so
 * that real and fake implementations are interchangeable and the domain's tests
 * are fully deterministic. Ticket 01 needed only `respond`; ticket 02 adds
 * `extract`, which is what turns a drop into **items** and a **record**.
 * Embeddings and link judging arrive with their own tickets.
 *
 * The real implementation talks to a cloud LLM; the fake one is scripted by the
 * test. The domain never learns which it got.
 *
 * @module domain/ai-provider
 */

import type { InputType } from './interface.ts';

/** What the provider is asked to say something about. */
export interface RespondRequest {
  /** The drop's original text. */
  readonly body: string;
}

/** The provider's answer to one drop. */
export interface RespondResult {
  /** The reply text. The domain validates it against the parent-voice rules. */
  readonly reply: string;
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

/**
 * The port. Implementations live outside the domain core — the domain holds the
 * interface, never a concrete provider.
 */
export interface AiProvider {
  /**
   * Compose the reply to one drop.
   *
   * Implementations may throw or take their time; the domain treats both as
   * ordinary, because a drop succeeds whether or not the provider answers.
   *
   * @param request - the drop being answered.
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
  extract(request: RespondRequest): Promise<ExtractResult>;
}
