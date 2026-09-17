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
 * Where an item stands: still to do, or done.
 *
 * Two values rather than a status the user picks from, because the product's
 * promise is that nothing is asked of them. An item is **todo** the moment it is
 * caught, and the only thing anyone ever does to it is say it is finished —
 * there is no "in progress", no priority, no category, and none of those is
 * coming. What the two are for is the list: it says what is still to do.
 */
export type ItemState = 'todo' | 'done';

/** Every state, so the store can read one back and refuse to invent one. */
export const ITEM_STATES: readonly ItemState[] = ['todo', 'done'];

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
  /** Whether it is still to do, or done. */
  readonly state: ItemState;
  /** The drop this item was parsed out of. Nothing exists without a source. */
  readonly dropId: string;
}

/**
 * One thing the user said that can be brought up again, in their own words.
 *
 * "Wants to learn guitar" is a term; "music interest" is not — turning the first
 * into the second throws away the only evidence the product works from. Saying
 * the same words on another day is the **same** term, which is what lets a
 * subject accumulate instead of scattering into one-off strings.
 */
export interface Term {
  /** Stable identity of this term. */
  readonly id: string;
  /** The user's own wording — the string that arrived, trimmed and nothing else. */
  readonly text: string;
  /**
   * The drop this term first came from.
   *
   * The *first* one, not the last: a term said again is the same term, so this
   * is where it came from rather than where it was last heard.
   */
  readonly dropId: string;
  /** When it was first said, as an ISO-8601 string. */
  readonly firstSeenAt: string;
}

/**
 * How two terms came to be connected.
 *
 * Two kinds, on purpose. `same-drop` is a fact about the user's own sentence —
 * two things said in one breath — and costs no model call at all. `similar` is
 * a reading of what the words mean, so it is a **judgment** and is weaker
 * evidence by construction.
 */
export type LinkKind = 'same-drop' | 'similar';

/**
 * Every kind of link, in the order the product offers them.
 *
 * A runtime list beside the type for the same reason `INPUT_TYPES` exists: the
 * storage adapter has to read a kind back out of a file, and a value it does not
 * recognise must not become a kind the domain never wrote.
 */
export const LINK_KINDS: readonly LinkKind[] = ['same-drop', 'similar'];

/** One term, named well enough to show without a second lookup. */
export interface NamedTerm {
  /** Identity of the term. */
  readonly id: string;
  /** The user's own wording for it. */
  readonly text: string;
}

/**
 * One end of a link: enough to name the term, no more.
 *
 * A `NamedTerm` by another name — the shape is shared rather than duplicated
 * because a link's end and a conclusion's supporting term are the same fact, and
 * two spellings of it would drift.
 */
export type LinkedTerm = NamedTerm;

/**
 * Two terms that have been connected in the user's own material.
 *
 * Both ends carry their wording, so a link can be read on its own — "what got
 * connected?" is the question this answers, and an id pair would answer it only
 * for someone holding the other table.
 */
export interface TermLink {
  /** Stable identity of this link. */
  readonly id: string;
  /** Which kind of evidence produced it. */
  readonly kind: LinkKind;
  /**
   * How strong the connection is, on one scale shared by both kinds.
   *
   * Comparable, not calibrated: a hard edge is 1 because two things said in one
   * breath are certain to have been said together, and a semantic edge carries
   * the score it earned. See the caution in `linking.ts` — a cosine is not a
   * probability, so this orders evidence rather than measuring belief.
   */
  readonly strength: number;
  /** Why this link exists, in words a person can read. */
  readonly reason: string;
  /** One end. The relation is symmetric; which end is which is not meaningful. */
  readonly from: LinkedTerm;
  /** The other end. */
  readonly to: LinkedTerm;
}

/**
 * How firmly a conclusion may speak.
 *
 * Three bands rather than a free choice of tone, because the strength of the
 * wording has to be answerable from numbers afterwards — see `conclusions.ts`.
 * A band is read off how many terms support the conclusion, how long the matter
 * has spanned and how tightly those terms connect to the feeling it is about.
 * None of the three is the threshold: that decides whether it may speak at all.
 */
export type ConclusionTier = 'weak' | 'medium' | 'strong';

/** Every band, so the store can read one back and refuse to invent one. */
export const CONCLUSION_TIERS: readonly ConclusionTier[] = ['weak', 'medium', 'strong'];

/**
 * What a record on the chain is: something the product worked out, or something
 * the user did to it.
 *
 * A `catch` is what the product says when it has crossed the threshold but does
 * not have enough material to say anything about a pattern: it names the feeling
 * the newest fragment carried and claims nothing. It is the **substitute** for a
 * conclusion, not a weaker one — which is why it carries no tier and no
 * uncertain wording (there is nothing it is asserting).
 *
 * A `correction` is the one entry on the chain that is **not a judgement at
 * all**: it records that the user rejected the entry before it (ticket 10). It
 * is kept apart from the other two because the three ask different things of a
 * reader — "this is what I make of you", "this is as much as I can hold", "this
 * is what you told me about the last one" — and because the chain's whole
 * promise is that the product's past cannot be quietly edited: the rejection is
 * added beside the sentence, never written over it.
 */
export type ConclusionKind = 'claim' | 'catch' | 'correction';

/** Every kind, for the same reason as `CONCLUSION_TIERS`. */
export const CONCLUSION_KINDS: readonly ConclusionKind[] = ['claim', 'catch', 'correction'];

/**
 * How a conclusion stands to the one before it in the same matter.
 *
 * `first` opens the chain for that matter, `inherit` carries it on, and
 * `overturn` is the user's own correction of the one before it (ticket 10).
 * `overturn` is the relation a `correction` always carries, and the two are not
 * the same fact: the kind says what the record is, the relation says how it
 * stands — and a store reading a relation it cannot name must not quietly drop
 * the conclusion carrying it.
 */
export type ConclusionRelation = 'first' | 'inherit' | 'overturn';

/** Every relation, for the same reason as `CONCLUSION_TIERS`. */
export const CONCLUSION_RELATIONS: readonly ConclusionRelation[] = ['first', 'inherit', 'overturn'];

/** A conclusion named well enough to point at another one. */
export interface ConclusionRef {
  /** Identity of the conclusion referred to. */
  readonly id: string;
  /** The sentence it said, so the reference reads on its own. */
  readonly text: string;
}

/**
 * One thing the product worked out about the user, in its own words.
 *
 * A conclusion is a **judgement**: it comes out of material the user never
 * curated, so it is always stated with the uncertainty the evidence earns. It
 * carries the terms that support it, because a judgement nobody can check
 * against their own words is not one they can trust — and it carries the numbers
 * its wording was read off, because "why did it say that then" has an answer.
 */
export interface Conclusion {
  /** Stable identity of this conclusion. */
  readonly id: string;
  /** The sentence the user reads, frame included. */
  readonly text: string;
  /**
   * Whether it claims a pattern, catches the newest feeling, or records a
   * correction the user made.
   */
  readonly kind: ConclusionKind;
  /**
   * The wording band the numbers earned, or null when there is no assertion to
   * be in one.
   *
   * Null is not "unknown": a catch and a correction both assert nothing about
   * the user — one holds a line that was already said to them, the other records
   * something they did — so there is no strength of assertion for either to be
   * in.
   *
   * This is the band the sentence was actually written in, which on a matter the
   * user has rejected is one step below what the three numbers below earn. That
   * difference is not left to be inferred: see `softened`.
   */
  readonly tier: ConclusionTier | null;
  /**
   * Whether the band above was written one step below what the numbers earned.
   *
   * True only where the step actually changed something: a claim whose numbers
   * already earned the weakest band is not "softened", because nothing was. It
   * travels with the record rather than being derived from the chain later,
   * because it is a fact about **the moment the sentence was written** — and
   * because the alternative is a portrait where the band and the numbers beside
   * it tell two stories, which is exactly what reading a band off numbers exists
   * to prevent (`conclusions.ts`). The page shows it as the fourth input: the
   * numbers, and the user's own rejection.
   */
  readonly softened: boolean;
  /** How it stands to the earlier conclusion for the same matter. */
  readonly relation: ConclusionRelation;
  /** The conclusion this one carries on from, or null when it opened the chain. */
  readonly supersedes: ConclusionRef | null;
  /**
   * The conclusion that carries on from this one, or null while it is the latest.
   *
   * The other half of `supersedes`, and derived from it rather than stored:
   * a conclusion does not know it will be revised, so nothing could write this
   * at the time. It is what lets the chain be read forwards and backwards.
   */
  readonly supersededBy: ConclusionRef | null;
  /** When it was assembled, as an ISO-8601 string. */
  readonly createdAt: string;
  /**
   * The terms that support it, in the user's own words and in the order said.
   *
   * The whole accumulated set, not only what arrived since the last conclusion:
   * what the sentence is about is the matter, and a support list that named only
   * the newest fragments would show the user a smaller case than the one it made.
   *
   * Empty on a `correction`, and deliberately so: nothing was assembled for it
   * and nothing stands behind it — what it rests on is the user's own act, which
   * needs no evidence and cannot be given any.
   */
  readonly support: readonly NamedTerm[];
  /**
   * How many times the matter had been raised when this was assembled.
   *
   * Zero on a `correction`, together with the two numbers below: nothing was
   * read off them for it, and the numbers the rejected conclusion was worded by
   * are still on that conclusion, where they belong.
   */
  readonly mentions: number;
  /** How many whole days the matter had spanned, as the bands are read. */
  readonly spanDays: number;
  /** How tightly its support connects to the feeling it is about, 0 to 1. */
  readonly averageStrength: number;
}

/** What a drop caught, plus the line the user gets back. */
export interface DropResult {
  /**
   * A faithful copy of what the user typed. Stored verbatim — never a summary —
   * so that later recall shows the user their own words.
   */
  readonly body: string;
  /**
   * The line the user sees. Always present: dropping something is never silent.
   *
   * The drop is answered before the provider is consulted, so what comes back
   * here is the line code itself can vouch for. Ticket 03 gives the styled one
   * its way in afterwards, and it replaces this one **only** if it passes the
   * parent-voice checks — read the drop back (see `getDrop`) to see which line
   * the drop ended up with.
   */
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
 * A sentence the user wrote beside a conclusion, and the drop it became.
 *
 * Both halves are reported because both are true at once: the sentence is a
 * **drop** like any other — stored verbatim, read for terms, answered, counted
 * when it settles — and it was written *beside one particular conclusion*, which
 * is why it is told apart from a fragment typed into the box at the top. What a
 * caller does with it is the page's business; what it must not do is treat the
 * two halves as one thing, and this shape is what keeps that from happening.
 */
export interface ConclusionAddition {
  /**
   * The conclusion it was written beside, named well enough to point at.
   *
   * The same reading a person would take: the note belongs to *that* sentence,
   * which is why it is written here rather than left to be inferred from the
   * words the note happened to use.
   */
  readonly conclusion: ConclusionRef;
  /** The drop the sentence became, in the shape `drop` hands one back. */
  readonly drop: DropResult;
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
   * The terms this drop yielded, in the order they were said. Empty until
   * extraction has run, and empty forever if it failed — both are ordinary,
   * because the drop itself already succeeded.
   *
   * A term already known from an earlier drop appears here too: what this drop
   * said is a fact about this drop, whatever else it is a fact about.
   */
  readonly terms: readonly Term[];
  /**
   * Whether extraction has run for this drop, successfully or not.
   *
   * `false` means "nothing has been read out of it yet, and asking again might
   * work" — which is exactly what the page needs to decide whether to keep
   * waiting. It is deliberately not exposed as a type or a category: it says
   * whether the work is done, never what the drop was judged to be.
   */
  readonly extracted: boolean;
  /**
   * The line this drop answers with, as it stands now.
   *
   * Rendered as the drop's own line rather than a page-level "last reply", so
   * that a refresh shows exactly what was said the first time. It starts as the
   * line code can vouch for and is replaced by the provider's once — and only
   * once — that line has passed the parent-voice checks.
   */
  readonly reply: string;
}

/**
 * Where an answer came from: one drop it was recalled out of.
 *
 * The **body** is the point of this type. Recall's whole promise is that the
 * user can check the answer against what they actually typed, so the verbatim
 * original travels with the answer rather than being fetched separately — a
 * second lookup could fail, or find something the answer was not based on.
 */
export interface RecallSource {
  /** Identity of the drop the answer came from. */
  readonly dropId: string;
  /** The user's original words, byte-for-byte. */
  readonly body: string;
  /** When that drop was recorded, as an ISO-8601 string. */
  readonly droppedAt: string;
}

/**
 * The outcome of asking a question of the user's **records**.
 *
 * A discriminated union rather than an optional answer, because the difference
 * between "here is your answer" and "I could not answer that" is the whole point
 * of this feature. A caller cannot reach either without having decided which it
 * got, and there is no shape in which an empty string can be mistaken for an
 * answer.
 *
 * The two failures are kept apart on purpose. `not-found` says **the user's
 * records do not cover this** — a claim about their data. `unavailable` says
 * **the question could not be put to them at all** — a claim about this attempt.
 * Collapsing them would let a provider outage be reported to the user as "you
 * never wrote about this", which is a lie about their own records and the one
 * thing this feature must never do.
 */
export type RecallResult =
  | {
      /** The question was answered from the records. */
      readonly kind: 'answered';
      /** The answer sentence. */
      readonly answer: string;
      /**
       * Every drop the answer was composed from, oldest first. Never empty.
       *
       * All of them, not one: the composer is handed every match and may draw
       * on any of them, so citing a single "main" source would name a drop the
       * answer may not have come from — and being able to check the answer is
       * the reason the source is shown at all.
       */
      readonly sources: readonly RecallSource[];
    }
  | {
      /**
       * The records were searched, and nothing in them covers this question.
       *
       * A real answer, not a failure: the product is trusted precisely because
       * it says this instead of inventing something plausible.
       */
      readonly kind: 'not-found';
    }
  | {
      /**
       * The question could not be put to the records at all.
       *
       * Nothing was searched, so no claim is made about what the records do or
       * do not contain. Distinguished from `not-found` so the user is never
       * told their own records lack something that was never looked for.
       */
      readonly kind: 'unavailable';
    };

/**
 * What a caller may pin when recalling.
 *
 * A named object rather than positional arguments because the pinned moment and
 * the question travel together through every layer — the page, the API, the
 * core and the port — and naming them once keeps that path legible.
 */
export interface RecallOptions {
  /**
   * The moment to answer *as of*, as an ISO-8601 string.
   *
   * Lets the demo hold the "a few days later" viewpoint without waiting, which
   * is what makes this step verifiable early. It changes how the answer is
   * worded and how it refers to time; it never changes which records answer the
   * question. Defaults to the real present.
   */
  readonly now?: string;
}

/**
 * Why nothing was surfaced.
 *
 * Zero is an ordinary outcome, never an error (`spec.md`, 浮现). The reasons are
 * kept apart because they are different facts about the product: a drop that was
 * not a moment at all, material that has not settled into anything sayable,
 * something sayable that the user has already heard this week, and a turn the
 * product chose not to use. The page shows nothing for any of them — surfacing
 * does not push — so these are for the domain and its checks, not for the user.
 */
export type SurfacingMiss =
  /**
   * This drop was not one the product speaks after.
   *
   * Only a drop carrying a feeling, or a question the user asked, is. Kept apart
   * from `nothing-to-say` because it is a fact about the moment rather than about
   * the material: there may be plenty to say and this is still not when.
   */
  | 'not-a-moment'
  /**
   * The material has not settled into a judgement.
   *
   * Either no matter has crossed the threshold, or the newest thing a matter
   * settled into is a **catch** — which asserts nothing, so there is nothing to
   * put in front of the user as an observation.
   */
  | 'nothing-to-say'
  /** Everything sayable has already been said within the cooldown — the same topic, inside seven days. */
  | 'cooldown'
  /** There was something to say, and this is a turn the product did not use — see `SurfacingPolicy.surfaceChance`. */
  | 'held-back';

/**
 * What came of asking the product to speak first.
 *
 * A discriminated union rather than an optional conclusion, because **zero is a
 * result**: "nothing this time" and "here is the one line" are different
 * outcomes and a caller should have to have decided which it got.
 *
 * Every number beside the sentence is one its wording was read off — the same
 * three a conclusion carries — so "why did it say that back then" stays
 * answerable about the moment it was said, not only about the portrait.
 */
export type SurfacingResult =
  | {
      /** One conclusion was shown to the user. */
      readonly kind: 'surfaced';
      /**
       * The line the user reads: the conclusion's own sentence, in the wording
       * its band owns.
       *
       * The product decides how firmly it may speak — that is what the band was
       * read off — and it writes that in front of the sentence rather than
       * judging the sentence's tone, because whether a line "reads as an
       * assertion" cannot be decided from the string. The conclusion in the
       * portrait is left exactly as it was assembled; what differs here is the
       * layer around it, and the same band may be worded differently twice.
       */
      readonly text: string;
      /** The band its wording was read off. Never null: only a claim is ever surfaced. */
      readonly tier: ConclusionTier;
      /** The conclusion that was shown, so the portrait can be read against it. */
      readonly conclusion: ConclusionRef;
      /** The terms behind it, in the user's own words and in the order said. */
      readonly support: readonly NamedTerm[];
      /** How many times the matter had been raised when it was assembled. */
      readonly mentions: number;
      /** How long it had spanned, as the band was read. */
      readonly spanDays: number;
      /** How tightly its support connected to the feeling it is about. */
      readonly averageStrength: number;
      /** When it was shown, as an ISO-8601 string. */
      readonly surfacedAt: string;
    }
  | {
      /** Nothing was shown, which is a normal outcome and not a failure. */
      readonly kind: 'none';
      /** Which of the ordinary reasons applies. */
      readonly reason: SurfacingMiss;
    };

/**
 * What raised the moment a surfacing is being asked for.
 *
 * A named object rather than a positional argument for the same reason as
 * `RecallOptions`: the reading travels through the page, the API and the core,
 * and naming it once keeps that path legible.
 */
export interface SurfacingOptions {
  /**
   * The drop that just arrived, when a drop is what raised the moment.
   *
   * Omitted when the user asked directly. The two are **not** the same trigger:
   * a drop has to carry a feeling to be a moment at all, and whether this turn is
   * used is rolled for; a question is always put to the material and always
   * answered, and is never rolled for.
   */
  readonly dropId?: string;
}

/**
 * What the user may do about a conclusion a deletion would take with it.
 *
 * Two answers and no third, because these are the two things a person actually
 * means when they delete a fragment they typed: *forget this* (and what I worked
 * out from it was wrong or unwanted too), or *forget I said it* (while what it
 * taught the product stands). There is deliberately no "keep the words, drop the
 * judgement": the words are the only evidence the judgement can be checked
 * against, so keeping it without them would leave the user a sentence they can no
 * longer account for — which is exactly what this product refuses to show.
 *
 * `keep` is a value rather than the absence of one so that a caller has to have
 * chosen, and so that "do nothing" is a thing a caller says rather than a thing
 * that happens by default. Deletion is the one operation here that cannot be
 * undone; it must never be the fall-through.
 */
export type DeletionMode = 'cascade' | 'original-only' | 'keep';

/** Every mode, so a caller (and the API) can refuse one it cannot name. */
export const DELETION_MODES: readonly DeletionMode[] = ['cascade', 'original-only', 'keep'];

/**
 * Whether a value that arrived from outside is one of the modes.
 *
 * A guard rather than a `some` at the call site, so that the narrowing and the
 * list cannot come apart: a caller that checked membership by hand would still be
 * holding a `string`, and the only way to hand it on would be a cast — which is
 * exactly how a mode the domain never wrote reaches `deleteDrop`.
 *
 * @param value - anything that claims to be a deletion mode.
 * @returns whether it is one.
 */
export function isDeletionMode(value: unknown): value is DeletionMode {
  return DELETION_MODES.some((known) => known === value);
}

/**
 * What deleting one **drop** would affect, counted before anything is removed.
 *
 * This exists because the user is owed an announcement, not a report: the whole
 * reason deletion is two steps in this product is that a fragment people typed
 * casually can turn out to be load-bearing, and finding that out *afterwards* is
 * how a product loses someone's trust in one keystroke.
 */
export interface DeletionPreview {
  /** The drop being asked about. */
  readonly dropId: string;
  /** The user's original text, so the announcement can name what is at stake. */
  readonly body: string;
  /**
   * The conclusions that came out of this drop, oldest first.
   *
   * The **conclusions themselves** rather than a count, because a number alone
   * is not something anyone can decide on: "2 conclusions came from it" asks the
   * user to trust a tally, while showing the two sentences asks them to
   * recognize what they would be giving up. The count the spec asks for is this
   * list's length, and the page says it in those words.
   */
  readonly conclusions: readonly ConclusionRef[];
  /**
   * The words this drop alone said, and which would therefore go with it.
   *
   * Only the ones no other drop also said, because a wording the user repeated
   * elsewhere stays — what is being deleted is one fragment, not a word they use.
   */
  readonly terms: readonly string[];
}

/**
 * The outcome of a deletion that happened.
 *
 * Deliberately not a confirmation of the request that was made: it says which
 * conclusions went, so a caller can report what actually happened rather than
 * what was asked for — and under `original-only` that list is empty, which is the
 * whole meaning of that choice. A caller that only wants "did anything happen"
 * reads `null` from `deleteDrop`; one that wants to tell the user what they lost
 * reads this.
 */
export interface DeletionResult {
  /** The drop that is now gone. */
  readonly dropId: string;
  /**
   * The conclusions that went with it, and **only ever the ones that went**.
   *
   * Empty under `original-only`: the judgements the user chose to keep are still
   * in the portrait, and reporting them here would read as a deletion that
   * happened to them.
   */
  readonly conclusions: readonly ConclusionRef[];
  /** The mode that was carried out. */
  readonly mode: DeletionMode;
}

/**
 * What is still to do, arranged on the timeline.
 *
 * A named shape rather than two return values or one list with a flag, because
 * the two halves answer different questions and a caller has to have decided
 * which it is showing: **due** is ordered by when, and **unscheduled** has no
 * when to be ordered by. A single list would put an item with no date next to
 * one with a date and let the page imply an order that does not exist.
 */
export interface Upcoming {
  /**
   * Everything with a time, soonest first.
   *
   * Overdue items are at the front of it, still dated: a deadline that has
   * passed is the thing most worth doing, not the thing to stop showing.
   */
  readonly due: readonly Item[];
  /**
   * Everything with no parsed time, oldest first.
   *
   * Kept and listed. This list is the product's promise that nothing typed is
   * silently lost, so an empty one means the user has said nothing undated —
   * never "this was not worth showing".
   */
  readonly unscheduled: readonly Item[];
}

/**
 * The domain core.
 *
 * Ticket 01 opened exactly one operation: **dropping**. Ticket 02 opened what
 * dropping turns out to mean — a drop is split into **items** and a **record**.
 * Ticket 04 opened what the record accumulates into: a drop yields **terms**,
 * and terms grow **links** between them. Ticket 07 opens **recall**: asking a
 * question of those records and being told both the answer and which drop it
 * came from. Ticket 05 opens what the accumulation settles into: when a matter
 * has been raised enough times, it becomes a **conclusion**, and the portrait is
 * the set of those conclusions. Ticket 06 opens the one moment the product speaks
 * first: a conclusion may be **surfaced** — shown to the user on a drop that
 * carries a feeling, or when the user asks — at most one per turn, never twice
 * for the same topic inside a week, and only if it is stated as an observation
 * rather than as a fact. Ticket 08 opens **scheduling**: the items caught so far,
 * placed on the timeline and read as what is still to do. The remaining
 * operations named in the spec's interface (deletion, and what the user may do
 * to a conclusion) arrive with their own tickets — this interface grows, it does
 * not get pre-declared with stubs that would fake behaviour.
 *
 * Ticket 09 opens the one operation that destroys rather than accumulates:
 * **deletion**. It is two operations and not one because the announcement is not
 * a courtesy here — a fragment dropped in passing can turn out to be the ground a
 * judgement stands on, and the user is owed that fact *before* they act on it.
 * `previewDeletion` answers what would go; `deleteDrop` carries out a choice the
 * caller has to have made, and `keep` is a value rather than an omission so that
 * "delete nothing" cannot happen by accident.
 *
 * Ticket 10 opens the two things the user may do to a conclusion, and both are
 * light on purpose (`CONTEXT.md`, 结论链): marking one wrong adds a record of the
 * correction beside it rather than touching the sentence it rejects, and writing
 * a sentence of their own beside it makes that sentence a **drop**, which is to
 * say the same kind of thing as anything else they type. Neither is a rating, a
 * like or a bulk answer — that is the line this product does not cross, because
 * a portrait the user maintains is a portrait they have been made to work on.
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
   * The items still to do, soonest first, with the undated ones kept apart.
   *
   * This is **scheduling**: everything time-bound is placed on the timeline
   * whether or not anyone filled a date in, and what has no time is listed
   * rather than dropped. Two lists and not one, because "due on Thursday" and
   * "no date at all" are different facts, and merging them would either invent
   * a date for the second or hide it behind the first.
   *
   * **Soonest first, and that includes what is already overdue** — a date that
   * has passed sorts to the front rather than falling off, because it is the
   * thing most worth doing. An item that is **done** is in neither list: the
   * question this answers is what is still to do.
   *
   * The due times are read against the domain's own clock, the same one every
   * other decision is made from, so "what is due" is the same answer twice in a
   * row and a check can pin the moment rather than wait for one.
   *
   * There is deliberately no calendar here and no notion of two things clashing.
   * The product does not tell the user their evening is overbooked; it tells
   * them what is coming.
   *
   * @returns the dated items soonest first, and the undated ones oldest first.
   */
  upcoming(): Promise<Upcoming>;

  /**
   * Advance one item's **state** — from todo to done, or back again.
   *
   * Reversible on purpose: a box ticked by mistake must be untickable, and
   * "done" is a fact the user corrects rather than a commitment they made. The
   * change is written down, so it survives a refresh, a restart and a new
   * session — the whole point of a list is that it remembers.
   *
   * @param itemId - identity of the item to advance.
   * @param state - where it now stands.
   * @returns the item as it now stands, or null when there is no such item.
   */
  setItemState(itemId: string, state: ItemState): Promise<Item | null>;

  /**
   * Every **link** that has grown between the user's terms.
   *
   * Links belong to no single drop — they are the accumulation itself, and one
   * of them can join a term said today to one said months ago. Each carries its
   * kind, a comparable strength and the reason it exists, because a connection
   * the user cannot account for is a connection they cannot trust.
   *
   * @returns every link, oldest first.
   */
  listLinks(): Promise<readonly TermLink[]>;

  /**
   * The **portrait**: every conclusion assembled so far, oldest first.
   *
   * The portrait is this list and nothing else — there is no second, hidden
   * model of the user anywhere behind it. Each conclusion carries the terms that
   * support it and how it stands to the one before it in its matter, which is
   * also the **conclusion chain**: the relations between these conclusions are
   * the chain, so reading it is reading this, not a second store.
   *
   * Read-only, and that is the shape of the product rather than an omission:
   * settling needs no participation from the user, so there is no step here to
   * maintain. The two things the user may do to a conclusion are
   * `markConclusionWrong` and `appendToConclusion` below, and neither of them is a
   * way of maintaining anything.
   *
   * @returns every conclusion, oldest first.
   */
  listConclusions(): Promise<readonly Conclusion[]>;

  /**
   * Mark one conclusion wrong, as the user's own correction of it.
   *
   * The **chain only grows**. The conclusion being rejected is not overwritten,
   * not invalidated and not deleted: it keeps its sentence, its evidence and its
   * place, and what is added is a record beside it saying which one it replaces.
   * That asymmetry is the point — the portrait is a history of what the product
   * made of the user's material as it stood, and a history that can be edited
   * after the fact is not one (ticket 09 reached the same conclusion about
   * deletion, which is the other operation that could have rewritten the past).
   *
   * The record is **code's own line**: a fact about what the user did, stated
   * plainly, with no model involved and no uncertainty wording. There is nothing
   * for a model to judge here — the user has just told the product the judgement
   * was wrong — and asking one to phrase it would be the product inventing a
   * reading to take the place of the one it just lost.
   *
   * The rejection also reaches the material, and that is deliberate: a matter the
   * user has rejected stops taking in fragments that merely look like it, and
   * anything said about it afterwards is hedged a band further (see
   * `ConclusionPolicy`). Saying "that is wrong" and then having the same reading
   * come back tomorrow is the one answer the product must not give.
   *
   * Marking the same conclusion wrong twice records one correction, not two: the
   * second tap is the same fact, and a chain that grew a record per tap would be
   * counting the user's clicks rather than their corrections.
   *
   * Only a **judgement** may be rejected. A `correction` is the product's note of
   * something the user did — a fact about them rather than a reading of them —
   * and there is nothing in it to disagree with, so nothing is written for one.
   *
   * @param conclusionId - the conclusion the user is rejecting.
   * @returns the record added beside it, or null when **nothing was recorded**:
   *   either there is no such conclusion, or it is a correction. The two are not
   *   told apart here for the same reason `deleteDrop` does not tell "no such
   *   drop" from `keep` apart — what the caller asked for either way is "reject
   *   this", and neither answer is an error.
   */
  markConclusionWrong(conclusionId: string): Promise<Conclusion | null>;

  /**
   * Write a sentence of the user's own beside one conclusion.
   *
   * The sentence becomes a **drop** — the same kind of thing as anything typed
   * into the box at the top: stored byte-for-byte, read for its own terms, linked
   * and answered, and counted when it settles. It is told apart from an ordinary
   * drop in exactly one respect, and it is the respect the user just expressed by
   * typing there rather than at the top: it belongs to **that** conclusion's
   * matter. The product does not re-infer which thing the note was about, because
   * the user has already said so more clearly than any overlap could.
   *
   * That reading is not a shortcut. It is what keeps the note from wandering: an
   * inferred attachment would be *damped* on a matter the user has rejected
   * (`markConclusionWrong`), so a note written beside a rejected conclusion could
   * otherwise land in a matter of its own and be about nothing the user meant.
   *
   * A conclusion that does not exist is reported as null rather than as an error,
   * and nothing is written — the same reading `getDrop` takes.
   *
   * @param conclusionId - the conclusion the sentence is written beside.
   * @param body - the sentence as typed. Stored verbatim.
   * @returns the drop it became, and the conclusion it was written beside.
   */
  appendToConclusion(conclusionId: string, body: string): Promise<ConclusionAddition | null>;

  /**
   * Ask the product to **surface** one thing it has worked out.
   *
   * Two triggers, and only two (`CONTEXT.md`, 浮现): a drop that carries a
   * feeling, and a question the user asked. Every other drop is not a moment, and
   * the answer is `not-a-moment` rather than silence-by-accident.
   *
   * What it returns is at most one conclusion, and **zero is a normal result** —
   * the material may not have settled into anything sayable, the same topic may
   * have been shown inside the last seven days, or the product may simply not use
   * this turn. None of those is an error, and the page shows nothing for any of
   * them: surfacing never pushes.
   *
   * Both triggers judge **on the spot** before answering, because the moment is
   * the user's and what they see may not be stale — the last few fragments have
   * to be counted. The difference is the dice: whether a drop's turn is used is
   * rolled for, while a question is always put to the material and never rolled
   * for.
   *
   * Every surfacing is recorded, so the cooldown holds across a restart.
   *
   * @param options - the drop that raised the moment, or nothing when the user asked.
   * @returns the one conclusion shown, or the ordinary reason there is none.
   */
  requestSurfacing(options?: SurfacingOptions): Promise<SurfacingResult>;

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

  /**
   * Ask a question of the user's **records**.
   *
   * Returns the answer together with every drop it was composed from, or an
   * explicit failure that distinguishes "your records do not cover this"
   * (`not-found`) from "the question could not be put to them" (`unavailable`).
   * It never invents an answer.
   *
   * Both ends go through the AI provider port, but the *selection* between them
   * does not: which records answer the question is decided by ordinary code, so
   * the same question recalls the same records every time and "nothing matched"
   * is a fact about the data rather than a model's opinion.
   *
   * @param question - the question as typed.
   * @param options - optionally, the moment to answer as of.
   * @returns the answer and its sources, or an explicit failure.
   */
  recall(question: string, options?: RecallOptions): Promise<RecallResult>;

  /**
   * What deleting one drop **would** affect, counted before anything is removed.
   *
   * The first half of a two-step deletion, and the step that exists so the second
   * one can be a decision rather than an accident: a fragment typed in passing may
   * be the ground several judgements stand on, and the user is told that **before**
   * they act on it, in words they can recognize — the sentences themselves, not a
   * reassuring tally.
   *
   * It changes nothing. Asking twice gives the same answer twice, and a caller
   * that shows a preview and then does nothing has left the user's material
   * exactly as it was.
   *
   * A drop that does not exist is reported as null rather than as an error, the
   * same reading `getDrop` takes: "there is no such fragment" is an answer.
   *
   * @param dropId - identity of the drop being asked about.
   * @returns what a deletion would take, or null when there is no such drop.
   */
  previewDeletion(dropId: string): Promise<DeletionPreview | null>;

  /**
   * Delete one drop, according to a choice the caller has already made.
   *
   * The mode is **required on purpose**. Deletion is the only operation here that
   * cannot be undone, so there is deliberately no call shape that deletes by
   * default or on a missing argument — a caller must say what it means. `keep` is
   * one of the three answers, and it deletes nothing at all: the decision the user
   * arrived at by reading the preview counts as a decision.
   *
   * What each choice does, in the product's terms (`CONTEXT.md`, 小结论 / 画像):
   *
   *  - **`cascade`** — the fragment goes and so does everything the product worked
   *    out from it. It is the choice for "forget this, and what you made of it was
   *    wrong too", and after it nothing of the fragment survives anywhere: not in
   *    recall, not in the portrait, not in the chain, not as the words it left
   *    behind. A judgement that only that fragment supported cannot stand once the
   *    evidence is gone — leaving it would be a claim with nothing behind it.
   *  - **`original-only`** — the fragment goes and the judgements it fed **stay**,
   *    exactly as they were worded. It is the choice for "forget I said it, but
   *    what you noticed still holds". This is where the two options in the ticket
   *    part ways, and the rule is deliberately "keep, do not invalidate": the
   *    portrait is a history of what the product made of the material as it stood,
   *    and rewriting an old judgement into "this was withdrawn" would be the
   *    product editing its own past to look better. What does **not** happen is
   *    half-measures: a supporting word the deleted fragment alone had said goes,
   *    and the stored judgement is left naming one word fewer rather than pointing
   *    at a word that no longer exists.
   *  - **`keep`** — nothing is deleted, and the answer is null.
   *
   * Nothing is ever left dangling in any of the three: no support naming a word
   * that is gone, no link joining one, no chain pointing at a conclusion that no
   * longer exists.
   *
   * @param dropId - identity of the drop to delete.
   * @param mode - what the user chose to do about what came from it.
   * @returns what was removed, or null when nothing was (an unknown drop, or `keep`).
   */
  deleteDrop(dropId: string, mode: DeletionMode): Promise<DeletionResult | null>;
}
