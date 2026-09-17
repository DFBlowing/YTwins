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
 * Ticket 07 gives the **record** its purpose: **recall**. Asking a question of
 * what was kept, and being told both the answer and which drop it came from, is
 * the whole reason the original is stored verbatim rather than summarised.
 *
 * Ticket 03 gives the drop its **reply**. It is the one place where the product
 * speaks rather than listens, so it is where the parent-voice rules have to hold
 * — and they are held twice over: the provider is told them, and the reply that
 * comes back is checked against them before the user ever sees it.
 *
 * Ticket 05 gives the accumulation its **conclusion**. Everything above is about
 * what the user said; this is the first thing the product works out on its own,
 * and it is where the product's hardest constraint shows up in code: a
 * conclusion is a **judgement**, so whether it may be said at all, how firmly it
 * may be said, and what it is allowed to follow are all read off counts and
 * spans (`conclusions.ts`) rather than asked of a model. What a model is asked
 * for is the sentence — and silence is a legitimate answer to that question,
 * because a conclusion nobody could compose must never become a worse one.
 *
 * Ticket 06 gives that conclusion its one visible moment. **Surfacing** is the
 * product speaking first, into a silence nobody asked it to fill, so it is
 * hedged twice over: it happens only on a drop that carries a feeling or on a
 * question the user asked, and only a claim — a conclusion that asserts
 * something, with the sentence it was written from kept beside its framed line —
 * may be shown. What the moment decides is how firmly to speak and which sentence
 * to show; what it may not do is decide what was observed. The uncertainty is
 * written in by code rather than looked for in the sentence (`surfacing.ts`),
 * because assertion-ness cannot be read off a string, and the conclusion's own
 * line in the portrait is left exactly as it was assembled. The same topic waits
 * seven days, and every surfacing is written down where the cooldown can find it
 * after a restart.
 *
 * Ticket 09 gives the whole of the above its one destructive operation, and
 * splits it in two on purpose. **Deletion** is the only thing here that cannot be
 * undone, and the reason it takes two calls is not politeness: a fragment dropped
 * in passing can turn out to be the ground a judgement stands on, and the user is
 * owed that fact before they act rather than after. So `previewDeletion` says what
 * would go, and `deleteDrop` carries out a choice that has to be **stated** —
 * `keep` is a value, not an omission, because there must be no call shape in which
 * material disappears by default. What the two choices mean is the product's own
 * position rather than a storage detail: `cascade` is "forget this and what you
 * made of it", `original-only` is "forget I said it, and let what you noticed
 * stand" — and the second keeps the judgements word for word, because rewriting
 * an old one into "withdrawn" would be the product editing its own history to look
 * better.
 *
 * Ticket 10 gives the user the two light things they may do to a conclusion, and
 * both are shaped by the same promise the deletion above was: the portrait is a
 * history, so it grows and is never rewritten. Marking a conclusion wrong adds a
 * record of the correction beside it — code's own plain line, no model asked,
 * nothing taken back — and reaches into the material behind it, because a matter
 * the user has rejected must stop pulling in fragments that merely look like it
 * and must speak one band softer if it speaks again. Writing a sentence of one's
 * own beside a conclusion is the other half, and it goes down the ordinary drop
 * path with one thing said in advance: it belongs to **that** conclusion's matter,
 * because the user put it there.
 *
 * @module domain/core
 */

import type { AiProvider, ExtractResult } from './ai-provider.ts';
import {
  CONCLUSION_INSTRUCTIONS,
  CORRECTION_LINE,
  DEFAULT_CONCLUSION_POLICY,
  bareSentence,
  checkConclusion,
  frameFor,
  mayClaim,
  overlapOf,
  softerTier,
  spanDays,
  spreadWeight,
  tierOf,
  type ConclusionPolicy,
} from './conclusions.ts';
import type {
  Conclusion,
  ConclusionAddition,
  ConclusionKind,
  ConclusionRef,
  ConclusionRelation,
  ConclusionTier,
  DeletionMode,
  DeletionPreview,
  DeletionResult,
  Domain,
  DropResult,
  DropSummary,
  Item,
  ItemState,
  LinkedTerm,
  NamedTerm,
  RecallOptions,
  RecallResult,
  RecallSource,
  SurfacingMiss,
  SurfacingOptions,
  SurfacingResult,
  Term,
  TermLink,
  Upcoming,
} from './interface.ts';
import {
  DEFAULT_LINK_POLICY,
  SAME_DROP_REASON,
  SAME_DROP_STRENGTH,
  cosineSimilarity,
  decideLink,
  pairKey,
  similarityReason,
  type LinkPolicy,
} from './linking.ts';
import {
  REPLY_INSTRUCTIONS,
  SAFE_CATCH_REPLY,
  briefFor,
  checkReply,
  readSituation,
  safeReply,
  type ReplySituation,
} from './parent-voice.ts';
import { upcomingFrom } from './scheduling.ts';
import type {
  DropStore,
  MatterDrop,
  NewLink,
  RecordedReading,
  StoredConclusion,
  StoredDrop,
  StoredItem,
  StoredMatter,
  StoredTerm,
} from './storage.ts';
import {
  DEFAULT_SURFACING_POLICY,
  isSameTopic,
  surfacingLine,
  type SurfacingPolicy,
} from './surfacing.ts';

/** How many times a provider is asked to answer one drop. One attempt, one retry. */
const REPLY_ATTEMPTS = 2;

/**
 * How many times a provider is asked to put a matter into a sentence.
 *
 * The same shape as `REPLY_ATTEMPTS`, for the same reason: a sentence that broke
 * a rule is asked for once more, told what it broke. A second failure is not a
 * third attempt — the matter simply has not been spoken about yet, and the next
 * look may do better.
 */
const CONCLUSION_ATTEMPTS = 2;

/**
 * The line code itself can vouch for, for a drop it has only the text of.
 *
 * Used where the situation was not read on the way in — a drop recorded before
 * ticket 03 added the column.
 */
function safeLineFor(body: string): string {
  return safeReply(readSituation(body));
}

/** What the core needs to run. */
export interface DomainCoreOptions {
  /** Where drops are persisted. */
  readonly store: DropStore;
  /**
   * The AI provider port. Optional: the product must work before any provider
   * is configured, and ticket 01's tests drive both with and without one.
   */
  readonly provider?: AiProvider;
  /**
   * Where the similarity bands sit, and what the grey zone does.
   *
   * Handed in rather than read from inside, so the rule can be changed without
   * touching the linking path — and so a caller can pin one to see what a
   * different rule would have produced. Defaults to `DEFAULT_LINK_POLICY`.
   */
  readonly linkPolicy?: LinkPolicy;
  /**
   * When a matter may be spoken about, and how firmly.
   *
   * The same shape as `linkPolicy` and for the same reasons: every number here
   * is a value the prototype calibrated rather than a finding, so a caller has
   * to be able to pin a different one — which is also how the debounce is
   * checkable without racing a real clock. Defaults to
   * `DEFAULT_CONCLUSION_POLICY`.
   */
  readonly conclusionPolicy?: ConclusionPolicy;
  /**
   * What the visible moment may do: how long a topic stays quiet, how much
   * overlap makes two supports one topic, and how often a turn is used.
   *
   * The same shape as `linkPolicy` and `conclusionPolicy`, for the same reasons:
   * every number here is a value rather than a finding, so a caller has to be
   * able to pin a different one — which is also how a seven-day cooldown is
   * checkable without waiting a week.
   */
  readonly surfacingPolicy?: SurfacingPolicy;
  /**
   * A number in `[0, 1)`, the way `Math.random` gives one.
   *
   * The domain's only source of chance, and it exists because chance is part of
   * the product here: whether a turn that could speak uses it, and which of the
   * conclusions it could show is shown. Injectable for the same reason as `now` —
   * a check that had to hope for a roll would not be a check.
   */
  readonly random?: () => number;
  /**
   * The moment the domain is working from, as an ISO-8601 string.
   *
   * The domain owns time rather than the store, because time is part of what it
   * decides: a matter's span is read off these moments, and so is a conclusion's
   * place in the chain. Everything that is stamped goes through here — a drop's
   * arrival, a reading, a conclusion — so the moments cannot come from two
   * clocks that disagree.
   *
   * Injectable for the same reason every other value here is: a span of days is
   * a rule this product decides on, and a check that had to wait for one would
   * not be a check. Defaults to the real present.
   */
  readonly now?: () => string;
}

/** What a drop caught, assembled for the interface. */
function toSummary(
  drop: StoredDrop,
  items: readonly StoredItem[],
  terms: readonly StoredTerm[],
): DropSummary {
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
    terms: terms.map(toTerm),
    // A null reply is a row written before ticket 03, and the line code can
    // vouch for is the honest answer for it: the drop is old, not unanswered.
    reply: drop.reply ?? safeLineFor(drop.body),
  };
}

function toItem(stored: StoredItem): Item {
  return {
    id: stored.id,
    text: stored.text,
    dueAt: stored.dueAt,
    state: stored.state,
    dropId: stored.dropId,
  };
}

/** Present a stored term as something the page may read — the vector stays behind. */
function toTerm(stored: StoredTerm): Term {
  return {
    id: stored.id,
    text: stored.text,
    dropId: stored.dropId,
    firstSeenAt: stored.firstSeenAt,
  };
}

/**
 * Present a stored term as something that may be named without its vector.
 *
 * One helper for both places a term is named on the way out — a link's end and a
 * conclusion's support — because `LinkedTerm` and `NamedTerm` are the same shape,
 * and two spellings of "the id and the wording, and nothing else" would drift.
 */
function toNamedTerm(stored: StoredTerm): NamedTerm {
  return { id: stored.id, text: stored.text };
}

/**
 * Which terms each matter has already spoken about.
 *
 * Derived from the conclusions rather than stored beside the matter, because
 * they are the same fact: a term is "concluded" when it appears in the support
 * of a conclusion that came out of the matter. Storing it as well would be two
 * records that could disagree — and the one that drifted would silently let the
 * same evidence produce the same conclusion twice.
 *
 * @param conclusions - every stored conclusion, oldest first.
 * @returns the terms concluded per matter.
 */
function concludedSupport(
  conclusions: readonly StoredConclusion[],
): ReadonlyMap<string, ReadonlySet<string>> {
  const grouped = new Map<string, Set<string>>();
  for (const conclusion of conclusions) {
    const already = grouped.get(conclusion.matterId) ?? new Set<string>();
    for (const termId of conclusion.supportTermIds) already.add(termId);
    grouped.set(conclusion.matterId, already);
  }
  return grouped;
}

/**
 * Which matters the user has rejected a reading of.
 *
 * Derived from the chain rather than kept as a flag on the matter, because it is
 * the same fact: a matter stands rejected when one of its conclusions was marked
 * wrong, and the `correction` row **is** that record. A flag would be a second
 * copy of it, and one that could not follow a kept judgement to another matter
 * the way ticket 09's `original-only` moves them.
 *
 * @param conclusions - every stored conclusion.
 * @returns the ids of the matters a correction was recorded against.
 */
function overturnedMatters(conclusions: readonly StoredConclusion[]): ReadonlySet<string> {
  const rejected = new Set<string>();
  for (const conclusion of conclusions) {
    if (conclusion.kind === 'correction') rejected.add(conclusion.matterId);
  }
  return rejected;
}

/**
 * How tightly a matter's support connects to the feeling it is about.
 *
 * The strong band's third gate, and the only one that looks at the links: a
 * matter held together by six terms that all arrived in the same breath with the
 * feeling is stronger evidence than six terms that happen to have been said
 * around it. A term with no direct link counts zero, which is what makes the
 * average fall rather than being skipped.
 *
 * @param supportTermIds - every term supporting the matter.
 * @param anchorTermId - the feeling the matter was opened around.
 * @param linkStrength - every link's strength, by pair key.
 * @returns the average, 0 to 1; a matter with only its anchor counts as 1.
 */
function averageStrengthToAnchor(
  supportTermIds: readonly string[],
  anchorTermId: string,
  linkStrength: ReadonlyMap<string, number>,
): number {
  const others = supportTermIds.filter((termId) => termId !== anchorTermId);
  if (others.length === 0) return 1;
  const total = others.reduce(
    (sum, termId) => sum + (linkStrength.get(pairKey(termId, anchorTermId)) ?? 0),
    0,
  );
  return total / others.length;
}

/**
 * The newest drop in a matter that brought a feeling or a decision.
 *
 * What the sentence has to follow: a matter that began with 「好烦」 and last
 * carried 「松了口气」 is about someone who has since relaxed, and a sentence
 * written from the opening word describes a person who is no longer there. The
 * author measured this the hard way — see ticket 05's `## Comments`.
 *
 * @param matter - the matter, whose member drops are oldest first.
 * @returns the newest mention with an anchor, or null when none has one.
 */
function newestFeeling(matter: StoredMatter): StoredMatter['drops'][number] | null {
  for (let index = matter.drops.length - 1; index >= 0; index -= 1) {
    const mention = matter.drops[index];
    if (mention !== undefined && mention.anchorTermId !== null) return mention;
  }
  return null;
}

/**
 * One conclusion a moment could show.
 *
 * The band and the sentence travel beside the conclusion rather than being read
 * off it again later: a stored conclusion may hold a null tier (which is the
 * honest record of a **catch**) and a null claim (one assembled before the words
 * were kept beside the line), and what may be shown is a claim with both. Naming
 * the narrowed view once is what keeps "a catch is never surfaced" and "a
 * conclusion nobody kept the sentence of is never surfaced" from being
 * re-derived in every branch that touches a candidate.
 */
interface ShowableConclusion {
  /** The stored conclusion, unchanged. */
  readonly conclusion: StoredConclusion;
  /** The band its wording is written in. Never null: only a claim is ever shown. */
  readonly tier: ConclusionTier;
  /** The sentence the provider wrote, without the frame. Never null. */
  readonly claim: string;
}

/** What a moment has to show, as `readySurfacings` reports it. */
type ReadySurfacings =
  | {
      /** Something may be shown. */
      readonly kind: 'ready';
      /** What may be shown, never empty — "nothing" is the other arm. */
      readonly candidates: readonly [ShowableConclusion, ...ShowableConclusion[]];
    }
  | {
      /** Nothing may be shown, for one of the ordinary reasons. */
      readonly kind: 'none';
      readonly reason: SurfacingMiss;
    };

/**
 * Build the domain core.
 *
 * @param options - the store, and optionally an AI provider.
 * @returns the domain interface.
 */
export function createDomain(options: DomainCoreOptions): Domain {
  const { store, provider } = options;
  const linkPolicy = options.linkPolicy ?? DEFAULT_LINK_POLICY;
  const conclusionPolicy = options.conclusionPolicy ?? DEFAULT_CONCLUSION_POLICY;
  const surfacingPolicy = options.surfacingPolicy ?? DEFAULT_SURFACING_POLICY;
  const now = options.now ?? ((): string => new Date().toISOString());
  const random = options.random ?? ((): number => Math.random());

  /**
   * How widely each wording is spread across the matters, and what sharing it is
   * therefore worth.
   *
   * One reading, because two rules ask the same question — "is this the same
   * thing?" — and they have to answer it the same way: `attach` asks it about a
   * fragment arriving, and the surfacing moment asks it about something the user
   * may already have heard. A word counted as generic in one place and specific
   * in the other would let a topic be judged the same going in and different
   * coming out.
   *
   * Spread is measured across **matters rather than mentions**: a word said ten
   * times about one thing is still specific to that thing, which is exactly the
   * distinction the weighting is for.
   *
   * @param matters - every matter as it stands.
   * @returns what a shared wording is worth, from `spreadWeight`.
   */
  function spreadWeigher(matters: readonly StoredMatter[]): (termId: string) => number {
    const spread = new Map<string, number>();
    for (const matter of matters) {
      for (const termId of matter.supportTermIds) {
        spread.set(termId, (spread.get(termId) ?? 0) + 1);
      }
    }
    // A term the map does not mention is in no matter yet, and a wording no
    // matter has claimed is fully specific — so the same 1 the weight gives a
    // term said only here, rather than a missing measurement.
    return (termId: string): number =>
      spreadWeight(spread.get(termId) ?? 0, conclusionPolicy);
  }

  /**
   * Every decision about a look, and every look itself, runs through here.
   *
   * One queue for both, and the reason is this file's trickiest ordering
   * problem: reads are asynchronous, so a burst of drops each decides after
   * *all* of them have been read. Racing decisions would each see the same
   * crossing and each spend the alternation's turn — three fragments typed in a
   * row would look like a rhythm of three, and the turn would be back where it
   * started by the time the next crossing arrived. Chaining a decision behind
   * the look before it means each one reads the state the last one left: a
   * crossing already spoken about is gone, and one deliberately left to the
   * quiet window is not reconsidered by the next drop of the same pile.
   *
   * What that costs is worth naming: a look may ask a model for a sentence, so a
   * provider that never answers stalls everything queued behind it, later looks
   * included. Nothing is lost — the pile and the material are still there — but
   * the settling waits for the provider rather than giving up on it, which is
   * what "the look waits for the sentence it asked for" means.
   */
  let lookQueue: Promise<void> = Promise.resolve();

  /** Queue one step of the invisible settling behind whatever is already queued. */
  function queueLook(step: () => Promise<void>): Promise<void> {
    lookQueue = lookQueue.then(step).catch(() => {});
    return lookQueue;
  }

  /**
   * Queue one write to the chain behind whatever is already settling, and hand
   * its outcome — failure included — back to the caller.
   *
   * The same queue `queueLook` uses, and for the reason that queue exists: a
   * correction writes to the portrait while a look may be mid-composition on
   * material it read a moment ago, and the two must not interleave — a sentence
   * decided against a chain that has since been corrected would be filed under
   * the wrong predecessor.
   *
   * What differs from `queueLook` is the promise the caller gets. A look is
   * background work and swallows its failure; a tap is not, and a write the user
   * asked for that could not be made must reach them as a failure rather than as
   * "there is no such conclusion" — which is what swallowing it here would report.
   *
   * @param step - the write to run.
   * @returns whatever the step returned, or its rejection.
   */
  async function queueRevision<T>(step: () => Promise<T>): Promise<T> {
    const queued = lookQueue.then(step);
    // The queue itself must never carry a rejection: everything behind this one
    // would be dropped with it.
    lookQueue = queued.then(
      () => {},
      () => {},
    );
    return queued;
  }

  /**
   * Every accumulation runs through here, one at a time and in arrival order.
   *
   * A look may ask a model for a sentence and hang; an accumulation may not, and
   * it must not queue behind one — hence two queues rather than one. What the
   * separate queue buys is what accumulation cannot do without: each drop
   * attaches to the material **the drop before it left behind**, so a burst of
   * fragments whose readings are still landing cannot each decide, from the same
   * empty state, to open a matter of its own.
   */
  let accumulationQueue: Promise<void> = Promise.resolve();

  /** The timer that carries "wait for it to go quiet" without anyone watching. */
  let quietTimer: ReturnType<typeof setTimeout> | null = null;

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

    let recorded: RecordedReading;
    try {
      recorded = await store.recordExtraction(
        drop.id,
        {
          inputType: reading.inputType,
          items: reading.items,
          terms: reading.terms,
          anchor: reading.anchor,
        },
        now(),
      );
    } catch {
      // The provider answered but the write failed. Swallowing this keeps the
      // port's promise that extraction never rejects, and leaves the drop
      // unread so a later attempt can still succeed. Nothing was half-written:
      // the store writes items, terms and the links between them in one step.
      return;
    }

    // What was read, as the store resolved it: terms carry their identities and
    // the anchor is either one of them or nothing. Read from the result rather
    // than from `drop`, whose row was captured before the reading landed — its
    // anchor is still empty, and that is exactly the kind of stale field a later
    // step would believe.
    const said = recorded.terms;

    // The zero-model half of linking: the terms the user said together. Written
    // here rather than by the store because it is the product's rule and its
    // wording, and it is a step of its own because a link that fails to write
    // costs a link — never the terms, which are already stored.
    await recordSameDropLinks(said);

    // The semantic half costs a provider call, so it runs on its own and on its
    // own time. A drop whose terms were read is a success whether or not
    // anything could be compared.
    void linkInto(said);

    // Settling. The drop is attached to the material first — that is the
    // inference, and it is written down — and only then is the invisible look
    // considered, so a crossing this drop caused can be spoken about in the same
    // breath rather than one drop late.
    //
    // The attachment is waited for and the look is not: attaching is store-only
    // work that must land before the look reads the material, while the look may
    // ask a model for a sentence and a model that hangs must not hold up the
    // reading of anything.
    //
    // Guarded as one step rather than left to each callee: extraction's promise
    // that it never rejects has to hold for **every** step this function awaits.
    // A store closed under a drop that is still being read is the ordinary way
    // that promise gets broken, and what it costs must be the accumulation —
    // never a rejection nobody is waiting for.
    try {
      await accumulate(drop, said, recorded.anchorTermId);
      void considerLook();
    } catch {
      // Swallowed: the terms, the links and the drop itself are already stored.
    }
  }

  /**
   * Link the terms one drop said, because they were said together.
   *
   * The zero-model half, and the strongest evidence the product has: two things
   * said in one breath were certainly said together, so there is nothing to
   * measure and nobody to ask. The strength is a fixed 1 and the reason is a
   * fact about the user's own sentence.
   *
   * A hard edge **outranks** a similarity edge for the same pair. When the pair
   * was already linked because the words merely looked close, saying them
   * together replaces that reading with the fact — the reverse cannot happen,
   * because `linkInto` leaves a pair that is already linked alone.
   *
   * Never throws: a link that could not be written is simply missing, and the
   * terms it would have joined are stored either way.
   */
  async function recordSameDropLinks(said: readonly StoredTerm[]): Promise<void> {
    if (said.length < 2) return;
    const links: NewLink[] = [];
    for (let left = 0; left < said.length; left += 1) {
      for (let right = left + 1; right < said.length; right += 1) {
        const from = said[left];
        const to = said[right];
        if (from === undefined || to === undefined) continue;
        links.push({
          fromTermId: from.id,
          toTermId: to.id,
          kind: 'same-drop',
          strength: SAME_DROP_STRENGTH,
          reason: SAME_DROP_REASON,
        });
      }
    }
    try {
      await store.recordLinks(links);
    } catch {
      // Swallowed on purpose: the user's material is what matters, and the
      // links are the domain's reading of it.
    }
  }

  /**
   * Connect the terms a drop just yielded to the material already there.
   *
   * The hard edges between terms said in the same breath are not this
   * function's work — the store already has them, put there by code with no
   * provider involved. What is left is the semantic half.
   *
   * Order of decisions, and why:
   *
   *  - Nothing is encoded while there is no **other** term to compare against.
   *    The first fragment a user ever drops therefore costs no model call at
   *    all, and a term stays unembedded until it can actually be used.
   *  - Encoding is all-or-nothing. A provider that fails, hangs, or returns a
   *    vector per text that does not line up costs the links this round, never
   *    the terms — they were stored before this ran.
   *  - The bands are read from the policy, so the grey zone is the only place a
   *    judge is asked and a score that cleared the high band never is.
   *  - A pair that is already linked is left alone. Two terms said together
   *    keep the hard edge that recorded that, even if a reading of their
   *    vectors would have called the same pair merely similar.
   *
   * Never throws: every failure ends in "fewer links than there could have
   * been", which is a state the product is designed to tolerate.
   */
  async function linkInto(said: readonly StoredTerm[]): Promise<void> {
    // One outer guard, because the promise this keeps is about the *function*:
    // every failure ends in "fewer links than there could have been". The steps
    // inside guard their own provider and write failures for legibility, but a
    // store that went away mid-read is not one of those steps, and a rejection
    // nobody awaits would take the process down with it.
    try {
      await linkTerms(said);
    } catch {
      // Swallowed on purpose: see `linkTerms`' failures, all of which cost links.
    }
  }

  async function linkTerms(said: readonly StoredTerm[]): Promise<void> {
    if (provider === undefined) return;
    if (said.length === 0) return;

    const mine = new Set(said.map((term) => term.id));
    // Every term, with its vector. The whole list is read once per drop, because
    // a new term is compared against everything rather than against a window:
    // a link to something said months ago is the point of accumulating at all.
    // That is cheap at this size and is the first thing to revisit if the term
    // count ever runs into the tens of thousands.
    const all = await store.listTerms();
    const others = all.filter((term) => !mine.has(term.id));
    // Nobody to link to yet. Encoding here would be a provider call spent to
    // learn nothing, and the term will be encoded when it first has a partner.
    if (others.length === 0) return;

    const needing = [...said, ...others].filter((term) => term.vector === null);
    if (needing.length === 0) return;

    let vectors: readonly (readonly number[])[];
    try {
      ({ vectors } = await provider.embed({ texts: needing.map((term) => term.text) }));
    } catch {
      return;
    }
    // A vector per text, in the order asked, and every one of them usable. A
    // short list or a ragged one is a provider that misunderstood the call, and
    // guessing at the missing entries would be inventing measurements.
    if (vectors.length !== needing.length) return;
    const width = vectors[0]?.length ?? 0;
    if (width === 0 || vectors.some((vector) => vector.length !== width)) return;

    const embedded = new Map<string, readonly number[]>();
    for (const [index, term] of needing.entries()) {
      const vector = vectors[index];
      if (vector !== undefined) embedded.set(term.id, vector);
    }

    try {
      await store.recordTermVectors(
        [...embedded].map(([termId, vector]) => ({ termId, vector })),
      );
    } catch {
      // The vectors are how the domain compares, not what the user said. Losing
      // them costs this round's links; it does not cost the terms.
      return;
    }

    /** What a term is measured as now: this round's vector, or the stored one. */
    const vectorOf = (term: StoredTerm): readonly number[] | null =>
      embedded.get(term.id) ?? term.vector;

    const alreadyLinked = new Set(
      (await store.listLinks()).map((link) => pairKey(link.fromTermId, link.toTermId)),
    );
    /** Pairs already read this round, so a grey pair is never judged twice. */
    const compared = new Set<string>();
    const links: NewLink[] = [];

    // Every pair is decided in the round where the **later** of its two ends
    // gains a vector, because that is the first moment both are known. So the
    // loop runs from what was just encoded against everything that now has one —
    // which is also how two older terms whose vectors were both missing still
    // get their only chance, on the round that finally encoded them together.
    for (const term of needing) {
      const vector = vectorOf(term);
      if (vector === null) continue;
      for (const other of all) {
        if (other.id === term.id) continue;
        // Two terms from this drop already have their hard edge: code put it
        // there, and a similarity reading would only be a weaker second opinion.
        if (mine.has(term.id) && mine.has(other.id)) continue;
        const otherVector = vectorOf(other);
        if (otherVector === null) continue;
        const key = pairKey(term.id, other.id);
        if (alreadyLinked.has(key) || compared.has(key)) continue;
        compared.add(key);

        // Null means the two cannot be compared at all — vectors of different
        // widths, which is what a swapped embedding implementation leaves
        // behind, or one with no direction. Neither is a score, so neither may
        // become a link.
        const similarity = cosineSimilarity(vector, otherVector);
        if (similarity === null) continue;

        const decision = decideLink(similarity, linkPolicy);
        if (decision === 'skip') continue;

        let judged = false;
        if (decision === 'ask') {
          try {
            const verdict = await provider.judgeLink({
              from: term.text,
              to: other.text,
              similarity,
            });
            if (!verdict.related) continue;
            judged = true;
          } catch {
            // A question nobody answered is not an answer. The pair stays
            // unlinked, which is exactly what a "no" would have produced.
            continue;
          }
        }

        links.push({
          fromTermId: term.id,
          toTermId: other.id,
          kind: 'similar',
          strength: similarity,
          reason: similarityReason(similarity, judged),
        });
        alreadyLinked.add(key);
      }
    }

    if (links.length === 0) return;
    try {
      await store.recordLinks(links);
    } catch {
      // Same as above: a link that could not be written is a link the next
      // comparison round can find again, and never a reason to lose a drop.
    }
  }

  /**
   * Attach one drop's terms to the material already there.
   *
   * The inference this makes is "which matter was that about?", and it is made
   * once, here, at the drop — then written down. It is deliberately not
   * recomputed later: the same reading under a later `ConclusionPolicy` would
   * split or merge matters the user's portrait was built from, and the promise
   * is that changing a value affects what happens next.
   *
   * Two ways a drop joins the accumulation, one way it is put there, and one way
   * it does not:
   *
   *  - It was **written beside a conclusion** (ticket 10), so the user has
   *    already said which matter it belongs to. That is not re-derived: overlap
   *    is what the product guesses from words, and here the user has stated it
   *    outright — all the more so on a matter they have rejected, where the guess
   *    is deliberately damped and a note about it would otherwise land somewhere
   *    it was not about.
   *  - It covers enough of a matter to be about it (`overlapRatio`, measured
   *    against the smaller side, with shared terms weighted by how widely they
   *    are already spread — see `conclusions.ts`).
   *  - It covers nothing, but carries a feeling or a decision, so it **opens** a
   *    matter of its own.
   *  - It covers nothing and carries neither — an observation, a fact, a plan
   *    with no feeling in it. Its terms are kept and it accumulates into
   *    nothing, because there is no "about" for a mark to attach to.
   *
   * A matter the user has rejected takes part in the measurement at a discount
   * (`overturnedOverlapFactor`): they have said the reading was wrong, so sharing
   * a word with it is worth less as evidence that this fragment is about it. The
   * discount falls on the **classification only** — which terms were said
   * together, and how strongly they link, is a fact and stays untouched.
   *
   * Never throws: a drop that could not be attached costs an accumulation, never
   * the drop, the terms or the links, all of which were written before this ran.
   */
  async function accumulate(
    drop: StoredDrop,
    said: readonly StoredTerm[],
    anchorTermId: string | null,
  ): Promise<void> {
    const queued = accumulationQueue
      .then(() => attach(drop, said, anchorTermId))
      // Never rejects, so the queue can neither stall nor break: a drop that
      // could not be attached costs an accumulation and nothing else.
      .catch(() => {});
    accumulationQueue = queued;
    return queued;
  }

  async function attach(
    drop: StoredDrop,
    said: readonly StoredTerm[],
    anchorTermId: string | null,
  ): Promise<void> {
    if (said.length === 0) return;
    try {
      // Already counted. Re-running extraction must converge rather than
      // counting the same fragment twice — the raised count is the threshold's
      // unit, and one drop counted twice would quietly lower it.
      if ((await store.matterForDrop(drop.id)) !== null) return;

      const matters = await store.listMatters();
      const anchor = said.find((term) => term.id === anchorTermId) ?? null;
      const saidIds = said.map((term) => term.id);

      // Where the user put it outranks what the product could infer. The matter
      // may be gone — a note outlives the thing it was written beside — and a pin
      // that no longer resolves simply leaves the drop to the ordinary rules.
      const pinned = drop.pinnedMatterId;
      if (pinned !== null && matters.some((matter) => matter.id === pinned)) {
        await store.growMatter({
          matterId: pinned,
          dropId: drop.id,
          anchorTermId: anchor?.id ?? null,
          at: drop.droppedAt,
          termIds: saidIds,
        });
        // Counted like any other fragment that joined: the pile the backstop
        // counts is the one a look will judge.
        await store.noteAttachment();
        return;
      }

      // What sharing a wording is worth, read the one way both rules read it —
      // see `spreadWeigher`.
      const weight = spreadWeigher(matters);
      const rejected = overturnedMatters(await store.listConclusions());

      let best: { matterId: string; value: number } | null = null;
      for (const matter of matters) {
        const measured = overlapOf(saidIds, matter.supportTermIds, weight).value;
        const value =
          measured * (rejected.has(matter.id) ? conclusionPolicy.overturnedOverlapFactor : 1);
        if (best === null || value > best.value) best = { matterId: matter.id, value };
      }

      if (best !== null && best.value >= conclusionPolicy.overlapRatio) {
        await store.growMatter({
          matterId: best.matterId,
          dropId: drop.id,
          anchorTermId: anchor?.id ?? null,
          at: drop.droppedAt,
          termIds: saidIds,
        });
        // Counted only once the drop is in the material: the pile the backstop
        // counts is the one a look will judge.
        await store.noteAttachment();
        return;
      }

      // Nothing to accumulate around: the words stay, the matter does not exist.
      if (anchor === null) return;
      await store.openMatter({
        dropId: drop.id,
        anchorTermId: anchor.id,
        at: drop.droppedAt,
        termIds: saidIds,
      });
      await store.noteAttachment();
    } catch {
      // Swallowed on purpose, like the links: what the user said is stored, and
      // the accumulation is the domain's reading of it.
    }
  }

  /** Whether any matter has crossed the threshold without being spoken about yet. */
  async function hasPendingCrossing(): Promise<boolean> {
    const concluded = concludedSupport(await store.listConclusions());
    return (await store.listMatters()).some(
      (matter) =>
        matter.raisedCount >= conclusionPolicy.threshold &&
        matter.supportTermIds.some((termId) => !(concluded.get(matter.id)?.has(termId) ?? false)),
    );
  }

  /**
   * Ask the provider for a matter's sentence, and take it only if it passes.
   *
   * The one retry is told which rules the first attempt broke, because a model
   * asked to try again at random is being asked to guess luckily. A second
   * failure returns null, and null means **silence**: the matter has not been
   * spoken about yet, and the next look may do better. There is no safe line
   * here to fall back to — an invented sentence would be a judgement the product
   * does not have, which is worse than saying nothing.
   */
  async function composeClaim(
    anchor: string,
    terms: readonly string[],
    tier: ConclusionTier,
  ): Promise<string | null> {
    if (provider === undefined) return null;

    let violations: readonly string[] | undefined;
    for (let attempt = 0; attempt < CONCLUSION_ATTEMPTS; attempt += 1) {
      let candidate: string;
      try {
        candidate = (
          await provider.composeConclusion({
            anchor,
            terms,
            tier,
            instructions: CONCLUSION_INSTRUCTIONS,
            ...(violations === undefined ? {} : { violations }),
          })
        ).text;
      } catch {
        return null;
      }

      const broken = checkConclusion(candidate);
      if (broken.length === 0) return candidate;
      violations = broken;
    }
    return null;
  }

  /**
   * Look at everything that has piled up, and make the conclusions that are due.
   *
   * One look is one pass over every matter. Nothing is decided from what arrived
   * since the last look — the whole accumulation is read every time — because
   * "has this matter earned a sentence" is a question about the matter, not about
   * the last fragment.
   */
  async function settle(): Promise<void> {
    const terms = new Map((await store.listTerms()).map((term) => [term.id, term]));
    const conclusions = await store.listConclusions();
    const concluded = concludedSupport(conclusions);
    // Read once for the whole look, the same way the wordings are: whether a
    // matter has been rejected is a fact about the chain, and a look that asked
    // again per matter could answer the same question two ways.
    const rejected = overturnedMatters(conclusions);
    const latest = new Map<string, StoredConclusion>();
    for (const conclusion of conclusions) latest.set(conclusion.matterId, conclusion);

    const linkStrength = new Map<string, number>();
    for (const link of await store.listLinks()) {
      linkStrength.set(pairKey(link.fromTermId, link.toTermId), link.strength);
    }

    // The moment belongs to the look, not to each conclusion: a settlement that
    // produced two conclusions produced them together.
    const at = now();

    for (const matter of await store.listMatters()) {
      try {
        const fresh = matter.supportTermIds.filter(
          (termId) => !(concluded.get(matter.id)?.has(termId) ?? false),
        );
        // Nothing new since the last sentence: saying it again would be a second
        // conclusion from the same evidence, which is the one way the chain could
        // pad itself.
        if (fresh.length === 0) continue;
        if (matter.raisedCount < conclusionPolicy.threshold) continue;

        const anchorTerm = terms.get(matter.anchorTermId);
        if (anchorTerm === undefined) continue;
        const support = matter.supportTermIds
          .map((termId) => terms.get(termId))
          .filter((term): term is StoredTerm => term !== undefined);
        const supportTexts = support.map((term) => term.text);
        const days = spanDays(matter.firstAt, matter.lastAt);
        const strength = averageStrengthToAnchor(
          matter.supportTermIds,
          matter.anchorTermId,
          linkStrength,
        );
        const previous = latest.get(matter.id) ?? null;
        const relation: ConclusionRelation = previous === null ? 'first' : 'inherit';
        // Which feeling this matter is about *now*, read once and used by both
        // branches: the sentence follows it, and the catch is the line it was
        // already answered with.
        const newest = newestFeeling(matter);

        let text: string;
        let kind: ConclusionKind;
        let tier: ConclusionTier | null;
        let claim: string | null;
        // Whether a band was written below what the numbers earned. False for a
        // catch and a correction, which have no band to soften.
        let softened = false;

        if (!mayClaim(matter.supportTermIds.length, conclusionPolicy)) {
          // Too little to say anything about a pattern: catch the newest feeling
          // instead, in the line that feeling was already answered with. Code's
          // own sentence, already checked against the parent voice, and no claim
          // in it — a catch asserts nothing, so there is nothing to be unsure
          // about and no band for it to be in.
          const catching = newest === null ? null : await catchLine(newest);
          if (catching === null) continue;
          text = catching;
          kind = 'catch';
          tier = null;
          // Nothing of its own was written: what a catch holds is the line the
          // newest feeling was already answered with, which is already stored
          // with that drop.
          claim = null;
        } else {
          const newestTerm =
            newest?.anchorTermId === null || newest === null
              ? undefined
              : terms.get(newest.anchorTermId);
          const feeling = newestTerm?.text ?? anchorTerm.text;
          // One band softer on a matter the user has rejected. The numbers are
          // **not** adjusted: they are what they were, and a band read off them
          // that then steps down is explained by saying so — which is why the
          // step is written down beside them rather than left to be inferred from
          // a chain that may since have changed. The step applies only where it
          // changes the answer: a claim already at the weakest band is not
          // "softened", because nothing was.
          const earned = tierOf(matter.supportTermIds.length, days, strength, conclusionPolicy);
          const band = softerTier(
            earned,
            rejected.has(matter.id) ? conclusionPolicy.overturnedBandDrop : 0,
          );
          const sentence = await composeClaim(feeling, supportTexts, band);
          // Silence rather than a worse sentence. The crossing stays pending, so
          // the next look tries again.
          if (sentence === null) continue;
          text = frameFor(band, sentence);
          kind = 'claim';
          tier = band;
          softened = band !== earned;
          // The sentence is kept beside the framed line, so the moment the product
          // speaks first can write its own opening in front of it rather than
          // reading one back out of a string.
          claim = bareSentence(sentence);
        }

        await store.appendConclusion({
          matterId: matter.id,
          claim,
          text,
          kind,
          tier,
          softened,
          relation,
          supersedes: previous?.id ?? null,
          createdAt: at,
          mentions: matter.raisedCount,
          spanDays: days,
          averageStrength: strength,
          supportTermIds: matter.supportTermIds,
        });
      } catch {
        // One matter that could not be spoken about must not stop the others,
        // and must not lose the material: nothing was half-written, because the
        // conclusion and its support go in together.
      }
    }

    // The look happened, so the pile is empty — and only the pile is touched:
    // the turn the alternation is on, and the moment the newest fragment landed,
    // were both written by whoever decided them and are not this function's to
    // restate.
    await store.resetPile();
  }

  /**
   * The line a matter may use when it has too little to claim anything.
   *
   * Deliberately the reply the newest feeling was answered with rather than a
   * fresh call: that sentence already names the feeling, it has already passed
   * the parent-voice checks, and it costs nothing. It is also the same sentence
   * the user saw when they said it, which is what "只接住你最新说的那句" means.
   *
   * What it is **not** is exempt from the shape a conclusion has to keep. A reply
   * is allowed three sentences and one question; a catch stands on the portrait
   * where a conclusion would, and a question there would be the product asking
   * the user something in the one place it is only supposed to be reporting. So
   * the line is checked, and code's own shortest line stands in when it does not
   * pass — a catch that catches nothing but presence is still a catch.
   *
   * @param newest - the newest mention that brought a feeling, from `newestFeeling`.
   * @returns the line, or null when the drop it belongs to cannot be read.
   */
  async function catchLine(newest: StoredMatter['drops'][number]): Promise<string | null> {
    const drop = await store.findDrop(newest.dropId);
    if (drop === null) return null;
    const line = drop.reply ?? safeLineFor(drop.body);
    return checkConclusion(line).length === 0 ? line : SAFE_CATCH_REPLY;
  }

  /**
   * Decide whether this drop deserves a look, and take it if it does.
   *
   * Three triggers, in the order the prototype settled them:
   *
   *  1. **The backstop** — enough drops have piled up that a look is forced
   *     whether or not anything paused. It exists for someone who never stops
   *     typing, and it is checked first so it cannot be starved by the
   *     alternation.
   *  2. **The count** — a matter has crossed the threshold, and the timing says
   *     to look the moment it does.
   *  3. **The quiet window** — the timer armed at the drop (see `armQuietWindow`)
   *     fires once nothing has been said for long enough.
   *
   * Under `alternate`, the second trigger is a turn rather than a rule. The turn
   * is spent by every crossing it is consulted about — that is what "交替" means
   * — and written down before the look, so a restart cannot rewind it. The
   * backstop bypasses the turn entirely.
   *
   * Never throws, and deliberately not awaited by its caller: a look may ask a
   * model for a sentence, and the reading of the next drop must not wait on that.
   */
  function considerLook(): Promise<void> {
    return queueLook(async () => {
      const state = await store.readSettlement();
      if (state.dropsSince >= conclusionPolicy.pendingLimit) {
        // The backstop, whatever the timing says and whoever is mid-sentence.
        await settle();
        return;
      }
      if (conclusionPolicy.judgeTiming === 'quiet') return;
      if (!(await hasPendingCrossing())) return;

      if (conclusionPolicy.judgeTiming === 'count') {
        await settle();
        return;
      }

      // Alternating. The turn is spent either way: looking now half the time is
      // what keeps the rhythm from becoming a rule the user can read.
      await store.setLookNowNext(!state.lookNowNext);
      if (state.lookNowNext) await settle();
    });
  }

  /**
   * Arm the quiet window, from the newest drop.
   *
   * Re-armed rather than counted down, because the window is measured from the
   * newest drop and a new one restarts it — a few sentences in one sitting are
   * one thought, and judging them mid-thought is exactly what the window is for.
   *
   * The timer is unref'd: a pending look must never be the reason a process
   * stays alive. Losing it to a shutdown costs nothing, because the next drop
   * arms it again and the pile it was going to look at is still there.
   */
  function armQuietWindow(): void {
    if (quietTimer !== null) clearTimeout(quietTimer);
    quietTimer = setTimeout(() => {
      quietTimer = null;
      void queueLook(async () => {
        // Nothing to look at means nothing to do: a drop the count trigger
        // already accounted for must not make the window look a second time.
        const state = await store.readSettlement();
        if (state.dropsSince === 0) return;
        await settle();
      });
    }, conclusionPolicy.quietWindowMs);
    if (typeof quietTimer.unref === 'function') quietTimer.unref();
  }

  /**
   * Whether a drop is one the product speaks after.
   *
   * Two readings of one fact, and either one is enough: the text carries a
   * feeling, as ordinary code reads it (`readSituation` — the same reading that
   * chose the drop's line), or the model that read the drop judged it an
   * emotional input, which is the product's own 输入类型 (`CONTEXT.md`).
   *
   * Either rather than both, because the two mistakes do not cost the same.
   * Missing a moment means a judgement the user earned is never shown to them;
   * an extra attempt can only ever surface something that already crossed the
   * threshold and cleared the cooldown, so it costs nothing at all. A cue list is
   * also a partial reading by construction — 「心里堵得慌」 carries a feeling and
   * none of the words the list knows — which is exactly the gap the model's
   * classification covers.
   *
   * @param drop - the drop the moment is being asked about.
   * @returns true when the product may speak after this drop.
   */
  function isAMoment(drop: StoredDrop): boolean {
    if (drop.inputType === 'emotion') return true;
    return readSituation(drop.body).emotionPresent;
  }

  /**
   * Everything this moment could **show**.
   *
   * Read from the conclusions, and only what the moment is allowed to say:
   *
   *  - **The newest conclusion of each matter.** An earlier one has been carried
   *    on from, and showing it would put the user back where they were rather
   *    than where they are. A matter whose newest conclusion is a **catch** has
   *    nothing sayable in it: a catch asserts nothing (`CONTEXT.md`, 承接), so
   *    there is no observation in it to put in front of someone — and adding
   *    uncertainty to one would be the dishonesty in the other direction.
   *  - **Only a claim whose sentence was kept.** What a surfacing reads is the
   *    sentence the provider wrote, with the band's own opening in front of it
   *    (`surfacingLine`); a conclusion assembled before those words were kept
   *    beside the line has no sentence to write an opening for.
   *  - **Not a topic the user has heard this week.** The cooldown is measured
   *    from the moments lines were shown, on the terms that stood behind them.
   *
   * Whether the sentence is *stated as an observation* is deliberately not a
   * filter here: that cannot be read off a string (see `surfacing.ts`), so the
   * uncertainty is written in rather than looked for.
   *
   * @param at - the moment being judged, ISO-8601.
   * @returns what may be shown, or the ordinary reason nothing may.
   */
  async function readySurfacings(at: string): Promise<ReadySurfacings> {
    const conclusions = await store.listConclusions();
    if (conclusions.length === 0) return { kind: 'none', reason: 'nothing-to-say' };

    // The newest conclusion per matter, and the map keeps the order the matters
    // were first concluded in, so a turn that could say several things does not
    // depend on the order they happen to come back in.
    const latest = new Map<string, StoredConclusion>();
    for (const conclusion of conclusions) latest.set(conclusion.matterId, conclusion);

    const weight = spreadWeigher(await store.listMatters());
    const cooling = (await store.listSurfacings()).filter(
      (record) => Date.parse(at) - Date.parse(record.surfacedAt) < surfacingPolicy.cooldownMs,
    );

    const candidates: ShowableConclusion[] = [];
    let sayable = 0;
    for (const conclusion of latest.values()) {
      // A claim always carries the band its wording was read off and the sentence
      // it was written from. A row missing either is one the domain cannot
      // describe, and a line nobody can explain is not one to push at the user.
      if (conclusion.kind !== 'claim') continue;
      const { tier, claim } = conclusion;
      if (tier === null || claim === null) continue;
      sayable += 1;
      const heard = cooling.some((record) =>
        isSameTopic(conclusion.supportTermIds, record.supportTermIds, weight, surfacingPolicy),
      );
      if (heard) continue;
      candidates.push({ conclusion, tier, claim });
    }

    const [first, ...rest] = candidates;
    if (first === undefined) {
      // Kept apart because they are different facts about the user: nothing has
      // settled into a judgement, or it has and they have heard it this week.
      return { kind: 'none', reason: sayable === 0 ? 'nothing-to-say' : 'cooldown' };
    }
    return { kind: 'ready', candidates: [first, ...rest] };
  }

  /** Assemble one drop with its items and terms, or null when there is none. */
  async function readDrop(dropId: string): Promise<DropSummary | null> {
    const drop = await store.findDrop(dropId);
    if (drop === null) return null;
    return toSummary(
      drop,
      await store.listItemsForDrop(dropId),
      await store.listTermsForDrop(dropId),
    );
  }

  /**
   * The chain as the interface reports it: every conclusion, with its evidence
   * named and its relations filled in both ways.
   *
   * One function rather than the shape written out wherever a conclusion is
   * handed back, because two callers ask the same question — the page reading the
   * portrait, and `markConclusionWrong` handing back the record it just wrote —
   * and a second spelling of "how a conclusion reads" would drift from the first.
   *
   * `supersededBy` is derived rather than stored, because a conclusion cannot know
   * it will be revised. A conclusion may be superseded more than once — carried on
   * from, and then rejected — and the forward pointer names the **newest** thing
   * that replaced it, because the question it answers is where that conclusion
   * stands now. The full history is not lost: every entry still names the one it
   * came from, so the chain can be walked backwards from the end.
   *
   * @returns every conclusion, oldest first.
   */
  async function conclusionViews(): Promise<readonly Conclusion[]> {
    // Read the terms once and share the map: what a conclusion needs from a term
    // is its wording, and one read of the whole list beats a lookup per supporting
    // term — the same trade `listLinks` makes.
    const terms = new Map((await store.listTerms()).map((term) => [term.id, term]));
    const stored = await store.listConclusions();
    const byId = new Map(stored.map((conclusion) => [conclusion.id, conclusion]));

    const revisedBy = new Map<string, string>();
    for (const conclusion of stored) {
      if (conclusion.supersedes !== null) revisedBy.set(conclusion.supersedes, conclusion.id);
    }
    const ref = (id: string | null | undefined): ConclusionRef | null => {
      const found = id === null || id === undefined ? undefined : byId.get(id);
      return found === undefined ? null : { id: found.id, text: found.text };
    };

    return stored.map((conclusion) => ({
      id: conclusion.id,
      text: conclusion.text,
      kind: conclusion.kind,
      tier: conclusion.tier,
      softened: conclusion.softened,
      relation: conclusion.relation,
      supersedes: ref(conclusion.supersedes),
      supersededBy: ref(revisedBy.get(conclusion.id)),
      createdAt: conclusion.createdAt,
      mentions: conclusion.mentions,
      spanDays: conclusion.spanDays,
      averageStrength: conclusion.averageStrength,
      // A supporting term the store can no longer name is left out rather than
      // shown as a blank: a conclusion listed with a nameless prop would be a
      // judgement with evidence the user cannot read.
      support: conclusion.supportTermIds
        .map((termId) => terms.get(termId))
        .filter((term): term is StoredTerm => term !== undefined)
        .map(toNamedTerm),
    }));
  }

  /**
   * Ask the provider for the drop's **reply**, and show it only if it passes.
   *
   * Never throws and never leaves the drop unanswered: the line code chose is
   * already written when this runs, so every failure path here ends in "the user
   * has been answered, just not in the provider's words".
   *
   * The rules are checked here rather than trusted to the provider, and the one
   * retry is told which of them the first attempt broke — a model asked to try
   * again with no information is being asked to guess luckily. A second failure
   * is not a third attempt: the drop keeps the line that is known to be safe,
   * which is the only way to promise the user never sees a violating one.
   *
   * A drop that asks to be left alone stops here. "Leave only the shortest
   * statement of presence" is a rule about what the product says, not a string
   * anyone can check a model against — so the provider is not asked at all, and
   * the answer is the one already written. That is also the answer the moment
   * wants: someone stepping back should not have a model reach for a sentence.
   *
   * @param drop - the drop just recorded.
   * @param situation - what that drop asks of its reply.
   */
  async function replyInto(drop: StoredDrop, situation: ReplySituation): Promise<void> {
    if (provider === undefined) return;
    if (situation.stopRequested) return;

    let violations: readonly string[] | undefined;
    for (let attempt = 0; attempt < REPLY_ATTEMPTS; attempt += 1) {
      let candidate: string;
      try {
        candidate = (
          await provider.respond({
            body: drop.body,
            brief: briefFor(situation),
            instructions: REPLY_INSTRUCTIONS,
            ...(violations === undefined ? {} : { violations }),
          })
        ).reply;
      } catch {
        // Down, refusing, or blowing up. The safe line stands, and asking again
        // would only spend a second call on a provider that cannot answer.
        return;
      }

      const broken = checkReply(candidate, situation);
      if (broken.length === 0) {
        try {
          await store.recordReply(drop.id, candidate);
        } catch {
          // The provider answered but the write failed. Swallowing this keeps
          // the promise that answering never rejects, and leaves the safe line
          // in place — which is a worse reply than the one just thrown away,
          // but never a wrong one.
        }
        return;
      }

      violations = broken;
    }
  }

  /**
   * Everything a deletion needs to know about one drop, read once.
   *
   * Read as one thing because the three answers are about the same fragment and
   * have to agree with each other: which judgements rested on it, which words it
   * was the last to say, and what the user is therefore being asked to give up.
   * Reading them separately would let the preview and the deletion see different
   * material — a small window, but this is the one operation where a discrepancy
   * between what was announced and what happened is unrecoverable.
   *
   * @param dropId - the drop being deleted or previewed.
   * @param body - its text, already read by the caller.
   * @returns the conclusions it fed, the terms only it said, and the announcement.
   */
  interface DeletionFacts {
    /** The conclusions that came out of this drop, oldest first. */
    readonly conclusions: readonly StoredConclusion[];
    /** The words this drop was the last to say, in the order it said them. */
    readonly terms: readonly StoredTerm[];
    /** What the user is shown before anything happens. */
    readonly preview: DeletionPreview;
  }

  async function readDeletion(dropId: string, body: string): Promise<DeletionFacts> {
    const byDrop = await store.listTermsByDrop();
    const matters = await store.listMatters();
    const all = await store.listConclusions();

    // A drop fed a conclusion when the matter that conclusion came out of counts
    // **this drop** among the fragments that raised it. That is the only honest
    // answer to "did this drop produce it", and it is deliberately the narrow one:
    // a conclusion assembled from a matter whose other fragments are still there
    // does not become "this drop's" merely by sharing a subject with it.
    const mattersFed = new Set(
      matters
        .filter((matter) => matter.drops.some((mention) => mention.dropId === dropId))
        .map((matter) => matter.id),
    );
    const conclusions = all.filter((conclusion) => mattersFed.has(conclusion.matterId));

    // Who is still saying a word is the set of drops that mention it — counted
    // across **every** drop rather than looked up from where the term came from.
    // The two come apart the moment someone repeats a word: an origin is only the
    // fragment that first said it, so trusting it would call 「好烦」 a word the
    // first fragment alone said — and deleting a later fragment would then take a
    // word two others still say.
    const saidElsewhere = new Set<string>();
    for (const [otherDropId, mentions] of byDrop) {
      if (otherDropId === dropId) continue;
      for (const term of mentions) saidElsewhere.add(term.id);
    }
    const terms = (byDrop.get(dropId) ?? []).filter((term) => !saidElsewhere.has(term.id));

    return {
      conclusions,
      terms,
      preview: {
        dropId,
        body,
        // The sentences themselves rather than a tally: "2 conclusions came from
        // it" asks the user to trust a number, while showing the two sentences
        // asks them to recognize what they would be giving up. The count the spec
        // asks for is this list's length, and the page says it in those words.
        conclusions: conclusions.map((conclusion) => ({
          id: conclusion.id,
          text: conclusion.text,
        })),
        terms: terms.map((term) => term.text),
      },
    };
  }

  /**
   * Remove conclusions outright.
   *
   * Explicitly, rather than leaving it to the cascade: a conclusion hangs off
   * **its matter**, and a drop's deletion only reaches the matter when that drop
   * was the matter's last member. A matter the user has kept raising would keep
   * the judgement alive, so "delete what came from it" would quietly become
   * "delete nothing" — the one outcome worse than either choice.
   *
   * @param conclusionIds - the conclusions to remove.
   */
  async function dropConclusions(conclusionIds: readonly string[]): Promise<void> {
    for (const conclusionId of conclusionIds) await store.deleteConclusion(conclusionId);
  }

  /**
   * Move what the user chose to keep somewhere the deletion cannot reach.
   *
   * `original-only` is the choice "forget I said it, but what you noticed still
   * holds", and the storage puts those two in conflict: a conclusion cascades
   * with its **matter**, a matter cascades with the **term** it was opened
   * around, and a topic's fragments keep saying the same few words — so deleting
   * the fragment that first said 「好烦」 would take the matter, and with it every
   * judgement the user just asked to keep.
   *
   * The way out is not to weaken the cascade but to give the kept judgements a
   * ground that survives **before** anything is deleted:
   *
   *  1. A term the drop alone said is going, so the matter is re-opened around a
   *     word that stays — one the matter already counts as support. If there is
   *     none, the matter has nothing left to stand on and no judgement can be
   *     kept from it; the second step then moves nothing, which is the honest
   *     outcome rather than a judgement with no evidence under it.
   *  2. The kept conclusions are moved onto that surviving matter. What they
   *     **cite** is left alone here: the support a judgement carries is the
   *     evidence it was assembled from, and rewriting that at the moment of
   *     deletion would make the product's own record of what it saw into a record
   *     of what is left.
   *  3. What is left of the matter becomes a summary of the fragments that remain,
   *     so a matter cannot keep counting a fragment the user has taken back.
   *
   * @param facts - what the one read of this drop turned up.
   * @returns the conclusions that now stand on the surviving matter.
   */
  async function carryOver(facts: DeletionFacts): Promise<readonly StoredConclusion[]> {
    const matters = await store.listMatters();
    const orphans = new Set(facts.terms.map((term) => term.id));

    const kept: StoredConclusion[] = [];
    for (const conclusion of facts.conclusions) {
      const matter = matters.find((candidate) => candidate.id === conclusion.matterId);
      if (matter === undefined) continue;

      const survivor =
        matter.supportTermIds.find((termId) => !orphans.has(termId)) ??
        (orphans.has(matter.anchorTermId) ? undefined : matter.anchorTermId);
      if (survivor === undefined) continue;

      // The new anchor term is named here, and what `reopenMatter` hands back —
      // the drops now feeding the matter — is not read: this function's job is to
      // get the matter and its judgements onto ground that survives, and the
      // caller re-reads whatever it needs afterwards. 
      if (orphans.has(matter.anchorTermId)) await store.reopenMatter(matter.id, survivor);
      await store.detachConclusion(conclusion.id, matter.id);
      kept.push(conclusion);
    }

    // The fragment gives up its place in the accumulation, and the matter is
    // brought back in line with what is left of it. This is the step that stops a
    // withdrawn fragment from keeping a matter crossing the threshold — a matter
    // that re-crossed on evidence nobody can read any more would have the product
    // speaking about material the user has taken back.
    //
    // Keyed by the drop's identity rather than the moment it joined: a few
    // fragments typed in one sitting carry the same timestamp to the millisecond,
    // and forgetting the wrong mention would silently re-count the matter.
    const dropId = facts.preview.dropId;
    for (const matter of matters) {
      if (matter.drops.some((mention) => mention.dropId === dropId)) {
        await store.forgetMatterDrop(matter.id, dropId);
      }
    }

    return kept;
  }

  /**
   * Stop kept judgements from citing words that no longer exist.
   *
   * The one thing `original-only` edits, and it edits **support, never the
   * sentence**. A judgement the user chose to keep is kept word for word — that is
   * the promise of the choice — but what it names as the evidence behind it has to
   * be something they can still read back. Rewriting the sentence instead would be
   * keeping a different judgement than the one they saw; leaving the props alone
   * would show them a claim resting on words they cannot find.
   *
   * Nothing takes the missing word's place: the domain does not know what the user
   * meant by it, and a conclusion whose support was quietly padded would be
   * explaining itself with evidence it never had.
   *
   * @param kept - the conclusions that survived.
   * @param facts - what the one read of this drop turned up.
   */
  async function pruneSupport(
    kept: readonly StoredConclusion[],
    facts: DeletionFacts,
  ): Promise<void> {
    const going = new Set(facts.terms.map((term) => term.id));
    if (going.size === 0) return;
    const citing = kept.filter((conclusion) =>
      conclusion.supportTermIds.some((termId) => going.has(termId)),
    );
    if (citing.length === 0) return;
    await store.pruneConclusionSupport({
      conclusionIds: citing.map((conclusion) => conclusion.id),
      termIds: [...going],
    });
  }

  /**
   * Record one drop, along with whatever the user has already said about where
   * it belongs.
   *
   * Everything that happens to a drop other than being read: the row, the line it
   * is answered with, the quiet window it arms, and the two pieces of background
   * work (reading it, and phrasing the reply). Pulled out of `drop` for one
   * caller — a sentence written beside a conclusion (ticket 10) — because the
   * whole point of that sentence is that it is **a drop like any other**, and a
   * second path into the store would be a second set of guarantees to keep.
   *
   * @param body - the raw text the user typed. Stored verbatim.
   * @param pinnedMatterId - the matter the user wrote it beside, or null for a
   *   drop typed at the top, which the ordinary attachment rules place.
   * @returns what this drop caught, and the reply to show the user.
   */
  async function recordDrop(body: string, pinnedMatterId: string | null): Promise<DropResult> {
    // What this drop asks of its reply, read once and used for two things:
    // the line to answer with now, and what the provider is told later.
    const situation = readSituation(body);
    const safe = safeReply(situation);

    // Record first, with the line the user is owed. The faithful original and
    // an answer to it are what make the drop a success; both are code's own,
    // and neither waits on anyone.
    // The moment is taken once, at the drop, and used for everything that drop
    // causes: the row it is stored as and — through the drop it belongs to —
    // where its terms and its matter land in time. Reading the clock again later
    // would let a slow reading move a fragment's moment, and a span is a number
    // this product decides on.
    const at = now();
    const stored = await store.appendDrop(body, safe, at, pinnedMatterId);

    // The quiet window is armed before anything else runs. It is a fact about
    // *this drop arriving* rather than about what was read out of it, so it may
    // not wait on a provider; what the drop added to the accumulation is counted
    // later, once it has actually been attached.
    armQuietWindow();

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

    // Compose the styled reply to what the user just said. Like extraction, it
    // does not gate the drop: it replaces the line the drop was caught with,
    // and only if it passes the parent-voice checks.
    void replyInto(stored, situation);

    return { body: stored.body, reply: stored.reply ?? safe, id: stored.id };
  }

  return {
    async drop(body: string): Promise<DropResult> {
      return recordDrop(body, null);
    },

    async listDrops(): Promise<readonly DropSummary[]> {
      const drops = await store.listDrops();
      const items = await store.listItems();
      // Group once rather than querying per drop: the page asks for every drop
      // on every load, and the number of drops only grows.
      const itemsByDrop = new Map<string, StoredItem[]>();
      for (const item of items) {
        const bucket = itemsByDrop.get(item.dropId);
        if (bucket === undefined) itemsByDrop.set(item.dropId, [item]);
        else bucket.push(item);
      }
      // Terms are grouped the same way, and for the same reason. Grouped by the
      // **mention**, not by a term's origin: what this asks is what each drop
      // said, and a term said twice was said by both drops.
      const termsByDrop = await store.listTermsByDrop();
      return drops.map((drop) =>
        toSummary(drop, itemsByDrop.get(drop.id) ?? [], termsByDrop.get(drop.id) ?? []),
      );
    },

    async getDrop(dropId: string): Promise<DropSummary | null> {
      return readDrop(dropId);
    },

    async listItems(): Promise<readonly Item[]> {
      return (await store.listItems()).map(toItem);
    },

    async upcoming(): Promise<Upcoming> {
      // The **whole** list, done items included, and the filtering happens in
      // `upcomingFrom`: which items a list is made of is a rule about what the
      // user is asking, and pushing half of it down into SQL would split one
      // rule across two layers that could then disagree.
      //
      // The moment is read once, here, and handed down — the domain owns time
      // (`createDomain({ now })`), and a read that took the clock twice could
      // order one list against two moments.
      return upcomingFrom((await store.listItems()).map(toItem), now());
    },

    async setItemState(itemId: string, state: ItemState): Promise<Item | null> {
      const stored = await store.setItemState(itemId, state);
      // Null is an answer: there is no such item, which is not an error the
      // caller should have to catch. The same reading `getDrop` takes.
      return stored === null ? null : toItem(stored);
    },

    async listLinks(): Promise<readonly TermLink[]> {
      // Both ends are named by looking the terms up once and sharing the map:
      // what a link needs from a term is its wording, and reading the whole term
      // list once is cheaper than a lookup per end.
      const byId = new Map((await store.listTerms()).map((term) => [term.id, term]));
      const links: TermLink[] = [];
      for (const link of await store.listLinks()) {
        const from = byId.get(link.fromTermId);
        const to = byId.get(link.toTermId);
        // A link with an end that cannot be named is not shown: the store
        // cascades links away with their terms, so this only happens to a
        // database that lost a row by hand, and a nameless link is not
        // something the page could render honestly anyway.
        if (from === undefined || to === undefined) continue;
        links.push({
          id: link.id,
          kind: link.kind,
          strength: link.strength,
          reason: link.reason,
          from: toNamedTerm(from),
          to: toNamedTerm(to),
        });
      }
      return links;
    },

    async listConclusions(): Promise<readonly Conclusion[]> {
      return conclusionViews();
    },

    async markConclusionWrong(conclusionId: string): Promise<Conclusion | null> {
      // Queued behind the looks, because this writes to the very chain a look is
      // reading: a correction that landed mid-settlement would leave the sentence
      // being composed pointing at the predecessor the user has just rejected.
      const written = await queueRevision(async (): Promise<StoredConclusion | null> => {
        const stored = await store.listConclusions();
        const target = stored.find((conclusion) => conclusion.id === conclusionId);
        if (target === undefined) return null;
        // A judgement is what a person can disagree with. A correction is the
        // product's note of something the user **did**, which is a fact about them
        // and not a reading of them — so there is nothing in it to reject, and
        // nothing is written.
        if (target.kind === 'correction') return null;
        // The second tap is the same fact. Appending another record for it would
        // make the chain count taps instead of corrections.
        const already = stored.find(
          (conclusion) =>
            conclusion.relation === 'overturn' && conclusion.supersedes === conclusionId,
        );
        if (already !== undefined) return already;

        return store.appendConclusion({
          matterId: target.matterId,
          // Nothing of its own was written: what a correction holds is the user's
          // own act, stated in code's words, so there is no sentence to hand the
          // surfacing moment and nothing to be phrased.
          claim: null,
          text: CORRECTION_LINE,
          kind: 'correction',
          // No band, and no numbers: a correction asserts nothing about the user,
          // so there is nothing for a wording to be read off. The numbers the
          // rejected sentence was worded by stay on that sentence.
          tier: null,
          softened: false,
          relation: 'overturn',
          supersedes: target.id,
          createdAt: now(),
          mentions: 0,
          spanDays: 0,
          averageStrength: 0,
          // The tap is the ground, and it needs no evidence behind it. The words
          // the rejected sentence stood on are still listed with **that**
          // sentence, which is where the user can go and read them.
          supportTermIds: [],
        });
      });

      if (written === null) return null;
      // Read back through the same assembly the page gets, so the record handed
      // to the caller carries the relations it was just given rather than the
      // half-built row the store returned.
      return (await conclusionViews()).find((conclusion) => conclusion.id === written.id) ?? null;
    },

    async appendToConclusion(
      conclusionId: string,
      body: string,
    ): Promise<ConclusionAddition | null> {
      const stored = await store.listConclusions();
      const target = stored.find((conclusion) => conclusion.id === conclusionId);
      // Nothing is written for a conclusion that is not there: the sentence was
      // meant to sit beside something, and a drop with no "beside" is not the
      // thing the user asked for.
      if (target === undefined) return null;

      // The same path an ordinary drop takes, with the one thing the user has
      // already decided handed to it in advance.
      const drop = await recordDrop(body, target.matterId);
      return { conclusion: { id: target.id, text: target.text }, drop };
    },

    async requestSurfacing(options?: SurfacingOptions): Promise<SurfacingResult> {
      // The trigger, read before anything else runs. A drop the product does not
      // speak after is not a moment, and no look is forced on its account — see
      // `isAMoment` for what makes one.
      const dropId = options?.dropId;
      if (dropId !== undefined) {
        const drop = await store.findDrop(dropId);
        // A drop nobody recorded is not a moment either: nothing arrived to
        // speak after.
        if (drop === null || !isAMoment(drop)) {
          return { kind: 'none', reason: 'not-a-moment' };
        }
      }

      // Judged now rather than whenever the invisible look would have come round:
      // the moment is the user's, and what they are about to read has to count
      // the last few fragments. It goes through the one look queue, so two
      // attempts in the same breath cannot each spend the alternation's turn.
      await queueLook(settle);

      const at = now();
      const ready = await readySurfacings(at);
      if (ready.kind === 'none') return ready;

      // The dice, and the whole of the mystery: whether this turn is used at all,
      // which of the things that could be said is said, and which of that band's
      // openings the line carries. A question is never rolled for — the user
      // asked, and "not this time" is not an answer to a question — so the chance
      // applies to a drop.
      if (dropId !== undefined && random() >= surfacingPolicy.surfaceChance) {
        return { kind: 'none', reason: 'held-back' };
      }
      const candidates = ready.candidates;
      // A roll below 1 always names one of them; the fallback keeps a caller that
      // breaks that contract from turning "show one" into "show none".
      const chosen = candidates[Math.floor(random() * candidates.length)] ?? candidates[0];

      // Written down before it is handed back, so the cooldown is a fact about
      // the user from the moment they have read the line.
      await store.recordSurfacing(chosen.conclusion.id, at);

      const terms = new Map((await store.listTerms()).map((term) => [term.id, term]));
      return {
        kind: 'surfaced',
        // The sentence the provider wrote, in the band's own opening. The
        // conclusion is not rewritten: its framed line stays in the portrait, and
        // what changes per surfacing is the layer code owns — how firmly the
        // product speaks, never what it observed.
        text: surfacingLine(chosen.tier, chosen.claim, random()),
        tier: chosen.tier,
        conclusion: { id: chosen.conclusion.id, text: chosen.conclusion.text },
        support: chosen.conclusion.supportTermIds
          .map((termId) => terms.get(termId))
          .filter((term): term is StoredTerm => term !== undefined)
          .map(toNamedTerm),
        mentions: chosen.conclusion.mentions,
        spanDays: chosen.conclusion.spanDays,
        averageStrength: chosen.conclusion.averageStrength,
        surfacedAt: at,
      };
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

    async recall(question: string, options?: RecallOptions): Promise<RecallResult> {
      // No provider means the question cannot be put to the records at all. That
      // is `unavailable`, not `not-found`: nothing was searched, so claiming the
      // records do not cover the question would be a claim about the user's own
      // data that nobody checked.
      if (provider === undefined) return { kind: 'unavailable' };

      // What to look for. The model reads the question; it does not read the
      // records, and it never decides whether an answer exists.
      let matchText: readonly string[];
      try {
        matchText = (await provider.parseQuestion({ question })).matchText;
      } catch {
        // A provider that is down, refuses, or blows up must not become an
        // invented answer, and must not be reported as a fact about the data.
        return { kind: 'unavailable' };
      }

      // Blank entries are discarded before matching. A model that returned `['']`
      // or whitespace would otherwise match every drop, since every string
      // contains the empty string — turning "I have nothing to look for" into
      // "everything answers this question", which is exactly backwards.
      const wanted = matchText.map((text) => text.trim()).filter((text) => text.length > 0);
      if (wanted.length === 0) return { kind: 'not-found' };

      // Selection is plain code, not a model call: a drop matches when any of
      // the text appears in it. That is what makes "found nothing" a fact about
      // the data rather than an opinion, and the same question recalls the same
      // records every time. `listDrops` is oldest-first, so this order is stable.
      const sources: readonly RecallSource[] = (await store.listDrops())
        .filter((drop) => wanted.some((text) => drop.body.includes(text)))
        .map(toRecallSource);
      if (sources.length === 0) return { kind: 'not-found' };

      // The moment to answer *as of*. Pinned by the caller for the demo's
      // "a few days later" viewpoint, otherwise now. It reaches the composer
      // only, so it can change how the answer reads but never what was found.
      const now = options?.now ?? new Date().toISOString();

      let answer: string;
      try {
        answer = (await provider.composeAnswer({ question, records: sources, now })).answer;
      } catch {
        return { kind: 'unavailable' };
      }

      // An answer of nothing is not an answer. Without this, a provider
      // returning whitespace would produce `kind: 'answered'` with an empty line
      // beside a source — the exact confusion this result shape exists to rule
      // out — so it is refused here rather than rendered.
      if (answer.trim().length === 0) return { kind: 'unavailable' };

      // Every match is cited, not one chosen "main" source: the composer was
      // handed all of them and may have drawn on any, so naming a single drop
      // could show the user an original the answer did not come from. Checking
      // the answer against the original is the reason a source is shown at all.
      return { kind: 'answered', answer, sources };
    },

    async previewDeletion(dropId: string): Promise<DeletionPreview | null> {
      const drop = await store.findDrop(dropId);
      // No such fragment is an answer, not a failure — the same reading `getDrop`
      // takes. Nothing was looked at, so nothing may be claimed about what a
      // deletion would take.
      if (drop === null) return null;
      return (await readDeletion(dropId, drop.body)).preview;
    },

    async deleteDrop(dropId: string, mode: DeletionMode): Promise<DeletionResult | null> {
      // The decision the user arrived at by reading the preview, and it is a
      // decision that removes nothing. Answered as null for the same reason an
      // unknown drop is: nothing happened, and the caller is told so rather than
      // handed a receipt for work that was never done.
      if (mode === 'keep') return null;

      const drop = await store.findDrop(dropId);
      if (drop === null) return null;

      // Read **once**, and used for both the announcement and the work. The two
      // have to agree: a deletion that reported a different set from the one it
      // announced would make the announcement worthless, and this is the one
      // operation where that discrepancy is unrecoverable.
      const facts = await readDeletion(dropId, drop.body);

      // The conclusions go **first**, and the order is load-bearing rather than
      // incidental: deleting the drop detaches it from its matter and can take
      // the matter with it, which cascades to every conclusion that came out of
      // it. Under `cascade` that is exactly what is wanted. Under
      // `original-only` it is the opposite of what the user chose, so the ones
      // they chose to keep are moved somewhere that survives before anything is
      // deleted — see `carryOver`.
      const kept = mode === 'cascade' ? [] : await carryOver(facts);
      if (mode === 'cascade') {
        await dropConclusions(facts.conclusions.map((conclusion) => conclusion.id));
      }

      // The drop itself. Everything the schema hangs off it goes by cascade: its
      // items, its mentions, its place in its matter. Its **terms** do not — a
      // word is one row per wording and may be said by several fragments, so which
      // ones this deletion takes was worked out above and removed below.
      await store.deleteDrop(dropId);

      // The words this fragment was the last to say. Removed after the drop and in
      // their own step, so the surviving words have already stopped pointing at a
      // fragment that is gone before anything is deleted outright.
      await store.deleteTerms({ termIds: facts.terms.map((term) => term.id), anchorTermId: null });

      // Under `original-only` the kept judgements have to be stopped from citing
      // words that no longer exist. What they cite is evidence, and evidence the
      // user can no longer read is not evidence — so it goes, and nothing is
      // invented in its place. The sentence itself is not touched: the user chose
      // to keep it, and rewording it would be keeping a different sentence.
      if (mode === 'original-only' && kept.length > 0) await pruneSupport(kept, facts);

      return {
        dropId,
        // Under `cascade` this is what went; under `original-only` it is empty,
        // because nothing came away but the original — which is the whole meaning
        // of that choice, and reporting the kept ones here would read as a
        // deletion that happened.
        conclusions: mode === 'cascade' ? facts.preview.conclusions : [],
        mode,
      };
    },
  };
}

/** Present a stored drop as something an answer can cite. */
function toRecallSource(drop: StoredDrop): RecallSource {
  return {
    dropId: drop.id,
    body: drop.body,
    droppedAt: drop.droppedAt,
  };
}
