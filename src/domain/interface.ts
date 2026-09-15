/**
 * The domain core's interface — the highest seam.
 *
 * Everything the product does passes through here: catching a drop, distilling
 * conclusions, surfacing them, scheduling, recall. The interface speaks domain
 * words and returns **task-shaped** results ("what did this drop catch?"), never
 * storage-shaped ones: no tables, no id assembly, no SQL leak through it.
 *
 * Tests drive the domain through this interface only. The web layer is the only
 * other caller, and it is allowed to depend on nothing else.
 *
 * @module domain/interface
 */

/** What a drop caught, plus the line the user gets back. */
export interface DropResult {
  /**
   * A faithful copy of what the user typed. Stored verbatim — never a summary —
   * so that later recall shows the user their own words.
   */
  readonly body: string;
  /** The line the user sees. Always present: dropping something is never silent. */
  readonly reply: string;
}

/**
 * One drop as the interface reports it, for showing what has been caught.
 *
 * Deliberately its own type rather than a re-export of the store's row shape:
 * the interface answers "what did the user drop?", and is free to change
 * without the storage changing with it.
 */
export interface DropSummary {
  /** Stable identity of this drop. */
  readonly id: string;
  /** The user's original text, byte-for-byte. */
  readonly body: string;
  /** When it was recorded, as an ISO-8601 string. */
  readonly droppedAt: string;
}

/**
 * The domain core.
 *
 * Ticket 01 opens exactly one operation: **dropping**. The remaining operations
 * named in the spec's interface (recall, surfacing, portrait, chain, scheduling,
 * deletion) arrive with their own tickets — this interface grows, it does not
 * get pre-declared with stubs that would fake behaviour.
 */
export interface Domain {
  /**
   * Drop one piece of text.
   *
   * Returns as soon as the original text is recorded. Extraction does **not**
   * gate this call: a slow or failing AI provider still leaves the drop caught
   * and the user answered, because extracting is asynchronous to recording.
   *
   * @param body - the raw text the user typed. Stored verbatim.
   * @returns what this drop caught, and the reply to show the user.
   */
  drop(body: string): Promise<DropResult>;

  /**
   * The drops recorded so far, oldest first.
   *
   * The page reads this on load, which is what makes a refresh show the same
   * drops rather than an empty screen.
   *
   * @returns what has been caught.
   */
  listDrops(): Promise<readonly DropSummary[]>;
}
