/*
 * End-to-end check of the three-act demo over real HTTP.
 *
 * Runs the real server handler the way `npm run server` builds it — the demo
 * provider, the demo's own two routes, the data-boundary read — against a real
 * SQLite file, and drives the three acts the way the page does: drop, read the
 * drop back, ask the product to speak; then ask the question; then one more
 * feeling.
 *
 * What this script is for, and what the domain tests cannot cover:
 *
 *  - The three acts share **one preset dataset**, and the script the page
 *    receives is that dataset rather than a second copy typed into the page.
 *  - Running the acts again, after the demo's reset, gives back the same lines
 *    — over the wire, not merely inside the domain.
 *  - The two routes a demo has exist **only** in demo mode: on a server started
 *    for real, nothing can ask it to empty the library.
 *  - The page is told which part of the user's data leaves this machine, and the
 *    answer is read off this machine's wiring rather than written into the page.
 *
 *   node tools/e2e-ticket-13.mjs
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveProviderConfig } from '../src/ai/config.ts';
import { createDomain } from '../src/domain/core.ts';
import { PRESET_ACTS, seedPreset } from '../src/domain/preset.ts';
import { openSqliteStore } from '../src/domain/sqlite-store.ts';
import { createHandler } from '../src/web/server.ts';
import { describeDataBoundary } from '../src/web/privacy.ts';
import { createConfiguredProvider } from '../src/web/provider.ts';

/**
 * The clock the whole check runs on.
 *
 * Pinned because the preset material says 「下周三」 rather than carrying a date:
 * 2026-09-17 is a Thursday, so the deadline the first act reads out is
 * 2026-09-23, and "a few days later" is the moment exactly three days before it.
 */
const DAY_ONE = new Date('2026-09-17T00:00:00.000Z');
const ASKED_AT = '2026-09-20T01:00:00.000Z';

/**
 * What the three acts have to come to, written out rather than imported.
 *
 * Deliberately literals: an expectation read from `src/domain/preset.ts` would
 * agree with the implementation by construction, and could not disagree with it
 * if the demo's script silently changed. The check just below does the other
 * half — it asserts that the script the **server** hands the page is that same
 * dataset — so the two together say "the page runs the material, and the material
 * still says this".
 */
const ACT_ONE_REPLY = '听着，事情全堆在一起，心里挺堵的。';
const ACT_ONE_ITEM = '下周三交提纲';
const ACT_ONE_TERMS = ['期末怎么算分', '平时分 40%', '期末考 60%', '下周三交提纲', '好烦'];
const ACT_ONE_LINE = '我不太确定：你最近好像有几件事堆在一起，心里一直不太顺。';
const ACT_THREE_LINE = '我不太确定：你最近睡得不太好，白天也提不起劲。';
const ACT_THREE_TERMS = ['睡不好', '没精神', '躺下又清醒'];
/**
 * The answer's shape, rather than one exact day count.
 *
 * The count is read off the moment asked and the material's own 「下周三」, which
 * is resolved in **local** time: an exact literal here would be a check that only
 * passes in the timezone this machine happens to be in. What the act promises is
 * the grading scheme restated and the deadline said relative to that moment, and
 * the count moving with the viewpoint is checked separately.
 */
const ANSWER_SHAPE = /^平时分占 40%，期末考占 60%。提纲还有 (\d+) 天到期。$/u;

/** Every drop a demo starts with, in the order it lays them down. */
const LEADS = ['下周三交提纲，好烦', '又是下周三交提纲，好烦', '这两天睡不好，白天也没精神', '还是睡不好，白天没精神'];

/**
 * Every request this process makes, and whether it left the machine.
 *
 * Installed before the server is built, because "the demo does not go online" is
 * a claim about the code rather than about a sentence the page shows — the
 * preset provider answers from a table, and this is what says so. The script's
 * own calls are all to `127.0.0.1`, so anything else recorded here is a call the
 * demo made outward.
 */
const leftTheMachine = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith('http://127.0.0.1:')) leftTheMachine.push(url);
  return realFetch(input, init);
};

/** The day count an answer states, or a failed assertion naming what it said. */
function daysLeft(answer) {
  const match = ANSWER_SHAPE.exec(answer);
  assert.ok(match !== null, `the answer restates the grading and the deadline: ${answer}`);
  return Number(match[1]);
}

const root = process.cwd();
const dir = mkdtempSync(join(tmpdir(), 'ytwins-e2e-demo-'));

/** The configuration a machine with a key and no local model runs. */
function realConfig() {
  return resolveProviderConfig(
    {
      YTwins_PROVIDER: 'real',
      YTwins_LLM: 'cloud',
      YTwins_LLM_API_KEY: 'sk-not-used-by-this-script',
      YTwins_EMBEDDING: 'local',
    },
    { repoRoot: root },
  );
}

/**
 * Start a real server on an ephemeral port, wired the way the composition root
 * wires it: the same provider decision, the same demo routes, the same boundary.
 *
 * @param dbPath - the database file to open.
 * @param options - whether this server is a demo, and whether it knows its own
 *   boundary (a server built without one is a case the page has to survive).
 * @returns the base URL and a way to stop it.
 */
async function listen(dbPath, options = {}) {
  const demo = options.demo !== false;
  const config = demo
    ? resolveProviderConfig({ YTwins_PROVIDER: 'demo' }, { repoRoot: root })
    : realConfig();
  const now = () => DAY_ONE;
  const { provider } = createConfiguredProvider(config, { now });
  const store = openSqliteStore(dbPath);
  const domain = createDomain({
    store,
    provider,
    now: () => DAY_ONE.toISOString(),
    ...(demo ? { random: () => 0 } : {}),
  });

  const demoRoutes = demo
    ? {
        acts: PRESET_ACTS,
        reset: async () => {
          await store.clear();
          await seedPreset(domain);
        },
      }
    : undefined;

  const handler = createHandler(domain, {
    ...(options.boundary === false ? {} : { boundary: describeDataBoundary(config) }),
    ...(demoRoutes === undefined ? {} : { demo: demoRoutes }),
  });

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

/**
 * Read a drop back until it has been read, the way the page does.
 *
 * Extraction is asynchronous to recording by design, so a drop is not its final
 * shape the moment it is posted — and the reply is composed a step behind even
 * that. The wait is bounded, and what it gives up on is whatever is there.
 *
 * @param base - the server.
 * @param dropId - the drop to read.
 * @param reply - the line it should end up carrying, when the check expects one.
 * @returns the drop as last read.
 */
async function readDrop(base, dropId, reply = null, attempts = 80) {
  let drop = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    drop = (await get(base, `/api/drops/${encodeURIComponent(dropId)}`)).drop;
    if (drop?.extracted === true && (reply === null || drop.reply === reply)) return drop;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return drop;
}

/** Put the library back to the preset material the way the page's button does. */
async function resetDemo(base) {
  const reset = await post(base, '/api/demo/reset');
  assert.equal(reset.status, 200, 'the demo can always start over');
}

/** What the three acts came to, as this script reads them off the wire. */
async function runThreeActs(base) {
  // Act one: the messy fragment, read back, and the moment it makes.
  const first = await post(base, '/api/drop', { body: PRESET_ACTS.drop });
  assert.equal(first.status, 200, 'a drop always succeeds');
  const readBack = await readDrop(base, first.body.id, ACT_ONE_REPLY);
  const spokeFirst = await post(base, '/api/surface', { dropId: first.body.id });

  // Act two: the question, from the "a few days later" viewpoint.
  const asked = await post(base, '/api/recall', { question: PRESET_ACTS.question, now: ASKED_AT });

  // Act three: one more feeling, and the moment that makes.
  const felt = await post(base, '/api/drop', { body: PRESET_ACTS.feeling });
  assert.equal(felt.status, 200, 'a drop always succeeds');
  const readFelt = await readDrop(base, felt.body.id);
  const spokeThird = await post(base, '/api/surface', { dropId: felt.body.id });

  return { readBack, spokeFirst: spokeFirst.body, asked: asked.body, readFelt, spokeThird: spokeThird.body };
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

console.log('end to end — the three acts on the preset material');

const dbFile = join(dir, 'demo.sqlite');
let server = await listen(dbFile);
try {
  await check('the server hands over the demo script, which is the preset material itself', async () => {
    const { demo } = await get(server.base, '/api/demo');
    assert.deepEqual(demo?.acts, PRESET_ACTS, 'all three lines, as the dataset holds them');
    // The page fills its placeholders from these, so what a presenter types is
    // the string the material reads — by construction, not by care.
    assert.equal(demo.acts.drop, '老师今天讲了期末怎么算分：平时分 40%，期末考 60%，下周三交提纲，好烦');
    assert.equal(demo.acts.question, '期末怎么算分');
    assert.equal(demo.acts.feeling, '这周总是睡不好，白天没精神，晚上躺下又清醒，有点撑不住');
  });

  await check('a demo starts from an empty library, and the reset lays the preset material down', async () => {
    const before = await get(server.base, '/api/drops');
    assert.deepEqual(before.drops, [], 'nothing was dropped before the presenter arrived');

    const reset = await post(server.base, '/api/demo/reset');
    assert.equal(reset.status, 200);
    assert.deepEqual(reset.body.demo.acts, PRESET_ACTS, 'and it hands the script back for the page');

    const after = await get(server.base, '/api/drops');
    assert.deepEqual(
      after.drops.map((drop) => drop.body),
      LEADS,
      'the leads are ordinary drops, in the order the demo lays them down',
    );
    assert.ok(after.drops.every((drop) => drop.extracted), 'each already read, so act one does not race them');
    assert.ok(
      after.drops.every((drop) => drop.reply.trim().length > 0),
      'and each already answered in the product\'s own voice',
    );
    assert.deepEqual((await get(server.base, '/api/conclusions')).conclusions, [], 'nothing has crossed yet');
  });

  await check('act one: the messy fragment splits into an item and a record, and the moment speaks', async () => {
    await resetDemo(server.base);
    const acts = await runThreeActs(server.base);

    assert.equal(acts.readBack.body, PRESET_ACTS.drop, 'the record is the original, verbatim');
    assert.equal(acts.readBack.items.length, 1, 'one item, and no type or time was asked of the user');
    assert.equal(acts.readBack.items[0].text, ACT_ONE_ITEM);
    assert.equal(new Date(acts.readBack.items[0].dueAt).getDay(), 3, 'the Wednesday the words named');
    assert.deepEqual(acts.readBack.terms.map((term) => term.text), ACT_ONE_TERMS);
    assert.equal(acts.readBack.reply, ACT_ONE_REPLY, 'answered on the spot, in the parent voice');

    assert.equal(acts.spokeFirst.kind, 'surfaced');
    assert.equal(acts.spokeFirst.tier, 'weak');
    assert.equal(acts.spokeFirst.text, ACT_ONE_LINE, 'the uncertain register is code\'s, in front of the sentence');
    assert.deepEqual(
      acts.spokeFirst.support.map((term) => term.text),
      ['下周三交提纲', '好烦', '期末怎么算分', '平时分 40%', '期末考 60%'],
      'with every preset word behind it on the wire',
    );
  });

  await check('act two: the question is answered and the answer names the drop it came from', async () => {
    await resetDemo(server.base);
    const acts = await runThreeActs(server.base);

    assert.equal(acts.asked.kind, 'answered');
    const left = daysLeft(acts.asked.answer);
    assert.equal(acts.asked.sources.length, 1, 'one source, and it is the fragment just dropped');
    assert.equal(acts.asked.sources[0].body, PRESET_ACTS.drop, 'quoted verbatim so it can be checked');

    // The pinned basis is what makes "a few days later" observable at all: the
    // same question from a nearer moment leaves exactly one day less. A property
    // rather than a literal, so the check does not hang on which timezone the
    // material's Wednesday was resolved in.
    const nearer = await post(server.base, '/api/recall', {
      question: PRESET_ACTS.question,
      now: '2026-09-21T01:00:00.000Z',
    });
    assert.equal(daysLeft(nearer.body.answer), left - 1, 'the viewpoint moves the deadline it names');
  });

  await check('act three: one more feeling surfaces its own conclusion, on the preset words', async () => {
    await resetDemo(server.base);
    const acts = await runThreeActs(server.base);

    assert.equal(acts.spokeThird.kind, 'surfaced', 'the second matter speaks for itself');
    assert.equal(acts.spokeThird.tier, 'weak');
    assert.equal(acts.spokeThird.text, ACT_THREE_LINE);
    assert.deepEqual(acts.spokeThird.support.map((term) => term.text), ACT_THREE_TERMS);
    assert.equal(acts.spokeThird.mentions, 3, 'twice in the leads, once by the act');
    assert.notEqual(acts.spokeThird.text, ACT_ONE_LINE, 'and it is not the first act\'s line said again');

    const conclusions = (await get(server.base, '/api/conclusions')).conclusions;
    assert.equal(conclusions.length, 2, 'two matters judged, each with its own sentence');
  });

  await check('the acts run again after the reset, and come back the same', async () => {
    await resetDemo(server.base);
    const first = await runThreeActs(server.base);
    const reset = await post(server.base, '/api/demo/reset');
    assert.equal(reset.status, 200);
    const second = await runThreeActs(server.base);

    // The two runs' ids differ; everything a presenter would read does not.
    const shape = (acts) => ({
      item: acts.readBack.items[0].text,
      due: acts.readBack.items[0].dueAt,
      terms: acts.readBack.terms.map((term) => term.text),
      reply: acts.readBack.reply,
      first: acts.spokeFirst.text,
      firstSupport: acts.spokeFirst.support.map((term) => term.text),
      answer: acts.asked.answer,
      sources: acts.asked.sources.map((source) => source.body),
      third: acts.spokeThird.text,
      thirdSupport: acts.spokeThird.support.map((term) => term.text),
    });
    assert.deepEqual(shape(second), shape(first), 'same material, same chain, same lines — no luck involved');
  });

  await check('the page is told which part of the data leaves this machine', async () => {
    const { boundary } = await get(server.base, '/api/privacy');
    assert.deepEqual(boundary.leaves, [], 'demo mode: nothing leaves this machine, and that is stated');
    assert.ok(boundary.stays.length >= 2, 'and what stays is spelled out');
    assert.ok(
      boundary.stays.some((line) => line.includes('不联网')),
      'the stand-in answers from a table, which is a stronger statement than "the model is local"',
    );

    // The disclosure is about data, and a key must not be part of it.
    assert.ok(!/sk-|API_KEY|apiKey/.test(JSON.stringify(boundary)), 'no credential crosses the wire');
  });

  await check('a real server says the cloud model is what leaves, and names it', async () => {
    const realFile = join(dir, 'real.sqlite');
    const real = await listen(realFile, { demo: false });
    try {
      const { boundary } = await get(real.base, '/api/privacy');
      assert.ok(
        boundary.leaves.some((line) => line.includes('api.deepseek.com') && line.includes('deepseek-flash')),
        'the endpoint and the model, so the user can check it',
      );
      assert.ok(
        boundary.leaves.some((line) => line.includes('投递原文')),
        'and which part of what they said goes there',
      );
      assert.ok(
        boundary.stays.some((line) => line.includes('embedding')),
        'while the embedding is said to stay local',
      );
      assert.ok(!/sk-not-used/.test(JSON.stringify(boundary)), 'and the key itself is never quoted');
    } finally {
      await real.close();
    }
  });

  await check('the demo\'s routes do not exist on a server started for real', async () => {
    const realFile = join(dir, 'real-two.sqlite');
    const real = await listen(realFile, { demo: false });
    try {
      const demo = await get(real.base, '/api/demo');
      assert.equal(demo.demo, null, 'the page is told there is no script rather than shown a broken one');

      // There is no request shape that empties the library on a server somebody
      // is using for real. Not a 400, not a no-op: the route is not there.
      const reset = await post(real.base, '/api/demo/reset');
      assert.equal(reset.status, 404, 'emptying everything is a demo\'s own route, and only a demo\'s');
    } finally {
      await real.close();
    }
  });

  await check('a server that was not told its boundary says so rather than saying "nothing leaves"', async () => {
    const quietFile = join(dir, 'quiet.sqlite');
    const quiet = await listen(quietFile, { demo: false, boundary: false });
    try {
      const response = await fetch(`${quiet.base}/api/privacy`);
      assert.equal(response.status, 404, 'an unread disclosure is not a disclosure');
    } finally {
      await quiet.close();
    }
  });

  await check('nothing the demo does goes off this machine', async () => {
    // Every act above has been run several times by now, and the only requests
    // made were to this script's own loopback server. This is the structural
    // half of "the demo needs no network": the sentence on the page says it, and
    // this says the code does it.
    assert.deepEqual(leftTheMachine, [], 'the preset provider answered from a table, not from a network');
  });

  await check('the whole demo needs no account, and offers no push or reminder', async () => {
    // Nothing in this script has carried a credential, and every call above has
    // been answered. The negative claims are pinned by **name and method**: none
    // of these is an operation, so a later ticket that added a signup form or a
    // reminder would have to add a route, and this is what would notice.
    for (const path of ['/api/signup', '/api/login', '/api/push', '/api/remind']) {
      const posted = await post(server.base, path);
      assert.equal(posted.status, 405, `POST ${path} is not a route this server has`);
      const fetched = await fetch(`${server.base}${path}`);
      assert.equal(fetched.status, 404, `GET ${path} is not a page and not a route`);
    }
  });
} finally {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exitCode = 1;
