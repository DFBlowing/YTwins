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
 * Nothing here is intelligence, and nothing here is the product. Replacing this
 * module with a real provider is ticket 12's whole job; the domain core does not
 * change when that happens, which is the point of the port.
 *
 * @module web/demo-provider
 */

import type { AiProvider, ComposeAnswerRequest } from '../domain/ai-provider.ts';
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
 * What to look for in the records.
 *
 * Whole phrases rather than single words on purpose. A single "期末" would match
 * any passing mention — "期末考完了" would be answered with the grading scheme,
 * citing a drop that says nothing about it. Until ticket 12 brings a real
 * reader, narrowing the match is how the stand-in avoids that.
 */
const DEMO_MATCH_TEXT = ['期末怎么算分', '平时分', '期末考 60%'];

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
 * Compose the demo answer.
 *
 * Exported so it can be exercised on its own, and so the preset facts are
 * visible in one place rather than buried in a script object.
 */
export function composeDemoAnswer(request: ComposeAnswerRequest): string {
  return `${DEMO_GRADING}${outlinePhrase(daysUntil(request.now, DEMO_DUE))}`;
}

/**
 * Build the demo provider.
 *
 * @returns the fake, with the demo's composition written out on top of it.
 */
export function createDemoProvider(): AiProvider {
  const fake = createFakeProvider({
    extractByBody: {
      [DEMO_DROP]: {
        kind: 'read',
        reading: { inputType: 'item', items: DEMO_ITEMS },
      },
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
    composeAnswer(request: ComposeAnswerRequest) {
      return Promise.resolve({ answer: composeDemoAnswer(request) });
    },
  };
}
