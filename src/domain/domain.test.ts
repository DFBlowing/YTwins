/**
 * Domain-core tests — a directly executable, single-file entry.
 *
 *   node src/domain/domain.test.ts
 *
 * Deliberately not a test framework and not `node --test`:
 *
 *  - `node --test` spawns a child process per file, and this environment denies
 *    child-process pipes, so it cannot run here at all. Running this file
 *    directly is a single process with no spawn.
 *  - Every assertion is a `node:assert` call and the exit code is the result,
 *    which is the same contract `tools/check-workspace.test.mjs` already uses.
 *
 * Tests drive the domain through its interface only, with the AI provider
 * faked. They assert facts the user can observe — the text is stored verbatim,
 * the reply arrives, the drop survives a provider that hangs or fails — and
 * never internal calls or SQL.
 *
 * @module domain/domain.test
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDomain } from './core.ts';
import { createFakeProvider } from './fake-provider.ts';
import { openSqliteStore } from './sqlite-store.ts';

let failures = 0;
let checks = 0;

/** Run one named check; a throw is recorded and the run continues. */
async function check(name: string, body: () => Promise<void> | void): Promise<void> {
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

/** A throwaway database file, removed when the check ends. */
async function withDatabase(body: (file: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'ytwins-domain-'));
  try {
    await body(join(dir, 'ytwins.sqlite'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A drop whose text mixes an item with a feeling, straight from the spec's demo. */
const MIXED_DROP = '老师今天讲了期末怎么算分，下周三交提纲，好烦';

console.log('domain core — dropping');

await check('a drop hands back the same text it caught', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const domain = createDomain({ store });
      const result = await domain.drop(MIXED_DROP);
      assert.equal(result.body, MIXED_DROP);
    } finally {
      await store.close();
    }
  });
});

await check('the reply tells the user it was caught', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const domain = createDomain({ store });
      const result = await domain.drop(MIXED_DROP);
      assert.ok(result.reply.trim().length > 0, 'a drop is never silent');
    } finally {
      await store.close();
    }
  });
});

await check('the drop is still there after reopening the database', async () => {
  await withDatabase(async (file) => {
    const first = openSqliteStore(file);
    await createDomain({ store: first }).drop(MIXED_DROP);
    await first.close();

    // Reopening is what a page refresh does to the server's view of the file.
    const second = openSqliteStore(file);
    try {
      const [stored] = await second.listDrops();
      assert.equal(stored?.body, MIXED_DROP);
    } finally {
      await second.close();
    }
  });
});

await check('the original is stored verbatim, including whitespace and newlines', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const raw = '  第一行\n\n  第二行，带空格  \n';
      await createDomain({ store }).drop(raw);
      const [stored] = await store.listDrops();
      assert.equal(stored?.body, raw, 'the original is kept, not trimmed or summarised');
    } finally {
      await store.close();
    }
  });
});

await check('the provider is consulted for the drop', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = createFakeProvider({
        byBody: { [MIXED_DROP]: { kind: 'reply', reply: '听起来今天挺累的。' } },
      });
      const result = await createDomain({ store, provider }).drop(MIXED_DROP);

      // The drop returns without awaiting the provider, so the styled line it
      // composed is ticket 03's to surface. What ticket 01 fixes is that the
      // call is made and the drop does not depend on its answer.
      assert.ok(result.reply.trim().length > 0);
      await Promise.resolve();
      assert.deepEqual(provider.seen, [MIXED_DROP], 'the drop asked the provider to answer');
    } finally {
      await store.close();
    }
  });
});

await check('a provider that hangs does not hold up the drop', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = createFakeProvider({ fallback: { kind: 'hang' } });
      const domain = createDomain({ store, provider });

      // The drop must settle on its own, so race it against a timer. If the
      // domain were waiting on the provider this would time out instead.
      const settled = await Promise.race([
        domain.drop(MIXED_DROP),
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 1000)),
      ]);

      assert.notEqual(settled, 'timeout', 'the drop waited on the provider');
      const [stored] = await store.listDrops();
      assert.equal(stored?.body, MIXED_DROP, 'the text landed even though the provider never answered');
    } finally {
      await store.close();
    }
  });
});

await check('a provider that rejects still leaves the drop caught', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = createFakeProvider({
        fallback: { kind: 'fail', reason: 'cloud LLM unreachable' },
      });
      const result = await createDomain({ store, provider }).drop(MIXED_DROP);

      assert.equal(result.body, MIXED_DROP, 'the drop succeeded despite the provider');
      assert.ok(result.reply.trim().length > 0, 'the user still gets an acknowledgement');
      const [stored] = await store.listDrops();
      assert.equal(stored?.body, MIXED_DROP);
    } finally {
      await store.close();
    }
  });
});

await check('a provider that throws synchronously still leaves the drop caught', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      // A synchronous throw is a different failure shape from a rejected
      // promise, and the one that a caller guarding only `.catch(...)` misses.
      // The port's contract says both are ordinary, so both are asserted.
      const provider = createFakeProvider({
        fallback: { kind: 'throw', reason: 'provider constructor blew up' },
      });
      const result = await createDomain({ store, provider }).drop(MIXED_DROP);

      assert.equal(result.body, MIXED_DROP, 'the drop succeeded despite the provider throwing');
      assert.ok(result.reply.trim().length > 0, 'the user still gets an acknowledgement');
      const [stored] = await store.listDrops();
      assert.equal(stored?.body, MIXED_DROP, 'the text landed anyway');
    } finally {
      await store.close();
    }
  });
});

await check('the reply never waits on the provider, even one that answers instantly', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      // A blank acknowledgement would pass a `length > 0` check by accident, so
      // assert the exact text instead: the styled answer is ticket 03's to
      // surface, and today's contract is that it does NOT appear here. This is
      // what makes the "not waiting" claim falsifiable rather than decorative.
      const provider = createFakeProvider({
        fallback: { kind: 'reply', reply: '听起来今天挺累的。' },
      });
      const result = await createDomain({ store, provider }).drop(MIXED_DROP);

      assert.equal(result.reply, '接住了。', 'the drop returned before the provider could answer');
    } finally {
      await store.close();
    }
  });
});

await check('drops come back oldest first, and none are lost', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const domain = createDomain({ store });
      const bodies = ['第一句', '第二句', '第三句'];
      for (const body of bodies) await domain.drop(body);

      const stored = await store.listDrops();
      assert.deepEqual(
        stored.map((drop) => drop.body),
        bodies,
      );
    } finally {
      await store.close();
    }
  });
});

console.log('\ndomain core — what a drop catches');

/** A provider scripted to read the demo's mixed drop into one item and one type. */
function splitProvider(): ReturnType<typeof createFakeProvider> {
  return createFakeProvider({
    extractByBody: {
      [MIXED_DROP]: {
        kind: 'read',
        reading: {
          inputType: 'emotion',
          items: [{ text: '下周三交提纲', dueAt: '2026-09-23T00:00:00.000Z' }],
        },
      },
    },
  });
}

/** Wait for background extraction to land, without guessing at a delay. */
async function settledUntil(condition: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

await check('one drop yields both an item and the record, and the record is the original', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const domain = createDomain({ store, provider: splitProvider() });
      await domain.drop(MIXED_DROP);

      await settledUntil(async () => (await domain.listItems()).length > 0);

      const items = await domain.listItems();
      assert.equal(items.length, 1, 'the item was split out of the mixed drop');
      assert.equal(items[0]?.text, '下周三交提纲');

      // The same drop yields the record, byte-for-byte. The two products of one
      // drop are asserted together because "it produced both" is the claim.
      const [record] = await store.listDrops();
      assert.equal(record?.body, MIXED_DROP, 'the record is the original, not a summary');
    } finally {
      await store.close();
    }
  });
});

await check('an item points back at the drop it came from', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const domain = createDomain({ store, provider: splitProvider() });
      const dropped = await domain.drop(MIXED_DROP);
      await settledUntil(async () => (await domain.listItems()).length > 0);

      const [item] = await domain.listItems();
      assert.equal(item?.dropId, dropped.id, 'nothing exists without a source drop');
    } finally {
      await store.close();
    }
  });
});

await check('an item with no parsed time is kept as unscheduled, on no date', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const noTime = '想去学吉他';
      const provider = createFakeProvider({
        extractByBody: {
          [noTime]: {
            kind: 'read',
            reading: { inputType: 'idea', items: [{ text: '想去学吉他', dueAt: null }] },
          },
        },
      });
      const domain = createDomain({ store, provider });
      await domain.drop(noTime);
      await settledUntil(async () => (await domain.listItems()).length > 0);

      const [item] = await domain.listItems();
      assert.ok(item !== undefined, 'the item is kept rather than silently dropped');
      assert.equal(item.dueAt, null, 'no date was invented for it');
    } finally {
      await store.close();
    }
  });
});

await check('the input type is recorded internally and never asked of the user', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const domain = createDomain({ store, provider: splitProvider() });
      await domain.drop(MIXED_DROP);
      await settledUntil(async () => (await domain.listItems()).length > 0);

      // The drop was typed internally — that is what makes it extracted at all.
      const [drop] = await domain.listDrops();
      assert.equal(drop?.extracted, true, 'the type was recorded behind the interface');

      // And the interface hands the user no way to see or choose it: the whole
      // drop summary carries the text, the time, the items and nothing else.
      assert.deepEqual(
        Object.keys(drop ?? {}).sort(),
        ['body', 'droppedAt', 'extracted', 'id', 'items'],
        'no classification field is exposed to the page',
      );
    } finally {
      await store.close();
    }
  });
});

await check('a provider that hangs does not hold up the drop, or the items', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = createFakeProvider({ extractFallback: { kind: 'hang' } });
      const domain = createDomain({ store, provider });

      const settled = await Promise.race([
        domain.drop(MIXED_DROP),
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 1000)),
      ]);
      assert.notEqual(settled, 'timeout', 'the drop waited on extraction');

      // The records survive: extraction hanging costs the user nothing.
      const [drop] = await domain.listDrops();
      assert.equal(drop?.body, MIXED_DROP);
      assert.equal(drop?.extracted, false, 'the drop is honestly reported as unread');
    } finally {
      await store.close();
    }
  });
});

await check('extraction that failed can be run again afterwards', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      // First attempt fails at the provider. The drop is still there, unread.
      const failing = createDomain({
        store,
        provider: createFakeProvider({
          extractFallback: { kind: 'fail', reason: 'cloud LLM unreachable' },
        }),
      });
      const dropped = await failing.drop(MIXED_DROP);
      assert.equal((await failing.getDrop(dropped.id))?.extracted, false);

      // A second attempt, with a provider that answers, reads it out. This is
      // the whole point of extraction not gating the drop: the failure is
      // recoverable by asking again rather than by re-dropping the text.
      const working = createDomain({ store, provider: splitProvider() });
      const after = await working.extract(dropped.id);

      assert.equal(after?.extracted, true, 'the retry read the drop');
      assert.equal(after?.items.length, 1, 'and found the item the first attempt missed');
    } finally {
      await store.close();
    }
  });
});

await check('a retried extraction does not duplicate the items', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const domain = createDomain({ store, provider: splitProvider() });
      const dropped = await domain.drop(MIXED_DROP);
      await settledUntil(async () => (await domain.listItems()).length > 0);

      // Asking again is meant to be safe: the user must not end up with the
      // same thing listed twice because a client retried.
      await domain.extract(dropped.id);
      await domain.extract(dropped.id);

      assert.equal((await domain.listItems()).length, 1, 'extraction converged on one item');
    } finally {
      await store.close();
    }
  });
});

await check('extraction that throws synchronously still leaves the drop caught', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = createFakeProvider({
        extractFallback: { kind: 'throw', reason: 'provider constructor blew up' },
      });
      const domain = createDomain({ store, provider });
      const dropped = await domain.drop(MIXED_DROP);

      // A synchronous throw is a different failure shape from a rejected
      // promise, and the one a caller guarding only `.catch(...)` misses.
      const after = await domain.extract(dropped.id);
      assert.equal(after?.body, MIXED_DROP, 'the text landed anyway');
      assert.equal(after?.extracted, false, 'and is honestly reported as unread');
    } finally {
      await store.close();
    }
  });
});

await check('items reach the page through the drop they came from', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const domain = createDomain({ store, provider: splitProvider() });
      const dropped = await domain.drop(MIXED_DROP);
      await settledUntil(async () => (await domain.listItems()).length > 0);

      // This is the read the page does after dropping: it returns before
      // extraction, so it asks again for what the drop turned out to contain.
      const read = await domain.getDrop(dropped.id);
      assert.equal(read?.items.length, 1, 'the drop reports the items it caught');
      assert.equal(read?.items[0]?.text, '下周三交提纲');
    } finally {
      await store.close();
    }
  });
});

await check('reading a drop that does not exist is null, not an error', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const domain = createDomain({ store, provider: splitProvider() });
      assert.equal(await domain.getDrop('no-such-drop'), null);
      assert.equal(await domain.extract('no-such-drop'), null);
    } finally {
      await store.close();
    }
  });
});

await check('extraction lands in the database, so it survives reopening', async () => {
  await withDatabase(async (file) => {
    const first = openSqliteStore(file);
    const dropped = await createDomain({ store: first, provider: splitProvider() }).drop(MIXED_DROP);
    await settledUntil(async () => (await first.listItems()).length > 0);
    await first.close();

    const second = openSqliteStore(file);
    try {
      const read = await createDomain({ store: second }).getDrop(dropped.id);
      assert.equal(read?.items.length, 1, 'the items are on disk, not in memory');
      assert.equal(read?.extracted, true, 'and so is the fact that it was read');
    } finally {
      await second.close();
    }
  });
});

await check('a drop with no items is still reported as read', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      // Most drops contain no items at all. "Read and empty" must stay
      // distinguishable from "not read", or extraction could never be retried
      // without either duplicating items or refusing forever.
      const plain = '今天天气不错';
      const provider = createFakeProvider({
        extractByBody: {
          [plain]: { kind: 'read', reading: { inputType: 'idea', items: [] } },
        },
      });
      const domain = createDomain({ store, provider });
      const dropped = await domain.drop(plain);
      const read = await domain.extract(dropped.id);

      assert.equal(read?.extracted, true, 'it was read');
      assert.equal(read?.items.length, 0, 'and genuinely had nothing to do in it');
    } finally {
      await store.close();
    }
  });
});

await check('with no provider at all, a drop still catches its record', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      // The product must work before any provider is configured. Then nothing
      // can be read out of a drop, and that has to be an ordinary state rather
      // than a crash — the record is what the user was promised.
      const domain = createDomain({ store });
      const dropped = await domain.drop(MIXED_DROP);

      const read = await domain.getDrop(dropped.id);
      assert.equal(read?.body, MIXED_DROP, 'the record is there');
      assert.equal(read?.extracted, false, 'nothing has read it');
      assert.deepEqual(read?.items, [], 'and it has caught no items');
      assert.equal((await domain.extract(dropped.id))?.extracted, false, 'asking again cannot invent a provider');
    } finally {
      await store.close();
    }
  });
});

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exitCode = 1;
}
