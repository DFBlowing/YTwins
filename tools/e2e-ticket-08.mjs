/*
 * End-to-end check of **scheduling** — items landing on time — over real HTTP.
 *
 * Runs the real server handler against a real SQLite file with a scripted
 * provider, so it exercises what the domain tests cannot: the JSON the page
 * actually receives for the two lists, the route that advances an item's state,
 * and whether that state is still there after a restart.
 *
 * Four of the claims are the point of the ticket, and three of them are
 * negative ones:
 *
 *  - An item that came out of a drop with a time in it is placed on the
 *    timeline without the user ever typing one.
 *  - An item with no parsed time is **kept** and listed apart, never dropped.
 *  - Nothing a finished item is hidden behind leaks the other way: it is absent
 *    from the lists and still present in the record.
 *  - Neither a calendar nor conflict detection exists — there is no endpoint
 *    for either, and two things due at once are simply two things due at once.
 *
 *   node tools/e2e-ticket-08.mjs
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

/** Four fragments: one already past, two ahead, one with nothing to go on. */
const OVERDUE = '上周五该交初稿了，还没交';
const OUTLINE = '下周三交提纲';
const ADVISOR = '下周一约导师谈论文';
const UNDATED = '想去学吉他，还想去爬山';

/** And two fragments whose items fall due at the very same moment. */
const CLASH_A = '周三上午去交材料';
const CLASH_B = '周三上午顺便把表交了';

/**
 * The times each fragment is read as carrying.
 *
 * Fixed dates rather than "next Wednesday", for the same reason the demo
 * provider fixes its own: the same drop has to produce the same list on
 * whatever day this script is run.
 */
const READINGS = {
  [OVERDUE]: [{ text: '交初稿', dueAt: '2026-09-11T09:00:00.000Z' }],
  [OUTLINE]: [{ text: '交提纲', dueAt: '2026-09-23T09:00:00.000Z' }],
  [ADVISOR]: [{ text: '约导师谈论文', dueAt: '2026-09-21T01:00:00.000Z' }],
  [UNDATED]: [{ text: '学吉他', dueAt: null }],
  // Deliberately the same instant, so "no conflict detection" is a claim this
  // script can actually check rather than one it only asserts in a comment.
  [CLASH_A]: [{ text: '交材料', dueAt: '2026-09-23T01:00:00.000Z' }],
  [CLASH_B]: [{ text: '交表', dueAt: '2026-09-23T01:00:00.000Z' }],
};

/** The moment the lists are read against, pinned so the order is a literal. */
const NOW = '2026-09-20T12:00:00.000Z';

function provider() {
  const extractByBody = {};
  for (const [body, items] of Object.entries(READINGS)) {
    extractByBody[body] = { kind: 'read', reading: { inputType: 'item', items } };
  }
  return createFakeProvider({ extractByBody });
}

const dir = mkdtempSync(join(tmpdir(), 'ytwins-e2e-scheduling-'));
const dbFile = join(dir, 'ytwins.sqlite');

/** Start a real server on an ephemeral port, backed by the given database. */
async function listen(dbPath) {
  const store = openSqliteStore(dbPath);
  const domain = createDomain({ store, provider: provider(), now: () => NOW });
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

/** Poll the timeline the way the page does, until it has `count` dated items. */
async function pollDue(base, count, attempts = 60) {
  let due = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    due = (await get(base, '/api/upcoming')).due;
    if (due.length >= count) return due;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return due;
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

console.log('end to end — items landing on time');

let server = await listen(dbFile);
try {
  await check('every fragment is caught, and the reading lands behind it', async () => {
    for (const body of [OVERDUE, OUTLINE, ADVISOR, UNDATED, CLASH_A, CLASH_B]) {
      const created = await post(server.base, '/api/drop', { body });
      assert.equal(created.status, 200, 'the drop itself always succeeds');
    }
    const due = await pollDue(server.base, 5);
    assert.equal(due.length, 5, 'five of the six carry a time the user never typed');
  });

  await check('the timeline is ordered by the dates, soonest first', async () => {
    const { due } = await get(server.base, '/api/upcoming');
    assert.deepEqual(
      due.map((item) => item.text),
      ['交初稿', '约导师谈论文', '交材料', '交表', '交提纲'],
      'sorted by moment, and the one already past leads rather than falling off',
    );
    assert.ok(
      due.every((item) => item.state === 'todo'),
      'everything caught is still to do until somebody says otherwise',
    );
    assert.ok(
      due.every((item) => Number.isFinite(Date.parse(item.dueAt))),
      'every dated entry carries a usable time',
    );
  });

  await check('the two things due at the same moment are simply two things due', async () => {
    const { due } = await get(server.base, '/api/upcoming');
    const clashing = due.filter((item) => item.dueAt === '2026-09-23T01:00:00.000Z');
    assert.equal(clashing.length, 2, 'nothing was merged and nothing was refused');
    assert.ok(
      !due.some((item) => 'conflict' in item || 'overlap' in item),
      'no conflict is reported, because none is detected',
    );
  });

  await check('an item with no parsed time is listed apart, and never dropped', async () => {
    const upcoming = await get(server.base, '/api/upcoming');
    assert.deepEqual(
      upcoming.unscheduled.map((item) => item.text),
      ['学吉他'],
      'kept, and kept apart from anything with a date',
    );
    assert.equal(upcoming.unscheduled[0].dueAt, null, 'and no date was invented for it');

    // The record keeps it too: being off the timeline is not being gone.
    const { items } = await get(server.base, '/api/items');
    assert.equal(items.length, 6, 'all six items exist, on a date or not');
  });

  await check('advancing an item takes it off the list, and nowhere else', async () => {
    const { due } = await get(server.base, '/api/upcoming');
    const done = due[0];
    const advanced = await post(server.base, `/api/items/${done.id}`, { state: 'done' });
    assert.equal(advanced.status, 200);
    assert.equal(advanced.body.item.state, 'done', 'the item comes back as it now stands');

    const after = await get(server.base, '/api/upcoming');
    assert.ok(
      !after.due.some((item) => item.id === done.id),
      'a finished item is not in the list of what is still to do',
    );
    assert.equal(
      (await get(server.base, '/api/items')).items.find((item) => item.id === done.id)?.state,
      'done',
      'and it is still an item — finished is not deleted',
    );
  });

  await check('a state that is not one of the two is refused, not defaulted', async () => {
    const { due } = await get(server.base, '/api/upcoming');
    const refused = await post(server.base, `/api/items/${due[0].id}`, { state: 'later' });
    assert.equal(refused.status, 400, 'the API says no rather than quietly picking one');
  });

  await check('an item with no date can be advanced too', async () => {
    // The 「待安排」 list is the one the page can most easily forget to wire up,
    // because a row without a time looks like a different kind of row. It is
    // not: it is an item, and the state checkbox in the ticket does not say
    // "only the dated ones".
    const { unscheduled } = await get(server.base, '/api/upcoming');
    assert.equal(unscheduled.length, 1, 'there is one undated item to advance');
    const advanced = await post(server.base, `/api/items/${unscheduled[0].id}`, { state: 'done' });
    assert.equal(advanced.status, 200);
    assert.equal(advanced.body.item.state, 'done');

    const after = await get(server.base, '/api/upcoming');
    assert.deepEqual(after.unscheduled, [], 'and it leaves the list it was in');
    // Put it back, so the later checks see the list they expect.
    await post(server.base, `/api/items/${unscheduled[0].id}`, { state: 'todo' });
  });

  await check('advancing an item that does not exist is a 404, not a silent success', async () => {
    const missing = await post(server.base, '/api/items/no-such-item', { state: 'done' });
    assert.equal(missing.status, 404);
  });

  await check('what crosses the wire is the item and its state, and no columns', async () => {
    const { due } = await get(server.base, '/api/upcoming');
    assert.deepEqual(
      Object.keys(due[0]).sort(),
      ['dropId', 'dueAt', 'id', 'state', 'text'],
      'the page gets the item, not the row',
    );
    const payload = JSON.stringify(await get(server.base, '/api/upcoming'));
    assert.ok(!/caught_at|drop_id|vector/.test(payload), 'no column names, no embeddings');
    assert.ok(!/matter|conclusion/.test(payload), 'nothing of the accumulation either');
  });
} finally {
  await server.close();
}

// Phase two: a fresh process against the same file. The state was written down,
// so what was ticked off is still ticked off — which is the whole promise of a
// list that is meant to be opened again tomorrow.
server = await listen(dbFile);
try {
  await check('what was advanced survives a restart', async () => {
    const { due } = await get(server.base, '/api/upcoming');
    assert.deepEqual(
      due.map((item) => item.text),
      ['约导师谈论文', '交材料', '交表', '交提纲'],
      'the finished one is still gone from the list',
    );
    const { items } = await get(server.base, '/api/items');
    assert.equal(
      items.filter((item) => item.state === 'done').length,
      1,
      'and the state is on disk, not in the process that ended',
    );
  });

  await check('an item can be put back to to-do, so a mistaken tick is undoable', async () => {
    const { items } = await get(server.base, '/api/items');
    const done = items.find((item) => item.state === 'done');
    const restored = await post(server.base, `/api/items/${done.id}`, { state: 'todo' });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.item.state, 'todo');

    const { due } = await get(server.base, '/api/upcoming');
    assert.equal(due.length, 5, 'it is back on the timeline where it was');
    assert.equal(
      due.filter((item) => item.text === '交初稿').length,
      1,
      'and there is no second copy of it',
    );
  });
} finally {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exitCode = 1;
