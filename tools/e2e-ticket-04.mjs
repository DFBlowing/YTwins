/*
 * End-to-end check of the drop → terms → links chain over real HTTP.
 *
 * Runs the real server handler against a real SQLite file with a scripted
 * provider, so it exercises what the domain tests cannot: the JSON the page
 * actually receives, the poll-after-drop path where a drop's terms show up, and
 * whether the terms and the links between them are still there after a restart.
 *
 * The claim under test is partly a negative one: the embeddings that decide the
 * semantic links are how the domain reasons, and none of them may cross the wire
 * to the page.
 *
 *   node tools/e2e-ticket-04.mjs
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDomain } from '../src/domain/core.ts';
import { createFakeProvider } from '../src/domain/fake-provider.ts';
import { openSqliteStore } from '../src/domain/sqlite-store.ts';
import { createHandler } from '../src/web/server.ts';

/** Two fragments from one act-one drop, and two later ones that connect to it. */
const MIXED = '老师今天讲了期末怎么算分，下周三交提纲，好烦';
const GUITAR = '最近老想着要不要报个吉他班';
const INSTRUMENT = '想学门乐器，先看看钢琴';

const MIXED_TERMS = ['期末怎么算分', '下周三交提纲', '好烦'];

/**
 * Vectors that put each pair in the band the check wants.
 *
 * Only the last pair is close enough to matter: 想学吉他 and 想学门乐器 sit at a
 * cosine of 0.855, which is inside the **calibrated** grey zone (ticket 14 put the
 * bands at 0.85/0.87), so that link can only come from the judge. Everything the
 * mixed fragment said is orthogonal or opposite to them, so those pairs must stay
 * unlinked.
 *
 * The 0.8 this pair used to sit at is below the unrelated gate now, so nothing
 * would be judged and the check would fail for a reason that has nothing to do
 * with linking — the same fixture move ticket 14 made in `domain.test.ts`, for
 * the same reason. Repaired in ticket 15, which found the script red.
 */
function atCosine(score) {
  return [score, Math.sqrt(1 - score ** 2)];
}

const VECTORS = {
  想学吉他: [1, 0],
  想学门乐器: atCosine(0.855),
  期末怎么算分: [0, 1],
  下周三交提纲: [0, 1],
  好烦: [-1, 0],
};

function provider() {
  const fake = createFakeProvider({
    extractByBody: {
      [MIXED]: {
        kind: 'read',
        reading: { inputType: 'emotion', items: [], terms: MIXED_TERMS },
      },
      [GUITAR]: { kind: 'read', reading: { inputType: 'idea', items: [], terms: ['想学吉他'] } },
      [INSTRUMENT]: { kind: 'read', reading: { inputType: 'idea', items: [], terms: ['想学门乐器'] } },
    },
    embedByText: Object.fromEntries(
      Object.entries(VECTORS).map(([text, vector]) => [text, { kind: 'vectors', vectors: [vector] }]),
    ),
    judgeLinkFallback: { kind: 'verdict', related: true },
  });
  return fake;
}

const dir = mkdtempSync(join(tmpdir(), 'ytwins-e2e-links-'));
const dbFile = join(dir, 'ytwins.sqlite');

/** Start a real server on an ephemeral port, backed by the given database. */
async function listen(dbPath) {
  const store = openSqliteStore(dbPath);
  const domain = createDomain({ store, provider: provider() });
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
const post = async (base, path, payload) =>
  (
    await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  ).json();

/** Poll one drop the way the page does, until its terms have been read out. */
async function pollTerms(base, dropId, expected, attempts = 40) {
  let drop = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    drop = (await get(base, `/api/drops/${dropId}`)).drop;
    if (drop.terms.length >= expected) return drop;
    await new Promise((r) => setTimeout(r, 25));
  }
  return drop;
}

/** The link between two terms, whichever way round the API reports the pair. */
function linkBetween(links, a, b) {
  return links.find(
    (link) =>
      (link.from.text === a && link.to.text === b) || (link.from.text === b && link.to.text === a),
  );
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

console.log('end to end — what a drop connects');

let server = await listen(dbFile);
try {
  await check('a drop reads back with the terms it said, in the user\'s own words', async () => {
    const created = await post(server.base, '/api/drop', { body: MIXED });
    const drop = await pollTerms(server.base, created.id, MIXED_TERMS.length);

    assert.deepEqual(
      drop.terms.map((term) => term.text),
      MIXED_TERMS,
      'the wording crossed the wire as the user said it',
    );
    assert.deepEqual(
      Object.keys(drop.terms[0]).sort(),
      ['dropId', 'firstSeenAt', 'id', 'text'],
      'and no vector crossed it with them',
    );
  });

  await check('terms said in one drop are linked, with the reason readable', async () => {
    const { links } = await get(server.base, '/api/links');
    // Four terms said together would be six pairs; this fragment said three.
    assert.equal(links.length, 3, 'every pair of terms in the fragment is linked');
    assert.ok(
      links.every((link) => link.kind === 'same-drop'),
      'all three are the zero-model kind',
    );
    assert.ok(
      links.every((link) => link.strength === 1 && link.reason.length > 0),
      'each one carries its strength and why it exists',
    );
    assert.ok(
      links.every((link) => link.from.text.length > 0 && link.to.text.length > 0),
      'and both ends are named, so the page can render it without another lookup',
    );
  });

  await check('the page is never handed an embedding over the API', async () => {
    const payload = JSON.stringify(await get(server.base, '/api/drops'));
    assert.ok(!/vector/.test(payload), 'no vector crosses the wire');
    assert.ok(!/origin_drop_id|first_seen_at/.test(payload), 'nor any storage column name');
  });

  await check('a later fragment links to an earlier one by similarity, and it says so', async () => {
    const created = await post(server.base, '/api/drop', { body: GUITAR });
    await pollTerms(server.base, created.id, 1);
    await post(server.base, '/api/drop', { body: INSTRUMENT });
    let links = [];
    for (let attempt = 0; attempt < 40; attempt += 1) {
      links = (await get(server.base, '/api/links')).links;
      if (linkBetween(links, '想学吉他', '想学门乐器') !== undefined) break;
      await new Promise((r) => setTimeout(r, 25));
    }

    const link = linkBetween(links, '想学吉他', '想学门乐器');
    assert.ok(link !== undefined, 'the grey pair was judged and connected');
    assert.equal(link.kind, 'similar', 'as the semantic kind');
    assert.match(link.reason, /灰区/, 'and the reason says it was judged rather than scored');
    assert.ok(link.strength > 0.85 && link.strength < 0.87, 'its strength is the score it got');

    assert.equal(
      linkBetween(links, '想学吉他', '期末怎么算分'),
      undefined,
      'nothing far apart was linked along the way',
    );
    assert.equal(links.length, 4, 'three hard edges and one judged one, and no more');
  });
} finally {
  await server.close();
}

// A fresh server against the same file: what the terms and links do across a restart.
server = await listen(dbFile);
try {
  await check('terms and links survive a restart', async () => {
    const { drops } = await get(server.base, '/api/drops');
    assert.equal(drops.length, 3, 'every drop is still there');
    assert.deepEqual(
      drops[0].terms.map((term) => term.text),
      MIXED_TERMS,
      'including the terms the first one said',
    );

    const { links } = await get(server.base, '/api/links');
    assert.equal(links.length, 4, 'and so are the links between them');
    assert.ok(
      linkBetween(links, '想学吉他', '想学门乐器') !== undefined,
      'the judged link included',
    );
  });
} finally {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exitCode = 1;
