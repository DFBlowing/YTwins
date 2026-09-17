/*
 * End-to-end check of the visible moment — **surfacing** — over real HTTP.
 *
 * Runs the real server handler against a real SQLite file with a scripted
 * provider, so it exercises what the domain tests cannot: the JSON the page
 * actually receives for a surfacing, the two triggers as the server routes them,
 * and whether the **cooldown** is still in force after a restart.
 *
 * Three of the claims are negative ones, and they are the point of the ticket:
 *
 *  - A drop that carries no feeling is not a moment, and the answer says so
 *    rather than going quiet by accident.
 *  - The same topic is not surfaced twice inside seven days — checked across a
 *    restart, so it is the record on disk doing the work.
 *  - Nothing of the scaffolding a conclusion was assembled from crosses the wire.
 *
 *   node tools/e2e-ticket-06.mjs
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

/** One matter, said three times, in the demo's own material. */
const MIXED = '老师今天讲了期末怎么算分，下周三交提纲，好烦';
const OUTLINE = '今天又在改提纲，好烦';
const PERCENT = '平时分那 40% 到底怎么算，好烦';
/** A fourth mention, arriving after the restart, bringing a word that is new. */
const FINAL = '期末考那一项到底考什么，好烦';
/** A fragment with nothing to feel about it: not a moment to speak at all. */
const NEUTRAL = '想把论文改成开题报告，先问问导师';

const MIXED_TERMS = ['期末怎么算分', '下周三交提纲', '好烦'];
const OUTLINE_TERMS = ['改提纲', '好烦'];
const PERCENT_TERMS = ['平时分 40%', '好烦'];
const FINAL_TERMS = ['期末考', '好烦'];

/** Every term the three fragments contributed, in the order they were said. */
const SUPPORT = ['期末怎么算分', '下周三交提纲', '好烦', '改提纲', '平时分 40%'];

/** The weak band's reading of that sentence — the frame is the product's. */
const SURFACED_TEXT = '我不太确定：你最近好像有几件事堆在一起。';

/** What the stand-in says about each feeling it is asked to phrase. */
const SENTENCE_BY_FEELING = {
  好烦: { kind: 'sentence', text: '你最近好像有几件事堆在一起' },
};

function provider() {
  return createFakeProvider({
    extractByBody: {
      [MIXED]: {
        kind: 'read',
        reading: { inputType: 'emotion', items: [], terms: MIXED_TERMS, anchor: '好烦' },
      },
      [OUTLINE]: {
        kind: 'read',
        reading: { inputType: 'emotion', items: [], terms: OUTLINE_TERMS, anchor: '好烦' },
      },
      [PERCENT]: {
        kind: 'read',
        reading: { inputType: 'emotion', items: [], terms: PERCENT_TERMS, anchor: '好烦' },
      },
      [FINAL]: {
        kind: 'read',
        reading: { inputType: 'emotion', items: [], terms: FINAL_TERMS, anchor: '好烦' },
      },
      [NEUTRAL]: {
        kind: 'read',
        reading: { inputType: 'decision', items: [], terms: ['开题报告'], anchor: '开题报告' },
      },
    },
    composeConclusionByAnchor: SENTENCE_BY_FEELING,
  });
}

/**
 * The policy the checks pin.
 *
 * Built from the **shipped default** rather than restated, unlike the domain
 * tests (which spell theirs out so a check fails when a rule changes): what this
 * script is about is the wire, not the numbers, and the one dial it moves is the
 * judgement timing — phase one waits for the quiet window, so only the
 * surfacing's own on-the-spot judgement can produce a sentence. The rest is what
 * a real server runs.
 */
function policy(judgeTiming) {
  return { ...DEFAULT_CONCLUSION_POLICY, judgeTiming };
}

const dir = mkdtempSync(join(tmpdir(), 'ytwins-e2e-surfacing-'));
const dbFile = join(dir, 'ytwins.sqlite');

/** Start a real server on an ephemeral port, backed by the given database. */
async function listen(dbPath, judgeTiming) {
  const store = openSqliteStore(dbPath);
  const domain = createDomain({
    store,
    provider: provider(),
    conclusionPolicy: policy(judgeTiming),
    // The dice are pinned to their first face here, and only here: a surfacing
    // carries one of its band's openings, so the wording would otherwise differ
    // between runs of this script. What the real server runs is `Math.random`;
    // that the roll makes a difference is checked in the domain tests, and this
    // script is about the wire.
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

console.log('end to end — the one line the product speaks first');

// Phase one: the fragments arrive with nobody looking, and then a question is
// asked of the material. The question is the moment that judges on the spot.
let server = await listen(dbFile, 'quiet');
try {
  await check('three fragments arrive without anything being settled yet', async () => {
    for (const body of [MIXED, OUTLINE, PERCENT]) {
      const created = await post(server.base, '/api/drop', { body });
      assert.equal(created.status, 200, 'the drop itself always succeeds');
    }
    // Long enough for the reading and the attachment to land, and far short of
    // the quiet window: nothing has been judged.
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.deepEqual((await get(server.base, '/api/conclusions')).conclusions, []);
  });

  await check('a question judges on the spot and surfaces one conclusion', async () => {
    const attempt = await post(server.base, '/api/surface', {});
    assert.equal(attempt.status, 200, 'zero answers are ordinary, not errors');

    const surfaced = attempt.body;
    assert.equal(surfaced.kind, 'surfaced', 'something had settled, so something was shown');
    assert.equal(surfaced.text, SURFACED_TEXT, 'the sentence is the provider\'s, the frame is the product\'s');
    assert.equal(surfaced.tier, 'weak', 'said in one sitting, so it is hedged');
    assert.equal(surfaced.mentions, 3);
    assert.equal(surfaced.spanDays, 0);
    assert.deepEqual(surfaced.support.map((term) => term.text), SUPPORT, 'in the user\'s own words');
    assert.ok(Number.isFinite(Date.parse(surfaced.surfacedAt)));

    // What crossed the wire is the conclusion the portrait holds — plus the
    // numbers its wording was read off, and nothing of the scaffolding.
    const { conclusions } = await get(server.base, '/api/conclusions');
    assert.equal(conclusions.length, 1);
    assert.equal(surfaced.conclusion.id, conclusions[0].id);
    assert.equal(surfaced.conclusion.text, conclusions[0].text);
    assert.deepEqual(
      Object.keys(surfaced).sort(),
      [
        'averageStrength',
        'conclusion',
        'kind',
        'mentions',
        'spanDays',
        'support',
        'surfacedAt',
        'text',
        'tier',
      ],
    );
    const payload = JSON.stringify(surfaced);
    assert.ok(!/vector/.test(payload), 'no embedding');
    assert.ok(!/matter|anchorTermId|term_ids/.test(payload), 'no matter or its anchor');
    assert.ok(!/origin_drop_id|first_seen_at|avg_strength|term_id/.test(payload), 'no column names');
  });

  await check('the same topic is not shown twice in one turn', async () => {
    const again = await post(server.base, '/api/surface', {});
    assert.equal(again.status, 200);
    assert.deepEqual(again.body, { kind: 'none', reason: 'cooldown' });
  });
} finally {
  await server.close();
}

// Phase two: a fresh process against the same file. The cooldown is read back
// from disk, and a drop that is not a moment is told apart from it.
server = await listen(dbFile, 'count');
try {
  await check('the cooldown survives a restart, on a matter that grew meanwhile', async () => {
    // A word the matter has not heard, so a second sentence is assembled — and
    // it is still the same thing, which is what the cooldown is about.
    const created = await post(server.base, '/api/drop', { body: FINAL });
    assert.equal(created.status, 200);
    const conclusions = await pollConclusions(server.base, 2);
    assert.equal(conclusions.length, 2, 'there is something new to say');

    const attempt = await post(server.base, '/api/surface', { dropId: created.body.id });
    assert.equal(attempt.status, 200);
    assert.deepEqual(attempt.body, { kind: 'none', reason: 'cooldown' }, 'and it has been said already');
  });

  await check('a drop with no feeling in it is not a moment', async () => {
    const created = await post(server.base, '/api/drop', { body: NEUTRAL });
    assert.equal(created.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const attempt = await post(server.base, '/api/surface', { dropId: created.body.id });
    assert.equal(attempt.status, 200);
    assert.deepEqual(attempt.body, { kind: 'none', reason: 'not-a-moment' });
  });

  await check('a drop nobody recorded is not a moment either', async () => {
    const attempt = await post(server.base, '/api/surface', { dropId: 'no-such-drop' });
    assert.equal(attempt.status, 200);
    assert.deepEqual(attempt.body, { kind: 'none', reason: 'not-a-moment' });
  });
} finally {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exitCode = 1;
