/*
 * End-to-end check of the drop → reply chain over real HTTP.
 *
 * Runs the real server handler against a real SQLite file with a scripted
 * provider, so it exercises what the domain tests cannot: the reply as it
 * crosses the wire, the poll-after-drop the page uses to pick up the styled
 * line, and what a reload shows.
 *
 * The claim under test is a negative one as much as a positive one: a reply that
 * breaks the parent-voice rules must not be reachable over the API, in any
 * response, at any point.
 *
 *   node tools/e2e-ticket-03.mjs
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDomain } from '../src/domain/core.ts';
import { REPLY_THAT_BREAKS_THE_RULES, createFakeProvider } from '../src/domain/fake-provider.ts';
import { openSqliteStore } from '../src/domain/sqlite-store.ts';
import { createHandler } from '../src/web/server.ts';

const MIXED = '老师今天讲了期末怎么算分，下周三交提纲，好烦';
const PLAIN = '明天下午三点开会';
const STOPPING = '算了，不想说了';
const BROKEN = '今天的事全乱了，好烦';

/** The line code itself can vouch for, one per situation. */
const SAFE_EMOTION_REPLY = '听着今天不太好受。';
const SAFE_PRESENCE_REPLY = '嗯，我在。想说了再说。';
const SAFE_RECORDED_REPLY = '接住了。';

/** A line that passes every check, so it is the one the drop ends up with. */
const STYLED_REPLY = '听起来今天挺累的。';

/**
 * A provider scripted for all four wires: a styled reply that is accepted, a
 * reply that breaks the rules twice, and a reply that asks after being asked to
 * stop — which must never be reached, because a stop request is answered by
 * code and never put to a provider at all.
 */
function provider() {
  return createFakeProvider({
    byBody: {
      [MIXED]: { kind: 'reply', reply: STYLED_REPLY },
      [STOPPING]: { kind: 'reply', reply: '你想说说吗？' },
    },
    respondAttempts: { [BROKEN]: [REPLY_THAT_BREAKS_THE_RULES, REPLY_THAT_BREAKS_THE_RULES] },
  });
}

const dir = mkdtempSync(join(tmpdir(), 'ytwins-e2e-reply-'));
const dbFile = join(dir, 'ytwins.sqlite');

/** Every reply the API has handed out, so the negative claim can be checked. */
const seenReplies = [];

/** Start a real server on an ephemeral port, backed by the given database. */
async function listen(dbPath) {
  const store = openSqliteStore(dbPath);
  const scripted = provider();
  const domain = createDomain({ store, provider: scripted });
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
    /** What the domain actually asked the provider to answer. */
    asked: scripted.seen,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await store.close();
    },
  };
}

async function get(base, path) {
  const payload = await (await fetch(`${base}${path}`)).json();
  if (payload.drops) for (const drop of payload.drops) seenReplies.push(drop.reply);
  if (payload.drop) seenReplies.push(payload.drop.reply);
  return payload;
}

async function post(base, path, body) {
  const payload = await (
    await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  ).json();
  if (typeof payload.reply === 'string') seenReplies.push(payload.reply);
  return payload;
}

/** Poll one drop the way the page does, until the line it settled on appears. */
async function pollReply(base, dropId, expected, attempts = 40) {
  let drop = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const arrived = await get(base, `${dropId}`);
    drop = arrived.drop;
    if (drop.reply === expected) return drop;
    await new Promise((r) => setTimeout(r, 25));
  }
  return drop;
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

console.log('end to end — what the drop is answered with');

let server = await listen(dbFile);
try {
  await check('an emotional drop is answered the moment it is caught', async () => {
    const created = await post(server.base, '/api/drop', { body: MIXED });
    assert.equal(
      created.reply,
      SAFE_EMOTION_REPLY,
      'the drop must be answered before the provider has said anything',
    );
    assert.ok(typeof created.id === 'string' && created.id.length > 0);
  });

  const drops = await get(server.base, '/api/drops');
  const mixedId = drops.drops.at(-1).id;

  await check('the styled reply replaces it once it has passed the checks', async () => {
    const drop = await pollReply(server.base, `/api/drops/${mixedId}`, STYLED_REPLY);
    assert.equal(drop.reply, STYLED_REPLY, 'the checked line is what the drop reports');
  });

  await check('a drop with nothing emotional in it is simply acknowledged', async () => {
    const created = await post(server.base, '/api/drop', { body: PLAIN });
    assert.equal(created.reply, SAFE_RECORDED_REPLY, 'no feeling was invented for it');
  });

  await check('a reply that breaks the rules is never reachable over the API', async () => {
    const created = await post(server.base, '/api/drop', { body: BROKEN });

    // Both attempts were made; after the second there is nowhere left to write,
    // so once this settles the drop's line is final.
    await new Promise((r) => setTimeout(r, 200));

    const drop = await get(server.base, `/api/drops/${created.id}`).then((r) => r.drop);
    assert.equal(drop.reply, SAFE_EMOTION_REPLY, 'the safe line is what the drop reports');

    // The whole API surface, not just this drop: a reply that broke the rules
    // must not be sitting in some other response either.
    await get(server.base, '/api/drops');
    const offered = REPLY_THAT_BREAKS_THE_RULES.reply;
    for (const reply of seenReplies) {
      assert.notEqual(reply, offered, 'the offered line crossed the wire');
      assert.ok(!reply.includes('宝贝'), 'a pet name crossed the wire');
      assert.ok(!reply.includes('别想那么多'), 'a judgement crossed the wire');
      assert.ok(!reply.includes('为什么'), 'an interrogation crossed the wire');
    }
  });

  await check('asking to stop is answered by code, and never put to the provider', async () => {
    const created = await post(server.base, '/api/drop', { body: STOPPING });
    assert.equal(created.reply, SAFE_PRESENCE_REPLY, 'only presence is left');

    await new Promise((r) => setTimeout(r, 200));
    const drop = await get(server.base, `/api/drops/${created.id}`).then((r) => r.drop);
    assert.equal(drop.reply, SAFE_PRESENCE_REPLY);
    assert.ok(!drop.reply.includes('？'), 'the probing question stayed out');
    assert.ok(
      !server.asked.includes(STOPPING),
      'a drop that asks to be left alone must not reach a provider at all',
    );
  });
} finally {
  await server.close();
}

// A fresh server against the same file: what the replies do across a restart.
server = await listen(dbFile);
try {
  await check('a reload shows the same lines, not an empty screen', async () => {
    const { drops } = await get(server.base, '/api/drops');
    assert.equal(drops.length, 4, 'every drop is still there');
    assert.ok(
      drops.every((drop) => typeof drop.reply === 'string' && drop.reply.length > 0),
      'and every one of them still has the line it was answered with',
    );
    const mixed = drops.find((drop) => drop.body === MIXED);
    assert.equal(mixed.reply, STYLED_REPLY, 'including the styled one');
    const stopped = drops.find((drop) => drop.body === STOPPING);
    assert.equal(stopped.reply, SAFE_PRESENCE_REPLY, 'and the line that stopped the probing');
  });
} finally {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exitCode = 1;
