/**
 * The demo's preset material: one dataset, and the provider that reads it.
 *
 * The three acts are a **script**, and a script has to be the same every time it
 * is run — so everything the acts are made of lives here, once: the fragment the
 * first act drops, the question the second act asks, the feeling the third act
 * drops, and the fragments that are already in the library when a demo starts
 * (its **leads**, which are what make the third act's single drop enough to cross
 * the threshold). Nothing is written twice and nothing is invented at run time,
 * which is why the page's placeholders and hints are read from the server rather
 * than typed into the HTML a second time.
 *
 * It lives beside `fake-provider.ts` rather than under `src/web/`, and the reason
 * is the one the ticket gives: **the domain tests run on this same material**.
 * The spec asks for the demo's preloaded data and the tests' preloaded data to be
 * one set, so it cannot live anywhere the tests would have to reach upwards for
 * it — and a copy in `src/web/` would have been exactly the drift the
 * requirement exists to prevent. The dependency still points one way:
 * `src/web/` imports this, never the reverse.
 *
 * The **provider** stays here with the material for a narrower reason, and it is
 * worth being explicit because ticket 12 put the port's real implementation side
 * under `src/ai/`: what lives there is the implementations that talk to the
 * outside world, while this one is a script built on `fake-provider.ts`, which
 * has sat beside the domain since ticket 01 precisely so the domain's own checks
 * can drive it. Splitting the two would either put the scripted provider out of
 * the tests' reach or make the tests build a second provider of their own —
 * which is the duplication this module exists to remove.
 *
 * Two things are computed rather than written down, and both for the same
 * reason — a preset that named a date would go stale, and a date the material
 * does not name is not the material:
 *
 *  - **The outline's deadline.** The fragment says 「下周三」, so the stand-in
 *    resolves it against the day the material is understood to have been said,
 *    exactly as the real reader is asked to (`llm-provider.ts` hands the model
 *    「今天是 …」 and tells it to convert relative times). The moment is taken once,
 *    when the provider is built, so the item the first act shows and the answer
 *    the second act gives cannot disagree about which Wednesday it is.
 *  - **How the deadline reads from the moment asked.** The second act asks "a few
 *    days later", and the answer says how many days that leaves — which is the
 *    one part of the answer that has to move with the viewpoint, or the
 *    viewpoint would not be observable at all.
 *
 * @module domain/preset
 */

import type {
  AiProvider,
  ComposeAnswerRequest,
  ComposeConclusionRequest,
  ComposeRecallAnswerRequest,
  ExtractRequest,
  ExtractResult,
} from './ai-provider.ts';
import { createFakeProvider } from './fake-provider.ts';
import type { Domain, InputType } from './interface.ts';
import { readSituation, safeReply } from './parent-voice.ts';

/**
 * The three acts, in the order they are demonstrated.
 *
 * The page presents these (see `/api/demo`), so what is typed on stage and what
 * this dataset reads are the same strings by construction rather than by care.
 */
export interface PresetActs {
  /** Act one: one unformatted fragment, carrying a grading scheme and a feeling. */
  readonly drop: string;
  /** Act two: the question asked of the records. */
  readonly question: string;
  /** Act three: one more feeling, about something else. */
  readonly feeling: string;
}

/** One item a preset fragment carries, with the weekday its words name. */
interface PresetItem {
  readonly text: string;
  /** `Date.getDay()`'s numbering: 3 is Wednesday, which is what 「下周三」 says. */
  readonly weekday: number;
}

/**
 * The one item the material carries: the outline, due the Wednesday it names.
 *
 * Named once because two places need it and they have to agree — the fragment
 * the first act drops, and the answer the second act gives, which phrases the
 * same deadline relative to the moment asked.
 */
const PRESET_OUTLINE: PresetItem = { text: '下周三交提纲', weekday: 3 };

/** One fragment of preset material, and what the stand-in reads out of it. */
interface PresetFragment {
  readonly body: string;
  readonly inputType: InputType;
  /** The words it yielded, in the user's own wording and in the order said. */
  readonly terms: readonly string[];
  /** Which of those carries the feeling, when one does. */
  readonly anchor: string | null;
  /** The item it carries, when it carries one. */
  readonly item?: PresetItem;
  /** What it is answered with. Absent means the stand-in's plain acknowledgement. */
  readonly reply?: string;
}

/**
 * The fragments already in the library when a demo starts.
 *
 * Two per matter, and that is the whole reason they exist: the threshold is "the
 * same thing has been raised three times", so one live drop is only a crossing if
 * two earlier ones are already there. Both matters the acts touch get two, and
 * none of them says anything the second act's question looks for — so the answer
 * cites the fragment the user just dropped, which is the thing act two is for.
 *
 * They were said out loud, once, a while ago: each is a fragment like any other,
 * with its own reply and its own words.
 */
const LEAD_OUTLINE_FIRST = '下周三交提纲，好烦';
const LEAD_OUTLINE_AGAIN = '又是下周三交提纲，好烦';
const LEAD_SLEEP_FIRST = '这两天睡不好，白天也没精神';
const LEAD_SLEEP_AGAIN = '还是睡不好，白天没精神';

/** The leads, in the order a demo lays them down. */
export const PRESET_LEADS: readonly string[] = [
  LEAD_OUTLINE_FIRST,
  LEAD_OUTLINE_AGAIN,
  LEAD_SLEEP_FIRST,
  LEAD_SLEEP_AGAIN,
];

/** The three acts themselves. */
export const PRESET_ACTS: PresetActs = {
  // A grading scheme and a deadline in the same breath as a feeling, with no
  // type chosen and no time filled in — the spec's first act, verbatim.
  drop: '老师今天讲了期末怎么算分：平时分 40%，期末考 60%，下周三交提纲，好烦',
  question: '期末怎么算分',
  // Plainly a feeling, and about something else, so the third act's moment is
  // its own rather than the first act's heard again.
  feeling: '这周总是睡不好，白天没精神，晚上躺下又清醒，有点撑不住',
};

/** The one item the first act's fragment carries. */
export const PRESET_ITEM_TEXT = PRESET_OUTLINE.text;

/** The words the first act's fragment yields, in the order it said them. */
export const PRESET_DROP_TERMS: readonly string[] = [
  '期末怎么算分',
  '平时分 40%',
  '期末考 60%',
  '下周三交提纲',
  '好烦',
];

/**
 * What the outline's matter stands on by the time act one has been dropped.
 *
 * The leads' two words first, because they were said first, then the three the
 * live fragment adds. Five terms rather than three, so the judgement is licensed
 * rather than merely caught (`ConclusionPolicy.claimFloor`).
 */
export const PRESET_EXAM_SUPPORT: readonly string[] = [
  '下周三交提纲',
  '好烦',
  '期末怎么算分',
  '平时分 40%',
  '期末考 60%',
];

/**
 * What the third act's matter stands on: exactly enough to make a judgement.
 *
 * Three, which is the floor. A preset matter supported by two words could only
 * ever **catch** a feeling, and the third act promises a conclusion.
 */
export const PRESET_FEELING_SUPPORT: readonly string[] = ['睡不好', '没精神', '躺下又清醒'];

/**
 * Every fragment in the dataset, leads included.
 *
 * One table rather than a leads list and an acts list that could disagree: the
 * provider reads from this, and `PRESET_LEADS` is only the part of it a demo lays
 * down before the presenter arrives.
 */
const PRESET_FRAGMENTS: readonly PresetFragment[] = [
  {
    body: LEAD_OUTLINE_FIRST,
    inputType: 'emotion',
    terms: ['下周三交提纲', '好烦'],
    anchor: '好烦',
    reply: '听着，交提纲这事又压上来了。',
  },
  {
    body: LEAD_OUTLINE_AGAIN,
    inputType: 'emotion',
    terms: ['下周三交提纲', '好烦'],
    anchor: '好烦',
    reply: '嗯，还是这件事，挺磨人的。',
  },
  {
    body: LEAD_SLEEP_FIRST,
    inputType: 'emotion',
    terms: ['睡不好', '没精神'],
    anchor: '睡不好',
    reply: '听着，这两天你没什么精神。',
  },
  {
    body: LEAD_SLEEP_AGAIN,
    inputType: 'emotion',
    terms: ['睡不好', '没精神'],
    anchor: '睡不好',
    reply: '嗯，睡不好这事一直没过去。',
  },
  {
    body: PRESET_ACTS.drop,
    inputType: 'item',
    terms: PRESET_DROP_TERMS,
    anchor: '好烦',
    item: PRESET_OUTLINE,
    reply: '听着，事情全堆在一起，心里挺堵的。',
  },
  {
    body: PRESET_ACTS.feeling,
    inputType: 'emotion',
    terms: PRESET_FEELING_SUPPORT,
    anchor: '睡不好',
    reply: '听着，这会儿你好像一直没睡踏实。',
  },
];

/**
 * What the stand-in says about a matter, per feeling it turns out to be about.
 *
 * Preset, like everything else here, and written in the uncertain register
 * because these are judgements out of accumulation. None of them says "我不太
 * 确定" itself: how firmly the product speaks is code's, added around the
 * sentence (`frameFor`, `surfacingLine`), and a preset that hedged on its own
 * would be choosing the band its numbers already decide.
 */
const PRESET_SENTENCE_BY_FEELING: Readonly<Record<string, string>> = {
  好烦: '你最近好像有几件事堆在一起，心里一直不太顺',
  睡不好: '你最近睡得不太好，白天也提不起劲',
};

/**
 * What the second act's question looks for in the records.
 *
 * Whole phrases rather than single words, and the reason is the one ticket 07
 * settled: a bare 「期末」 would match any passing mention, and the answer would
 * cite a fragment that says nothing about the grading. None of these appears in
 * the leads, so the fragment act one just dropped is the one the answer names.
 */
const PRESET_MATCH_TEXT: readonly string[] = ['期末怎么算分', '平时分', '期末考 60%'];

/** The facts the record holds, restated as an answer. */
const PRESET_GRADING = '平时分占 40%，期末考占 60%。';

/** The hour of day `` nextWeekday`` places a deadline at, locally. */
const PRESET_DEADLINE_HOUR = 9;

/** How many times the seeding waits for a lead's wording before taking what is there. */
const SEED_ATTEMPTS = 40;
/** How long between those waits. */
const SEED_INTERVAL_MS = 25;

/**
 * The next occurrence of a weekday, at the hour a deadline is usually given.
 *
 * Strictly after the given moment: a fragment saying 「下周三」 on a Wednesday
 * means the following week's, which is what "next" says in Chinese. Local time,
 * because a deadline is a wall-clock thing where the user is — the same reading
 * the scheduling list and the page's own date rendering take.
 *
 * @param from - the moment the words are read as of, ISO-8601.
 * @param weekday - `Date.getDay()`'s numbering.
 * @returns the deadline, ISO-8601.
 */
function nextWeekday(from: string, weekday: number): string {
  const at = new Date(from);
  const ahead = (weekday - at.getDay() + 7) % 7;
  at.setDate(at.getDate() + (ahead === 0 ? 7 : ahead));
  at.setHours(PRESET_DEADLINE_HOUR, 0, 0, 0);
  return at.toISOString();
}

/** Whole days from the answering moment to a deadline, or null when either is unreadable. */
function daysUntil(now: string, due: string): number | null {
  const from = Date.parse(now);
  const to = Date.parse(due);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / 86_400_000);
}

/** How the outline's deadline reads from a given moment. */
function outlinePhrase(days: number | null): string {
  if (days === null) return '';
  if (days > 1) return `提纲还有 ${days} 天到期。`;
  if (days === 1) return '提纲明天到期。';
  if (days === 0) return '提纲今天到期。';
  return '提纲的期限已经过去了。';
}

/**
 * Compose the stand-in's answer about the **records**.
 *
 * Named for recall rather than for the product's word 答案, which belongs to the
 * composer below (`CONTEXT.md`, 追溯). The deadline is passed in rather than read
 * from the clock here, so that the sentence and the item the first act shows are
 * phrased from **one** resolution of 「下周三」.
 *
 * The page renders dates its own way (`dueLabel` in `src/web/main.ts`: 「今天」、
 * 「明天」、「已过期」). That is deliberate and not a second copy of this mapping:
 * this one is a sentence the product says about the user's material, that one is
 * a label on a row, and the two are allowed to word the same fact differently.
 *
 * @param request - the question, the records, and the moment being answered as of.
 * @param due - the deadline the material named, already resolved.
 * @returns the answer, as the page will show it.
 */
function composeRecallAnswerFor(request: ComposeRecallAnswerRequest, due: string): string {
  return `${PRESET_GRADING}${outlinePhrase(daysUntil(request.now, due))}`;
}

/**
 * Compose the stand-in's asked-for **answer**.
 *
 * Built out of the user's own words rather than written out as a fixed line,
 * and that is the point of the demo: what comes back names things only this
 * user said, which is exactly the property the real provider is supposed to
 * have. A stand-in with a canned sentence would show the shape of the feature
 * and hide the one thing worth looking at.
 *
 * The words are taken until the sentence is long enough to say something and
 * short enough that the domain's own check still passes it: a stand-in whose
 * answer was rejected for length would fall back to a single line, and the demo
 * would look like the feature was not there.
 *
 * @param request - the conclusions, and the words behind them.
 * @returns the sentence.
 */
function composeAnswerFrom(request: ComposeAnswerRequest): string {
  const named: string[] = [];
  for (const term of request.terms) {
    const quoted = `「${term}」`;
    if (named.length >= 3 || named.join('').length + quoted.length > 24) break;
    named.push(quoted);
  }
  if (named.length === 0) return '你最近说的那几件事，好像是连在一起的';
  return `你反复提到的${named.join('')}，好像是连在一起的`;
}

/**
 * Build the stand-in provider the demo runs on.
 *
 * The scripted reads come from the one fragment table above, so a fragment the
 * dataset does not hold is read as nothing rather than invented. Three calls are
 * written out because a fixed script cannot make them: the extracted due date,
 * which has to be resolved against a day; the composed answer about the records,
 * which has to phrase the deadline relative to the moment asked; and the
 * assembled answer, which is built from whatever words the user actually said.
 *
 * @param options - the clock the material is read against.
 * @returns the provider.
 */
export function createPresetProvider(options: { readonly now?: () => string } = {}): AiProvider {
  const clock = options.now ?? ((): string => new Date().toISOString());
  // Taken once, at construction, so the item the first act shows and the answer
  // the second act gives resolve 「下周三」 to the same day. Reading the clock
  // again at each call would let a demo run across midnight disagree with
  // itself, and the disagreement would be invisible.
  const materialDay = clock();

  const readings: Record<string, { readonly kind: 'read'; readonly reading: ExtractResult }> = {};
  const replies: Record<string, { readonly kind: 'reply'; readonly reply: string }> = {};
  for (const fragment of PRESET_FRAGMENTS) {
    readings[fragment.body] = {
      kind: 'read',
      reading: {
        inputType: fragment.inputType,
        items: [],
        terms: fragment.terms,
        anchor: fragment.anchor,
      },
    };
    if (fragment.reply !== undefined) {
      replies[fragment.body] = { kind: 'reply', reply: fragment.reply };
    }
  }

  const fake = createFakeProvider({
    byBody: replies,
    extractByBody: readings,
    parseQuestionByQuestion: {
      [PRESET_ACTS.question]: { kind: 'match', matchText: PRESET_MATCH_TEXT },
    },
    // The one routing the stand-in has to be able to answer, now that the acts
    // can be run through the **fused page** (ticket 15) as well: 「期末怎么算分」
    // is a question about the user's own records, so the box answers it out of
    // them. Every other line — the acts' fragments, and anything typed off
    // script — is left unscripted, which the domain reads as "not a question"
    // and treats as a fragment. That is the right reading for a demo whose
    // fragments are exactly that.
    judgeQuestionByBody: {
      [PRESET_ACTS.question]: { kind: 'asking', about: 'records' },
    },
    // Present so the fake never reaches its "no compose script" failure, and so
    // what this module replaces is legible: the real composition follows.
    composeFallback: { kind: 'answer', answer: PRESET_GRADING },
  });

  return {
    ...fake,
    extract(request: ExtractRequest): Promise<ExtractResult> {
      const fragment = PRESET_FRAGMENTS.find((candidate) => candidate.body === request.body);
      const item = fragment?.item;
      if (fragment === undefined || item === undefined) return fake.extract(request);
      // The one reading a table cannot hold: the date is resolved from the words
      // rather than written down, exactly as a model reading 「下周三」 would.
      return Promise.resolve({
        inputType: fragment.inputType,
        items: [
          { text: item.text, dueAt: nextWeekday(materialDay, item.weekday) },
        ],
        terms: fragment.terms,
        anchor: fragment.anchor,
      });
    },
    composeRecallAnswer(request: ComposeRecallAnswerRequest) {
      return Promise.resolve({
        answer: composeRecallAnswerFor(request, nextWeekday(materialDay, PRESET_OUTLINE.weekday)),
      });
    },
    composeConclusion(request: ComposeConclusionRequest) {
      const scripted = PRESET_SENTENCE_BY_FEELING[request.anchor];
      return Promise.resolve({
        text: scripted ?? `你好像一直想着「${request.anchor}」这件事`,
      });
    },
    composeAnswer(request: ComposeAnswerRequest) {
      return Promise.resolve({ text: composeAnswerFrom(request) });
    },
  };
}

/**
 * Wait until a seeded fragment is in its final shape.
 *
 * A drop is answered twice: code's own line goes in with the row, and the
 * styled line replaces it afterwards, as its own background job. A demo that
 * started between the two would show one text on the first load and another a
 * moment later, which is precisely the flakiness the leads exist to remove — so
 * the wait is here, bounded, and gives up on the line that is already there
 * rather than refusing to start.
 *
 * @param domain - the library being seeded.
 * @param dropId - the fragment to wait for.
 * @param body - its text, which is what code's own line was chosen from.
 */
async function settleSeeded(domain: Domain, dropId: string, body: string): Promise<void> {
  const caught = safeReply(readSituation(body));
  for (let attempt = 0; attempt < SEED_ATTEMPTS; attempt += 1) {
    const drop = await domain.getDrop(dropId);
    if (drop === null) return;
    if (drop.extracted && drop.reply !== caught) return;
    await new Promise((resolve) => setTimeout(resolve, SEED_INTERVAL_MS));
  }
}

/**
 * Lay the preset material down in an empty library, through the ordinary drop path.
 *
 * The leads are **real drops**: they are read, they yield terms, they attach to
 * matters, and they are answered — the same chain everything else in the product
 * runs on. Nothing is written behind the domain's back, which is what makes the
 * acts that follow ordinary acts rather than a special mode of the core.
 *
 * Each one is waited for, reading and wording both, so that the library the demo
 * starts from is complete rather than nearly complete.
 *
 * @param domain - the library to seed. It is not emptied first; that is the
 *   caller's decision (see the demo's reset), because emptying is destructive.
 */
export async function seedPreset(domain: Domain): Promise<void> {
  for (const body of PRESET_LEADS) {
    const dropped = await domain.drop(body);
    await domain.extract(dropped.id);
    await settleSeeded(domain, dropped.id, body);
  }
}
