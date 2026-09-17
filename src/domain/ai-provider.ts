/**
 * The AI provider port — the single external-dependency seam.
 *
 * Every non-deterministic intelligent call leaves the domain through here, so
 * that real and fake implementations are interchangeable and the domain's tests
 * are fully deterministic. Ticket 01 needed only `respond`; ticket 02 adds
 * `extract`, which is what turns a drop into **items** and a **record**.
 * Ticket 03 gives `respond` the **situation** it is answering and the
 * parent-voice rules, and has the domain check what comes back rather than
 * trusting it. Ticket 07 adds the two ends of **recall** — parsing a question,
 * and composing its answer. Ticket 04 adds the two ends of **linking**: encoding
 * text, and judging the pairs a score could not settle. Ticket 05 adds the one
 * thing settling needs a model for — putting a matter that has crossed the
 * threshold into a sentence — and gives `extract` the **anchor**: which of the
 * terms it read carries the feeling or the decision the fragment is about.
 * Ticket 11 adds the other end of the visible moment: bringing several
 * conclusions together into the one **answer** the user asked for, which is the
 * only call here that is handed more than one thing the product worked out.
 *
 * Note what settling does *not* put here: whether a matter may speak, when the
 * invisible look happens, and how firmly the sentence is allowed to speak. Those
 * are ordinary code inside the domain (`conclusions.ts`), read off counts and
 * spans, so "why did it say that then" is answerable from numbers rather than
 * from a model's mood.
 *
 * Note what linking does *not* put here: deciding whether two terms are linked.
 * The cosine and the thresholds are ordinary code inside the domain, so which
 * links exist is reproducible and a provider can never invent one — the model is
 * consulted only about the grey zone, and only when the policy says to ask.
 *
 * Note what recall does *not* put here: choosing which records answer a
 * question. That selection is ordinary code inside the domain, so "found
 * nothing" is a fact about the data rather than a model's opinion, and the same
 * question recalls the same records every time. Only the two ends that
 * genuinely need a model cross this seam. *
 * The real implementation talks to a cloud LLM; the fake one is scripted by the
 * test. The domain never learns which it got.
 *
 * @module domain/ai-provider
 */

import type { ConclusionTier, InputType, RecallSource } from './interface.ts';

/** What the provider is asked to say something about. */
export interface RespondRequest {
  /** The drop's original text. */
  readonly body: string;
  /**
   * What the reply is being asked for, as ordinary code read it.
   *
   * Deliberately only the readings a provider can act on. Whether the user
   * **asked to stop** is a third reading, and it never reaches here: a drop like
   * that is answered by code, because "leave only the shortest statement of
   * presence" is not something a string check can hold a model to (see
   * `parent-voice.ts` and `core.ts`). An instruction the provider cannot act on
   * is worse than no instruction: it invites an answer nobody wants.
   */
  readonly brief: ReplyBrief;
  /**
   * The rules this reply must obey, in the product's own words.
   *
   * They are sent rather than left to the implementation because they are a
   * hard product constraint rather than a prompt-tuning choice: an
   * implementation puts them in its instructions, and the domain's own code
   * checks the same rules afterwards (`parent-voice.ts`). Two places, one list.
   */
  readonly instructions: readonly string[];
  /**
   * Which rules the previous attempt broke, when this is the one regeneration.
   *
   * Absent on a first attempt. Named by `checkReply`; the port treats them as
   * opaque labels to put in front of the model, which is why they are plain
   * strings here rather than a type this module would have to own.
   *
   * A retry that is not told what was wrong is a reroll, and a model asked to
   * try again at random is no likelier to succeed.
   */
  readonly violations?: readonly string[];
}

/**
 * What a reply is being asked for, as the provider is told it.
 *
 * Two readings, not three: see `RespondRequest.brief`.
 */
export interface ReplyBrief {
  /** The text carries a feeling, so the reply's first sentence must name one. */
  readonly emotionPresent: boolean;
  /** The user asked what to do, so advice is licensed this turn. */
  readonly adviceRequested: boolean;
}

/** The provider's answer to one drop. */
export interface RespondResult {
  /** The reply text. The domain validates it against the parent-voice rules. */
  readonly reply: string;
}

/** A drop the provider is asked to read. */
export interface ExtractRequest {
  /** The drop's original text. */
  readonly body: string;
}

/**
 * One thing worth doing later, as the provider read it out of the drop.
 *
 * Note what is *absent*: no id, no link back to the drop, no storage detail.
 * The provider reads meaning; identity and ownership are the domain's to mint.
 */
export interface ExtractedItem {
  /** The thing to do, in the user's own words — not rewritten into a category. */
  readonly text: string;
  /**
   * When it is due as an ISO-8601 string, or null when the drop gave no time.
   *
   * Null is a legitimate reading, not a failure: "下周三交提纲" has a time and
   * "想去学吉他" does not, and both are items. The provider is expected to say
   * so rather than invent a date to look useful.
   */
  readonly dueAt: string | null;
}

/** The provider's reading of one drop. */
export interface ExtractResult {
  /** The items found in the drop. Empty is normal — most drops contain none. */
  readonly items: readonly ExtractedItem[];
  /**
   * The terms worth bringing up again, in the user's own words and in the order
   * they were said. Empty is normal.
   *
   * The wording is the contract: "想学吉他" is what the user said, and handing
   * back "音乐兴趣" instead would replace their evidence with the model's
   * summary of it. No ids and no links — identity and connection are the
   * domain's to mint, exactly as they are for items.
   */
  readonly terms: readonly string[];
  /**
   * Which of those terms carries the feeling or the decision this fragment is
   * about, or null when it carries neither.
   *
   * This is what the accumulation needs and a term list cannot say: the product
   * settles around a **feeling or a decision** the user keeps coming back to
   * (see `CONTEXT.md` — the threshold counts how often *that* was raised), and
   * only a reader of the sentence knows which of them it is. A fragment with no
   * feeling and no decision still keeps its terms; it just does not become
   * something to accumulate around.
   *
   * The wording has the same contract as `terms`: it is the user's own string,
   * and a value that is not one of the terms above is a reading that contradicts
   * itself, which the domain treats as no anchor at all rather than inventing a
   * term the user never said.
   */
  readonly anchor: string | null;
  /**
   * What kind of input this was, as the provider judged it.
   *
   * Recorded internally and never shown. It exists so the product can decide
   * what to do with a drop; it is not a label for the user to browse, and no
   * part of the product may ask the user to pick one.
   */
  readonly inputType: InputType;
}

/**
 * Texts the provider is asked to encode.
 *
 * A batch rather than one text at a time, because encoding is the same call
 * whatever it is handed and a drop arrives with several terms at once.
 */
export interface EmbedRequest {
  /** The texts to encode, in the order the domain wants the vectors back. */
  readonly texts: readonly string[];
}

/** One vector per text, in the order the texts were given. */
export interface EmbedResult {
  readonly vectors: readonly (readonly number[])[];
}

/** Two terms the provider is asked to rule on, and how close they already look. */
export interface JudgeLinkRequest {
  /** The wording at one end. */
  readonly from: string;
  /** The wording at the other end. */
  readonly to: string;
  /**
   * The cosine similarity the domain already computed.
   *
   * Sent because it is the whole reason this call is happening: the score sits
   * in a band where it is neither clearly a link nor clearly not one, and a
   * judge asked without the score would be judging blind.
   */
  readonly similarity: number;
}

/** The provider's verdict on one pair. */
export interface JudgeLinkResult {
  /**
   * Whether the two are close enough to link.
   *
   * A boolean rather than a score on purpose: this call exists to settle a band
   * the domain has already measured, and a second number with a different scale
   * would only invite the two to be compared.
   */
  readonly related: boolean;
}

/** A question the user asked of their records. */
export interface ParseQuestionRequest {
  /** The question as typed, verbatim. */
  readonly question: string;
}

/** What the provider made of a question. */
export interface ParseQuestionResult {
  /**
   * The text to look for in the records.
   *
   * Deliberately plain strings rather than anything cleverer: the domain turns
   * them into a substring lookup, so a hit is a match the user can check by eye.
   * Named for the mechanic rather than for a domain concept, because it is one —
   * the product's own words for what a question is about do not exist yet, and
   * inventing one here would be language the project does not use.
   *
   * An empty list means the question yielded nothing to look for, which the
   * domain reports as "found nothing" rather than asking a model to phrase the
   * absence. Blank entries are the domain's to discard, not the provider's.
   */
  readonly matchText: readonly string[];
}

/**
 * A request to compose the reply to one question about the user's **records**.
 *
 * Deliberately named for **recall** and not for the product's word **answer**
 * (`CONTEXT.md`, 追溯): what comes back from here is a **fact** — the user's own
 * words, read back to them — and the glossary is explicit that what recall hands
 * back is not to be called an 答案. The one thing on this port that *is* an answer
 * is `composeAnswer` below, and the two are kept apart in their names for exactly
 * the reason they are kept apart in the product: one states what the user said,
 * the other states what the product makes of them.
 */
export interface ComposeRecallAnswerRequest {
  /** The question as typed. */
  readonly question: string;
  /**
   * The records that answered it, oldest first. Never empty.
   *
   * The same type the result cites as its sources — the composer is handed
   * exactly what the user will be shown, so the two cannot drift apart.
   */
  readonly records: readonly RecallSource[];
  /**
   * The moment to answer *as of*, as an ISO-8601 string.
   *
   * This is what makes the demo's "a few days later" viewpoint possible without
   * waiting: the composer phrases time references ("下周三") relative to this.
   * It affects wording only — it never selects records, so pinning a different
   * basis can change how an answer reads but never what is recalled.
   */
  readonly now: string;
}

/** The composed reply to a question about the records. */
export interface ComposeRecallAnswerResult {
  /**
   * The answer sentence.
   *
   * The domain rejects a blank one: an empty answer beside a source is the
   * confusion this result shape exists to prevent.
   */
  readonly answer: string;
}

/**
 * A matter the provider is asked to put into one sentence.
 *
 * Only a matter that has already crossed the threshold arrives here: the domain
 * never asks a model what it thinks of the accumulation, because that decision
 * belongs to counts and spans rather than to an opinion.
 */
export interface ComposeConclusionRequest {
  /**
   * The feeling or decision the matter is about, in the user's own words.
   *
   * The **newest** one, not the one that opened the matter: a matter that began
   * with 「好烦」 and last carried 「松了口气」 is about someone who has since
   * relaxed, and a sentence built from the opening word describes a person who
   * is no longer there.
   */
  readonly anchor: string;
  /**
   * Every term supporting the matter, oldest first, in the user's own words.
   *
   * The sentences the user actually typed, not a summary of them: a conclusion
   * has to be checkable against the material, and a model handed categories
   * instead of words can only answer in categories.
   */
  readonly terms: readonly string[];
  /**
   * The band the numbers earned.
   *
   * Context for the wording, not a licence to choose a tone: the frame that
   * carries the strength is added by code afterwards (see `conclusions.ts`), so
   * the sentence itself is written the same way whatever band it is in.
   */
  readonly tier: ConclusionTier;
  /** The rules this sentence must obey, in the product's own words. */
  readonly instructions: readonly string[];
  /** Which rules the previous attempt broke, when this is the one retry. */
  readonly violations?: readonly string[];
}

/** The provider's sentence for one matter. */
export interface ComposeConclusionResult {
  /**
   * The sentence, without the band's frame.
   *
   * The domain adds the frame and rejects a blank: a conclusion rendered as an
   * empty line beside its supporting terms would be the product claiming
   * something it cannot say.
   */
  readonly text: string;
}

/**
 * Several conclusions the provider is asked to bring together into one sentence.
 *
 * This is the asked-for **answer** (`CONTEXT.md`, 答案), and it is the one call
 * on this port that is not about a single piece of material: what it is handed is
 * what the product has already worked out about the user, across several matters,
 * and what it owes back is one sentence that could only have come from that.
 *
 * Everything here is the user's own material — the sentences assembled out of
 * their fragments, and the wordings those sentences stand on. Nothing generic is
 * sent, which is the structural half of "只可能出自这个用户自己的数据": a model
 * handed only these cannot answer with something that would fit anyone else.
 */
export interface ComposeAnswerRequest {
  /**
   * The sentences to bring together, oldest first.
   *
   * The sentences the product assembled — without the band's frames, exactly as
   * `composeConclusion` handed them over — because those frames are the
   * product's own wording about how firmly it may speak, and an answer is not a
   * place to read them back out of a string.
   */
  readonly conclusions: readonly string[];
  /**
   * Every wording behind those sentences, oldest first, in the user's own words.
   *
   * The same material a conclusion is composed from, laid out as the union of
   * what supports the several of them: what an answer may be about is what the
   * user actually said, and a model given categories instead of words can only
   * answer in categories.
   */
  readonly terms: readonly string[];
  /**
   * The band the combined numbers earned.
   *
   * Context for the wording, not a licence to choose a tone: the opening that
   * carries the strength is written by code afterwards (`surfacing.ts`), so the
   * sentence itself is written the same way whatever band it is in.
   */
  readonly tier: ConclusionTier;
  /** The rules this sentence must obey, in the product's own words. */
  readonly instructions: readonly string[];
  /** Which rules the previous attempt broke, when this is the one retry. */
  readonly violations?: readonly string[];
}

/** The provider's one sentence about several conclusions. */
export interface ComposeAnswerResult {
  /**
   * The sentence, without the band's opening.
   *
   * The domain adds the opening and rejects a blank: an answer rendered as an
   * empty line beside the conclusions it was drawn from would be the product
   * claiming something it cannot say.
   */
  readonly text: string;
}

/**
 * The port. Implementations live outside the domain core — the domain holds the
 * interface, never a concrete provider.
 */
export interface AiProvider {
  /**
   * Compose the reply to one drop.
   *
   * Implementations may throw or take their time; the domain treats both as
   * ordinary, because a drop succeeds whether or not the provider answers. What
   * they may **not** do is decide how long a reply is or whether it asks a
   * question: those are checked afterwards, and a reply that breaks them is
   * thrown away and asked for once more.
   *
   * @param request - the drop, the situation it presents, and the rules.
   * @returns the reply text.
   */
  respond(request: RespondRequest): Promise<RespondResult>;

  /**
   * Read one drop for **items** and its **input type**.
   *
   * The same tolerance applies as for `respond`: throwing, hanging, or
   * returning nonsense all leave the drop itself untouched. The original text
   * is already stored by the time this is called, so nothing here can lose it,
   * and a failure only means the drop can be read again later.
   *
   * @param request - the drop being read.
   * @returns the items it contains, and what kind of input it was.
   */
  extract(request: ExtractRequest): Promise<ExtractResult>;

  /**
   * Encode texts so the domain can measure how close two terms are.
   *
   * The domain does the comparing: this call returns vectors and nothing else,
   * because turning a score into a decision has to be ordinary code the tests
   * can pin down. A provider that throws, hangs, or returns a vector per input
   * that does not line up costs the terms their semantic links — never the
   * terms themselves, which were already stored by the time this is called.
   *
   * @param request - the texts to encode.
   * @returns one vector per text, in the order asked.
   */
  embed(request: EmbedRequest): Promise<EmbedResult>;

  /**
   * Settle a pair whose similarity landed in the grey zone.
   *
   * Only ever called for a pair the domain could not decide by score: high
   * scores connect and low scores do not, and asking a model about those would
   * spend a call to be told what the number already said. Whether the grey zone
   * is asked at all is a policy the domain holds, not a decision this call
   * makes.
   *
   * @param request - both wordings, and the score between them.
   * @returns whether the two should be linked.
   */
  judgeLink(request: JudgeLinkRequest): Promise<JudgeLinkResult>;

  /**
   * Put a matter that has crossed the threshold into one sentence.
   *
   * Called only when ordinary code has already decided that the matter may
   * speak — the count crossed the threshold, the support is thick enough to claim
   * something, and the look was due. The same tolerance applies as everywhere
   * else: throwing, hanging or returning nonsense costs this round's sentence
   * and nothing else, because the matter stays pending and the next look tries
   * again. Silence is the honest failure here — a conclusion nobody could
   * compose must not become a worse one.
   *
   * @param request - the matter's feeling, its terms, and the rules.
   * @returns the sentence, before the band's frame is applied.
   */
  composeConclusion(request: ComposeConclusionRequest): Promise<ComposeConclusionResult>;

  /**
   * Bring several conclusions together into the one **answer** the user asked
   * for.
   *
   * Called only when ordinary code has already decided that an answer is
   * possible: the user asked, at least a few conclusions are eligible, and none
   * of them is inside the cooldown. The same tolerance applies as everywhere else
   * on this port — throwing, hanging or returning a sentence that breaks the
   * rules costs this turn's answer and nothing else, because what the moment
   * falls back to is a line that already exists rather than a worse one invented
   * here.
   *
   * Deliberately told nothing about *how* to answer: how firmly the product may
   * speak is read off numbers and written by code (`surfacing.ts`), so the model
   * supplies the words and never the register.
   *
   * @param request - the conclusions, the words behind them, and the rules.
   * @returns the sentence, before the band's opening is applied.
   */
  composeAnswer(request: ComposeAnswerRequest): Promise<ComposeAnswerResult>;

  /**
   * Work out what to look for when the user asks about their records.
   *
   * The same tolerance applies as everywhere else on this port: a provider that
   * throws, hangs, or returns nonsense leaves the user told that the question
   * could not be put to their records — never with an invented answer, and never
   * told that their records lack something nobody looked for.
   *
   * @param request - the question being asked.
   * @returns the text to look for in the records.
   */
  parseQuestion(request: ParseQuestionRequest): Promise<ParseQuestionResult>;

  /**
   * Turn the records that matched into a reply sentence.
   *
   * Only ever called when something matched: with no evidence there is nothing
   * to compose, and the domain says so itself rather than asking a model to
   * phrase an absence it cannot check.
   *
   * @param request - the question, the matching records, and the moment to answer as of.
   * @returns the reply text. A blank one is rejected by the domain.
   */
  composeRecallAnswer(request: ComposeRecallAnswerRequest): Promise<ComposeRecallAnswerResult>;
}
