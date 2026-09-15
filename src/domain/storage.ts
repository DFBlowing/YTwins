/**
 * The storage port.
 *
 * The domain core declares what it needs to persist; an adapter decides how.
 * This port is **internal** to the domain — it is not a seam the tests drive,
 * and the web layer never sees it. Tests exercise it only through the domain's
 * own operations.
 *
 * @module domain/storage
 */

import type { InputType, LinkKind } from './interface.ts';

/** One stored drop, as the store keeps it. */
export interface StoredDrop {
  /** Stable identity of this drop, minted by the store. */
  readonly id: string;
  /** The user's original text, byte-for-byte. */
  readonly body: string;
  /** When the drop was recorded, as an ISO-8601 string. */
  readonly droppedAt: string;
  /**
   * What kind of input this was judged to be, or null when it has not been read
   * yet. Null is the honest state for "no extraction has succeeded", and it is
   * also what makes extraction re-runnable: the store can tell the two apart.
   */
  readonly inputType: InputType | null;
  /**
   * The line the user is answered with, or null for a drop recorded before this
   * column existed. Null is not "no reply": the domain falls back to the line
   * code can vouch for, because a drop is never silent.
   *
   * The value changes once: it is written when the drop is caught, and replaced
   * if and only if the provider returns a reply that passes the checks.
   */
  readonly reply: string | null;
}

/** One stored item, as the store keeps it. */
export interface StoredItem {
  /** Stable identity of this item, minted by the store. */
  readonly id: string;
  /** What is to be done. */
  readonly text: string;
  /** When it is due, or null when no time was parsed. */
  readonly dueAt: string | null;
  /** The drop it came from. */
  readonly dropId: string;
}

/**
 * One stored term, as the store keeps it.
 *
 * `vector` is here and nowhere in the domain's interface: it is how the store
 * remembers what a term was measured as, so a pair is compared once rather than
 * on every drop. It never reaches the page.
 */
export interface StoredTerm {
  /** Stable identity of this term. */
  readonly id: string;
  /** The user's own wording. */
  readonly text: string;
  /** The drop it first came from. */
  readonly dropId: string;
  /** When it was first said, as an ISO-8601 string. */
  readonly firstSeenAt: string;
  /** Its embedding, or null until something has needed to compare it. */
  readonly vector: readonly number[] | null;
}

/** One stored link, as the store keeps it. */
export interface StoredLink {
  /** Stable identity of this link. */
  readonly id: string;
  /** One end. */
  readonly fromTermId: string;
  /** The other end. */
  readonly toTermId: string;
  /** Which kind of evidence produced it. */
  readonly kind: LinkKind;
  /** How strong it is, on the one scale both kinds share. */
  readonly strength: number;
  /** Why it exists. */
  readonly reason: string;
}

/** One term's embedding, on its way into storage. */
export interface TermVector {
  /** The term this vector belongs to. */
  readonly termId: string;
  /** The vector itself. */
  readonly vector: readonly number[];
}

/** A link the store has not minted an id for yet. */
export interface NewLink {
  /** One end. */
  readonly fromTermId: string;
  /** The other end. */
  readonly toTermId: string;
  /** Which kind of evidence produced it. */
  readonly kind: LinkKind;
  /** How strong it is, on the one scale both kinds share. */
  readonly strength: number;
  /** Why it exists, in words a person can read. */
  readonly reason: string;
}

/**
 * What the domain needs the provider to have read, so it can be written down.
 *
 * Deliberately mirrors the provider's own result: the domain passes the reading
 * through without reshaping it, because it is the store — not the core — that
 * mints ids and attaches the drop.
 */
export interface ExtractOutcome {
  readonly inputType: InputType;
  readonly items: readonly {
    readonly text: string;
    readonly dueAt: string | null;
  }[];
  /** The terms read out of the drop, in the user's own words. */
  readonly terms: readonly string[];
}

/**
 * What the domain core needs from persistence.
 *
 * Deliberately narrow: it records drops and what was read out of them — items,
 * terms, the links that follow from both being said together — and reads them
 * back. Later tickets widen this port as they add entities.
 */
export interface DropStore {
  /**
   * Record one drop verbatim and return what was stored.
   *
   * The reply is written with it, in the same step: dropping something is never
   * silent, so the line the user is owed exists from the moment the drop does —
   * before any provider has been asked anything. A better line may replace it
   * later (see `recordReply`); an absent one may not.
   *
   * @param body - the user's text, stored byte-for-byte.
   * @param reply - the line the drop is answered with.
   */
  appendDrop(body: string, reply: string): Promise<StoredDrop>;

  /**
   * Replace a drop's reply with the checked one the provider composed.
   *
   * Called at most once per drop. It is a separate step from `appendDrop`
   * because the two lines have different guarantees: the first is code's own and
   * always exists, the second is a model's and arrives only if it passes.
   *
   * @param dropId - the drop being answered.
   * @param reply - the line to show instead.
   */
  recordReply(dropId: string, reply: string): Promise<void>;

  /**
   * Record what was read out of a drop.
   *
   * Called once per successful extraction. It writes the input type, the items
   * and the terms in one step, because they only mean something together: a drop
   * marked as read while carrying half of what was read out of it is a state the
   * domain could not recover from, and being marked as read is what stops
   * extraction running again.
   *
   * The **links** between those terms are not written here. They are the
   * domain's reading of the material rather than part of it, and the domain
   * writes them straight afterwards (see `recordLinks`) — so a missing link
   * costs a link, while a missing term would cost something the user said.
   *
   * Implementations must tolerate being called for a drop that already has
   * items or terms, and must not duplicate either: extraction is re-runnable,
   * and a retry after a half-finished attempt must not show the user two copies
   * of the same thing.
   *
   * @param dropId - the drop that was read.
   * @param outcome - what was read out of it.
   * @returns the terms this drop said, with the identities the store minted.
   */
  recordExtraction(dropId: string, outcome: ExtractOutcome): Promise<readonly StoredTerm[]>;

  /** Every term recorded so far, in the order it was first said. */
  listTerms(): Promise<readonly StoredTerm[]>;

  /** The terms one drop said, in the order they were said in it. */
  listTermsForDrop(dropId: string): Promise<readonly StoredTerm[]>;

  /**
   * Every term, grouped by the drops that said it.
   *
   * The same fact as `listTermsForDrop`, read in one query rather than one per
   * drop: the page asks for every drop on every load. Grouped by mention, so a
   * term said on two days appears under both.
   */
  listTermsByDrop(): Promise<ReadonlyMap<string, readonly StoredTerm[]>>;

  /** Every drop recorded so far, oldest first. */
  listDrops(): Promise<readonly StoredDrop[]>;

  /** One drop, or null when there is no such drop. */
  findDrop(dropId: string): Promise<StoredDrop | null>;

  /** Every item recorded so far, in the order it was caught. */
  listItems(): Promise<readonly StoredItem[]>;

  /** The items parsed out of one drop, in the order they were caught. */
  listItemsForDrop(dropId: string): Promise<readonly StoredItem[]>;

  /**
   * Remember what a term was encoded as.
   *
   * Written apart from `recordExtraction` because the two have different
   * guarantees: the terms are what the user said and are owed to them, while
   * the vectors are how the domain compares them and cost a provider call that
   * is allowed to fail. Failing to store a vector must cost the comparisons
   * that needed it, and nothing else.
   *
   * @param vectors - one embedding per term.
   */
  recordTermVectors(vectors: readonly TermVector[]): Promise<void>;

  /** Every link recorded so far, oldest first. */
  listLinks(): Promise<readonly StoredLink[]>;

  /**
   * Write links that have been decided.
   *
   * One row per pair, and a pair written again is **replaced**: which link a
   * pair has is the domain's decision, not the store's, and this is how a newer
   * decision takes an older one's place — saying two things together, for
   * instance, outranks having thought their words looked close. The store must
   * not merge the two or keep both: ticket 05 counts links, and the same pair
   * counted twice would quietly lower its threshold.
   *
   * @param links - the links to write, each without an id.
   */
  recordLinks(links: readonly NewLink[]): Promise<void>;

  /** Release the underlying resource. */
  close(): Promise<void>;
}
