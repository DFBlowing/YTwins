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
 * @module domain/core
 */

import type { AiProvider, ExtractResult } from './ai-provider.ts';
import type {
  Domain,
  DropResult,
  DropSummary,
  Item,
  LinkedTerm,
  RecallOptions,
  RecallResult,
  RecallSource,
  Term,
  TermLink,
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
  briefFor,
  checkReply,
  readSituation,
  safeReply,
  type ReplySituation,
} from './parent-voice.ts';
import type { DropStore, NewLink, StoredDrop, StoredItem, StoredTerm } from './storage.ts';

/** How many times a provider is asked to answer one drop. One attempt, one retry. */
const REPLY_ATTEMPTS = 2;

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

function toLinkedTerm(stored: StoredTerm): LinkedTerm {
  return { id: stored.id, text: stored.text };
}

/**
 * Build the domain core.
 *
 * @param options - the store, and optionally an AI provider.
 * @returns the domain interface.
 */
export function createDomain(options: DomainCoreOptions): Domain {
  const { store, provider } = options;
  const linkPolicy = options.linkPolicy ?? DEFAULT_LINK_POLICY;

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

    let said: readonly StoredTerm[];
    try {
      said = await store.recordExtraction(drop.id, {
        inputType: reading.inputType,
        items: reading.items,
        terms: reading.terms,
      });
    } catch {
      // The provider answered but the write failed. Swallowing this keeps the
      // port's promise that extraction never rejects, and leaves the drop
      // unread so a later attempt can still succeed. Nothing was half-written:
      // the store writes items, terms and the links between them in one step.
      return;
    }

    // The zero-model half of linking: the terms the user said together. Written
    // here rather than by the store because it is the product's rule and its
    // wording, and it is a step of its own because a link that fails to write
    // costs a link — never the terms, which are already stored.
    await recordSameDropLinks(said);

    // The semantic half costs a provider call, so it runs on its own and on its
    // own time. A drop whose terms were read is a success whether or not
    // anything could be compared.
    void linkInto(said);
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

  return {
    async drop(body: string): Promise<DropResult> {
      // What this drop asks of its reply, read once and used for two things:
      // the line to answer with now, and what the provider is told later.
      const situation = readSituation(body);
      const safe = safeReply(situation);

      // Record first, with the line the user is owed. The faithful original and
      // an answer to it are what make the drop a success; both are code's own,
      // and neither waits on anyone.
      const stored = await store.appendDrop(body, safe);

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
          from: toLinkedTerm(from),
          to: toLinkedTerm(to),
        });
      }
      return links;
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
