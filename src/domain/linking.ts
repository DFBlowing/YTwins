/**
 * The rules that turn two terms into a **link**.
 *
 * Three decisions live here, and nowhere else, because they are the ones that
 * get re-tuned once real material exists rather than reasoned out in advance:
 * where a score stops being a link, where it stops being worth asking about,
 * and what to do in between.
 *
 * The shape is the one the research settled on (`docs/ytwins/memory-linking-research.md`
 * §2.1): pretrained embeddings, a cosine, and three bands — high connects, low
 * skips, the grey zone is the only place a model is consulted. Both bounds and
 * the grey-zone policy are carried by `LinkPolicy`, so changing the rule later
 * is changing a value rather than editing the linking path.
 *
 * @module domain/linking
 */

/**
 * Where the bands sit, and what to do in the grey one.
 *
 * Deliberately a value the core is handed rather than a table of module
 * constants read from inside: a caller (and a test) can pin a different policy
 * without reaching into the implementation, which is what makes "the rule can
 * be changed later" true rather than aspirational.
 *
 * The initial numbers are a starting point, not a finding. The research notes
 * that a plain threshold produces wrong edges in a wide middle band and gives
 * 0.7–0.85 as the shape of that band, not as a measured value for this product
 * — ticket 05's prototype is where they get calibrated against real terms.
 */
export interface LinkPolicy {
  /**
   * At or above this cosine, two terms are linked without asking anyone.
   *
   * Inclusive, and checked first: a score that clears this band is never put to
   * a judge, because the number already settled it.
   */
  readonly connectAbove: number;
  /**
   * At or below this cosine, two terms are not linked, and nobody is asked.
   *
   * The cheaper half of the three-band design: most pairs of terms in a year of
   * drops are unrelated, and a price paid per unrelated pair is the one that
   * would make linking cost more than it is worth.
   */
  readonly skipBelow: number;
  /**
   * What happens between the two bounds.
   *
   * `judge` asks the provider; `skip` leaves the pair unlinked for now. The
   * second is a real option rather than a placeholder: the research is explicit
   * that missing a link is the cheaper mistake, so a build that cannot afford
   * the call may legitimately prefer to under-connect.
   */
  readonly greyZone: 'judge' | 'skip';
}

/**
 * The policy in force until something says otherwise.
 *
 * Wide grey zone on purpose: at this stage the cost of asking is a fraction of
 * a cent per drop, and a wrong link is visible to the user while a missing one
 * is not.
 */
export const DEFAULT_LINK_POLICY: LinkPolicy = {
  connectAbove: 0.85,
  skipBelow: 0.7,
  greyZone: 'judge',
};

/**
 * How strong a hard edge is.
 *
 * The top of the scale, and a fixed number rather than a measured one: two
 * things said in one sentence were certainly said together, so there is nothing
 * to estimate. Every other strength has to be read against this one.
 */
export const SAME_DROP_STRENGTH = 1;

/** Why a hard edge exists, in the words the user reads. */
export const SAME_DROP_REASON = '出现在同一次投递里';

/**
 * A pair of terms in one order.
 *
 * A link is symmetric, so a pair has to have one written form or the same two
 * terms would be two rows, two comparisons and two reasons. The smaller id
 * first is that form — arbitrary but stable, and the store's unique constraint
 * is written against it.
 *
 * @param left - one end.
 * @param right - the other end.
 * @returns both ends, ordered.
 */
export function orderedPair(left: string, right: string): readonly [string, string] {
  return left < right ? [left, right] : [right, left];
}

/**
 * One string naming a pair, whichever way round it is given.
 *
 * For asking "have these two been compared already?" — a question about a set,
 * where the order the pair arrived in carries no meaning. Built from
 * `orderedPair`, so the set and the table agree on what "the same pair" means.
 *
 * @param left - one end.
 * @param right - the other end.
 * @returns the pair's one name.
 */
export function pairKey(left: string, right: string): string {
  return orderedPair(left, right).join('\u0000');
}

/**
 * What to do about a pair, once its score has been read against the policy.
 *
 * The three bands and the grey-zone policy are folded into one answer on
 * purpose: they are one decision, and a caller that had to combine "which band
 * is this" with "what does the policy say about that band" would be
 * re-implementing half the rule.
 */
export type LinkDecision =
  /** Close enough to link on the score alone. */
  | 'link'
  /** In the grey zone, and the policy says to ask the judge. */
  | 'ask'
  /** Not a link: too far apart, or grey-zone and left for now. */
  | 'skip';

/**
 * Read a similarity against the policy.
 *
 * Order matters and is the whole definition: `connect` is checked before
 * `skip`, so the bands stay meaningful even if a policy is written with its
 * bounds crossed (`skipBelow` above `connectAbove`), where the space between
 * them is a grey zone rather than an overlap with no answer.
 *
 * @param similarity - the cosine between two term vectors.
 * @param policy - the bounds in force, and what the grey zone does.
 * @returns what to do with the pair.
 */
export function decideLink(similarity: number, policy: LinkPolicy): LinkDecision {
  if (similarity >= policy.connectAbove) return 'link';
  if (similarity <= policy.skipBelow) return 'skip';
  return policy.greyZone === 'judge' ? 'ask' : 'skip';
}

/**
 * Cosine similarity between two vectors.
 *
 * Written out rather than pulled from a library: it is a few lines, and the
 * project has no numerical dependencies to hide it behind.
 *
 * Two things make a pair **incomparable** rather than merely unrelated, and
 * both return null instead of a number, because a wrong number here would go on
 * to become a link:
 *
 *  - Different widths. The spec allows swapping the embedding implementation,
 *    and vectors from two different models have no shared meaning — comparing
 *    the part they happen to have in common would be reading a measurement that
 *    was never taken.
 *  - A vector with no direction (all zeros), which is a provider saying it has
 *    nothing to compare rather than saying the two are opposite.
 *
 * @param a - one vector.
 * @param b - the other.
 * @returns the cosine, or null when the two cannot be compared at all.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number | null {
  if (a.length === 0 || a.length !== b.length) return null;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    dot += left * right;
    normA += left * left;
    normB += right * right;
  }
  if (normA === 0 || normB === 0) return null;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Why a semantic edge exists, in the words the user reads.
 *
 * The score is in the sentence because it is the difference between "these are
 * related" and "these are related, and here is how much" — and because the same
 * number is what sorted the link's strength, so the two cannot tell different
 * stories.
 *
 * A score is not a probability: a cosine of 0.9 does not mean 90% likely to be
 * the same subject. The wording therefore reports the measurement ("语义相近")
 * rather than claiming a confidence.
 *
 * @param similarity - the cosine that produced the link.
 * @param judged - whether the pair had to be put to the judge first.
 * @returns the reason to store with the link.
 */
export function similarityReason(similarity: number, judged: boolean): string {
  const score = similarity.toFixed(2);
  return judged ? `语义相近（灰区判定，相似度 ${score}）` : `语义相近（相似度 ${score}）`;
}
