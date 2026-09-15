/**
 * The parent voice: how the product talks, and what ordinary code can check.
 *
 * `docs/ytwins/parent-voice-principles.md` is the authority. Its fifteen
 * executable rules split in two, and the split is the whole design here:
 *
 *  - **Mechanical rules** — sentence count, length, "why" openings, question
 *    count, banned words, pet names, contrast endings, the language. A model
 *    cannot be trusted with these: they are the ones a plausible-sounding reply
 *    breaks most often, and no amount of instruction makes them certain. They
 *    are checked here, in code, and a reply that breaks one never reaches the
 *    user.
 *  - **Judgements** — whether the feeling was answered first, whether this was
 *    advice, whether the user was labelled or decided for. Code cannot read
 *    those off a string. They go into the provider's instructions, told to it
 *    together with the **situation** it is answering, and the domain asserts
 *    what it can observe about them instead of pretending to verify the rest.
 *
 * A reply that fails the check is asked for once more, told which rules it
 * broke. A second failure ends the conversation with a line this module owns —
 * every one of which passes every check above by construction, and is what the
 * drop is given before the provider is even consulted.
 *
 * Nothing here is a seam: it is called by the domain core, and the tests reach
 * it through the domain's interface rather than through these functions.
 *
 * @module domain/parent-voice
 */

import type { ReplySituation } from './ai-provider.ts';

/** At most three sentences, from the doc's executable rule 1. */
const MAX_SENTENCES = 3;

/**
 * About sixty characters, from the doc's executable rule 1.
 *
 * The doc itself records that this number has no source in the four books and
 * is an engineering setting, adjustable by measurement. It lives here as one
 * constant for exactly that reason. Whitespace is not counted: a reply does not
 * get longer by being wrapped.
 */
const MAX_CHARACTERS = 60;

/**
 * What a reply may not call the user, or the user's situation.
 *
 * Rule 13's list plus the pet names rule 1 forbids and the labels rule 6 names.
 * Matching is plain substring matching, so an entry has to be long enough not to
 * appear inside an ordinary word — which is why the list says 「别想那么多」
 * rather than 「想太多」 and 「亲爱的」 rather than 「亲」.
 */
const BANNED_WORDS: readonly string[] = [
  // 贴标签 / 否认感受（规则 13）
  '敏感',
  '想太多',
  '矫情',
  '玻璃心',
  '太负能量',
  '完美主义',
  '你一直很坚强',
  '你很懂事',
  '别想那么多',
  '开心点',
  '换个角度',
  '你看别人',
  '至少你还有',
  // 亲昵称呼（规则 1）
  '宝贝',
  '亲爱的',
  // 替用户下定义（规则 6）
  '你就是',
  '你其实是想要',
];

/**
 * The advice forms rule 5 rules out.
 *
 * Advice itself is a judgement and is left to the instructions; what is
 * mechanical is that advice, *when given*, must be refusable. An imperative is
 * not refusable, so these strings are a violation whatever the situation —
 * including the one turn where the user did ask what to do.
 */
const ADVICE_FORMS: readonly string[] = ['你应该', '你得', '你必须', '我建议', '建议你', '你最好'];

/** How a reply may not end: rule 12's reversal, which undoes the acceptance. */
const CONTRAST_ENDINGS: readonly string[] = ['但是', '不过', '至少', '你也别太'];

/** Openings that make the reply an interrogation rather than an answer (rule 7). */
const WHY_OPENINGS: readonly string[] = ['为什么', '为啥'];

/** The same rule's longer forms, which need not open the sentence to offend. */
const WHY_PHRASES: readonly string[] = ['你为什么', '你怎么会', '是不是因为'];

/**
 * The emotion cues ordinary code can see, from the doc's rule 2 word list.
 *
 * One deliberate narrowing: bare 「气」 and bare 「崩」 are left out, because
 * 「天气」 and 「崩塌」 are ordinary words and a false positive here means an
 * ordinary drop is answered as though something were wrong. The longer forms
 * cover the senses the rule was after.
 */
const EMOTION_CUES: readonly string[] = [
  '累',
  '烦',
  '崩溃',
  '生气',
  '气死',
  '气人',
  '难过',
  '焦虑',
  '害怕',
  '怕',
  '委屈',
  '想哭',
  '撑不住',
  '不想干',
];

/** Asking to be left alone, in the doc's rule 9 words. */
const STOP_CUES: readonly string[] = ['不想说', '不想讲', '不想聊', '不说了', '别问了', '算了', '没事'];

/** Asking what to do — the one mechanical licence to advise (rule 4). */
const ADVICE_CUES: readonly string[] = [
  '怎么办',
  '你觉得呢',
  '你怎么看',
  '你说呢',
  '我该',
  '该不该',
  '给我个建议',
  '有什么建议',
];

/**
 * The lines code itself can vouch for.
 *
 * Each is what the drop is caught with, and what it keeps when the provider
 * cannot answer or answers twice with something that breaks the rules. Written
 * as the shortest thing that is still true: presence when the user stepped
 * back, a named feeling when the drop carried one, plain acknowledgement when it
 * carried neither.
 */
const SAFE_PRESENCE_REPLY = '嗯，我在。想说了再说。';
const SAFE_EMOTION_REPLY = '听着今天不太好受。';
const SAFE_RECORDED_REPLY = '接住了。';

/**
 * The rules, in the product's own words, for the provider's instructions.
 *
 * Sent with every request rather than left to each implementation, so the hard
 * constraints have one source. The wording is the doc's, compressed: the real
 * provider (ticket 12) is expected to put these in its system instruction, and
 * `parent-voice-principles.md` remains the place to read the reasoning.
 */
export const REPLY_INSTRUCTIONS: readonly string[] = [
  '只用中文，默认不超过 3 句、约 60 字；不复读用户的话，不做总结，不说教。',
  '输入里有情绪时，第一句必须是情绪回应：替用户把感受说出来，不要以信息、结论、建议或提问开篇。',
  '输入里没有情绪就平淡确认，不要硬凑情绪回应。',
  '不主动给建议。只有用户明确问「怎么办」、或自己已说出一个方向时才给，最多一条，而且要说成可以谢绝的形式。',
  '不替用户做决定，不宣布已经替他安排好了；选项摆出来，选择权留给他。',
  '不评判、不贴标签：不说用户是怎样的人，也不说「别想那么多」「开心点」这类话。',
  '不做未被索取的提醒（作息、喝水、效率、健康）。',
  '不转移注意力，不用「开心的事」盖过难受。',
  '不以「为什么」起问，一轮最多一个问句；用户说「不想说 / 算了 / 没事」时停止追问，只留一句最短的在场声明。',
  '接纳感受不等于认同判断：可以说「你这么难受是有道理的」，不说「你说得对，他就是个混蛋」。',
  '不用亲昵称呼，也不用单字语气词充当回应的全部内容。',
  '不用「但是 / 不过 / 至少」这类转折收尾；要补充就另起一句。',
];

/** Whether the text contains any of these cues. */
function mentions(text: string, cues: readonly string[]): boolean {
  return cues.some((cue) => text.includes(cue));
}

/**
 * What a drop asks of its reply, read mechanically.
 *
 * The readings decide two things: what the provider is told, and which line the
 * drop falls back to. Both are deliberately crude — a cue list, not an
 * understanding of the text — because the alternative is a model deciding
 * whether the model's own output was appropriate.
 *
 * @param body - the drop's original text.
 * @returns the situation the reply has to answer.
 */
export function readSituation(body: string): ReplySituation {
  return {
    emotionPresent: mentions(body, EMOTION_CUES),
    stopRequested: mentions(body, STOP_CUES),
    adviceRequested: mentions(body, ADVICE_CUES),
  };
}

/** Split a reply into the sentences the reader would count. */
function splitSentences(text: string): readonly string[] {
  // A lookbehind rather than a capture, so the punctuation stays with the
  // sentence it ends: the last sentence is what the contrast rule looks at.
  return text
    .split(/(?<=[。！？!?…])/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/** How many questions a reply asks, by its question marks. */
function countQuestions(text: string): number {
  return (text.match(/[？?]/gu) ?? []).length;
}

/**
 * Check one reply against the mechanical rules.
 *
 * Returns the rules it broke, as short names rather than prose: the names are
 * what the one regeneration is told, so a provider can fix what failed instead
 * of trying again at random. An empty list means the reply may be shown.
 *
 * @param reply - the candidate, exactly as the provider returned it.
 * @param situation - what the drop asked of it.
 * @returns the names of the rules it broke; empty when it obeys all of them.
 */
export function checkReply(reply: string, situation: ReplySituation): readonly string[] {
  const text = reply.trim();
  // Nothing to check a blank against, and a blank is not a reply: it would
  // render as the product answering with silence.
  if (text.length === 0) return ['empty'];

  const broken = new Set<string>();

  // The product answers in Chinese only, and a reply in another language is the
  // one thing a Chinese-only product must not show. Digits and punctuation are
  // fine; Latin letters are not, because no Chinese reply needs them.
  if (!/[\u4e00-\u9fff]/u.test(text) || /[A-Za-z]/.test(text)) broken.add('not-chinese');

  const sentences = splitSentences(text);
  if (sentences.length > MAX_SENTENCES) broken.add('too-many-sentences');
  if ([...text.replace(/\s+/gu, '')].length > MAX_CHARACTERS) broken.add('too-long');

  const interrogating = sentences.some(
    (sentence) =>
      WHY_OPENINGS.some((opening) => sentence.startsWith(opening)) ||
      mentions(sentence, WHY_PHRASES),
  );
  if (interrogating) broken.add('why-question');

  const questions = countQuestions(text);
  if (questions > 1) broken.add('too-many-questions');
  // Rule 9: when the user steps back, presence is the whole reply. A question
  // here is the probing the rule exists to stop.
  if (situation.stopRequested && questions > 0) broken.add('question-when-stop-requested');

  if (mentions(text, BANNED_WORDS)) broken.add('banned-word');
  if (mentions(text, ADVICE_FORMS)) broken.add('advice-form');

  const last = sentences.at(-1) ?? '';
  if (mentions(last, CONTRAST_ENDINGS)) broken.add('contrast-ending');

  // Rule 2, to the extent a string can carry it: on an emotional drop the first
  // sentence may not be a question. Whether it names the feeling is the model's
  // to get right; that it does not open by asking something is checkable, and
  // asking first is what the rule is most often broken by.
  if (situation.emotionPresent && /[？?]/u.test(sentences[0] ?? '')) {
    broken.add('question-when-emotion-first');
  }

  return [...broken];
}

/**
 * The line to answer a drop with when the provider cannot be trusted to.
 *
 * Every branch passes `checkReply` by construction, and is short enough to be
 * the whole of what the user sees.
 *
 * @param situation - what the drop asked of its reply.
 * @returns the line the drop is caught with, and keeps if nothing better passes.
 */
export function safeReply(situation: ReplySituation): string {
  // Stepping back outranks everything else: when someone says they do not want
  // to talk, the reply is not the moment to name their feeling for them.
  if (situation.stopRequested) return SAFE_PRESENCE_REPLY;
  if (situation.emotionPresent) return SAFE_EMOTION_REPLY;
  return SAFE_RECORDED_REPLY;
}
