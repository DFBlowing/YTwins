/*
 * End-to-end check of **revising a conclusion** — marking one wrong, and writing
 * a sentence beside it — over real HTTP.
 *
 * Runs the real server handler against a real SQLite file with a scripted
 * provider, so it exercises what the domain tests cannot: the two routes the page
 * actually calls, the JSON that comes back over the wire, the refusal of
 * everything else under that path, and whether a correction is still a correction
 * after a restart.
 *
 * The claims that matter here are the ones about what did **not** happen, because
 * this ticket is the one place the user can disagree with the product:
 *
 *  - Marking a conclusion wrong does not rewrite, invalidate or delete it. The
 *    sentence, its evidence and its place on the chain are all still there
 *    afterwards, byte for byte — the chain only grows.
 *  - The record added is code's own plain line about what the user did, with no
 *    model involved and no scaffolding on the wire.
 *  - A sentence written beside a conclusion is a **drop**: stored word for word,
 *    read for its own terms, and settled into that same chain.
 *  - There is no rating, no like and no bulk answer — the API has no shape for
 *    one and the page the user actually reads never offers one.
 *
 *   node tools/e2e-ticket-10.mjs
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDomain } from '../src/domain/core.ts';
import { DEFAULT_CONCLUSION_POLICY } from '../src/domain/conclusions.ts';
import { createFakeProvider } from '../src/domain/fake-provider.ts';
import { openSqliteStore } from '../src/domain/sqlite-store.ts';
import { createHandler } from '../src/web/server.ts';

/** One matter, said three times, in the demo's own material. */
const MIXED = '老师今天讲了期末怎么算分，下周三交提纲，好烦';
const OUTLINE = '今天又在改提纲，好烦';
const PERCENT = '平时分那 40% 到底怎么算，好烦';
/** The sentence the user writes beside the conclusion, in their own words. */
const NOTE = '期末考那一项到底考什么，好烦';

/** Every term the three fragments contributed, in the order they were said. */
const SUPPORT = ['期末怎么算分', '下周三交提纲', '好烦', '改提纲', '平时分 40%'];

/** What the stand-in says about the matter it is asked to phrase. */
const SENTENCE = '你最近好像有几件事堆在一起';
const LINE = `我不太确定：${SENTENCE}。`;
/** What code writes into the chain when the user rejects that line. */
const CORRECTION = '你标了这条不对。';

const READINGS = {
  [MIXED]: { terms: ['期末怎么算分', '下周三交提纲', '好烦'], anchor: '好烦' },
  [OUTLINE]: { terms: ['改提纲', '好烦'], anchor: '好烦' },
  [PERCENT]: { terms: ['平时分 40%', '好烦'], anchor: '好烦' },
  [NOTE]: { terms: ['期末考', '好烦'], anchor: '好烦' },
};

function provider() {
  const extractByBody = {};
  for (const [body, reading] of Object.entries(READINGS)) {
    extractByBody[body] = {
      kind: 'read',
      reading: { inputType: 'emotion', items: [], terms: reading.terms, anchor: reading.anchor },
    };
  }
  return createFakeProvider({
    extractByBody,
    composeConclusionByAnchor: { 好烦: { kind: 'sentence', text: SENTENCE } },
  });
}

/**
 * The policy this script pins.
 *
 * Built from the **shipped default** rather than restated, because what is being
 * checked here is the wire and not the numbers: the one dial it moves is the
 * judgement timing, so a conclusion appears on the drop's count rather than
 * minutes later. Everything else is what a real server runs, so a default that
 * broke this behaviour would break this script too.
 */
function policy() {
  return { ...DEFAULT_CONCLUSION_POLICY, judgeTiming: 'count' };
}

const dir = mkdtempSync(join(tmpdir(), 'ytwins-e2e-revision-'));
const dbFile = join(dir, 'ytwins.sqlite');

/** Start a real server on an ephemeral port, backed by the given database. */
async function listen(dbPath) {
  const store = openSqliteStore(dbPath);
  const domain = createDomain({ store, provider: provider(), conclusionPolicy: policy() });
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

const get = async (base, path) => {
  const response = await fetch(`${base}${path}`);
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: text };
  }
};
const post = async (base, path, payload) => {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
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

/** Poll the portrait the way the page does, until it has `count` records. */
async function pollConclusions(base, count, attempts = 60) {
  let conclusions = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    conclusions = (await get(base, '/api/conclusions')).body.conclusions;
    if (conclusions.length >= count) return conclusions;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return conclusions;
}

/** Drop one fragment and wait for its reading to land, so the next step sees it. */
async function dropAndSettle(base, body) {
  const created = await post(base, '/api/drop', { body });
  assert.equal(created.status, 200, 'the drop itself always succeeds');
  const id = created.body.id;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const { body: payload } = await get(base, `/api/drops/${id}`);
    if (payload.drop?.extracted === true) return id;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`the reading for ${body} never landed`);
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

console.log('end to end — revising a conclusion');

let server = await listen(dbFile);
// Kept outside the `try` so the last phase can act on them from a second process.
let openedId;
let correctionId;
let noteDropId;

try {
  await check('the material settles into exactly one conclusion', async () => {
    await dropAndSettle(server.base, MIXED);
    await dropAndSettle(server.base, OUTLINE);
    await dropAndSettle(server.base, PERCENT);

    const conclusions = await pollConclusions(server.base, 1);
    assert.equal(conclusions.length, 1, 'one matter crossed, so one conclusion exists');
    assert.equal(conclusions[0].text, LINE, 'with the band frame code writes in front of it');
    openedId = conclusions[0].id;
  });

  await check('marking it wrong adds the correction beside it, and rewrites nothing', async () => {
    const marked = await post(server.base, `/api/conclusions/${openedId}/wrong`);
    assert.equal(marked.status, 200, 'the tap is accepted');
    const correction = marked.body.conclusion;

    assert.equal(correction.kind, 'correction', 'it is a record of the act, not a judgement');
    assert.equal(correction.text, CORRECTION, 'in code\'s own words');
    assert.equal(correction.tier, null, 'and it asserts nothing, so it has no band');
    assert.equal(correction.relation, 'overturn', 'it overturns what came before it');
    assert.equal(correction.supersedes.id, openedId, 'and names which record that was');
    assert.equal(correction.supersedes.text, LINE);
    assert.deepEqual(correction.support, [], 'nothing supports it: the tap is the ground');
    correctionId = correction.id;

    const conclusions = await pollConclusions(server.base, 2);
    assert.equal(conclusions.length, 2, 'the chain grew by one and only one');
    const [before, after] = conclusions;
    assert.equal(before.id, openedId, 'the rejected record is still on the chain');
    assert.equal(before.text, LINE, 'not rewritten');
    assert.deepEqual(
      before.support.map((term) => term.text),
      SUPPORT,
      'and its evidence is exactly what it was assembled from',
    );
    assert.equal(before.supersededBy.id, correctionId, 'the chain reads forwards too');
    assert.equal(after.id, correctionId);
  });

  await check('nothing of the scaffolding crosses the wire with a correction', async () => {
    const { body } = await get(server.base, '/api/conclusions');
    // The shape the page is handed, spelled out: a record is a sentence, how
    // firmly it may speak, where it sits on the chain, and what it was read off.
    // The sentence the provider wrote and the matter it came out of are the
    // product's own business, and are not here.
    assert.deepEqual(
      Object.keys(body.conclusions[0]).sort(),
      [
        'averageStrength',
        'createdAt',
        'id',
        'kind',
        'mentions',
        'relation',
        'softened',
        'spanDays',
        'supersededBy',
        'supersedes',
        'support',
        'text',
        'tier',
      ],
      'the record is the product\'s own shape, with nothing of the scaffolding',
    );

    const payload = JSON.stringify(body);
    assert.ok(!/matter|anchorTermId|pinned/.test(payload), 'no matter, and no pin');
    assert.ok(!/vector/.test(payload), 'no embedding');
    assert.ok(!/origin_drop_id|avg_strength|term_id/.test(payload), 'no column names');
  });

  await check('the same tap twice is the same fact, not two records', async () => {
    const again = await post(server.base, `/api/conclusions/${openedId}/wrong`);
    assert.equal(again.status, 200);
    assert.equal(again.body.conclusion.id, correctionId, 'the same correction comes back');

    const conclusions = await pollConclusions(server.base, 2);
    assert.equal(conclusions.length, 2, 'and the chain did not grow again');
  });

  await check('marking something that is not there is refused, not invented', async () => {
    const missing = await post(server.base, '/api/conclusions/no-such-conclusion/wrong');
    // A 404 rather than a 200 with nothing: the client asked about a specific
    // record, so there is no honest page state for "it is gone".
    assert.equal(missing.status, 404, 'there is no such conclusion to reject');
    assert.equal((await pollConclusions(server.base, 2)).length, 2, 'and nothing was written');
  });

  await check('the product\'s own note of what the user did cannot be rejected', async () => {
    const refused = await post(server.base, `/api/conclusions/${correctionId}/wrong`);
    // A correction is a fact about the user rather than a reading of them, so
    // there is nothing in it to disagree with — refused by the domain, not only
    // by the page that never offers the button.
    assert.equal(refused.status, 404, 'no record was added for it');
    assert.equal((await pollConclusions(server.base, 2)).length, 2, 'and the chain did not grow');
  });

  await check('a note beside a conclusion is a drop, kept word for word', async () => {
    const written = await post(server.base, `/api/conclusions/${openedId}/append`, { body: NOTE });
    assert.equal(written.status, 200, 'the note is accepted');
    const { addition } = written.body;

    assert.equal(addition.conclusion.id, openedId, 'it says what it was written beside');
    assert.equal(addition.conclusion.text, LINE);
    assert.equal(addition.drop.body, NOTE, 'the wording is kept byte for byte');
    assert.ok(addition.drop.reply.trim().length > 0, 'and it is answered like any other drop');
    noteDropId = addition.drop.id;

    const drops = (await get(server.base, '/api/drops')).body.drops;
    const stored = drops.find((drop) => drop.id === noteDropId);
    assert.ok(stored !== undefined, 'and it is a drop in the list like any other');
    assert.equal(stored.body, NOTE);
    assert.deepEqual(
      stored.terms.map((term) => term.text),
      ['期末考', '好烦'],
      'with its own terms read out of it',
    );
  });

  await check('the note enters the same chain, and settles there', async () => {
    const conclusions = await pollConclusions(server.base, 3);
    assert.equal(conclusions.length, 3, 'what the note added crossed the threshold');
    const [, correction, newest] = conclusions;
    assert.equal(correction.id, correctionId, 'the correction is where it was');
    assert.equal(newest.relation, 'inherit');
    assert.equal(
      newest.supersedes.id,
      correctionId,
      'and it carries on from the correction, because that is where the matter stands',
    );
    assert.ok(
      newest.support.map((term) => term.text).includes('期末考'),
      'with the note\'s own words behind it',
    );
  });

  await check('an empty note is refused rather than stored as a blank drop', async () => {
    const before = (await get(server.base, '/api/drops')).body.drops.length;
    const blank = await post(server.base, `/api/conclusions/${openedId}/append`, { body: '   ' });
    assert.equal(blank.status, 400, 'there is nothing to write');
    assert.equal(
      (await get(server.base, '/api/drops')).body.drops.length,
      before,
      'and no drop was written for it',
    );
  });

  await check('there is no way to rate, like or bulk-answer a conclusion', async () => {
    // Plausible names for the feature this product does not have, and one bulk
    // shape — every one of them is refused rather than quietly accepted and
    // ignored. A 405 is the honest answer: there is no such operation.
    for (const path of [
      `/api/conclusions/${openedId}/rate`,
      `/api/conclusions/${openedId}/like`,
      `/api/conclusions/${openedId}/score`,
      `/api/conclusions/${openedId}/vote`,
      `/api/conclusions/${openedId}/favorite`,
      '/api/rate',
      '/api/bulk',
    ]) {
      const refused = await post(server.base, path, { score: 5 });
      assert.equal(refused.status, 405, `${path} is not an operation`);
    }
    // The two operations take **one** conclusion, named in the path: there is no
    // request shape that carries a list, and this is how that is checked rather
    // than asserted.
    const bulk = await post(server.base, '/api/conclusions/wrong', { ids: [openedId] });
    assert.notEqual(bulk.status, 200, 'a list of conclusions is not something to act on');

    // And the page the user reads never offers one. What such an entry point
    // would be labelled with, checked against everything the page is built from.
    const page = ['index.html', 'main.ts', 'style.css']
      .map((name) =>
        readFileSync(fileURLToPath(new URL(`../src/web/${name}`, import.meta.url)), 'utf8'),
      )
      .join('\n');
    for (const word of ['打分', '评分', '点赞', '星级', '好评', '差评', '五星']) {
      assert.ok(!page.includes(word), `the page never offers 「${word}」`);
    }
  });
} finally {
  await server.close();
}

// A second process against the same file: what the user said about the product's
// own record, from disk.
server = await listen(dbFile);
try {
  await check('what was corrected is still corrected after a restart', async () => {
    const conclusions = await pollConclusions(server.base, 3);
    assert.equal(conclusions.length, 3, 'every record is on disk');
    const [opened, correction, newest] = conclusions;

    assert.equal(opened.text, LINE, 'the rejected line, unchanged');
    assert.equal(opened.supersededBy.id, correction.id, 'still overturned, and by the same record');
    assert.equal(correction.kind, 'correction', 'the correction is a correction on disk too');
    assert.equal(correction.relation, 'overturn', 'and so is its relation');
    assert.equal(correction.supersedes.id, opened.id);
    assert.equal(newest.supersedes.id, correction.id, 'and the note still entered that chain');

    const drops = (await get(server.base, '/api/drops')).body.drops;
    assert.ok(
      drops.some((drop) => drop.id === noteDropId && drop.body === NOTE),
      'the note is still there word for word',
    );
  });
} finally {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exitCode = 1;
