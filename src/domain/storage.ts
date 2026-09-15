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

import type { InputType } from './interface.ts';

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
}

/**
 * What the domain core needs from persistence.
 *
 * Deliberately narrow: it records drops and the items read out of them, and
 * reads both back. Later tickets widen this port as they add entities.
 */
export interface DropStore {
  /** Record one drop verbatim and return what was stored. */
  appendDrop(body: string): Promise<StoredDrop>;

  /**
   * Record what was read out of a drop.
   *
   * Called once per successful extraction. It writes the input type and the
   * items in one step, because a drop that is marked as read but carries no
   * items is indistinguishable from a drop that was read and genuinely had
   * none — and that distinction is what re-running extraction depends on.
   *
   * Implementations must tolerate being called for a drop that already has
   * items, and must not duplicate them: extraction is re-runnable, and a
   * retry after a half-finished attempt must not show the user two copies of
   * the same thing.
   *
   * @param dropId - the drop that was read.
   * @param outcome - what was read out of it.
   */
  recordExtraction(dropId: string, outcome: ExtractOutcome): Promise<void>;

  /** Every drop recorded so far, oldest first. */
  listDrops(): Promise<readonly StoredDrop[]>;

  /** One drop, or null when there is no such drop. */
  findDrop(dropId: string): Promise<StoredDrop | null>;

  /** Every item recorded so far, in the order it was caught. */
  listItems(): Promise<readonly StoredItem[]>;

  /** The items parsed out of one drop, in the order they were caught. */
  listItemsForDrop(dropId: string): Promise<readonly StoredItem[]>;

  /** Release the underlying resource. */
  close(): Promise<void>;
}
