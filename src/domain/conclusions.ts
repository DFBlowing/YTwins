/**
 * The rules that turn accumulated material into a **conclusion**.
 *
 * Everything on this page was calibrated by a throwaway prototype rather than
 * reasoned out in advance (`archive/ytwins-05-threshold-prototype/`, on the
 * branch `prototype/ytwins-05-conclusion-threshold`), and the numbers it settled
 * are the initial values of `ConclusionPolicy`. The findings that shaped them,
 * because the shape is not obvious from the values:
 *
 *  - **The threshold counts mentions, not terms.** "This matter has been raised
 *    three times" survives a single unusually rich fragment; "six terms have
 *    connected" rewards someone for saying a lot in one breath. The author's
 *    calibration was "3 times is enough".
 *  - **The same-matter formula is literal overlap ÷ the smaller side**, at 0.50.
 *    Dividing by the union was measured and rejected: the denominator grows with
 *    the matter, so an old matter becomes harder and harder to add to for no
 *    reason but its age, until it closes itself.
 *  - **Shared terms are weighted by rarity** (config `weightSharedBySpread`).
 *    The prototype's most valuable negative result: for one matter, the genuine
 *    pair and the misfire pair both measured 0.67, so the ratio knob *cannot*
 *    separate them — raising it rejects both, lowering it admits both. Weighting
 *    a term by how many matters already contain it (1 / spread, learned from the
 *    user's own material) separates them, and costs the genuine lines nothing.
 *  - **Whether it may speak and how firmly it speaks are two dials.** The
 *    threshold decides whether a crossing may become a sentence; the three bands
 *    (terms / span / average connection strength) decide whether that sentence
 *    overstates. Moving one must not move the other, which is why the bands are
 *    independent of the threshold.
 *  - **The band's uncertainty frame is code's, not the model's.** A model may
 *    write the sentence; it may not choose how strongly the product speaks,
 *    because "why did it say that then" has to stay answerable from numbers.
 *
 * @module domain/conclusions
 */

import { CONCLUSION_TIERS, type ConclusionTier } from './interface.ts';

/**
 * The dials that decide when a conclusion is assembled, and how firmly it speaks.
 *
 * Deliberately a value the core is handed rather than a table of module
 * constants read from inside, for the same reason as `LinkPolicy`: changing a
 * rule later is changing a value, not editing the settling path. It also keeps
 * a check able to pin a different policy and see what a different rule would
 * have produced (a threshold of 4, a quiet window of zero).
 *
 * The initial values, and where each comes from, are the prototype's constant
 * table in `.scratch/ytwins/issues/05-conclusion-threshold-portrait-chain.md`.
 */
export interface ConclusionPolicy {
  /**
   * How many times a matter must have been raised before it may speak.
   *
   * The unit is **mentions** — one drop that attached to the matter is one —
   * and not the number of terms or a relevance score. Counting terms would let
   * a single rich fragment out-shout three separate days of saying the same
   * thing.
   */
  readonly threshold: number;
  /**
   * How long the fragments must have gone quiet before the deferred look runs.
   *
   * Measured from the newest drop, and it only has to cover "a few sentences in
   * one sitting": a few mutually-contextual fragments are one thought, and
   * judging them mid-thought assembles a wrong conclusion out of half of it.
   */
  readonly quietWindowMs: number;
  /**
   * How many drops may pile up before a look is forced, whatever the timing says.
   *
   * A backstop for someone who never pauses. It has to be well clear of the
   * quiet window, or it splits the very burst the window exists to protect: at
   * 3 it turned one four-fragment thought into two conclusions.
   */
  readonly pendingLimit: number;
  /**
   * When the invisible look happens.
   *
   * - `alternate` — the moment the count is reached, then the quiet window, and
   *   so on. The default: the rhythm should not become a clock the user can read
   *   off their own experience. The user cannot see a look, so this carries no
   *   mystery of its own (see ticket 06's notes); it is only about not settling
   *   into a pattern.
   * - `count` — look the moment the count is reached, never waiting.
   * - `quiet` — always wait for the quiet window.
   *
   * The three are one dial rather than three booleans because they are one
   * choice, and `count` / `quiet` are the two ends `alternate` alternates between
   * — which is what makes the debounce checkable without racing a clock.
   */
  readonly judgeTiming: 'alternate' | 'count' | 'quiet';
  /**
   * Below this many supporting terms it **catches** the newest feeling instead.
   *
   * Not a threshold: the matter has already crossed that and may speak. This is
   * about whether it has enough *material* to say something about a pattern —
   * with two terms behind it, anything it claims is a guess dressed as a
   * judgement, and the honest substitute is to catch the feeling instead.
   */
  readonly claimFloor: number;
  /**
   * How much of the new fragment a matter must already cover to be the same one.
   *
   * Checked against the smaller side of the two term sets, so it reads stably:
   * "how much of what you just said does this matter already know".
   *
   * The prototype measured this knob and found it cannot fix a misfire — do not
   * reach for it expecting that. `weightSharedBySpread` is what does.
   */
  readonly overlapRatio: number;
  /**
   * Whether a shared term counts less the more matters it already appears in.
   *
   * The word 「好烦」 turns up in matter after matter, so sharing it says almost
   * nothing; 「论文开题」 turns up in one, so sharing it says a lot. Learned from
   * the user's own material, so no curated stop-word list is needed, and the
   * first few matters are still undiscounted.
   */
  readonly weightSharedBySpread: boolean;
  /**
   * What a matter the user has rejected is still worth as "the same thing".
   *
   * A fragment that shares a word with a matter the user already called wrong is
   * not evidence that the fragment is about it — the user has said the reading
   * was off, so the overlap is discounted before it is compared with
   * `overlapRatio`. At the default the discount is decisive: overlap tops out at
   * 1, so a rejected matter can only be added to by a note the user writes beside
   * one of its conclusions, which is an attachment the user made rather than one
   * the product inferred.
   *
   * This is the prototype's own number and its own reading ("标不对要走到语料层"):
   * what the rejection lowers is the **classification**, never the fact — the
   * terms were still said together, and the links between them are untouched.
   */
  readonly overturnedOverlapFactor: number;
  /**
   * How many bands softer a matter speaks once the user has rejected a reading.
   *
   * The second half of the same reading: an inferred overlap discounted is a
   * matter that stops attracting look-alikes, and a band stepped down is what the
   * product says if anything is said about it afterwards. A step rather than a
   * factor, because bands are ordinal and there are three of them.
   */
  readonly overturnedBandDrop: number;
  /**
   * The wording bands: how many terms support it, how long it has spanned, and
   * how tightly those terms connect to the feeling it is about.
   *
   * The medium band is the floor for a sentence that is not explicitly hedged;
   * below it the frame itself says "我不太确定". The strong band's third gate is
   * the average connection strength, because a matter held together by one
   * shared word is not the same evidence as one held together by a tight web.
   */
  readonly mediumTerms: number;
  readonly mediumSpanDays: number;
  readonly strongTerms: number;
  readonly strongSpanDays: number;
  readonly strongStrength: number;
}

/**
 * The policy in force until something says otherwise.
 *
 * Every number here is a starting point measured on preset material, not a
 * finding about real users. Changing one affects what happens next and never
 * what has already been concluded — conclusions live in the portrait, and the
 * chain only grows.
 */
export const DEFAULT_CONCLUSION_POLICY: ConclusionPolicy = {
  threshold: 3,
  quietWindowMs: 3 * 60 * 1000,
  pendingLimit: 6,
  judgeTiming: 'alternate',
  claimFloor: 3,
  overlapRatio: 0.5,
  weightSharedBySpread: true,
  overturnedOverlapFactor: 0.3,
  overturnedBandDrop: 1,
  mediumTerms: 3,
  mediumSpanDays: 3,
  strongTerms: 6,
  strongSpanDays: 14,
  strongStrength: 0.8,
};

/** Two term sets measured against each other. */
export interface Overlap {
  /** How much of the smaller side the other covers, after weighting. */
  readonly value: number;
  /** The wordings both sides actually share, in the new fragment's order. */
  readonly shared: readonly string[];
}

/**
 * How much a shared term is worth, given how many matters already contain it.
 *
 * `spread` is a count of *matters*, not of mentions: a word said ten times about
 * one thing is still specific to that thing. A word spanning one matter is worth
 * its full weight; a word spanning several is worth an ever smaller share, which
 * is the whole measurement — a generic word shared with an old matter is not
 * evidence that the new fragment is about it.
 *
 * @param mattersContaining - how many matters already support this term.
 * @param policy - where the switch lives.
 * @returns the weight to count this term at.
 */
export function spreadWeight(mattersContaining: number, policy: ConclusionPolicy): number {
  if (!policy.weightSharedBySpread) return 1;
  return mattersContaining >= 2 ? 1 / mattersContaining : 1;
}

/**
 * Measure two term sets against each other.
 *
 * Literal overlap divided by the **smaller** side, so the reading is stable as a
 * matter grows: "how much of what you just said does this cover" does not change
 * meaning because the matter got older. The alternative (÷ union) was measured
 * and rejected — see this module's header.
 *
 * Empty on either side is no overlap at all rather than a division by zero: a
 * fragment that yielded no terms cannot be about anything.
 *
 * @param left - the new fragment's wordings, in the order they were said.
 * @param right - the matter's wordings as accumulated.
 * @param weight - what a shared wording is worth (see `spreadWeight`).
 * @returns how much of the smaller side is covered, and by which wordings.
 */
export function overlapOf(
  left: readonly string[],
  right: readonly string[],
  weight: (text: string) => number,
): Overlap {
  const rightSet = new Set(right);
  const shared = left.filter((text) => rightSet.has(text));
  const size = (list: readonly string[]): number =>
    list.reduce((total, text) => total + weight(text), 0);
  const denominator = Math.min(size(left), size(right));
  if (denominator === 0) return { value: 0, shared };
  return { value: size(shared) / denominator, shared };
}

/**
 * How many days a matter has spanned, as the number the page reads.
 *
 * Rounded once, here, and the rounding is what the bands are checked against:
 * a sentence that says "cross 3 days" was banded on that same 3, so the number
 * the user sees and the frame around the sentence cannot tell two stories.
 *
 * @param from - when the matter was opened, ISO-8601.
 * @param to - when it was last raised, ISO-8601.
 * @returns whole days, never negative.
 */
export function spanDays(from: string, to: string): number {
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (!Number.isFinite(days)) return 0;
  return Math.max(0, Math.round(days));
}

/**
 * Which wording band a matter's support earns.
 *
 * A pure reading of three numbers, and deliberately not a function of the
 * threshold score: the threshold says whether it may speak at all, this says how
 * firmly, and moving one must not move the other. See `ConclusionPolicy`.
 *
 * @param termCount - how many terms support the matter.
 * @param days - how long it has spanned, as `spanDays` rounds it.
 * @param averageStrength - how tightly the support connects to the feeling.
 * @param policy - where the two bands' gates live.
 * @returns the band the sentence must be written in.
 */
export function tierOf(
  termCount: number,
  days: number,
  averageStrength: number,
  policy: ConclusionPolicy,
): ConclusionTier {
  if (
    termCount >= policy.strongTerms &&
    days >= policy.strongSpanDays &&
    averageStrength >= policy.strongStrength
  ) {
    return 'strong';
  }
  if (termCount >= policy.mediumTerms && days >= policy.mediumSpanDays) return 'medium';
  return 'weak';
}

/**
 * Whether a matter's support is enough to claim anything at all.
 *
 * @param supportCount - how many terms carry the matter.
 * @param policy - where the floor lives.
 * @returns true when a claim is licensed; false means catch the feeling instead.
 */
export function mayClaim(supportCount: number, policy: ConclusionPolicy): boolean {
  return supportCount >= policy.claimFloor;
}

/**
 * The same band, hedged one step further.
 *
 * Used for a matter the user has rejected: nothing about the evidence changed,
 * but the product has been told it read this one wrong, and speaking as firmly
 * as before would be the product ignoring what it was just told. `weak` is the
 * floor — there is no band below the one that says outright that it is unsure.
 *
 * @param tier - the band the numbers earned.
 * @param steps - how many bands to soften; zero is the band unchanged.
 * @returns the band to write the sentence in.
 */
export function softerTier(tier: ConclusionTier, steps: number): ConclusionTier {
  // The order is `CONCLUSION_TIERS`, not a second list: the bands are one set,
  // and the store reads the same one back so that a relation it cannot name is
  // never invented.
  const index = CONCLUSION_TIERS.indexOf(tier);
  // A value this build does not know is handed back untouched rather than
  // turned into the weakest band, which would be a reading nobody earned — the
  // same choice the store makes when it cannot name a stored value.
  if (index === -1) return tier;
  return CONCLUSION_TIERS[Math.max(0, index - Math.max(0, steps))] ?? tier;
}

/**
 * The line code writes into the chain when the user marks a conclusion wrong.
 *
 * A fact, so it is stated plainly: the user did this, and there is nothing for
 * the product to hedge. It names the act and not the sentence, because the
 * record it is written on already carries the conclusion it supersedes — an
 * interface that quotes it again would be the same fact stored twice, and the
 * two copies could only ever come apart.
 */
export const CORRECTION_LINE = '你标了这条不对。';

/**
 * A sentence with its closing punctuation taken off.
 *
 * Exported because two places have to agree on where the sentence ends: the
 * band's frame around it, and the **surfacing**'s own opening in front of it.
 * Agreeing by sharing this rather than by each stripping its own way is what
 * keeps a conclusion and the moment it is shown as the same sentence.
 *
 * @param sentence - the sentence, as the provider wrote it.
 * @returns it, trimmed, with any run of closing punctuation removed.
 */
export function bareSentence(sentence: string): string {
  return sentence.trim().replace(/[。.！!？?…]+$/u, '');
}

/**
 * The band's frame, applied by code around the sentence's own words.
 *
 * This is the one place a band turns into wording, and it is code rather than an
 * instruction for exactly one reason: "why did it say that then" has to be
 * answerable from the numbers the band was read off. A model asked to pick its
 * own register could not be held to one afterwards.
 *
 * The frames are the prototype's, kept verbatim because they were read and
 * accepted as they are: weak says outright that it is unsure, medium states the
 * sentence the model already wrote in the uncertain register, and strong opens
 * by owning that this is a line seen over time.
 *
 * They are the **strength marker**, not the product's whole vocabulary. "Same
 * band, different wording" is real and it comes from the sentence itself: the
 * model writes each one, so 「你似乎…」 and 「听起来…」 arrive without this function
 * having to choose between them. Anything further — how a surfacing introduces
 * the conclusion, whether one band gets several openings — belongs to ticket 06,
 * and belongs *around* this sentence rather than inside it: a conclusion is part
 * of the chain and is never rewritten, so its wording is not a place to keep a
 * decision that changes per surfacing. Ticket 06 therefore keeps the sentence
 * beside this framed line (see `StoredConclusion.claim`) and writes its own
 * opening in front of it, rather than reading a frame back out of the text.
 *
 * @param tier - the band the numbers earned.
 * @param base - the sentence itself, without a closing full stop.
 * @returns what the user reads.
 */
export function frameFor(tier: ConclusionTier, base: string): string {
  const sentence = bareSentence(base);
  if (tier === 'weak') return `我不太确定：${sentence}。`;
  if (tier === 'strong') return `这段时间我看到一条线：${sentence}。`;
  return `${sentence}。`;
}

/** At most one sentence, from the shape a conclusion has to be. */
const MAX_SENTENCES = 1;

/**
 * How long any sentence the product bands may be, before its opening is added.
 *
 * Shorter than a reply's allowance on purpose: a reply answers something the user
 * just said, while a conclusion — or an answer assembled from several of them —
 * is a sentence out of nowhere, and the longer it is the more it sounds like a
 * verdict. The band's opening adds at most twelve characters on top, which is why
 * the limit is measured before it.
 *
 * Exported because it is not only enforced here: the rules each provider request
 * carries state the same limit in words, and a number written out twice is one
 * that can drift from the check that enforces it.
 */
export const MAX_SENTENCE_CHARACTERS = 48;

/**
 * The rules `checkConclusion` can find broken.
 *
 * A closed set for the same reason as `ReplyViolation`: these names are the
 * checker's return value, what the one retry is told, and what the checks
 * assert, and a typo in any of them would quietly retire a rule.
 */
export type ConclusionViolation =
  | 'empty'
  | 'not-chinese'
  | 'too-many-sentences'
  | 'too-long'
  | 'question';

/**
 * The rules a conclusion sentence must obey, in the product's own words.
 *
 * Sent with the request so the hard constraints have one source. The uncertain
 * register is required here and *only* here: a conclusion is a **judgement**, so
 * it may never be stated as a fact — while the frame around it (how much it
 * hedges) is added by code and must not be duplicated by the model.
 */
export const CONCLUSION_INSTRUCTIONS: readonly string[] = [
  '只写一句中文陈述句，说人话；不用「用户」「画像」「数据」这类词，也不要写成报告或分析。',
  '这是判断，不是事实：用不确定的措辞（「你似乎…」这类），不要写成断言。',
  '句子跟着这件事里最新那句情绪或决定走，不要用最早那句的样子去描述现在。',
  '不复述投递原文，不提问，不给建议，不给人格下定义，不用亲昵称呼。',
  `不加「我不太确定」这类整句缓冲语，语气强弱由外层决定；不超过 ${MAX_SENTENCE_CHARACTERS} 字，不以问号结尾。`,
];

/**
 * Check one conclusion sentence against the mechanical rules.
 *
 * Only what a string can carry: whether the model actually named a pattern in
 * the uncertain register is a judgement, and it travels as instructions
 * instead. An empty list means the sentence may be shown.
 *
 * @param text - the candidate, exactly as the provider returned it.
 * @returns the names of the rules it broke; empty when it obeys all of them.
 */
export function checkConclusion(text: string): readonly ConclusionViolation[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return ['empty'];

  const broken = new Set<ConclusionViolation>();

  // Chinese only, the same reading as the reply check: the product does not
  // speak another language, and no conclusion needs Latin letters. Digits and
  // punctuation are ordinary — 「平时分 40%」 is the user's own material.
  if (!/[\u4e00-\u9fff]/u.test(trimmed) || /[A-Za-z]/.test(trimmed)) broken.add('not-chinese');

  const sentences = trimmed
    .split(/(?<=[。！？!?…])/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
  if (sentences.length > MAX_SENTENCES) broken.add('too-many-sentences');
  if ([...trimmed.replace(/\s+/gu, '')].length > MAX_SENTENCE_CHARACTERS) broken.add('too-long');
  if (/[？?]/u.test(trimmed)) broken.add('question');

  return [...broken];
}
