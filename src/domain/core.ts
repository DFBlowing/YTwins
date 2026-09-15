/**
 * The domain core.
 *
 * Holds the interface declared in `interface.ts` and everything behind it.
 * Its internal split — parsing, distillation, surfacing, scheduling, recall,
 * parent-voice enforcement — is *not* a seam: tests never reach through it.
 *
 * Ticket 01 gave it one operation — recording a **drop** — and fixed the shape
 * the whole product rests on: **extraction is asynchronous to recording**. The
 * original text is stored and the user is answered before any AI call settles,
 * so a slow or broken provider costs the user nothing.
 *
 * Ticket 02 gives that shape its consequence. A drop is not one thing: reading
 * it splits it into **items** (what has to be done later) and a **record** (the
 * faithful original). The two are produced by the same act and by different
 * means — the record is the text itself and needs no intelligence, the items
 * are read out of it and do — which is exactly why the record survives an
 * extraction that never happens.
 *
 * @module domain/core
 */

import type { AiProvider, ExtractResult } from './ai-provider.ts';
import type { Domain, DropResult, DropSummary, Item } from './interface.ts';
import type { DropStore, StoredDrop, StoredItem } from './storage.ts';

/**
 * The reply used when no provider could answer.
 *
 * A drop must never be silent, and a provider failure must never surface as the
 * user's problem. This is the plain acknowledgement that the drop was caught.
 */
const RECORDED_REPLY = '接住了。';

/** What the core needs to run. */
export interface DomainCoreOptions {
  /** Where drops are persisted. */
  readonly store: DropStore;
  /**
   * The AI provider port. Optional: the product must work before any provider
   * is configured, and ticket 01's tests drive both with and without one.
   */
  readonly provider?: AiProvider;
}

/** What a drop caught, assembled for the interface. */
function toSummary(drop: StoredDrop, items: readonly StoredItem[]): DropSummary {
  return {
    id: drop.id,
    body: drop.body,
    droppedAt: drop.droppedAt,
    // A null input type is how the store records "nothing has been read out of
    // this yet" — see `storage.ts`. Reading it that way here keeps the one
    // piece of state the page needs (is there more to see?) from needing a
    // second column that could disagree with the first.
    extracted: drop.inputType !== null,
    items: items.map(toItem),
  };
}

function toItem(stored: StoredItem): Item {
  return {
    id: stored.id,
    text: stored.text,
    dueAt: stored.dueAt,
    dropId: stored.dropId,
  };
}

/**
 * Build the domain core.
 *
 * @param options - the store, and optionally an AI provider.
 * @returns the domain interface.
 */
export function createDomain(options: DomainCoreOptions): Domain {
  const { store, provider } = options;

  /**
   * Read one drop, and write down what was read.
   *
   * Returns the drop as it stands afterwards. Never throws: every failure path
   * ends in "the drop is still there, still unread", because losing the text is
   * the only outcome that would actually matter.
   *
   * The provider is asked for **both** items and an input type. They are
   * stored together, so a drop that was read is one that has both — a drop
   * marked as read while carrying no items is a real and common state (most
   * drops contain no items), and it must not be confused with a drop nobody
   * has looked at.
   */
  async function extractInto(drop: StoredDrop): Promise<void> {
    if (provider === undefined) return;
    // Already read. Re-reading would be wasted work at best; the store's
    // contract would absorb it, but asking again is not what "extract once"
    // means, and a caller retrying should not drive the provider twice.
    if (drop.inputType !== null) return;

    let reading: ExtractResult;
    try {
      reading = await provider.extract({ body: drop.body });
    } catch {
      // A provider that is down, refuses, or blows up leaves the drop unread.
      // That is recoverable by asking again, and it is not the user's problem.
      return;
    }

    try {
      await store.recordExtraction(drop.id, {
        inputType: reading.inputType,
        items: reading.items,
      });
    } catch {
      // The provider answered but the write failed. Swallowing this keeps the
      // port's promise that extraction never rejects, and leaves the drop
      // unread so a later attempt can still succeed. Nothing was half-written:
      // the store writes items and the type in one step.
    }
  }

  /** Assemble one drop with its items, or null when there is no such drop. */
  async function readDrop(dropId: string): Promise<DropSummary | null> {
    const drop = await store.findDrop(dropId);
    if (drop === null) return null;
    return toSummary(drop, await store.listItemsForDrop(dropId));
  }

  return {
    async drop(body: string): Promise<DropResult> {
      // Record first. The faithful original is what makes the drop a success,
      // and it is the only thing the user is promised.
      const stored = await store.appendDrop(body);

      // Read the drop in the background. This is the decision the whole product
      // is shaped around: a drop returns in the time it takes to write one row,
      // so a provider that is slow, down, or still thinking cannot delay the
      // user.
      //
      // The items this produces are therefore *not* in the return value — they
      // do not exist yet. The caller finds them by reading the drop again, and
      // so does a page refresh, which is why both paths are the same code.
      //
      // `extractInto` never rejects, so this floating promise cannot become an
      // unhandled rejection — including when the provider throws synchronously,
      // which is why the call happens inside an async function rather than as a
      // bare `provider.extract(...)` guarded by `.catch(...)`. Awaiting inside
      // `extractInto` also means the reply is composed only after the drop row
      // exists, so it cannot race the store.
      void extractInto(stored);

      // Compose the styled reply to what the user just said. Like extraction,
      // it does not gate the drop: ticket 03 surfaces it by updating the drop
      // once the provider answers, not by blocking this call. Until then the
      // outcome is observed only so that no rejection goes unhandled.
      if (provider !== undefined) {
        Promise.resolve()
          .then(() => provider.respond({ body }))
          .catch(() => {
            // Expected when the provider is down or refuses. The drop already
            // succeeded, so there is nothing to report and nothing to undo.
          });
      }

      return { body: stored.body, reply: RECORDED_REPLY, id: stored.id };
    },

    async listDrops(): Promise<readonly DropSummary[]> {
      const drops = await store.listDrops();
      const items = await store.listItems();
      // Group once rather than querying per drop: the page asks for every drop
      // on every load, and the number of drops only grows.
      const byDrop = new Map<string, StoredItem[]>();
      for (const item of items) {
        const bucket = byDrop.get(item.dropId);
        if (bucket === undefined) byDrop.set(item.dropId, [item]);
        else bucket.push(item);
      }
      return drops.map((drop) => toSummary(drop, byDrop.get(drop.id) ?? []));
    },

    async getDrop(dropId: string): Promise<DropSummary | null> {
      return readDrop(dropId);
    },

    async listItems(): Promise<readonly Item[]> {
      return (await store.listItems()).map(toItem);
    },

    async extract(dropId: string): Promise<DropSummary | null> {
      const drop = await store.findDrop(dropId);
      if (drop === null) return null;
      // Unlike `drop`, this call waits. That is what it is for: a caller that
      // asks whether a drop has been read wants the answer, not a promise that
      // it soon will be. It still never rejects — a provider that is down comes
      // back as `extracted: false`, so a caller retrying later has nothing to
      // catch.
      await extractInto(drop);
      return readDrop(dropId);
    },
  };
}
