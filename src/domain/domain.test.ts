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

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exitCode = 1;
}
