/**
 * The rules that decide what the product may **surface**, and when.
 *
 * Surfacing is the one moment the product speaks first — a **conclusion** coming
 * out at the user rather than the user pulling it. Three moments are kept apart
 * on purpose (`CONTEXT.md`, 浮现): a drop's **reply** is immediate, **judging**
 * is debounced and invisible, and **surfacing** is visible and happens only on a
 * drop that carries a feeling or on a question the user asked. This module holds
 * what that moment is allowed to be:
 *
 *  - **Only a judgement may be pushed.** A candidate is a **claim**; a **catch**
 *    is not a judgement at all (`CONTEXT.md`, 承接) — it only catches the newest
 *    feeling, so there is nothing in it to state with or without uncertainty, and
 *    it is not surfaced. That is also where "never hedge a catch" is enforced:
 *    structurally, by never putting one in this position.
 *  - **The register is code's, and the numbers are what is read off.** The
 *    strength of the wording comes from the band `conclusions.ts` read off term
 *    count, span and connection strength; what this module does is write the
 *    band's **opening** in front of the sentence the provider wrote. So every
 *    surfaced line is uncertain *by construction*, whatever the sentence looks
 *    like on its own — and the register is never guessed at afterwards.
 *  - **The register is a form, not a phrase, and it is not checked for.** The
 *    authority here is `docs/ytwins/parent-voice-principles.md` §「产品作者补充的
 *    规则」①: 校验要判的是「这句话有没有被说成断言」，不是「有没有出现某个词」——
 *    按词表匹配会把多样的、更自然的说法误杀。 A string check cannot read
 *    assertion-ness off a sentence, so nothing here tries: the uncertainty is
 *    added rather than detected, and the same band has several openings to draw
 *    from, which is where "same band, different wording" lives.
 *  - **The conclusion itself is never rewritten.** Its sentence is kept beside
 *    the framed line it was shown as (`StoredConclusion.claim`), and a surfacing
 *    reads that sentence with a fresh opening. The chain — what was said, and
 *    when — is untouched: what changes per surfacing is only the layer around it,
 *    which is exactly what ticket 05's review said belonged here.
 *  - **The same topic waits seven days.** What counts as the same topic is
 *    "semantic overlap of the supporting term sets", measured with the very same
 *    weighted rubric accumulation uses — and for the same reason: the prototype
 *    measured that the ratio knob **cannot** separate a genuine continuation from
 *    a misfire (they score identically), so what does is weighting a shared word
 *    by its rarity (ticket 05's `## Comments`, and ticket 06's).
 *  - **The dice are here, and nowhere else.** The author wants the internal
 *    logic not to be legible; that could not be done at the judging layer, which
 *    the user never sees, so it lives at the visible moment: whether this turn is
 *    used at all, which of the eligible conclusions is shown, and which of that
 *    band's openings the line carries. A question the user asked is never rolled
 *    for.
 *  - **An asked-for answer is several conclusions in one, and it is the same
 *    moment.** When the user asks directly, the product may bring a few
 *    conclusions together into one sentence (`CONTEXT.md`, 答案) instead of
 *    showing one of them — the same moment, the same cooldown, the same dice on
 *    the wording and never on whether to answer at all. What may be assembled,
 *    and how many, is `answerFloor` / `answerLimit` below; the sentence itself is
 *    the provider's, and the opening in front of it is the same band's.
 *
 * @module domain/surfacing
 */

import { MAX_SENTENCE_CHARACTERS, bareSentence, overlapOf } from './conclusions.ts';
import type { ConclusionTier } from './interface.ts';

/**
 * The dials of the visible moment.
 *
 * A value the core is handed rather than a table read from inside, for the same
 * reason as `LinkPolicy` and `ConclusionPolicy`: these are numbers a prototype
 * settled, not findings, so a caller has to be able to pin a different one —
 * which is also how a cooldown of seven days is checkable without waiting a week.
 *
 * The rarity weighting is deliberately **not** here. A shared word is counted the
 * one way accumulation counts it, and that switch lives in `ConclusionPolicy`
 * (`weightSharedBySpread`); restating it would be two switches for one
 * measurement, and they would eventually disagree.
 */
export interface SurfacingPolicy {
  /**
   * How long a topic stays quiet after it has been surfaced.
   *
   * Seven days, from the spec ("同一主题 7 天内只浮一次"), and measured from the
   * moment it was shown rather than from when the conclusion was assembled: what
   * the user is owed is not being told the same thing twice in a week, whatever
   * the material did meanwhile.
   */
  readonly cooldownMs: number;
  /**
   * How much of the smaller side two supports must share to be the same topic.
   *
   * The same reading as `ConclusionPolicy.overlapRatio`, and deliberately the
   * same number: "is this the same thing" is one question, asked once while
   * accumulating and once again when deciding whether the user has heard it.
   */
  readonly topicOverlapRatio: number;
  /**
   * How often a turn that has something to say uses it.
   *
   * 1 — always — as the initial value, because the demo may not depend on luck
   * (spec's 65) and because a conclusion that crossed the threshold is worth
   * hearing. The dial is here so the rhythm can be made less legible later, from
   * real use rather than from a guess; turning it down is the author's call, and
   * lowering it is the whole reason the visible moment carries the mystery.
   */
  readonly surfaceChance: number;
  /**
   * How many conclusions have to come together before there is an **answer**.
   *
   * Two, and the number is the feature rather than a calibration: an answer is
   * those several conclusions assembled into one sentence (`CONTEXT.md`, 答案),
   * and with fewer than two there is nothing to assemble — a single conclusion
   * dressed up as an assembled one would be the restatement the ticket rules out.
   * Below it the asked-for moment falls back to showing the one thing there is,
   * which is what the user already got before this ticket existed.
   *
   * A value rather than a constant for the same reason as every other dial here:
   * what the fallback is worth is a judgement about the product, and a check has
   * to be able to pin a different one. It can only be **stricter** than two — a
   * lower value is read as two, because "several" is what an answer is.
   */
  readonly answerFloor: number;
  /**
   * How many conclusions are brought together at most.
   *
   * Not a finding, a working limit: what the user asked for is *one* sentence,
   * and twenty things the product noticed cannot honestly be pressed into one.
   * The newest ones are taken, because the question is what the user is like
   * **lately** — the oldest material is still in the portrait, and a sentence
   * that led with it would describe someone who has moved on.
   */
  readonly answerLimit: number;
}

/** The policy in force until something says otherwise. */
export const DEFAULT_SURFACING_POLICY: SurfacingPolicy = {
  cooldownMs: 7 * 86_400_000,
  topicOverlapRatio: 0.5,
  surfaceChance: 1,
  answerFloor: 2,
  answerLimit: 4,
};

/**
 * Whether two support sets are the same topic.
 *
 * Literal overlap over the smaller side, with every shared word worth what
 * accumulation already says it is worth (`spreadWeight`): a word that turns up in
 * matter after matter nearly stops counting, which is what keeps 「好烦」 from
 * being evidence that two different things are one.
 *
 * @param candidate - the supporting wordings of the conclusion under consideration.
 * @param earlier - the supporting wordings of something already surfaced.
 * @param weight - what a shared wording is worth, from the accumulation's own spread.
 * @param policy - where the ratio lives.
 * @returns true when the two are close enough to count as one topic.
 */
export function isSameTopic(
  candidate: readonly string[],
  earlier: readonly string[],
  weight: (text: string) => number,
  policy: SurfacingPolicy,
): boolean {
  return overlapOf(candidate, earlier, weight).value >= policy.topicOverlapRatio;
}

/**
 * The openings each band may be introduced with, in code's own words.
 *
 * This is where the uncertainty of a surfaced line comes from, and it is a value
 * rather than something read off the sentence for the reason the module header
 * gives: assertion-ness cannot be checked off a string, so the product adds the
 * uncertainty instead of looking for it. Every opening in a band says the same
 * thing about how firmly the product may speak; they differ in phrasing only,
 * which is what lets the same band read differently twice without the strength
 * ever moving.
 *
 * The first opening of each band is the frame `frameFor` puts around a conclusion
 * in the portrait, so the two presentations coincide unless the dice say
 * otherwise. The medium band's frame adds nothing — that band is where the
 * sentence's own wording is supposed to carry the register — so at the moment the
 * product speaks first, code supplies the opening itself; the others hedge nothing
 * extra because saying an observation out loud is already a claim about what was
 * noticed rather than about what is.
 *
 * Like `BANNED_WORDS` in `parent-voice.ts`, this is an engineering setting: it is
 * expected to gain openings as real phrasings show up, and adding one never
 * changes what a band means.
 */
const SURFACING_OPENINGS: Readonly<Record<ConclusionTier, readonly [string, ...string[]]>> = {
  weak: ['我不太确定：', '可能是我多想了：', '我说不好，不过'],
  medium: ['听起来，', '看起来，', '似乎，'],
  strong: ['这段时间我看到一条线：', '这段时间看下来，', '回头看这段时间，'],
};

/**
 * The line a surfacing reads: the sentence the provider wrote, in the band's own
 * opening.
 *
 * One sentence, and the conclusion's own words inside it — the product decides
 * how firmly to speak and how to phrase the observation, never what was observed.
 *
 * @param tier - the band the conclusion's numbers earned.
 * @param claim - the sentence, without the frame.
 * @param roll - a number in `[0, 1)`, which of the band's openings this is.
 * @returns the line the user reads.
 */
export function surfacingLine(tier: ConclusionTier, claim: string, roll: number): string {
  const openings = SURFACING_OPENINGS[tier];
  const index = Math.min(openings.length - 1, Math.max(0, Math.floor(roll * openings.length)));
  // A roll below 1 always names one of them; the fallback keeps a caller that
  // breaks that contract from producing a line with no opening at all.
  const opening = openings[index] ?? openings[0];
  return `${opening}${bareSentence(claim)}。`;
}

/**
 * The rules an **answer**'s sentence must obey, in the product's own words.
 *
 * Deliberately not `CONCLUSION_INSTRUCTIONS`: those are written for one matter
 * and tell the model to follow the newest feeling inside it, which is the wrong
 * instruction for a sentence that has to hold several matters at once. What is
 * left is the part both share — one Chinese sentence, in the uncertain register,
 * with no hedge of its own (the band's opening is written by code) — plus the one
 * thing an answer must never be: something that would be true of anybody.
 *
 * The last rule is the whole product's reason for existing stated as an
 * instruction, and it is only half of the guarantee: the other half is that
 * nothing but the user's own material is sent with this request, so a model
 * handed only these words has nothing generic to reach for.
 *
 * The length is `MAX_SENTENCE_CHARACTERS` rather than a number written out here,
 * because `checkConclusion` enforces the same one: a limit stated twice is a
 * limit that can be stated wrong.
 */
export const ANSWER_INSTRUCTIONS: readonly string[] = [
  '只写一句中文陈述句，说人话；不用「用户」「画像」「数据」这类词，也不要写成报告或分析。',
  '这是判断，不是事实：用不确定的措辞（「你似乎…」这类），不要写成断言。',
  '只从这里给的事实出发，不要说出放在任何人身上都成立的话；不复述原话，不提问，不给建议。',
  `不加「我不太确定」这类整句缓冲语，语气强弱由外层决定；不超过 ${MAX_SENTENCE_CHARACTERS} 字，不以问号结尾。`,
];
