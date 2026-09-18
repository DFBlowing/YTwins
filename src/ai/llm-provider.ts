/**
 * The language model half of the port: eight of the nine operations.
 *
 * The ninth, `embed`, is not here and never will be: it is the one thing the
 * product deliberately keeps on the user's own machine (see the spec's frozen
 * decision), so it is built separately and joined on afterwards. What is left
 * is every operation that asks a model to **read or write language** — answering
 * a drop, reading items and terms out of one, judging what the words were
 * addressed to, settling a pair of wordings, putting a matter into a sentence,
 * bringing several conclusions together, working out what a question is about,
 * and replying to it from the records.
 *
 * Three things are the same for all eight, and each is a decision rather than a
 * convenience:
 *
 *  - **The rules come from the request.** Parent-voice and conclusion rules are
 *    handed over as `instructions` and put in the system message verbatim. They
 *    are a hard product constraint with one source (`parent-voice.ts`,
 *    `conclusions.ts`), and this module is not allowed to hold a second copy of
 *    them — a copy is a place for the two to drift.
 *  - **A retry is told what was wrong.** `violations` names the rules the
 *    previous attempt broke. The domain checks the answer afterwards and asks
 *    once more; a model asked to "try again" without being told is only being
 *    asked to guess differently.
 *  - **Everything comes back as JSON, and every field is checked.** See
 *    `structured.ts`: a reading with an invented field is the product putting
 *    words in the user's mouth.
 *
 * What is deliberately **absent** from the prompts: any persona, any generic
 * material, any example the user did not say. For `composeAnswer` that is
 * load-bearing rather than tidy — the guarantee that an answer "could only have
 * come from this user's own data" is half structural, and the structure is that
 * nothing else is sent with the call.
 *
 * @module ai/llm-provider
 */

import type {
  AiProvider,
  ComposeAnswerRequest,
  ComposeAnswerResult,
  ComposeConclusionRequest,
  ComposeConclusionResult,
  ComposeRecallAnswerRequest,
  ComposeRecallAnswerResult,
  ExtractedItem,
  ExtractRequest,
  ExtractResult,
  JudgeLinkRequest,
  JudgeLinkResult,
  JudgeQuestionRequest,
  JudgeQuestionResult,
  ParseQuestionRequest,
  ParseQuestionResult,
  RespondRequest,
  RespondResult,
} from '../domain/ai-provider.ts';
import { QUESTION_TARGETS } from '../domain/routing.ts';
import type { ChatClient, ChatMessage } from './openai-chat.ts';
import {
  optionalString,
  requireArray,
  requireBoolean,
  requireChoice,
  requireInputType,
  requireObject,
  requireString,
  requireStringArray,
} from './structured.ts';

/**
 * The port without `embed`.
 *
 * Named here rather than in the domain because it is a fact about **this**
 * implementation: the split is what keeps the local embedding out of the half
 * that leaves the machine.
 */
export type LlmOperations = Omit<AiProvider, 'embed'>;

/** What the half needs to be built. */
export interface LlmProviderOptions {
  /** The transport, already pointed at one endpoint and one model. */
  readonly client: ChatClient;
  /**
   * The clock the prompts read "today" from.
   *
   * Injected because a model cannot resolve 「下周三」 without a date, and a
   * check that could not pin the date could not assert the prompt at all. It
   * defaults to the real present, which is what a running server wants.
   */
  readonly now?: (() => Date) | undefined;
}

/** Who is being asked, in one line. */
const PRODUCT_CONTEXT =
  '你在 YTwins 里做事：这是一个私人小产品，用户随手把日程、灵感、情绪丢进来，你负责读懂它、把它接住，' +
  '而不是说教、安慰模板或者分析报告。';

/** The output contract, which every operation shares. */
const OUTPUT_RULE = '只输出一个 JSON 对象，不要输出 JSON 之外的任何解释文字。';

/** The days of the week, in the order `Date.getDay()` counts them. */
const WEEKDAYS: readonly string[] = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

/** A local date, in the form a prompt can reason about relative time from. */
function describeToday(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}（${WEEKDAYS[date.getDay()] ?? ''}）`;
}

/** The request's own rules, numbered, or nothing when there are none. */
function ruleBlock(instructions: readonly string[]): string {
  if (instructions.length === 0) return '';
  const numbered = instructions.map((rule, index) => `${index + 1}. ${rule}`);
  return ['必须遵守的规则：', ...numbered].join('\n');
}

/** What the last attempt broke, when this is the one regeneration. */
function violationBlock(violations: readonly string[] | undefined): string {
  if (violations === undefined || violations.length === 0) return '';
  return `上一次的回答违反了这些规则：${violations.join('、')}。请重写，不要重复同样的写法。`;
}

/** The system message: the framing, the request's rules, and the shape to answer in. */
function systemPrompt(parts: readonly string[]): string {
  return parts.filter((part) => part.length > 0).join('\n\n');
}

/** One labelled list of the user's own words, as a prompt reads it. */
function bulletList(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join('\n');
}

/** One numbered list, for things whose order is the point. */
function numberedList(items: readonly string[]): string {
  return items.map((item, index) => `${index + 1}. ${item}`).join('\n');
}

/** The items a reading claims, each one checked before it is handed on. */
function readItems(object: Record<string, unknown>, what: string): ExtractedItem[] {
  return requireArray(object, 'items', what).map((entry, index) => {
    const item = requireObject(entry, `items[${index}]`, what);
    return {
      text: requireString(item, 'text', what),
      // Left as it came: a due date nobody can parse is the domain's own
      // reading of "no time" (see `scheduling.ts`), and turning it into null
      // here would hide a model that keeps inventing unparsable dates.
      dueAt: optionalString(item, 'dueAt', what),
    };
  });
}

/**
 * Build the eight language-model operations.
 *
 * @param options - the transport, and optionally the clock.
 * @returns the operations, ready to be joined with an embedding.
 */
export function createLlmOperations(options: LlmProviderOptions): LlmOperations {
  const { client } = options;
  const now = options.now ?? (() => new Date());

  return {
    async respond(request: RespondRequest): Promise<RespondResult> {
      const situation = [
        '这段输入：',
        request.brief.emotionPresent
          ? '- 带着情绪：第一句必须是情绪回应，替他把感受说出来，不要以信息、建议或提问开篇。'
          : '- 没有明显情绪：平淡确认就好，不要硬凑情绪回应。',
        request.brief.adviceRequested
          ? '- 他明确问了怎么办：可以给一条建议，但要说成可以谢绝的形式。'
          : '- 他没有问怎么办：不要主动给建议。',
      ].join('\n');

      const object = await client.askJson(
        [
          {
            role: 'system',
            content: systemPrompt([
              PRODUCT_CONTEXT,
              '任务：给用户刚丢进来的这段话写一句回应。',
              situation,
              ruleBlock(request.instructions),
              violationBlock(request.violations),
              '输出 JSON，形如：{"reply": "回应的一句话"}',
              OUTPUT_RULE,
            ]),
          },
          { role: 'user', content: request.body },
        ],
        'respond',
      );
      return { reply: requireString(object, 'reply', 'respond') };
    },

    async extract(request: ExtractRequest): Promise<ExtractResult> {
      const object = await client.askJson(
        [
          {
            role: 'system',
            content: systemPrompt([
              PRODUCT_CONTEXT,
              '任务：把用户丢进来的这段话读成结构化 JSON。他说的词要原样保留，不要改写、不要归纳成类别。',
              `今天是 ${describeToday(now())}。相对时间（「下周三」「明天」）按今天换算成 ISO-8601；说不清就写 null，不要编一个。`,
              [
                '字段：',
                '- inputType：emotion（在说自己的情绪）｜decision（在做一个决定）｜item（一件要去做的事）｜idea（念头、见闻、信息）。',
                '- items：要去做的事；text 用他的原话；dueAt 是 ISO-8601 时间字符串或 null。',
                '- terms：值得以后再提起的词条，用他的原话（不要写成「音乐兴趣」这类类别），按出现先后。',
                '- anchor：terms 里最像「这件小事在说的那个情绪或决定」的那一条原字符串，没有就写 null；不要写 terms 里没有的词。',
              ].join('\n'),
              '输出 JSON，形如：' +
                '{"inputType":"item","items":[{"text":"下周三交提纲","dueAt":"2026-09-23T09:00:00.000Z"}],' +
                '"terms":["期末怎么算分","好烦"],"anchor":"好烦"}',
              OUTPUT_RULE,
            ]),
          },
          { role: 'user', content: request.body },
        ],
        'extract',
      );

      return {
        inputType: requireInputType(object, 'inputType', 'extract'),
        items: readItems(object, 'extract'),
        terms: requireStringArray(object, 'terms', 'extract').filter((term) => term.length > 0),
        anchor: optionalString(object, 'anchor', 'extract'),
      };
    },

    async judgeQuestion(request: JudgeQuestionRequest): Promise<JudgeQuestionResult> {
      const object = await client.askJson(
        [
          {
            role: 'system',
            content: systemPrompt([
              PRODUCT_CONTEXT,
              '任务：判断用户刚说的这段话是不是在向你提问，以及问的是哪一类。',
              [
                '口径：',
                '- 只有他**在问你、等你回答**时才算提问。记录一件事、说一句心情、随口念叨，都不算。',
                '- 问一件过去说过的事（「期末怎么算分」），about 写 records：答案在他自己的记录里。',
                '- 问你怎么看他（「你觉得我最近怎么样」），about 写 self：答案是你要形成的判断。',
                '- 拿不准就当不是提问：宁可少说一句，也不要把自言自语当成提问。',
              ].join('\n'),
              `普通代码从这段话里读出的形状是 ${request.shape}（question＝他自己标了问号或用了一望即知的提问说法，unclear＝只是句尾带「吗／呢」）。这只是线索，不是结论。`,
              '输出 JSON，形如：{"asks": true, "about": "records"}；不是提问就写 {"asks": false}',
              OUTPUT_RULE,
            ]),
          },
          { role: 'user', content: request.body },
        ],
        'judgeQuestion',
      );

      // A reading that says "not a question" needs nothing else, and deliberately
      // does not have to supply an `about`: the arm that is not an arm is the one
      // the domain treats a blank answer as, so a model that answers
      // `{"asks": false, "about": "records"}` is not asked to be coherent about a
      // field that means nothing here.
      if (!requireBoolean(object, 'asks', 'judgeQuestion')) return { asks: false };
      return { asks: true, about: requireChoice(object, 'about', QUESTION_TARGETS, 'judgeQuestion') };
    },

    async judgeLink(request: JudgeLinkRequest): Promise<JudgeLinkResult> {
      const object = await client.askJson(
        [
          {
            role: 'system',
            content: systemPrompt([
              PRODUCT_CONTEXT,
              '任务：判断两个词条是不是在说同一类事（语义相近），只回答 related。',
              [
                '判断口径：',
                '- 换一种说法的同一件事算相近；字面不同不算理由。',
                '- 只是同属一个大领域、实际是两件事的不算。',
                '- 分数只是参考，不要拿它直接套自己的阈值。',
              ].join('\n'),
              '输出 JSON，形如：{"related": true}',
              OUTPUT_RULE,
            ]),
          },
          {
            role: 'user',
            content: [
              `词条一：${request.from}`,
              `词条二：${request.to}`,
              `已有的相似度：${request.similarity}`,
            ].join('\n'),
          },
        ],
        'judgeLink',
      );
      return { related: requireBoolean(object, 'related', 'judgeLink') };
    },

    async composeConclusion(request: ComposeConclusionRequest): Promise<ComposeConclusionResult> {
      const object = await client.askJson(
        [
          {
            role: 'system',
            content: systemPrompt([
              PRODUCT_CONTEXT,
              '任务：把这件事汇成一句关于这个人的判断。',
              `这件事围绕的是他自己说的「${request.anchor}」，用最新那一句的样子说现在，不要用最早那句。`,
              `这件事的档位是 ${request.tier}（只作措辞的语境，语气强弱由外层决定，不要自己在句子里加缓冲语）。`,
              ruleBlock(request.instructions),
              violationBlock(request.violations),
              '输出 JSON，形如：{"text": "你似乎……"}',
              OUTPUT_RULE,
            ]),
          },
          { role: 'user', content: `支撑这件事的原话（从旧到新）：\n${bulletList(request.terms)}` },
        ],
        'composeConclusion',
      );
      return { text: requireString(object, 'text', 'composeConclusion') };
    },

    async composeAnswer(request: ComposeAnswerRequest): Promise<ComposeAnswerResult> {
      const object = await client.askJson(
        [
          {
            role: 'system',
            // Note what is **not** here: the product context every other
            // operation gets. Ticket 11's guarantee is that an answer could
            // only have come from this user's own material, and half of it is
            // structural — so this request carries the task, the band and the
            // domain's own rules, and no framing about who is being asked.
            // `PRODUCT_CONTEXT` is a persona, and a persona is generic text;
            // the check that pins this is in `provider.test.ts`.
            content: systemPrompt([
              '任务：把下面几条小结论汇成一句关于这个人的话。',
              `这几条的档位是 ${request.tier}（只作措辞的语境，语气强弱由外层决定，不要自己在句子里加缓冲语）。`,
              ruleBlock(request.instructions),
              violationBlock(request.violations),
              '输出 JSON，形如：{"text": "你似乎……"}',
              OUTPUT_RULE,
            ]),
          },
          {
            // The user message is **nothing but** the user's own material, and
            // that is a product guarantee rather than a formatting choice: with
            // no generic material in the call, an answer that reads like it
            // could be about anyone is a sentence the model added, not one this
            // code handed it. See the module header.
            role: 'user',
            content: [
              `小结论（从旧到新）：\n${numberedList(request.conclusions)}`,
              `这些结论背后的原话（从旧到新）：\n${bulletList(request.terms)}`,
            ].join('\n\n'),
          },
        ],
        'composeAnswer',
      );
      return { text: requireString(object, 'text', 'composeAnswer') };
    },

    async parseQuestion(request: ParseQuestionRequest): Promise<ParseQuestionResult> {
      const object = await client.askJson(
        [
          {
            role: 'system',
            content: systemPrompt([
              PRODUCT_CONTEXT,
              '任务：用户要在自己过去的记录里找点什么。你只需要给出「去他的原文里找哪些字符串」。',
              [
                '口径：',
                '- 给 1 到 5 个关键词组，尽量用他自己会写在原文里的说法。',
                '- 只给要找的字符串，不要给答案、不要给判断。',
                '- 一点线索都给不出就给空数组。',
              ].join('\n'),
              '输出 JSON，形如：{"matchText": ["期末怎么算分","平时分"]}',
              OUTPUT_RULE,
            ]),
          },
          { role: 'user', content: request.question },
        ],
        'parseQuestion',
      );
      return { matchText: requireStringArray(object, 'matchText', 'parseQuestion') };
    },

    async composeRecallAnswer(
      request: ComposeRecallAnswerRequest,
    ): Promise<ComposeRecallAnswerResult> {
      const records = request.records.map(
        (record) => `[${record.droppedAt.slice(0, 10)}] ${record.body.replace(/\s+/gu, ' ').trim()}`,
      );

      const object = await client.askJson(
        [
          {
            role: 'system',
            content: systemPrompt([
              PRODUCT_CONTEXT,
              '任务：用他自己的记录回答他的问题。',
              [
                '口径：',
                '- 只陈述记录里的事实，不要推测、不要补充记录里没有的东西，也不要给建议。',
                '- 可以复述他的原话来回答，但不要说「根据记录」这类话。',
                '- 记录里没有的就说没有，不要编。',
              ].join('\n'),
              '输出 JSON，形如：{"answer": "……"}',
              OUTPUT_RULE,
            ]),
          },
          {
            role: 'user',
            content: [
              `现在的时间是 ${request.now}。记录里提到的时间要按这个时间点来说。`,
              `问题：${request.question}`,
              `找到的记录（从旧到新）：\n${numberedList(records)}`,
            ].join('\n\n'),
          },
        ],
        'composeRecallAnswer',
      );
      return { answer: requireString(object, 'answer', 'composeRecallAnswer') };
    },
  };
}
