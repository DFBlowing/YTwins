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

/** One stored drop, as the store keeps it. */
export interface StoredDrop {
  /** Stable identity of this drop, minted by the store. */
  readonly id: string;
  /** The user's original text, byte-for-byte. */
  readonly body: string;
  /** When the drop was recorded, as an ISO-8601 string. */
  readonly droppedAt: string;
}

/**
 * What the domain core needs from persistence.
 *
 * Deliberately narrow: ticket 01 records a drop and reads back the ones
 * already there. Later tickets widen this port as they add entities.
 */
export interface DropStore {
  /** Record one drop verbatim and return what was stored. */
  appendDrop(body: string): Promise<StoredDrop>;
  /** Every drop recorded so far, oldest first. */
  listDrops(): Promise<readonly StoredDrop[]>;
  /** Release the underlying resource. */
  close(): Promise<void>;
}
