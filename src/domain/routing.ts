/**
 * What the user's words are addressed to, and how ordinary code reads that.
 *
 * Ticket 15 fused the product's three doings — **投递**, **追溯**, **浮现** — into
 * one box: the user types whatever they have to say, and the product decides for
 * itself whether that was a fragment, a question about something in their
 * **records**, or a question about **themselves**. That decision is a product
 * rule rather than a page's `if`, so it is made here, beside the domain, and the
 * page only shows what came of it.
 *
 * The reading has two steps, and the split is the whole design:
 *
 *  - **Ordinary code reads the shape.** A question mark, a 「怎么」, a trailing
 *    「吗」 — those are facts about the string, and reading them costs nothing.
 *    Words that carry none of them are a fragment and **no model is asked at
 *    all**, which is most of what anyone types.
 *  - **A model settles what only meaning can settle.** Whether words that
 *    *could* be a question are one, and whether they are about the user's own
 *    records or about the user, is a judgement: it is asked for through the port
 *    (`judgeQuestion`), and a judgement nobody could make leaves the words a
 *    fragment — 「判不出是问题，就不当问题」.
 *
 * The shape is a **gate, not a verdict**, and it is deliberately loose in one
 * direction: 「老师今天讲了期末怎么算分」 carries a question phrase and is not a
 * question, so it costs one call to find that out. The other direction has no
 * such tolerance — treating a real question as a fragment silently answers
 * nothing at all, and the user who asked has no way to tell that from "your
 * records do not cover this".
 *
 * @module domain/routing
 */

/**
 * What a question the user asked is addressed to.
 *
 * Two arms and no third, because the two are answered by different machinery
 * and with different registers, and mixing them is the one thing this whole
 * decision exists to prevent (`CONTEXT.md`, 追溯 and 答案):
 *
 *  - `records` is the user's own **留档** — what they said, read back to them.
 *    It is a **fact**, so it is stated plainly and with the drop it came from
 *    beside it, and it is never answered with a judgement.
 *  - `self` is what the product makes of them — the asked-for **answer**, put
 *    together out of their own conclusions. It is a **judgement**, so it is
 *    worded with the uncertainty its band earned.
 *
 * A question that is neither, or that could not be judged at all, is not an arm
 * here: it stays a fragment (see `readQuestionShape` and the domain core).
 */
export type QuestionTarget = 'records' | 'self';

/**
 * Every target, so a value read back from outside cannot become one the domain
 * never wrote — the same reason `INPUT_TYPES` and `LINK_KINDS` exist.
 */
export const QUESTION_TARGETS: readonly QuestionTarget[] = ['records', 'self'];

/**
 * How the words look as a question, as ordinary code reads them.
 *
 * Three shapes rather than two, because the two mistakes this reading can make
 * are not equally cheap and the middle arm is where that is decided:
 *
 *  - `question` — the user marked it themselves (a question mark), or used a
 *    phrase that only turns up when something is being asked for. Judged by the
 *    model whatever else is true: an explicit question is exactly the thing that
 *    must not be swallowed.
 *  - `unclear` — a sentence-ending particle (「…吗」「…呢」), which ends a question
 *    and also ends a thought spoken aloud. The drop's **输入类型** is read here:
 *    a feeling worded that way is still a feeling, and answering
 *    「下周三交提纲吗」 out of the user's records would be the product mistaking
 *    self-talk for a question. Anything else in this arm goes to the model.
 *  - `statement` — none of the above. A fragment, and nobody is asked.
 */
export type QuestionShape = 'question' | 'unclear' | 'statement';

/**
 * Which of the product's three doings one piece of text turned out to be.
 *
 * The routing's own outcome, internal on purpose: the page is handed the
 * **speech** (`DeliverySpeech`), never the decision. A caller that could read
 * this value could start branching on it, and the whole point of ticket 15 is
 * that the branching is the domain's.
 *
 * Two of the three arms are the port's own targets (`QuestionTarget`), spelled
 * the one way deliberately: `'records'` here and `about: 'records'` there are the
 * same arm — the words were put to the user's own records — and two spellings of
 * one arm would drift.
 */
export type DeliveryRoute = 'fragment' | QuestionTarget;

/** A question mark, in either width — the user's own statement that they asked. */
const QUESTION_MARK = /[?？]/u;

/**
 * Phrases that only turn up when something is being asked for.
 *
 * A list rather than a grammar, and that is honest about what it is: it does not
 * have to be complete, because it is the gate in front of the model and not the
 * decision. What it costs to be wrong is one call spent on a fragment.
 */
const ASKING_PHRASES: readonly RegExp[] = [
  /怎么/u,
  /为什么/u,
  /为啥/u,
  /什么/u,
  /哪/u,
  /多少/u,
  /多久/u,
  /几点/u,
  /几号/u,
  /如何/u,
  /是不是/u,
  /有没有/u,
  /能不能/u,
  /可不可以/u,
  /算不算/u,
  /要不要/u,
];

/**
 * Particles that end a question, and also end a thought spoken aloud.
 *
 * 「吧」 is deliberately **not** here: it proposes something rather than asking,
 * and a proposal is a fragment to be caught rather than a question to be put to
 * the records.
 */
const SOFT_PARTICLES = /[吗嘛呢]$/u;

/**
 * How one piece of the user's text looks as a question.
 *
 * @param body - the text as typed, verbatim.
 * @returns the shape ordinary code can vouch for.
 */
export function readQuestionShape(body: string): QuestionShape {
  const text = body.trim();
  if (text.length === 0) return 'statement';
  if (QUESTION_MARK.test(text)) return 'question';
  if (ASKING_PHRASES.some((phrase) => phrase.test(text))) return 'question';
  if (SOFT_PARTICLES.test(text)) return 'unclear';
  return 'statement';
}
