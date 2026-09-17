/**
 * The demo's stand-in AI provider.
 *
 * Tickets 01–11 run on a fake provider by design: the real one arrives in
 * ticket 12, together with the API key a human has to supply. This module is
 * that fake as the **server** uses it — the page needs something to talk to, or
 * act two could only ever report that it could not look, no matter what was
 * dropped.
 *
 * Everything here is **preset demo data**, which the spec allows for the three
 * acts ("三幕都跑在预置数据上，保证可重复"). It lives here rather than in the
 * domain because it is demo material, not domain logic — the dependency points
 * one way only, `src/web/` → `src/domain/`, exactly as the layout requires.
 * The domain's own tests keep their own fixtures and import nothing from here.
 *
 * Two pieces are written out rather than scripted, because a fixed script cannot
 * show them:
 *
 *  - The extracted due date, so act one's item carries a real date instead of
 *    "待安排" for a fragment that plainly gave one.
 *  - The composed answer, which phrases the outline's deadline relative to the
 *    moment it is answering as of — that is what makes act two's "a few days
 *    later" basis observable at all.
 *
 * Ticket 05 adds two more readings of the same fragment: which of its terms it is
 * **about** (好烦, so the accumulation has something to gather around), and what a
 * matter that has crossed the threshold sounds like. The band's frame is not here
 * — the domain adds it, because how firmly the product speaks is decided by code
 * from counts and spans and never by this module.
 *
 * The **reply** is scripted (ticket 03). It has to be: the demo's fragment
 * carries a feeling, so a stand-in that fell through to its default would answer
 * an emotional drop with a bare acknowledgement — exactly the line the parent
 * voice forbids. Scripting it also keeps the demo honest about what is real: the
 * reply rules are the domain's, and this is only the sentence a stand-in would
 * have offered.
 *
 * Ticket 11 adds the other two fragments act three can drop, and the asked-for
 * **answer**. Both are needed for the feature to be reachable in the browser: an
 * answer is several conclusions brought together, so the demo has to be able to
 * grow a second matter — the stand-in's four preset sentences were already there,
 * and two of them now have fragments that reach them.
 *
 * Nothing here is intelligence, and nothing here is the product. Replacing this
 * module with a real provider is ticket 12's whole job; the domain core does not
 * change when that happens, which is the point of the port.
 *
 * @module web/demo-provider
 */

import type {
  AiProvider,
  ComposeAnswerRequest,
  ComposeConclusionRequest,
  ComposeRecallAnswerRequest,
} from '../domain/ai-provider.ts';
import { createFakeProvider } from '../domain/fake-provider.ts';

/**
 * The fragment act one drops.
 *
 * Mixed on purpose, exactly as the spec's first act describes it: a grading
 * scheme and a deadline (an **item** with a time in it) plus a feeling, in one
 * unformatted sentence, with no type chosen and no time filled in by the user.
 */
export const DEMO_DROP = '老师今天讲了期末怎么算分：平时分 40%，期末考 60%，下周三交提纲，好烦';

/** The question act two asks, in the demo's "a few days later" voice. */
export const DEMO_QUESTION = '期末怎么算分';

/**
 * What act one shows the demo drop was read as.
 *
 * The deadline is a fixed date rather than a parsed "下周三", because preset
 * demo data has to be reproducible: the same drop must produce the same item
 * on any day the demo is run. 2026-09-23 is a Wednesday.
 */
const DEMO_DUE = '2026-09-23T09:00:00.000Z';

const DEMO_ITEMS = [{ text: '下周三交提纲', dueAt: DEMO_DUE }] as const;

/**
 * The **terms** act one shows were read out of it (ticket 04).
 *
 * Written the way the fragment was said rather than tidied into categories:
 * 「期末怎么算分」 rather than 「考试信息」, and 「好烦」 kept as a term of its own,
 * because a feeling the user repeated is exactly the kind of thing that should
 * be able to gather connections. Four terms, so the six links between them stay
 * readable on the page.
 *
 * No embedding is scripted here, and none is needed: every one of these terms
 * was said in the same drop, so the links between them are the zero-model kind
 * and the semantic half has nothing to compare yet. It gets something to
 * compare as soon as a second fragment arrives — which is ticket 05's and 06's
 * material, and where a vector per term belongs.
 */
const DEMO_TERMS = ['期末怎么算分', '平时分 40%', '下周三交提纲', '好烦'] as const;

/**
 * The **anchor** act one shows that fragment is about (ticket 05).
 *
 * The feeling, not the subject: a matter accumulates around what the user keeps
 * coming back to, and this fragment comes back to 好烦. The grading scheme is
 * there, but it is not what the sentence would be about.
 */
const DEMO_ANCHOR = '好烦';

/**
 * What the stand-in says about a matter, per feeling it turns out to be about.
 *
 * Preset, like everything else here. The register matters: these are judgements
 * out of accumulation, so they carry the uncertainty the evidence would earn —
 * and the band's frame is added around them by the domain, which is why none of
 * them says "我不太确定" itself.
 */
const DEMO_CLAIM_BY_FEELING: Readonly<Record<string, string>> = {
  好烦: '你最近好像有几件事堆在一起，心里一直不太顺',
  松了口气: '论文这条线最近总算松开了一点',
  想学吉他: '你似乎真的很想学吉他',
  睡不好: '你最近睡得不太好，而且它总跟期末连在一起',
};

/**
 * The other two fragments act three can drop, each opening a matter of its own.
 *
 * Preset for the same reason `DEMO_DROP` is: a stand-in that guessed at a reading
 * would be inventing one, and the demo has to be repeatable. They exist because
 * an **answer** needs more than one conclusion to assemble, and one repeated
 * fragment can only ever make one — see this module's header.
 *
 * Each yields three terms rather than two, and that is not decoration: below
 * three the matter can only **catch** a feeling instead of concluding anything
 * (`ConclusionPolicy.claimFloor`), so a two-word fragment would give the demo a
 * second matter that never produces a second thing to assemble.
 *
 * `DEMO_GUITAR`'s text is also quoted by act three's placeholder in
 * `index.html` — the one place in this repo where a preset string is written
 * twice, because a placeholder cannot be fetched from the store. If the two
 * drift apart, what breaks is the demo's second matter (a line typed by hand
 * reads as nothing), never the product; change both together.
 */
export const DEMO_GUITAR = '最近老想着学吉他，也在看琴行的帖子，周末想去试一节体验课';
export const DEMO_SLEEP = '这周总是睡不好，白天也没精神，晚上躺下又清醒';

/**
 * What the stand-in reads those two as.
 *
 * The anchors are the feelings the preset sentences above are keyed by — the
 * same shape the demo's first fragment has, where 好烦 is a term of its own and
 * the thing the accumulation gathers around.
 */
const DEMO_SECOND_READINGS: Readonly<Record<string, { readonly terms: readonly string[]; readonly anchor: string }>> = {
  [DEMO_GUITAR]: {
    terms: ['想学吉他', '琴行的帖子', '体验课'],
    anchor: '想学吉他',
  },
  [DEMO_SLEEP]: { terms: ['睡不好', '没精神', '躺下又清醒'], anchor: '睡不好' },
};

/**
 * Compose the demo's conclusion sentence.
 *
 * Exported so the preset material is visible in one place, and so the stand-in's
 * limitation is legible: a feeling it has no sentence for gets a plain sentence
 * built from the user's own wording, which is what a stand-in can honestly do
 * without inventing a psychology for it.
 */
export function composeDemoConclusion(request: ComposeConclusionRequest): string {
  const scripted = DEMO_CLAIM_BY_FEELING[request.anchor];
  if (scripted !== undefined) return scripted;
  return `你好像一直想着「${request.anchor}」这件事`;
}

/**
 * What to look for in the records.
 *
 * Whole phrases rather than single words on purpose. A single "期末" would match
 * any passing mention — "期末考完了" would be answered with the grading scheme,
 * citing a drop that says nothing about it. Until ticket 12 brings a real
 * reader, narrowing the match is how the stand-in avoids that.
 */
const DEMO_MATCH_TEXT = ['期末怎么算分', '平时分', '期末考 60%'];

/**
 * What act one is answered with.
 *
 * One sentence, no question, no advice, no pet name: the fragment ends in 好烦,
 * so this is the emotion reply the first sentence has to be. It names the
 * feeling rather than restating the fragment, because echoing the user's own
 * words back is the one thing the doc rules out by name.
 */
const DEMO_REPLY = '听着，事情全堆在一起，心里挺堵的。';

/** The facts the demo record contains, restated as an answer. */
const DEMO_GRADING = '平时分占 40%，期末考占 60%。';

/** Whole days from the answering moment to the outline's deadline. */
function daysUntil(now: string, due: string): number | null {
  const from = new Date(now).getTime();
  const to = new Date(due).getTime();
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
 * Compose the demo's reply to a question about the **records**.
 *
 * Exported so it can be exercised on its own, and so the preset facts are
 * visible in one place rather than buried in a script object. Named for recall
 * rather than for the product's word 答案, which belongs to the composer below
 * (`CONTEXT.md`, 追溯).
 */
export function composeDemoRecallAnswer(request: ComposeRecallAnswerRequest): string {
  return `${DEMO_GRADING}${outlinePhrase(daysUntil(request.now, DEMO_DUE))}`;
}

/**
 * Compose the demo's asked-for **answer**.
 *
 * Built out of the user's own words rather than written out as a fixed line, and
 * that is the point of the demo: what comes back names things only this user
 * said, which is exactly the property the real provider is supposed to have. A
 * stand-in with a canned sentence would show the shape of the feature and hide
 * the one thing worth looking at.
 *
 * The words are taken until the sentence is long enough to say something and
 * short enough that the domain's own check still passes it: a stand-in whose
 * answer was rejected for length would fall back to a single line, and the demo
 * would look like the feature was not there.
 */
export function composeDemoAnswer(request: ComposeAnswerRequest): string {
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
 * Build the demo provider.
 *
 * @returns the fake, with the demo's composition written out on top of it.
 */
export function createDemoProvider(): AiProvider {
  const fake = createFakeProvider({
    byBody: { [DEMO_DROP]: { kind: 'reply', reply: DEMO_REPLY } },
    extractByBody: {
      [DEMO_DROP]: {
        kind: 'read',
        reading: {
          inputType: 'item',
          items: DEMO_ITEMS,
          terms: DEMO_TERMS,
          anchor: DEMO_ANCHOR,
        },
      },
      // The two fragments act three may drop. Emotional, because that is what
      // they are: the demo's second matter is raised by saying the same thing
      // three times, and each of those is a moment the product speaks after.
      ...Object.fromEntries(
        Object.entries(DEMO_SECOND_READINGS).map(([body, reading]) => [
          body,
          {
            kind: 'read',
            reading: { inputType: 'emotion', items: [], terms: reading.terms, anchor: reading.anchor },
          },
        ]),
      ),
    },
    parseQuestionByQuestion: {
      [DEMO_QUESTION]: { kind: 'match', matchText: DEMO_MATCH_TEXT },
    },
    // Present so the fake never reaches its "no compose script" failure, and so
    // what this module replaces is legible: the real composition follows.
    composeFallback: { kind: 'answer', answer: DEMO_GRADING },
  });

  return {
    ...fake,
    composeRecallAnswer(request: ComposeRecallAnswerRequest) {
      return Promise.resolve({ answer: composeDemoRecallAnswer(request) });
    },
    composeConclusion(request: ComposeConclusionRequest) {
      return Promise.resolve({ text: composeDemoConclusion(request) });
    },
    composeAnswer(request: ComposeAnswerRequest) {
      return Promise.resolve({ text: composeDemoAnswer(request) });
    },
  };
}
