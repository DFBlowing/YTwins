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

import type {
  ConclusionKind,
  ConclusionRelation,
  ConclusionTier,
  InputType,
  ItemState,
  LinkKind,
} from './interface.ts';

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
   * The term that carried the feeling or the decision this drop was about, or
   * null when it carried neither.
   *
   * Kept on the drop because it is a reading of *this* drop: what a matter
   * accumulates around is the feeling the user keeps returning to, and only the
   * drop that said it knows which of its terms that was.
   */
  readonly anchorTermId: string | null;
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
  /** Whether it is still to do, or done. */
  readonly state: ItemState;
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
 * One drop that fed a matter, and the feeling it brought to it.
 *
 * Kept per drop rather than as a single count because two questions need the
 * order: which feeling the matter last carried (the sentence follows the newest
 * one), and which drop to quote when the matter may only catch a feeling rather
 * than claim a pattern.
 */
export interface MatterDrop {
  /** The drop that joined or opened the matter. */
  readonly dropId: string;
  /** The feeling or decision it brought, or null when it brought neither. */
  readonly anchorTermId: string | null;
  /** When it joined, as an ISO-8601 string. */
  readonly at: string;
}

/**
 * One **matter** as the store keeps it: the accumulation itself.
 *
 * "The same matter" is an inference the domain makes once, at the drop, and
 * writes down here — like a link, and for the same reason: it is a reading of
 * the material, not the material, and it must not silently re-run itself later
 * under different values. Ticket 05's `ConclusionPolicy` therefore changes what
 * happens *next*; what has already been attached stays attached.
 *
 * A matter is not part of the domain's interface. The user is shown the
 * **portrait** — the conclusions — not the scaffolding they were assembled from.
 */
export interface StoredMatter {
  /** Stable identity of this matter. */
  readonly id: string;
  /** The term carrying the feeling or decision that opened it. */
  readonly anchorTermId: string;
  /** When it was opened, as an ISO-8601 string. */
  readonly firstAt: string;
  /** When it was last raised, as an ISO-8601 string. */
  readonly lastAt: string;
  /**
   * How many times it has been raised.
   *
   * The unit the threshold counts, and the one the glossary fixes: "raised three
   * times" is worth more than "three days have passed" (`CONTEXT.md`, 阈值), and
   * neither is the number of terms it happened to bring. One drop that attached
   * is one, however many terms it said.
   */
  readonly raisedCount: number;
  /** Every term supporting it, in the order they were first said. */
  readonly supportTermIds: readonly string[];
  /** The drops that fed it, oldest first. */
  readonly drops: readonly MatterDrop[];
}

/** A matter that has just been opened by the drop that said its feeling. */
export interface NewMatter {
  /** The drop that opened it. */
  readonly dropId: string;
  /** The feeling or decision it opened around. */
  readonly anchorTermId: string;
  /** When, as an ISO-8601 string. */
  readonly at: string;
  /** The terms the opening drop contributed. */
  readonly termIds: readonly string[];
}

/** A drop joining a matter that already exists. */
export interface MatterGrowth {
  /** The matter being joined. */
  readonly matterId: string;
  /** The drop joining it. */
  readonly dropId: string;
  /** The feeling or decision that drop brought, or null when it brought none. */
  readonly anchorTermId: string | null;
  /** When it joined, as an ISO-8601 string. */
  readonly at: string;
  /** The terms that drop contributes. */
  readonly termIds: readonly string[];
}

/**
 * One stored conclusion.
 *
 * The three numbers beside the sentence are the ones its wording was read off,
 * stored as they stood at the time rather than recomputed later: a matter keeps
 * growing, so a conclusion that recomputed them would explain itself with
 * evidence that arrived after it spoke.
 */
export interface StoredConclusion {
  /** Stable identity of this conclusion. */
  readonly id: string;
  /** Which matter it came out of. */
  readonly matterId: string;
  /**
   * The sentence the provider wrote, before the band's frame, or null for a
   * catch.
   *
   * Kept beside `text` rather than read back out of it, because the **surfacing**
   * moment needs the sentence to put its own opening in front of (ticket 06), and
   * a frame recovered by stripping a prefix off a stored string would be a fact
   * about today's `frameFor` rather than about what was written. Null on a catch,
   * which has no sentence of its own: what it holds is the line the newest feeling
   * was already answered with.
   */
  readonly claim: string | null;
  /** The sentence, frame included. */
  readonly text: string;
  /** Whether it claims a pattern, or catches the newest feeling. */
  readonly kind: ConclusionKind;
  /** The wording band, or null for a catch. */
  readonly tier: ConclusionTier | null;
  /** How it stands to the earlier conclusion for the same matter. */
  readonly relation: ConclusionRelation;
  /** The conclusion it carries on from, or null when it opened the chain. */
  readonly supersedes: string | null;
  /** When it was assembled, as an ISO-8601 string. */
  readonly createdAt: string;
  /** How many times the matter had been raised. */
  readonly mentions: number;
  /** How many whole days it had spanned. */
  readonly spanDays: number;
  /** How tightly its support connected to the feeling, 0 to 1. */
  readonly averageStrength: number;
  /** The terms supporting it, in the order they were said. */
  readonly supportTermIds: readonly string[];
}

/** A conclusion the store has not minted an id for yet. */
export type NewConclusion = Omit<StoredConclusion, 'id'>;

/**
 * One **surfacing** as the store keeps it: a conclusion shown to the user, and
 * when.
 *
 * The record exists for one rule — "the same topic does not surface twice inside
 * seven days" — and that rule has to survive a restart, so it is a row rather
 * than something the running process remembers. What counts as the same topic is
 * the support behind **what was shown**, which is why the terms travel with the
 * record: they are the fact the cooldown is measured on, read from the
 * conclusion's own support rather than restated here.
 */
export interface StoredSurfacing {
  /** Stable identity of this surfacing. */
  readonly id: string;
  /** The conclusion that was shown. */
  readonly conclusionId: string;
  /** When it was shown, as an ISO-8601 string. */
  readonly surfacedAt: string;
  /** The terms that stood behind it, in the order they were said. */
  readonly supportTermIds: readonly string[];
}

/**
 * How far the invisible settling has got.
 *
 * Deliberately about *timing* only — how much has piled up, and which way the
 * alternation points. Nothing here says whether anything is due: that is read
 * from the matters, which is what keeps "which matter crossed" in one place
 * instead of two that can disagree.
 *
 * There is no "when the last fragment landed" beside it, and that is on purpose:
 * the quiet window is carried by a timer armed at the drop itself, so a stored
 * moment would be a second record of the same fact with nothing reading it. A
 * pile left behind by a shutdown simply waits for the next drop, which arms the
 * window again.
 */
export interface StoredSettlement {
  /**
   * How many drops have joined the accumulation since the last look.
   *
   * The pile the backstop counts, and deliberately not the number of *arrivals*:
   * what a look judges is the material that has been read and attached, and a
   * count of anything else would force a look at a pile that is not there yet —
   * which is exactly the wrong moment, since the fragment that tripped the
   * backstop would be the one missing from it.
   */
  readonly dropsSince: number;
  /**
   * Which way the next crossing looks: now, or on the quiet window.
   *
   * The alternation is stored rather than derived because it is a decision about
   * the future: a restart must not turn "wait for the quiet window" back into
   * "look now", or the rhythm would restart with the process.
   */
  readonly lookNowNext: boolean;
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
  /**
   * The term that carries the drop's feeling or decision, or null.
   *
   * One of `terms` above, or nothing: a reading that names something it did not
   * list is a reading that contradicts itself, and the store records "no anchor"
   * for it rather than inventing a term.
   */
  readonly anchor: string | null;
}

/**
 * What the store made of one drop's reading.
 *
 * The two things it resolved, rather than what it was handed: a term's identity
 * is minted here, and the anchor's is resolved here (the reading names a wording,
 * the store knows whether that wording is one of the drop's own terms). Handing
 * them back keeps the caller from reading the drop it already has — that row was
 * captured *before* the reading landed, and its anchor is still empty.
 */
export interface RecordedReading {
  /** The terms this drop said, in the order it said them, with their ids. */
  readonly terms: readonly StoredTerm[];
  /**
   * The term the drop is about, or null when nothing was read or the anchor was
   * not one of the drop's own terms.
   */
  readonly anchorTermId: string | null;
}

/**
 * What the domain core needs from persistence.
 *
 * Deliberately narrow: it records drops and what was read out of them — items,
 * terms, the links that follow from both being said together — and reads them
 * back. It also keeps the two things ticket 05 settles into — the **matters**
 * material accumulates into, and the conclusions assembled out of them — and what
 * ticket 06 shows of them: the **surfacings**, which are what the cooldown is
 * measured from. Later tickets widen this port as they add entities.
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
   * @param at - when it arrived, as an ISO-8601 string, from the domain's clock.
   */
  appendDrop(body: string, reply: string, at: string): Promise<StoredDrop>;

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
   * @param at - when it was read, as an ISO-8601 string, from the domain's clock.
   * @returns the terms this drop said, and what it turned out to be about.
   */
  recordExtraction(dropId: string, outcome: ExtractOutcome, at: string): Promise<RecordedReading>;

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
   * Record where one item now stands: still to do, or done.
   *
   * A write of its own rather than part of `recordExtraction`, because the two
   * are about different things and happen at different times: extraction says
   * what the drop turned out to contain, and this says what the user did about
   * it afterwards. It is also the only thing the user ever changes in this
   * product (`CONTEXT.md`, 无感 — nothing is asked of them, but a list of what
   * to do is theirs to tick off).
   *
   * @param itemId - the item being advanced.
   * @param state - where it now stands.
   * @returns the item as it now stands, or null when there is no such item.
   */
  setItemState(itemId: string, state: ItemState): Promise<StoredItem | null>;

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

  /** Every matter recorded so far, oldest first, each with its support. */
  listMatters(): Promise<readonly StoredMatter[]>;

  /**
   * Open a matter around the feeling or decision that opened it.
   *
   * The opening drop is its first member and its terms its first support, so a
   * matter never exists with nothing in it — an empty accumulation would be a
   * thing to judge with no evidence behind it.
   *
   * @param matter - the drop, the anchor and the terms.
   * @returns the matter as it now stands.
   */
  openMatter(matter: NewMatter): Promise<StoredMatter>;

  /**
   * Add a drop to a matter that already exists.
   *
   * Adding is idempotent per drop: a drop already recorded as a member of the
   * matter is left alone, so a re-run converges rather than counting the same
   * fragment twice — the raised count is the threshold's unit, and counting one
   * drop twice would lower it.
   *
   * @param growth - the matter, the drop, and what it contributes.
   */
  growMatter(growth: MatterGrowth): Promise<void>;

  /**
   * Which matter a drop has already been accumulated into, or null.
   *
   * Asked before accumulating, so a drop that has already been read into a
   * matter is not read into it again.
   *
   * @param dropId - the drop to look for.
   * @returns the matter's id, or null when the drop is in none.
   */
  matterForDrop(dropId: string): Promise<string | null>;

  /** Every conclusion assembled so far, oldest first. */
  listConclusions(): Promise<readonly StoredConclusion[]>;

  /**
   * Write a conclusion that has been assembled.
   *
   * Append-only, and the store must not replace or merge anything: the chain
   * only grows, because a judgement the product once made is part of the record
   * even after it has been revised. The support terms are written with it, in
   * the order they were said, since that is what the user is shown.
   *
   * @param conclusion - the conclusion to write, without an id.
   * @returns the conclusion as stored, with the id the store minted.
   */
  appendConclusion(conclusion: NewConclusion): Promise<StoredConclusion>;

  /** Every surfacing so far, oldest first, each with the terms behind it. */
  listSurfacings(): Promise<readonly StoredSurfacing[]>;

  /**
   * Record that a conclusion was shown to the user.
   *
   * Written **when it is shown**, not when it is decided, because that is the
   * moment the cooldown is measured from: a conclusion assembled a week ago and
   * surfaced today keeps the topic quiet for a week from today. The row is what
   * makes the rule outlive the process.
   *
   * @param conclusionId - the conclusion that was shown.
   * @param at - when, as an ISO-8601 string, from the domain's clock.
   * @returns the surfacing as stored, with the terms that stood behind it.
   */
  recordSurfacing(conclusionId: string, at: string): Promise<StoredSurfacing>;

  /** How far the invisible settling has got. */
  readSettlement(): Promise<StoredSettlement>;

  /**
   * Record that one drop has joined the accumulation.
   *
   * Called once per drop that attached to a matter — not for one that had
   * nothing to accumulate around — because the pile exists to be judged, and a
   * fragment already read into nothing adds nothing to judge. It is also what
   * arms the backstop, which counts *drops* rather than elapsed time: someone who
   * types six fragments in one sitting has given the domain six things to look
   * at, whether or not a minute has passed.
   */
  noteAttachment(): Promise<void>;

  /**
   * Record which way the next crossing looks.
   *
   * One value, written on its own rather than as part of the whole state: the
   * counts beside it are incremented by the drops as they arrive, and rewriting
   * the row from a value read a moment ago would quietly undo one of them.
   *
   * @param lookNowNext - true when the next crossing looks immediately.
   */
  setLookNowNext(lookNowNext: boolean): Promise<void>;

  /**
   * Record that a look happened, so the pile starts again.
   *
   * Its own write for the same reason as the turn: the arrival it would have to
   * rewrite alongside it is being updated by the drops themselves.
   */
  resetPile(): Promise<void>;

  /** Release the underlying resource. */
  close(): Promise<void>;
}
