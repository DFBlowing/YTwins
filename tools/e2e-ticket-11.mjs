/*
 * End-to-end check of the asked-for **answer** over real HTTP.
 *
 * Runs the real server handler against a real SQLite file with a scripted
 * provider, so it exercises what the domain tests cannot: the JSON the page
 * actually receives when it asks "what do you think of me lately", the cooldown
 * as a record on disk, and the same question asked of two different sets of
 * material — one that can support an answer and one that cannot.
 *
 * Three of the claims are negative ones, and they are the point of the ticket:
 *
 *  - An answer is not a restatement of one conclusion: it names every conclusion
 *    it was assembled from, and the sentence is the provider's, not one of them.
 *  - The same turn cannot produce an answer *and* a surfacing, and the same topic
 *    is not heard again inside the cooldown — checked across a restart.
 *  - Nothing of the scaffolding an answer was assembled from crosses the wire.
 *
 *   node tools/e2e-ticket-11.mjs
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDomain } from '../src/domain/core.ts';
import { DEFAULT_CONCLUSION_POLICY } from '../src/domain/conclusions.ts';
import { createFakeProvider } from '../src/domain/fake-provider.ts';
import { openSqliteStore } from '../src/domain/sqlite-store.ts';
import { createHandler } from '../src/web/server.ts';

/** One matter: the exam. Raised three times. */
const EXAM_1 = '期末怎么算分，好烦';
const EXAM_2 = '平时分 40% 到底怎么算，好烦';
/** The other: the guitar. Raised three times, so a second conclusion exists. */
const GUITAR_1 = '最近老想着学吉他，想学吉他';
const GUITAR_2 = '看了几个吉他班，想学吉他';
/** A fragment with nothing to feel about it: not a moment to speak at all. */
const NEUTRAL = '想把论文改成开题报告，先问问导师';

const EXAM_TERMS = ['期末怎么算分', '好烦'];
const PERCENT_TERMS = ['平时分 40%', '好烦'];
const GUITAR_TERMS = ['学吉他', '想学吉他'];
const CLASS_TERMS = ['吉他班', '想学吉他'];

/** Every word behind both matters, in the order the user said them. */
const SUPPORT = ['期末怎么算分', '好烦', '平时分 40%', '学吉他', '想学吉他', '吉他班'];

/** What the stand-in says about each matter, and about both together. */
const SENTENCE_BY_FEELING = {
  好烦: { kind: 'sentence', text: '你最近被期末压着' },
  想学吉他: { kind: 'sentence', text: '你好像真的很想学吉他' },
};
const ANSWER_SENTENCE = '你反复提到的那几件事，好像连在一起';

/** Said in one sitting, so the weakest band speaks: the frame is the product's. */
const ANSWERED_TEXT = `我不太确定：${ANSWER_SENTENCE}。`;

function provider() {
  return createFakeProvider({
    extractByBody: {
      [EXAM_1]: {
        kind: 'read',
        reading: { inputType: 'emotion', items: [], terms: EXAM_TERMS, anchor: '好烦' },
      },
      [EXAM_2]: {
        kind: 'read',
        reading: { inputType: 'emotion', items: [], terms: PERCENT_TERMS, anchor: '好烦' },
      },
      [GUITAR_1]: {
        kind: 'read',
        reading: { inputType: 'emotion', items: [], terms: GUITAR_TERMS, anchor: '想学吉他' },
      },
      [GUITAR_2]: {
        kind: 'read',
        reading: { inputType: 'emotion', items: [], terms: CLASS_TERMS, anchor: '想学吉他' },
      },
      [NEUTRAL]: {
        kind: 'read',
        reading: { inputType: 'decision', items: [], terms: ['开题报告'], anchor: '开题报告' },
      },
    },
    composeConclusionByAnchor: SENTENCE_BY_FEELING,
    answerFallback: { kind: 'sentence', text: ANSWER_SENTENCE },
  });
}

/**
 * The policy the checks pin.
 *
 * Built from the **shipped default** rather than restated, unlike the domain
 * tests (which spell theirs out so a check fails when a rule changes): what this
 * script is about is the wire, not the numbers, and the one dial it moves is the
 * judgement timing — `count` settles the moment a matter crosses, so a phase can
 * raise its material and then ask without waiting out a quiet window.
 */
function policy() {
  return { ...DEFAULT_CONCLUSION_POLICY, judgeTiming: 'count' };
}

const dir = mkdtempSync(join(tmpdir(), 'ytwins-e2e-answer-'));
const dbFile = join(dir, 'ytwins.sqlite');

/** Start a real server on an ephemeral port, backed by the given database. */
async function listen(dbPath) {
  const store = openSqliteStore(dbPath);
  const domain = createDomain({
    store,
    provider: provider(),
    conclusionPolicy: policy(),
    // The dice are pinned to their first face here, and only here: an answer
    // carries one of its band's openings, so the wording would otherwise differ
    // between runs of this script. What the real server runs is `Math.random`;
    // that the roll makes a difference is checked in the domain tests.
    random: () => 0,
  });
  const server = createServer((req, res) => {
    createHandler(domain)(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await store.close();
    },
  };
}

const get = async (base, path) => (await fetch(`${base}${path}`)).json();
const post = async (base, path, payload) => {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  // Not every answer is JSON: a refusal comes back as the handler's plain-text
  // line, and pretending otherwise would turn "it said no" into a parse error.
  const text = await response.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Left as text.
  }
  return { status: response.status, body };
};

/** Poll the portrait the way the page does, until it has `count` conclusions. */
async function pollConclusions(base, count, attempts = 60) {
  let conclusions = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    conclusions = (await get(base, '/api/conclusions')).conclusions;
    if (conclusions.length >= count) return conclusions;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return conclusions;
}

/** Raise one matter three times, and wait until it has been settled. */
async function raise(base, first, second) {
  for (const body of [first, second, second]) {
    const created = await post(base, '/api/drop', { body });
    assert.equal(created.status, 200, 'the drop itself always succeeds');
  }
}

let failures = 0;
let checks = 0;
async function check(name, body) {
  checks += 1;
  try {
    await body();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log('end to end — the asked-for answer');

// Phase one: two matters raised, then the question. The question is the moment
// that judges on the spot and assembles what it finds.
let server = await listen(dbFile);
try {
  await check('a question is answered from several conclusions, not one of them restated', async () => {
    await raise(server.base, EXAM_1, EXAM_2);
    await raise(server.base, GUITAR_1, GUITAR_2);
    const conclusions = await pollConclusions(server.base, 2);
    assert.equal(conclusions.length, 2, 'two matters crossed, so two conclusions exist');

    const attempt = await post(server.base, '/api/surface', {});
    assert.equal(attempt.status, 200, 'zero answers are ordinary, not errors');

    const answer = attempt.body;
    assert.equal(answer.kind, 'answered');
    assert.equal(answer.text, ANSWERED_TEXT, 'the sentence is the provider\'s, the frame is the product\'s');
    assert.ok(
      !answer.text.includes('你最近被期末压着') && !answer.text.includes('你好像真的很想学吉他'),
      'and it is not either matter\'s own sentence said again',
    );
    assert.equal(answer.tier, 'weak', 'said in one sitting, so it is hedged');
    assert.deepEqual(
      answer.conclusions.map((conclusion) => conclusion.text),
      conclusions.map((conclusion) => conclusion.text),
      'every conclusion it was assembled from, in the portrait\'s own words',
    );
    assert.deepEqual(answer.support.map((term) => term.text), SUPPORT, 'and the words behind them');
    assert.equal(answer.mentions, 6, 'both matters\' times, added up');
    assert.equal(answer.spanDays, 0, 'nothing has spanned yet');
    assert.ok(Number.isFinite(Date.parse(answer.answeredAt)));

    // What crossed the wire is the answer, the conclusions it rests on and the
    // numbers its wording was read off — and nothing of the scaffolding.
    assert.deepEqual(
      Object.keys(answer).sort(),
      [
        'answeredAt',
        'averageStrength',
        'conclusions',
        'kind',
        'mentions',
        'softened',
        'spanDays',
        'support',
        'text',
        'tier',
      ],
    );
    const payload = JSON.stringify(answer);
    assert.ok(!/vector/.test(payload), 'no embedding');
    assert.ok(!/matter|anchorTermId|term_ids/.test(payload), 'no matter or its anchor');
    assert.ok(!/origin_drop_id|first_seen_at|avg_strength|term_id/.test(payload), 'no column names');
  });

  await check('one turn is one line: asking again is answered with the cooldown', async () => {
    const again = await post(server.base, '/api/surface', {});
    assert.equal(again.status, 200);
    assert.deepEqual(again.body, { kind: 'none', reason: 'cooldown' });
  });

  await check('a drop about one of the same matters is in the same cooldown', async () => {
    const created = await post(server.base, '/api/drop', { body: EXAM_2 });
    assert.equal(created.status, 200);
    // Long enough for the reading and the attachment to land.
    await new Promise((resolve) => setTimeout(resolve, 150));

    const attempt = await post(server.base, '/api/surface', { dropId: created.body.id });
    assert.equal(attempt.status, 200);
    assert.deepEqual(
      attempt.body,
      { kind: 'none', reason: 'cooldown' },
      'the drop and the question share one cooldown rather than each being answered',
    );
  });

  await check('a drop with no feeling in it is not a moment', async () => {
    const created = await post(server.base, '/api/drop', { body: NEUTRAL });
    assert.equal(created.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const attempt = await post(server.base, '/api/surface', { dropId: created.body.id });
    assert.equal(attempt.status, 200);
    assert.deepEqual(attempt.body, { kind: 'none', reason: 'not-a-moment' });
  });
} finally {
  await server.close();
}

// Phase two: a fresh process against the same file. The cooldown is read back
// from disk, so what the user heard is still heard.
server = await listen(dbFile);
try {
  await check('the question is still in cooldown after a restart', async () => {
    const attempt = await post(server.base, '/api/surface', {});
    assert.equal(attempt.status, 200);
    assert.deepEqual(attempt.body, { kind: 'none', reason: 'cooldown' }, 'the record survived');
  });
} finally {
  await server.close();
}

// Phase three: the same question over a different data set — one matter, so one
// conclusion, and one conclusion is not an answer. This is the wire's half of
// "an answer could only have grown out of this user's material": with less of it
// there is no answer at all, rather than a generic one.
const secondDir = mkdtempSync(join(tmpdir(), 'ytwins-e2e-answer-thin-'));
const secondFile = join(secondDir, 'ytwins.sqlite');
server = await listen(secondFile);
try {
  await check('with one thing settled there is no answer, only the one line', async () => {
    await raise(server.base, EXAM_1, EXAM_2);
    const conclusions = await pollConclusions(server.base, 1);
    assert.equal(conclusions.length, 1);

    const attempt = await post(server.base, '/api/surface', {});
    assert.equal(attempt.status, 200);
    assert.equal(attempt.body.kind, 'surfaced', 'nothing to assemble, so the one thing is shown');
    assert.equal(attempt.body.text, conclusions[0].text);
  });
} finally {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(secondDir, { recursive: true, force: true });
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exitCode = 1;
