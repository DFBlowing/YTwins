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

/**
 * What a drop turned out to be, judged internally by the AI.
 *
 * The user is never asked to choose this and never sees it: it exists so the
 * product can decide what to do with a drop, not so anyone can browse a
 * classification. It is part of the domain's vocabulary, not of the page's.
 */
export type InputType = 'emotion' | 'decision' | 'item' | 'idea';

/** Every input type, in the order the spec lists them. */
export const INPUT_TYPES: readonly InputType[] = ['emotion', 'decision', 'item', 'idea'];

/**
 * One thing the drop asked the user to do later.
 *
 * An item is bound to time when the drop said when; otherwise it is
 * **unscheduled** and kept anyway. "No date" is a normal state, never a reason
 * to drop it — the user is promised that nothing they typed gets silently lost.
 */
export interface Item {
  /** Stable identity of this item. */
  readonly id: string;
  /** What is to be done, in the user's own words. */
  readonly text: string;
  /**
   * When it is due, as an ISO-8601 string, or null when no time was parsed.
   *
   * Null is the "**待安排**" state: the item exists, the page lists it apart
   * from anything time-bound, and it appears on no date.
   */
  readonly dueAt: string | null;
  /** The drop this item was parsed out of. Nothing exists without a source. */
  readonly dropId: string;
}

/** What a drop caught, plus the line the user gets back. */
export interface DropResult {
  /**
   * A faithful copy of what the user typed. Stored verbatim — never a summary —
   * so that later recall shows the user their own words.
   */
  readonly body: string;
  /** The line the user sees. Always present: dropping something is never silent. */
  readonly reply: string;
  /**
   * Stable identity of the drop that was just recorded.
   *
   * Handed back because the page needs to know which drop to ask about while
   * extraction is still running — the items it produced are not known yet.
   * Named `id` to match `DropSummary.id`, so a caller that drops and then reads
   * the drop back passes the same value straight through.
   */
  readonly id: string;
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
  /**
   * The items this drop produced. Empty until extraction has run, and empty
   * forever if extraction failed — both are ordinary, because the drop itself
   * already succeeded.
   */
  readonly items: readonly Item[];
  /**
   * Whether extraction has run for this drop, successfully or not.
   *
   * `false` means "nothing has been read out of it yet, and asking again might
   * work" — which is exactly what the page needs to decide whether to keep
   * waiting. It is deliberately not exposed as a type or a category: it says
   * whether the work is done, never what the drop was judged to be.
   */
  readonly extracted: boolean;
}

/**
 * The domain core.
 *
 * Ticket 01 opened exactly one operation: **dropping**. Ticket 02 opened what
 * dropping turns out to mean — a drop is split into **items** and a **record**.
 * The remaining operations named in the spec's interface (recall, surfacing,
 * portrait, chain, scheduling, deletion) arrive with their own tickets — this
 * interface grows, it does not get pre-declared with stubs that would fake
 * behaviour.
 */
export interface Domain {
  /**
   * Drop one piece of text.
   *
   * Returns as soon as the original text is recorded. Extraction does **not**
   * gate this call: a slow or failing AI provider still leaves the drop caught
   * and the user answered, because extracting is asynchronous to recording.
   *
   * The items this drop produced are therefore *not* in the return value — they
   * do not exist yet. The page learns them by reading the drop again (see
   * `getDrop`), which is the same path it uses after a refresh.
   *
   * @param body - the raw text the user typed. Stored verbatim.
   * @returns what this drop caught, and the reply to show the user.
   */
  drop(body: string): Promise<DropResult>;

  /**
   * The drops recorded so far, oldest first, each carrying what it caught.
   *
   * The page reads this on load, which is what makes a refresh show the same
   * drops rather than an empty screen.
   *
   * @returns what has been caught.
   */
  listDrops(): Promise<readonly DropSummary[]>;

  /**
   * One drop, with whatever has been extracted from it so far.
   *
   * This is how the page finds out what the drop it just made turned out to
   * contain: dropping returns before extraction, so the page asks again. A drop
   * that does not exist is reported as null rather than as an error — "no such
   * drop" is an answer, not a failure.
   *
   * @param dropId - identity of the drop to read.
   * @returns the drop, or null when there is no such drop.
   */
  getDrop(dropId: string): Promise<DropSummary | null>;

  /**
   * Every **item** that has been parsed out of the user's drops, oldest first.
   *
   * Items whose time could not be parsed come back with a null `dueAt`. They
   * are included on purpose: an item with no date is still something the user
   * has to do, and dropping it silently is the one failure the product does not
   * allow. Ordering them onto a timeline is ticket 08's job, not this one's.
   *
   * @returns every item caught so far.
   */
  listItems(): Promise<readonly Item[]>;

  /**
   * Run extraction on a drop that has not been read yet, and report the outcome.
   *
   * Dropping already schedules this; calling it again is how a drop whose
   * extraction failed or never ran gets another chance. It is idempotent in
   * effect: a drop that has already been extracted is left as it is, so asking
   * twice cannot produce the same items twice.
   *
   * Unlike `drop`, this call **does** wait for the provider — that is the whole
   * point of asking for it — but it never rejects. A provider that is down means
   * `extracted: false`, which is an ordinary answer rather than an error, so a
   * caller retrying later has nothing to catch.
   *
   * @param dropId - identity of the drop to extract.
   * @returns the drop as it stands once the attempt is over, or null when there
   *   is no such drop.
   */
  extract(dropId: string): Promise<DropSummary | null>;
}
