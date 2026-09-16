/*
 * End-to-end check of the drop → accumulation → conclusion chain over real HTTP.
 *
 * Runs the real server handler against a real SQLite file with a scripted
 * provider, so it exercises what the domain tests cannot: the JSON the page
 * actually receives for the **portrait**, the poll-after-drop path the page uses
 * to find a conclusion without waiting for the quiet window, and whether the
 * **chain** — a later conclusion carrying on from an earlier one — is still there
 * after a restart.
 *
 * Two of the claims are negative ones, and they are the point of the ticket:
 *
 *  - Nothing settles while the fragments are still coming in (the quiet window),
 *    which is checked by pinning a window far longer than the check and finding
 *    the portrait empty afterwards.
 *  - The **portrait is read-only**: there is no endpoint that asks the user to
 *    maintain anything, because settling needs no participation at all.
 *
 *   node tools/e2e-ticket-05.mjs
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
/** A fifth, once the chain exists: new material, so there is something to say. */
const FOLLOW_UP = '又跟同学聊到期末范围，好烦';

const MIXED_TERMS = ['期末怎么算分', '下周三交提纲', '好烦'];
const OUTLINE_TERMS = ['改提纲', '好烦'];
const PERCENT_TERMS = ['平时分 40%', '好烦'];
const FINAL_TERMS = ['期末考', '好烦'];
const FOLLOW_UP_TERMS = ['期末范围', '好烦'];

/** Every term the three fragments contributed, in the order they were said. */
const SUPPORT = ['期末怎么算分', '下周三交提纲', '好烦', '改提纲', '平时分 40%'];

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
      [FOLLOW_UP]: {
        kind: 'read',
        reading: { inputType: 'emotion', items: [], terms: FOLLOW_UP_TERMS, anchor: '好烦' },
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
 * judgement timing — phase one waits for the quiet window, phase two looks on the
 * count. The rest is what a real server runs, so a change to a default that broke
 * the demo would break this too.
 */
function policy(judgeTiming) {
  return { ...DEFAULT_CONCLUSION_POLICY, judgeTiming };
}

const dir = mkdtempSync(join(tmpdir(), 'ytwins-e2e-conclusions-'));
const dbFile = join(dir, 'ytwins.sqlite');

/** Start a real server on an ephemeral port, backed by the given database. */
async function listen(dbPath, judgeTiming) {
  const store = openSqliteStore(dbPath);
  const domain = createDomain({ store, provider: provider(), conclusionPolicy: policy(judgeTiming) });
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

console.log('end to end — what the accumulation settles into');

// Phase one: the fragments arrive, and nothing is said while they are arriving.
let server = await listen(dbFile, 'quiet');
try {
  await check('three fragments arrive without anything being settled yet', async () => {
    for (const body of [MIXED, OUTLINE, PERCENT]) {
      const created = await post(server.base, '/api/drop', { body });
      assert.equal(created.status, 200, 'the drop itself always succeeds');
    }
    // Long enough for the reading, the linking and the attachment to land.
    await new Promise((resolve) => setTimeout(resolve, 150));

    assert.deepEqual(
      (await get(server.base, '/api/conclusions')).conclusions,
      [],
      'the window is far from over, so nobody has been asked to speak',
    );
    const { links } = await get(server.base, '/api/links');
    assert.ok(links.length > 0, 'while the linking behind it did happen');
  });
} finally {
  await server.close();
}

// Phase two: the same file, a policy that looks on the count, one more mention.
server = await listen(dbFile, 'count');
try {
  await check('crossing the threshold assembles one conclusion, with its support', async () => {
    // The three fragments from before are already the crossing; the drop is what
    // makes the domain look, and the pile it looks at is all four.
    const created = await post(server.base, '/api/drop', { body: FINAL });
    assert.equal(created.status, 200);
    const conclusions = await pollConclusions(server.base, 1);

    assert.equal(conclusions.length, 1, 'one sentence, from the accumulation');
    const [conclusion] = conclusions;
    assert.equal(conclusion.kind, 'claim');
    assert.equal(conclusion.tier, 'weak', 'said in one sitting, so it is hedged');
    assert.equal(conclusion.text, '我不太确定：你最近好像有几件事堆在一起。');
    assert.equal(conclusion.relation, 'first');
    assert.equal(conclusion.supersedes, null);

    assert.deepEqual(
      conclusion.support.map((term) => term.text),
      [...SUPPORT, '期末考'],
      'every term behind it, in the user\'s own words',
    );
    assert.equal(conclusion.mentions, 4, 'and how many times it had been raised');
    assert.equal(conclusion.spanDays, 0);
    assert.ok(
      conclusion.averageStrength > 0 && conclusion.averageStrength <= 1,
      'the connection strength the band was read off is on the wire',
    );
  });

  await check('the portrait is read-only, and the page is handed nothing to maintain', async () => {
    // A write to the portrait is not "unimplemented but coming": there is no such
    // operation, because settling takes no part from the user. A 405 is the
    // honest answer, and a 200 for something that did nothing would not be.
    const written = await post(server.base, '/api/conclusions', { text: '不对' });
    assert.equal(written.status, 405, 'nothing about the portrait may be written');
  });

  await check('no scaffolding crosses the wire', async () => {
    const payload = JSON.stringify(await get(server.base, '/api/conclusions'));
    assert.ok(!/vector/.test(payload), 'no embedding');
    assert.ok(!/matter|anchorTermId|term_ids/.test(payload), 'no matter or its anchor');
    assert.ok(!/origin_drop_id|first_seen_at|avg_strength|term_id/.test(payload), 'no column names');
  });
} finally {
  await server.close();
}

// Phase three: a fresh process against the same file — the chain, from disk.
server = await listen(dbFile, 'count');
try {
  await check('the chain survives a restart, in both directions', async () => {
    // A fragment with a word the matter has not heard: that is what gives the
    // next look something to say. Saying the same thing again does not — a
    // second sentence from the same evidence would pad the chain, not grow it.
    await post(server.base, '/api/drop', { body: FOLLOW_UP });
    const conclusions = await pollConclusions(server.base, 2);

    assert.equal(conclusions.length, 2, 'the second mention is a second sentence');
    const [earlier, later] = conclusions;
    assert.equal(later.relation, 'inherit');
    assert.equal(later.supersedes.id, earlier.id, 'the chain points backwards');
    assert.equal(later.supersedes.text, earlier.text);
    assert.equal(earlier.supersededBy.id, later.id, 'and forwards');
    assert.equal(earlier.text, '我不太确定：你最近好像有几件事堆在一起。', 'nothing was rewritten');
  });
} finally {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exitCode = 1;
