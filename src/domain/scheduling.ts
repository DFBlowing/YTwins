/**
 * Scheduling: putting **items** on a timeline, and reading them back as work.
 *
 * The whole of this module is ordinary code. Nothing here asks a model
 * anything, and that is the point rather than an accident: *when* something is
 * due is an inference the provider already made when it read the drop (`dueAt`,
 * see `ai-provider.ts`), and everything after that is bookkeeping. What the
 * product promises — the same list twice in a row, a date that has passed still
 * shown, nothing silently dropped — is only promiseable because no model is
 * consulted about any of it.
 *
 * What is deliberately **not** here:
 *
 *  - **No calendar.** No month grid, no durations, no all-day events. The user
 *    asked what is coming; the product says what is coming.
 *  - **No conflict detection.** Two things due at the same hour are two things
 *    due at the same hour. Telling someone their evening is overbooked is
 *    advice, and advice is licensed only when they ask for it (`CONTEXT.md`,
 *    回应方式).
 *  - **No reminders.** The demo promises nothing about system push or about a
 *    reminder firing reliably; what it promises is that opening the page tells
 *    the user what to do.
 *
 * @module domain/scheduling
 */

import { ITEM_STATES } from './interface.ts';
import type { Item, ItemState, Upcoming } from './interface.ts';

/**
 * Where an item stands when nothing has said otherwise.
 *
 * An item exists because the drop asked the user to do something later, so it
 * is **to do** the moment it is caught. There is no state a store could fail to
 * write that would make it anything else.
 */
export const DEFAULT_ITEM_STATE: ItemState = 'todo';

/**
 * Whether a stored value is a state the domain knows.
 *
 * Anything unrecognised reads as "to do" rather than as a made-up state: the
 * column is written only by the store, so an unknown value means the file was
 * edited by hand or written by an older version — and an item that is wrongly
 * listed as still to do is a smaller failure than one that vanishes from the
 * list because nobody can name what it is.
 *
 * @param raw - the value as it came back, or null when the column has none.
 * @returns the state, defaulting when the value cannot be named.
 */
export function readItemState(raw: string | null): ItemState {
  return ITEM_STATES.find((state) => state === raw) ?? DEFAULT_ITEM_STATE;
}

/**
 * Which list an item belongs in, and how it is placed.
 *
 * One comparison rather than two: an item is on the timeline exactly when it has
 * a time that can be **read**. A due time the clock cannot parse is treated as
 * no time at all — which is the honest reading of it, and it lands the item in
 * the unscheduled list where a person can still see it, rather than at the front
 * of the timeline under a date nobody can render.
 *
 * @param dueAt - the item's due time, or null.
 * @returns its due time as milliseconds, or null when it has none to place.
 */
function dueTime(dueAt: string | null): number | null {
  if (dueAt === null) return null;
  const when = Date.parse(dueAt);
  return Number.isNaN(when) ? null : when;
}

/**
 * What is still to do, out of every item caught so far.
 *
 * **Done items are dropped here and only here.** Both lists answer "what is
 * still to do", so a finished item belongs in neither — but it is not gone: it
 * is still an item, still readable through `listItems`, and still says when it
 * was due. What is finished is the asking, not the fact.
 *
 * Ordering, and why it is two different orders:
 *
 *  - **Due**, soonest first, by the moment itself rather than by the string.
 *    ISO-8601 in UTC sorts the same either way, and date-only due times — the
 *    common case for a provider reading 「下周三」 — do not. What the user is
 *    owed is the order the dates are in, not the order the text is in. Ties keep
 *    the order they were caught in, which is the store's own, so two things due
 *    at the same moment do not swap places between reads.
 *  - **Unscheduled**, oldest first: the order they were said. There is no other
 *    order available for them, and inventing one (alphabetical, longest first)
 *    would be pretending to a judgement the product does not have.
 *
 * Items with no usable time at all are placed by nothing, so the moment passed
 * in does not affect them — it is taken, and used, only for the dated list.
 *
 * @param items - every item caught so far, oldest first, as the store returns them.
 * @param at - the moment being read against, ISO-8601, from the domain's clock.
 * @returns the dated items soonest first, and the undated ones oldest first.
 */
export function upcomingFrom(items: readonly Item[], at: string): Upcoming {
  const due: { readonly item: Item; readonly when: number }[] = [];
  const unscheduled: Item[] = [];

  for (const item of items) {
    if (item.state !== DEFAULT_ITEM_STATE) continue;
    const when = dueTime(item.dueAt);
    if (when === null) unscheduled.push(item);
    else due.push({ item, when });
  }

  // Sorted on a copy, and stably: `Array.prototype.sort` is stable, so items
  // caught in one order come back in it when their moments are equal.
  const ordered = [...due].sort((left, right) => left.when - right.when);

  return {
    // The moment is read, not used to filter: an overdue item is the thing most
    // worth doing, so it leads the list rather than being hidden from it. What
    // `at` is for is being the *same* moment every decision in one read is made
    // from — see `core.ts`, which owns the clock.
    due: ordered.map((entry) => entry.item),
    unscheduled,
  };
}
