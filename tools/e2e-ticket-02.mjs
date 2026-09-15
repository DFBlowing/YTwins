/*
 * End-to-end check of the drop → items chain over real HTTP.
 *
 * Runs the real server handler against a real SQLite file with a scripted
 * provider, so it exercises the parts unit tests cannot: routing, JSON shapes
 * on the wire, the poll-after-drop path the page uses, and persistence across a
 * server restart.
 *
 *   node tools/e2e-ticket-02.mjs
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

const MIXED = '老师今天讲了期末怎么算分，下周三交提纲，好烦';
const NO_TIME = '想去学吉他';

/** A provider that reads the demo's fragments the way the real one should. */
function provider() {
  return createFakeProvider({
    extractByBody: {
      [MIXED]: {
        kind: 'read',
        reading: {
          inputType: 'emotion',
          items: [{ text: '下周三交提纲', dueAt: '2026-09-23T00:00:00.000Z' }],
        },
      },
      [NO_TIME]: {
        kind: 'read',
        reading: { inputType: 'idea', items: [{ text: '想去学吉他', dueAt: null }] },
      },
    },
  });
}

const dir = mkdtempSync(join(tmpdir(), 'ytwins-e2e-'));
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

console.log('end to end — what a drop catches');

let server = await listen(dbFile);
try {
  await check('dropping returns the id and the record, without waiting for items', async () => {
    const created = await post(server.base, '/api/drop', { body: MIXED });
    assert.equal(created.body, MIXED, 'the record is the original');
    assert.ok(typeof created.id === 'string' && created.id.length > 0, 'an id comes back');
    assert.ok(created.reply.trim().length > 0, 'the user is answered');
  });

  const drops = await get(server.base, '/api/drops');
  const dropId = drops.drops.at(-1).id;

  await check('the drop reads back with the item split out of it', async () => {
    // Poll the way the page does, so this covers the path the browser takes.
    let read = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      read = (await get(server.base, `/api/drops/${dropId}`)).drop;
      if (read.extracted) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(read.extracted, true, 'the drop was read');
    assert.equal(read.items.length, 1, 'one item came out of a mixed fragment');
    assert.equal(read.items[0].text, '下周三交提纲');
    assert.equal(read.items[0].dueAt, '2026-09-23T00:00:00.000Z', 'its time was kept');
    assert.equal(read.items[0].dropId, dropId, 'the item points back at its drop');
    assert.equal(read.body, MIXED, 'and the record is still the untouched original');
  });

  await check('an item with no parsed time is listed as unscheduled, not dropped', async () => {
    await post(server.base, '/api/drop', { body: NO_TIME });
    let items = [];
    for (let attempt = 0; attempt < 40; attempt += 1) {
      items = (await get(server.base, '/api/items')).items;
      if (items.length >= 2) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    const unscheduled = items.find((i) => i.text === '想去学吉他');
    assert.ok(unscheduled !== undefined, 'it was kept');
    assert.equal(unscheduled.dueAt, null, 'and carries no invented date');
  });

  await check('the API never exposes the input type to the page', async () => {
    const payload = JSON.stringify(await get(server.base, '/api/drops'));
    assert.ok(!/inputType/.test(payload), 'no classification field crosses the wire');
    assert.ok(!/emotion|decision|idea/.test(payload), 'and no type value does either');
  });

  await check('a drop that does not exist is a 404, not a crash', async () => {
    const response = await fetch(`${server.base}/api/drops/no-such-drop`);
    assert.equal(response.status, 404);
    const still = await fetch(`${server.base}/api/drops`);
    assert.equal(still.status, 200, 'the server survived the request');
  });
} finally {
  await server.close();
}

// A fresh server against the same file: what the items do across a restart.
server = await listen(dbFile);
try {
  await check('items survive a server restart', async () => {
    const { items } = await get(server.base, '/api/items');
    assert.equal(items.length, 2, 'both items are on disk');
    const timed = items.find((i) => i.text === '下周三交提纲');
    assert.equal(timed.dueAt, '2026-09-23T00:00:00.000Z', 'including the parsed time');
  });

  await check('a page load after restart shows drops with their items', async () => {
    const { drops } = await get(server.base, '/api/drops');
    assert.equal(drops.length, 2);
    assert.ok(
      drops.every((d) => d.extracted === true),
      'reopening the database still reports them as read',
    );
    assert.equal(drops[0].items.length, 1, 'the items travel with the drop');
  });
} finally {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exitCode = 1;
