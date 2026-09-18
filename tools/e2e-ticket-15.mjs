/*
 * End-to-end check of the one box over real HTTP (ticket 15).
 *
 *   node tools/e2e-ticket-15.mjs
 *
 * What this script is for, and what the domain tests cannot cover:
 *
 *  - **One request, one answer.** The fused page makes a single call and shows
 *    what came back; which of 投递 / 追溯 / 浮现 the words turned out to be is
 *    decided inside the domain and travels in the response. This is what the
 *    wire has to carry, and it is checked over a real socket rather than through
 *    the interface.
 *  - **The page is not the thing routing.** Two servers are started: one wired
 *    to a scripted provider, where all four kinds of input can be pinned exactly,
 *    and one in demo mode, where the three acts run through the box on the preset
 *    material. Neither server has a route that lets a client say what its words
 *    were, which is the structural half of "只有领域决定".
 *  - **The two pages are where they should be.** `/` is the product and
 *    `/demo.html` is the three-act page, unchanged — the decision this ticket
 *    took with the author, and one that a build setting could silently undo.
 *  - **The three acts' own surface is untouched.** `POST /api/drop` still answers
 *    with exactly the three fields it always did, and the demo still runs through
 *    it; the fused route is additive.
 *
 * The scripted provider is a `createFakeProvider` instance, exactly as the domain
 * tests use — but here it sits behind the real HTTP handler, a real SQLite file
 * and the real routing, so what is asserted is the cross-layer chain rather than
 * the domain alone.
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveProviderConfig } from '../src/ai/config.ts';
import { DEFAULT_CONCLUSION_POLICY } from '../src/domain/conclusions.ts';
import { createDomain } from '../src/domain/core.ts';
import { createFakeProvider } from '../src/domain/fake-provider.ts';
import { PRESET_ACTS, seedPreset } from '../src/domain/preset.ts';
import { openSqliteStore } from '../src/domain/sqlite-store.ts';
import { createConfiguredProvider } from '../src/web/provider.ts';
import { createHandler } from '../src/web/server.ts';

/**
 * The clock the whole check runs on.
 *
 * Pinned because the preset material says 「下周三」 rather than carrying a date:
 * 2026-09-17 is a Thursday, so the deadline the first act reads out is
 * 2026-09-23.
 */
const DAY_ONE = new Date('2026-09-17T00:00:00.000Z');

/** The four kinds of thing the box can be handed, plus the material around them. */
const FRAGMENT = '楼下咖啡店换了个新豆子，闻着不错';
const UNSURE = '下周三交提纲吗';
const RECORD_DROP = '老师今天讲了期末怎么算分：平时分 40%，期末考 60%，下周三交提纲';
const FACT_QUESTION = '期末怎么算分';
const UNCOVERED_QUESTION = '上周的会议纪要放哪了';
const SELF_QUESTION = '你觉得我最近怎么样';

/** The two matters the self-question needs, raised three times each. */
const EXAM_ONE = '平时分 40% 到底怎么算，好烦';
const EXAM_TWO = '期末考那部分到底考什么，好烦';
const GUITAR_ONE = '最近老想着学吉他，想学吉他';
const GUITAR_TWO = '看了几个吉他班，想学吉他';
const MATTER_FRAGMENTS = [EXAM_ONE, EXAM_TWO, GUITAR_ONE, GUITAR_TWO];

/** What the scripted provider says, written out rather than imported. */
const RECALL_ANSWER = '平时分占 40%，期末考占 60%。';
const EXAM_SENTENCE = '你最近被期末压着';
const GUITAR_SENTENCE = '你好像真的很想学吉他';
const ASSEMBLED_ANSWER = '你反复提到的那几件事，好像连在一起';

/** The same line the three-act demo's first act shows, reached through the box. */
const ACT_ONE_LINE = '我不太确定：你最近好像有几件事堆在一起，心里一直不太顺。';
const ACT_ONE_ITEM = '下周三交提纲';

/** What the fake reads each fragment as: terms, anchor, input type. */
const READING_BY_BODY = {
  [FRAGMENT]: { terms: ['新豆子'], anchor: null, inputType: 'idea' },
  [UNSURE]: { terms: ['下周三交提纲'], anchor: null, inputType: 'emotion' },
  [EXAM_ONE]: { terms: ['平时分 40%', '好烦'], anchor: '好烦', inputType: 'emotion' },
  [EXAM_TWO]: { terms: ['期末考', '好烦'], anchor: '好烦', inputType: 'emotion' },
  [GUITAR_ONE]: { terms: ['学吉他', '想学吉他'], anchor: '想学吉他', inputType: 'emotion' },
  [GUITAR_TWO]: { terms: ['吉他班', '想学吉他'], anchor: '想学吉他', inputType: 'emotion' },
};

/** The scripted provider, plus the reference this script asserts against. */
function scriptedProvider() {
  const extractByBody = {};
  for (const [body, reading] of Object.entries(READING_BY_BODY)) {
    extractByBody[body] = {
      kind: 'read',
      reading: { inputType: reading.inputType, items: [], terms: reading.terms, anchor: reading.anchor },
    };
  }

  return createFakeProvider({
    extractByBody,
    // Only three bodies are scripted as questions, and they are the ones the box
    // is expected to route: everything else — every fragment, and both of the
    // statements above that happen to carry an asking phrase — is left to fail,
    // which the domain reads as 「not a question」. That is what makes "nobody was
    // asked" and "somebody was asked and said no" tell apart on the wire.
    judgeQuestionByBody: {
      [FACT_QUESTION]: { kind: 'asking', about: 'records' },
      [UNCOVERED_QUESTION]: { kind: 'asking', about: 'records' },
      [SELF_QUESTION]: { kind: 'asking', about: 'self' },
    },
    parseQuestionByQuestion: {
      [FACT_QUESTION]: { kind: 'match', matchText: ['期末怎么算分'] },
    },
    composeFallback: { kind: 'answer', answer: RECALL_ANSWER },
    composeConclusionByAnchor: {
      好烦: { kind: 'sentence', text: EXAM_SENTENCE },
      想学吉他: { kind: 'sentence', text: GUITAR_SENTENCE },
    },
    answerFallback: { kind: 'sentence', text: ASSEMBLED_ANSWER },
  });
}

const root = process.cwd();
const dir = mkdtempSync(join(tmpdir(), 'ytwins-e2e-one-box-'));

/**
 * Start a real server on an ephemeral port.
 *
 * @param dbPath - the database file to open.
 * @param build - how to wire the domain: the scripted provider, or demo mode.
 * @returns the base URL and a way to stop it.
 */
async function listen(dbPath, build) {
  const store = openSqliteStore(dbPath);
  const { domain, demo } = build(store);

  const handler = createHandler(domain, demo === undefined ? {} : { demo });
  const server = createServer((req, res) => {
    handler(req, res).catch(() => {
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

/** A server whose provider is scripted, so all four routings can be pinned. */
async function listenScripted(dbPath, provider) {
  return listen(dbPath, (store) => ({
    domain: createDomain({
      store,
      provider,
      // Settling is forced by count rather than by the alternation, so the
      // material behind the self-question is judged the moment it crosses — the
      // same dial the domain's own answer checks turn, for the same reason.
      conclusionPolicy: { ...DEFAULT_CONCLUSION_POLICY, judgeTiming: 'count' },
      // The opening a banded line carries is rolled for; pinned to its first
      // face so the expected sentence is a literal rather than a hope.
      random: () => 0,
    }),
  }));
}

/** A server wired the way `YTwins_PROVIDER=demo` wires one. */
async function listenDemo(dbPath) {
  const config = resolveProviderConfig({ YTwins_PROVIDER: 'demo' }, { repoRoot: root });
  const { provider } = createConfiguredProvider(config, { now: () => DAY_ONE });
  return listen(dbPath, (store) => {
    const domain = createDomain({
      store,
      provider,
      now: () => DAY_ONE.toISOString(),
      random: () => 0,
    });
    return {
      domain,
      demo: {
        acts: PRESET_ACTS,
        reset: async () => {
          await store.clear();
          await seedPreset(domain);
        },
      },
    };
  });
}

const get = async (base, path) => (await fetch(`${base}${path}`)).json();
const post = async (base, path, payload) => {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  });
  const text = await response.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Left as text: a refusal comes back as the handler's plain line.
  }
  return { status: response.status, body };
};

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

console.log('end to end — one box, three doings');

const provider = scriptedProvider();
const scripted = await listenScripted(join(dir, 'scripted.sqlite'), provider);

try {
  await check('the product is at /, and the three-act page is still served at /demo.html', async () => {
    const product = await (await fetch(`${scripted.base}/`)).text();
    assert.ok(product.includes('id="deliver-form"'), 'the one box is what opens at the root');
    assert.ok(!product.includes('act-tab'), 'and there are no tabs on it: no separate way in for 问');

    const acts = await (await fetch(`${scripted.base}/demo.html`)).text();
    assert.ok(acts.includes('data-act="drop"'), 'the three-act page keeps its first act');
    assert.ok(acts.includes('data-act="surface"'), 'and its third');
    assert.ok(acts.includes('id="drop-form"'), 'with the drop box it always had');
    assert.ok(!acts.includes('id="deliver-form"'), 'and nothing of the fused page in it');
  });

  await check('the three-act page\'s own write still answers with exactly what it always did', async () => {
    const dropped = await post(scripted.base, '/api/drop', { body: RECORD_DROP });
    assert.equal(dropped.status, 200);
    assert.deepEqual(
      Object.keys(dropped.body).sort(),
      ['body', 'id', 'reply'],
      'the fused route is additive: the three-act page\'s surface is untouched',
    );
  });

  await check('a fragment is caught, and nothing more is said about it', async () => {
    const delivered = await post(scripted.base, '/api/deliver', { body: FRAGMENT });
    assert.equal(delivered.status, 200);

    const { drop, speech } = delivered.body;
    assert.equal(drop.body, FRAGMENT, 'the original is kept word for word');
    assert.equal(drop.extracted, true, 'the delivery waits for the reading');
    assert.deepEqual(drop.terms.map((term) => term.text), ['新豆子'], 'and carries what it read');
    assert.ok(drop.reply.trim().length > 0, 'a drop is never silent');
    assert.deepEqual(speech, { kind: 'none' }, 'a fragment gets nothing beyond its own reply');
    assert.deepEqual(provider.classified, [], 'a statement is settled by code: nobody was asked');
  });

  await check('a feeling worded as a question is still a feeling, and costs no model call', async () => {
    const delivered = await post(scripted.base, '/api/deliver', { body: UNSURE });
    assert.equal(delivered.status, 200);
    assert.deepEqual(
      delivered.body.speech,
      { kind: 'none' },
      '「下周三交提纲吗」 is a thought spoken aloud, not a question to answer',
    );
    assert.deepEqual(provider.classified, [], 'and the input type settled it without asking anyone');
  });

  await check('a question about the records is answered over HTTP, with the drop it came from', async () => {
    const delivered = await post(scripted.base, '/api/deliver', { body: FACT_QUESTION });
    assert.equal(delivered.status, 200);

    const { drop, speech } = delivered.body;
    assert.equal(speech.kind, 'recall', 'the records are what a fact question is put to');
    assert.equal(speech.result.kind, 'answered');
    assert.equal(speech.result.answer, RECALL_ANSWER);
    assert.deepEqual(
      speech.result.sources.map((source) => source.body),
      [RECORD_DROP],
      'and it cites the fragment that really said it',
    );
    assert.ok(
      !speech.result.sources.some((source) => source.dropId === drop.id),
      'the words just typed are never cited back as their own answer',
    );
    assert.deepEqual(provider.answers, [], 'no judgement was pushed at a question about a fact');
  });

  await check('a question the records do not cover says so, and still gets no judgement', async () => {
    const delivered = await post(scripted.base, '/api/deliver', { body: UNCOVERED_QUESTION });
    assert.equal(delivered.status, 200);
    assert.equal(delivered.body.speech.kind, 'recall');
    assert.deepEqual(
      delivered.body.speech.result,
      { kind: 'not-found' },
      'the records were searched, and saying so plainly is the answer',
    );
    assert.deepEqual(provider.answers, [], 'and what the product does have is not dressed up as one');
  });

  await check('a question about the user goes to the moment, and never to the records', async () => {
    // Raise both matters, through the ordinary drop route, the way the product
    // accumulates anything.
    for (const body of [...MATTER_FRAGMENTS, ...MATTER_FRAGMENTS.slice(1)]) {
      const dropped = await post(scripted.base, '/api/drop', { body });
      assert.equal(dropped.status, 200);
    }

    const delivered = await post(scripted.base, '/api/deliver', { body: SELF_QUESTION });
    assert.equal(delivered.status, 200);

    const { speech } = delivered.body;
    assert.equal(speech.kind, 'surface', 'the moment answers this, not the records');
    assert.equal(speech.result.kind, 'answered');
    assert.equal(
      speech.result.text,
      `我不太确定：${ASSEMBLED_ANSWER}。`,
      'the uncertainty is written in by the band, not by the model',
    );
    assert.equal(speech.result.conclusions.length, 2, 'several conclusions brought together');
    assert.ok(
      !provider.askedQuestions.includes(SELF_QUESTION),
      'and the records were never put to it: reading the newest fragment back would be no answer',
    );
  });

  await check('an empty delivery is refused rather than recorded', async () => {
    const refused = await post(scripted.base, '/api/deliver', { body: '   ' });
    assert.equal(refused.status, 400);
    const missing = await post(scripted.base, '/api/deliver');
    assert.equal(missing.status, 400, 'a request with no words in it is not a delivery');
  });
} finally {
  await scripted.close();
}

const demo = await listenDemo(join(dir, 'demo.sqlite'));
try {
  await check('in demo mode the acts run through the one box on the preset material', async () => {
    const reset = await post(demo.base, '/api/demo/reset');
    assert.equal(reset.status, 200, 'a demo starts from the preset leads');

    // Act one, through the box: the messy fragment is a fragment that carries a
    // feeling, so what comes back is its reply and the line the moment surfaces.
    const first = await post(demo.base, '/api/deliver', { body: PRESET_ACTS.drop });
    assert.equal(first.status, 200);
    const { drop, speech } = first.body;
    assert.equal(drop.items.length, 1, 'the item is in the delivery, and no type was asked of the user');
    assert.equal(drop.items[0].text, ACT_ONE_ITEM);
    assert.equal(speech.kind, 'surface');
    assert.equal(speech.result.kind, 'surfaced');
    assert.equal(speech.result.text, ACT_ONE_LINE, 'the uncertain register is code\'s, in front of the sentence');

    // The question the second act asks, through the same box.
    const asked = await post(demo.base, '/api/deliver', { body: PRESET_ACTS.question });
    assert.equal(asked.status, 200);
    assert.equal(asked.body.speech.kind, 'recall', 'the preset stand-in answers this one as a question');
    assert.equal(asked.body.speech.result.kind, 'answered');
    assert.deepEqual(
      asked.body.speech.result.sources.map((source) => source.body),
      [PRESET_ACTS.drop],
      'and it names the fragment the presenter just dropped',
    );
  });

  await check('the box\'s demo notice is read from the server, not written into the page', async () => {
    const { demo: script } = await get(demo.base, '/api/demo');
    assert.deepEqual(script?.acts, PRESET_ACTS, 'the page is told which script this server runs');

    // A server started for real has no script, and the page hides the notice on
    // that answer rather than on a guess.
    const realFile = join(dir, 'real.sqlite');
    const config = resolveProviderConfig(
      {
        YTwins_PROVIDER: 'real',
        YTwins_LLM: 'cloud',
        YTwins_LLM_API_KEY: 'sk-not-used-by-this-script',
        YTwins_EMBEDDING: 'local',
      },
      { repoRoot: root },
    );
    const { provider: realProvider } = createConfiguredProvider(config);
    const real = await listenScripted(realFile, realProvider);
    try {
      const { demo: none } = await get(real.base, '/api/demo');
      assert.equal(none, null, 'there is no script to show, and the page is told so');
    } finally {
      await real.close();
    }
  });
} finally {
  await demo.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exitCode = 1;
