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
import { DatabaseSync } from 'node:sqlite';

import { createDomain } from './core.ts';
import { checkConclusion, type ConclusionPolicy } from './conclusions.ts';
import type { RespondRequest } from './ai-provider.ts';
import {
  REPLY_THAT_BREAKS_THE_RULES,
  createFakeProvider,
  type EmbedScript,
  type ExtractScript,
  type FakeProviderScript,
} from './fake-provider.ts';
import type { Conclusion, Domain, InputType, SurfacingResult, Term, TermLink } from './interface.ts';
import { DEFAULT_LINK_POLICY, decideLink, type LinkDecision } from './linking.ts';
import {
  PRESET_ACTS,
  PRESET_DROP_TERMS,
  PRESET_EXAM_SUPPORT,
  PRESET_FEELING_SUPPORT,
  PRESET_ITEM_TEXT,
  PRESET_LEADS,
  createPresetProvider,
  seedPreset,
} from './preset.ts';
import { openSqliteStore } from './sqlite-store.ts';
import type { SurfacingPolicy } from './surfacing.ts';

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

/**
 * A line that obeys every mechanical rule.
 *
 * Declared here rather than beside the reply checks because an earlier check
 * needs it too: the reply rules are the difference between "the drop was
 * answered" and "the provider's line came back", and both are asserted before
 * this file ever reaches the reply section.
 */
const GOOD_REPLY = '听起来今天挺累的。';

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
      // name the exact line the provider offered. Ticket 03 gave the drop a line
      // code itself can vouch for the moment it is caught, and made the styled
      // one replace it only after it has been checked — so the styled line not
      // being here is what keeps the "not waiting" claim falsifiable.
      const provider = createFakeProvider({
        fallback: { kind: 'reply', reply: GOOD_REPLY },
      });
      const result = await createDomain({ store, provider }).drop(MIXED_DROP);

      assert.notEqual(result.reply, GOOD_REPLY, 'the drop returned before the provider answered');
      assert.ok(result.reply.trim().length > 0, 'and the user was answered anyway');
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

console.log('\ndomain core — items landing on time');

/**
 * A fragment whose items are scripted with the times its check is about.
 *
 * The times are worked examples rather than "now + a day", so the expected
 * order below is a literal the check wrote down rather than the same arithmetic
 * the domain performs — an assertion that recomputed the answer could never
 * disagree with the code.
 */
function timedProvider(
  readings: readonly (readonly [body: string, items: readonly { readonly text: string; readonly dueAt: string | null }[]])[],
): ReturnType<typeof createFakeProvider> {
  const extractByBody: Record<string, ExtractScript> = {};
  for (const [body, items] of readings) {
    extractByBody[body] = { kind: 'read', reading: { inputType: 'item', items } };
  }
  return createFakeProvider({ extractByBody });
}

/** Wait until every item a check expects has been read out of its drop. */
async function readItems(domain: Domain, count: number): Promise<void> {
  await settledUntil(async () => (await domain.listItems()).length >= count);
}

/**
 * Four fragments: one plainly in the past, two days apart in the future, and one
 * with nothing to go on. Read against a pinned moment, so three of them are due
 * (one of them overdue) and the last is unscheduled.
 */
const OVERDUE_DROP = '上周五已经把初稿交了';
const SOON_DROP = '明天上午十点去交提纲';
const LATER_DROP = '下周一约导师谈论文';
const UNDATED_DROP = '想去学吉他，还想去爬山';

const TIMED_READINGS = [
  [OVERDUE_DROP, [{ text: '交初稿', dueAt: '2026-09-11T09:00:00.000Z' }]],
  [SOON_DROP, [{ text: '交提纲', dueAt: '2026-09-21T02:00:00.000Z' }]],
  [LATER_DROP, [{ text: '约导师谈论文', dueAt: '2026-09-28T01:00:00.000Z' }]],
  [UNDATED_DROP, [{ text: '学吉他', dueAt: null }]],
] as const;

/** The moment the scheduling checks read the list as of. */
const SCHEDULING_NOW = '2026-09-20T12:00:00.000Z';

/** Build the four fragments' items, and hand the domain back. */
async function schedulingFixture(file: string): Promise<Domain> {
  const store = openSqliteStore(file);
  try {
    const domain = createDomain({
      store,
      provider: timedProvider(TIMED_READINGS),
      now: () => SCHEDULING_NOW,
    });
    for (const [body] of TIMED_READINGS) await domain.drop(body);
    await readItems(domain, 4);
    return domain;
  } finally {
    await store.close();
  }
}

await check('an item is placed on the timeline from the drop alone, with no time typed', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const domain = createDomain({
        store,
        provider: timedProvider(TIMED_READINGS),
        now: () => SCHEDULING_NOW,
      });
      for (const [body] of TIMED_READINGS) await domain.drop(body);
      await readItems(domain, 4);

      const upcoming = await domain.upcoming();
      assert.deepEqual(
        upcoming.due.map((item) => item.text),
        ['交初稿', '交提纲', '约导师谈论文'],
        'placed by their own times, with no time typed by anybody',
      );
      assert.deepEqual(
        upcoming.due.map((item) => item.dueAt),
        ['2026-09-11T09:00:00.000Z', '2026-09-21T02:00:00.000Z', '2026-09-28T01:00:00.000Z'],
        'soonest first, and the one already past leads rather than falling off',
      );
    } finally {
      await store.close();
    }
  });
});

await check('an item with no parsed time is listed apart, not dropped', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const domain = createDomain({
        store,
        provider: timedProvider(TIMED_READINGS),
        now: () => SCHEDULING_NOW,
      });
      for (const [body] of TIMED_READINGS) await domain.drop(body);
      await readItems(domain, 4);

      const upcoming = await domain.upcoming();
      assert.deepEqual(
        upcoming.unscheduled.map((item) => item.text),
        ['学吉他'],
        'kept, and kept apart from anything with a date',
      );
      assert.equal(upcoming.unscheduled[0]?.dueAt, null, 'and no date was invented for it');
      assert.equal(upcoming.due.length, 3, 'it did not quietly join the timeline either');
    } finally {
      await store.close();
    }
  });
});

await check("an item's state advances, and stays advanced across a restart", async () => {
  await withDatabase(async (file) => {
    const first = openSqliteStore(file);
    const marked = await (async () => {
      try {
        const domain = createDomain({
          store: first,
          provider: timedProvider(TIMED_READINGS),
          now: () => SCHEDULING_NOW,
        });
        for (const [body] of TIMED_READINGS) await domain.drop(body);
        await readItems(domain, 4);

        const [soonest] = (await domain.upcoming()).due;
        assert.ok(soonest !== undefined);
        assert.equal(soonest.state, 'todo', 'everything starts to do');

        const advanced = await domain.setItemState(soonest.id, 'done');
        assert.equal(advanced?.state, 'done', 'the item comes back as it now stands');
        return soonest;
      } finally {
        await first.close();
      }
    })();

    // A second process against the same file — what a page refresh does to the
    // server's view of it.
    const second = openSqliteStore(file);
    try {
      const reopened = createDomain({ store: second, now: () => SCHEDULING_NOW });
      const upcoming = await reopened.upcoming();
      assert.ok(
        !upcoming.due.some((item) => item.id === marked.id),
        'a finished item is not in the list of what is still to do',
      );
      assert.equal(
        (await reopened.listItems()).find((item) => item.id === marked.id)?.state,
        'done',
        'the state is on disk, not in the process',
      );
    } finally {
      await second.close();
    }
  });
});

await check('an item can be put back to to-do, so a mistaken tick is undoable', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const domain = createDomain({
        store,
        provider: timedProvider(TIMED_READINGS),
        now: () => SCHEDULING_NOW,
      });
      for (const [body] of TIMED_READINGS) await domain.drop(body);
      await readItems(domain, 4);

      const [soonest] = (await domain.upcoming()).due;
      assert.ok(soonest !== undefined);
      await domain.setItemState(soonest.id, 'done');
      await domain.setItemState(soonest.id, 'todo');

      assert.deepEqual(
        (await domain.upcoming()).due.map((item) => item.text),
        ['交初稿', '交提纲', '约导师谈论文'],
        'back where it was, with no second copy of it anywhere',
      );
    } finally {
      await store.close();
    }
  });
});

await check('advancing an item that does not exist is null, not an error', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const domain = createDomain({ store });
      assert.equal(await domain.setItemState('no-such-item', 'done'), null);
    } finally {
      await store.close();
    }
  });
});

await check('with nothing caught yet, the lists are empty rather than absent', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const domain = createDomain({ store, now: () => SCHEDULING_NOW });
      assert.deepEqual(await domain.upcoming(), { due: [], unscheduled: [] });
    } finally {
      await store.close();
    }
  });
});

await check('an item caught before this column existed is still listed as to do', async () => {
  await withDatabase(async (file) => {
    // A database as an earlier ticket wrote it: `item_` with no state column at
    // all. Written by hand rather than by an older checkout, because the shape
    // being checked is exactly the one no code in this tree makes any more.
    const old = new DatabaseSync(file);
    old.exec(`
      CREATE TABLE drop_ (id TEXT PRIMARY KEY, body TEXT NOT NULL, dropped_at TEXT NOT NULL,
                          input_type TEXT, reply TEXT NOT NULL);
      CREATE TABLE item_ (id TEXT PRIMARY KEY,
                          drop_id TEXT NOT NULL REFERENCES drop_(id) ON DELETE CASCADE,
                          text TEXT NOT NULL, due_at TEXT, caught_at TEXT NOT NULL);
      INSERT INTO drop_ (id, body, dropped_at, input_type, reply)
        VALUES ('d1', '下周三交提纲', '${SCHEDULING_NOW}', 'item', '接住了。');
      INSERT INTO item_ (id, drop_id, text, due_at, caught_at)
        VALUES ('i1', 'd1', '交提纲', '2026-09-23T09:00:00.000Z', '${SCHEDULING_NOW}');
    `);
    old.close();

    const store = openSqliteStore(file);
    try {
      const domain = createDomain({ store, now: () => SCHEDULING_NOW });
      // The column is added with a default rather than left null, because a
      // rule reads it: an item the file already held must not become invisible.
      assert.deepEqual(
        (await domain.upcoming()).due.map((item) => item.text),
        ['交提纲'],
        'the item the old file held is on the timeline, not hidden by a null',
      );
      assert.equal((await domain.setItemState('i1', 'done'))?.state, 'done');
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
      // drop summary carries the text, the time, the items, the terms, the line
      // it answers with, and nothing else.
      assert.deepEqual(
        Object.keys(drop ?? {}).sort(),
        ['body', 'droppedAt', 'extracted', 'id', 'items', 'reply', 'terms'],
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

console.log('\ndomain core — what a drop connects');

/** A fragment, and the terms it is scripted to yield — in the user's own words. */
type Reading = readonly [body: string, terms: readonly string[]];

/**
 * A provider scripted to read those fragments into those terms, and nothing
 * else. Nothing is scripted for embedding or judging unless the check adds it,
 * which is how a check can tell "code did this" from "a model did this".
 */
function termsOnly(
  readings: readonly Reading[],
  extra: Omit<FakeProviderScript, 'extractByBody'> = {},
): ReturnType<typeof createFakeProvider> {
  const extractByBody: Record<string, ExtractScript> = {};
  for (const [body, terms] of readings) {
    extractByBody[body] = { kind: 'read', reading: { inputType: 'idea', items: [], terms } };
  }
  return createFakeProvider({ ...extra, extractByBody });
}

/** Script the fake to hand back one vector per term text. */
function vectors(readings: Readonly<Record<string, readonly number[]>>): Record<string, EmbedScript> {
  const scripted: Record<string, EmbedScript> = {};
  for (const [text, vector] of Object.entries(readings)) {
    scripted[text] = { kind: 'vectors', vectors: [vector] };
  }
  return scripted;
}

/** Wait until a fragment's terms have been read out of it, and hand them back. */
async function readTerms(domain: Domain, dropId: string): Promise<readonly Term[]> {
  await settledUntil(async () => ((await domain.getDrop(dropId))?.terms.length ?? 0) > 0);
  return (await domain.getDrop(dropId))?.terms ?? [];
}

/** Wait until at least `count` links exist, then hand back every link. */
async function readLinks(domain: Domain, count: number): Promise<readonly TermLink[]> {
  await settledUntil(async () => (await domain.listLinks()).length >= count);
  return domain.listLinks();
}

/** The link between two terms, whichever way round the pair was stored. */
function linkBetween(links: readonly TermLink[], a: string, b: string): TermLink | undefined {
  return links.find(
    (link) =>
      (link.from.text === a && link.to.text === b) || (link.from.text === b && link.to.text === a),
  );
}

/** Two fragments, and the terms each is scripted to yield. */
const GUITAR_DROP = '最近老想着要不要报个吉他班，还想去爬山';
const GUITAR_TERMS = ['报个吉他班', '想去爬山'];
const HILL_DROP = '又想起学琴这事了，周末想去爬山';
/** Later fragments, whose terms each check scripts for itself. */
const THIRD_DROP = '周末想去爬山，顺便看看装备';
const SWAP_DROP = '想学门乐器，先看看钢琴';

/**
 * A unit vector whose cosine against `[1, 0]` is `score`.
 *
 * The linking checks need a pair at a chosen cosine, and writing
 * `[x, Math.sqrt(1 - x ** 2)]` out at every fixture is both noisy and easy to
 * get wrong. `[1, 0]` against this vector is `score`, by construction.
 *
 * @param score - the cosine the pair should have.
 * @returns the vector to pair with `[1, 0]`.
 */
function atCosine(score: number): readonly number[] {
  return [score, Math.sqrt(1 - score ** 2)];
}

/**
 * Two vectors 0.855 apart — a pair inside the **calibrated** grey zone.
 *
 * Ticket 14 measured the real embedding and put the bands at 0.85/0.87, so the
 * 0.8 pair these checks used to use is now below the unrelated gate: the grey zone
 * moved, and the fixture that says "a pair in the middle of it" moved with it.
 * The checks that pin an explicit policy still spell their own pair out.
 */
const GREY_PAIR_VECTORS = { 想学吉他: [1, 0], 想学门乐器: atCosine(0.855) };

await check("a drop's terms keep the user's own words, not a tidied-up concept", async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const domain = createDomain({ store, provider: termsOnly([[GUITAR_DROP, GUITAR_TERMS]]) });
      const dropped = await domain.drop(GUITAR_DROP);
      const terms = await readTerms(domain, dropped.id);

      assert.deepEqual(
        terms.map((term) => term.text),
        GUITAR_TERMS,
        'the wording is the user\'s, not a higher-level concept',
      );
      assert.ok(
        terms.every((term) => term.dropId === dropped.id),
        'and each one points back at the drop it came from',
      );
      assert.ok(
        terms.every((term) => Number.isFinite(Date.parse(term.firstSeenAt))),
        'each carries when it was first said',
      );
    } finally {
      await store.close();
    }
  });
});

await check('a term reaches the page without the vector it is compared by', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const domain = createDomain({ store, provider: termsOnly([[GUITAR_DROP, GUITAR_TERMS]]) });
      const dropped = await domain.drop(GUITAR_DROP);
      const [term] = await readTerms(domain, dropped.id);

      // The embedding is how the domain reasons, not something the page is owed.
      // Leaking it would make the numbers look like part of the product.
      assert.deepEqual(
        Object.keys(term ?? {}).sort(),
        ['dropId', 'firstSeenAt', 'id', 'text'],
        'the vector stays inside the domain',
      );
    } finally {
      await store.close();
    }
  });
});

await check('the same words said again are the same term, not a second one', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const first = '想去学吉他';
      const second = '还是想去学吉他，就是没时间';
      const domain = createDomain({
        store,
        provider: termsOnly([
          [first, ['想去学吉他']],
          [second, ['想去学吉他']],
        ]),
      });

      const one = await readTerms(domain, (await domain.drop(first)).id);
      const two = await readTerms(domain, (await domain.drop(second)).id);

      assert.equal(
        two[0]?.id,
        one[0]?.id,
        'a term is a thing that can be brought up again, so repeating it cannot make a second one',
      );
      assert.equal(two[0]?.dropId, (await domain.listDrops())[0]?.id, 'and it keeps where it first came from');
    } finally {
      await store.close();
    }
  });
});

await check('a drop that said no terms yields none, and is still a drop that was read', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const plain = '今天天气不错';
      const domain = createDomain({ store, provider: termsOnly([[plain, []]]) });
      const dropped = await domain.drop(plain);

      const read = await domain.getDrop(dropped.id);
      assert.equal(read?.extracted, true, 'it was read');
      assert.deepEqual(read?.terms, [], 'and genuinely had nothing worth bringing up again');
      assert.deepEqual(await domain.listLinks(), [], 'so nothing was connected');
    } finally {
      await store.close();
    }
  });
});

await check('terms said together in one drop are linked by code, with no model call at all', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      // Embedding and judging are both scripted to hang, so a link that still
      // appears cannot have come from either of them. The whole path is code.
      const provider = termsOnly([[GUITAR_DROP, [...GUITAR_TERMS, '爬山计划']]], {
        embedFallback: { kind: 'hang' },
        judgeLinkFallback: { kind: 'hang' },
      });
      const domain = createDomain({ store, provider });
      const dropped = await domain.drop(GUITAR_DROP);

      const terms = await readTerms(domain, dropped.id);
      const links = await readLinks(domain, 3);

      assert.equal(links.length, 3, 'every pair of terms from one drop is linked');
      assert.ok(
        links.every((link) => link.kind === 'same-drop'),
        'all three are the zero-model kind',
      );
      assert.ok(
        links.every((link) => link.strength === 1),
        'saying two things in one breath is the strongest evidence there is',
      );
      assert.ok(
        links.every((link) => link.reason.trim().length > 0),
        'and each one says why it exists',
      );
      assert.equal(terms.length, 3);
      assert.deepEqual(provider.embedded, [], 'nothing was embedded: there was no other term to compare with');
      assert.deepEqual(provider.judged, [], 'and no verdict was ever asked for');
    } finally {
      await store.close();
    }
  });
});

await check('the same pair is never linked twice, however often it is said', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const again = '报个吉他班和去爬山都还想，学琴也还想';
      const domain = createDomain({
        store,
        provider: termsOnly([
          [GUITAR_DROP, GUITAR_TERMS],
          [again, GUITAR_TERMS],
        ]),
      });

      await readTerms(domain, (await domain.drop(GUITAR_DROP)).id);
      const links = await readLinks(domain, 1);
      await domain.drop(again);
      await settledUntil(async () => false);

      assert.equal(
        (await domain.listLinks()).length,
        links.length,
        'saying the same two things again does not grow a second link between them',
      );
    } finally {
      await store.close();
    }
  });
});

await check('terms close enough are linked by their vectors, with nobody asked', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = termsOnly(
        [
          [GUITAR_DROP, ['想学吉他']],
          [HILL_DROP, ['打算学吉他']],
        ],
        { embedByText: vectors({ 想学吉他: [1, 0], 打算学吉他: [1, 0] }) },
      );
      const domain = createDomain({ store, provider });

      await readTerms(domain, (await domain.drop(GUITAR_DROP)).id);
      await readTerms(domain, (await domain.drop(HILL_DROP)).id);
      const links = await readLinks(domain, 1);

      const link = linkBetween(links, '想学吉他', '打算学吉他');
      assert.ok(link !== undefined, 'the two ends of the link name the terms');
      assert.equal(link.kind, 'similar', 'this is the semantic kind');
      assert.equal(link.strength, 1, 'its strength is the score it got');
      assert.match(link.reason, /语义相近/, 'and the reason says so');
      assert.deepEqual(provider.judged, [], 'a clear score is never put to a judge');
    } finally {
      await store.close();
    }
  });
});

await check('terms that are far apart are left alone, without asking anyone', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = termsOnly(
        [
          [GUITAR_DROP, ['想学吉他']],
          [HILL_DROP, ['打算学吉他']],
        ],
        { embedByText: vectors({ 想学吉他: [1, 0], 打算学吉他: [0, 1] }) },
      );
      const domain = createDomain({ store, provider });

      await readTerms(domain, (await domain.drop(GUITAR_DROP)).id);
      await readTerms(domain, (await domain.drop(HILL_DROP)).id);
      await settledUntil(async () => false);

      assert.deepEqual(await domain.listLinks(), [], 'two unrelated fragments stay unconnected');
      assert.deepEqual(provider.judged, [], 'and the low band never reaches a judge');
    } finally {
      await store.close();
    }
  });
});

await check('a pair in the grey zone is judged, and connects when the judge says it is close', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      // Scripted by pair, in the pair's own single order — here the reverse of
      // the one the domain hands over, because which end is `from` carries no
      // meaning and a check should not have to know it.
      const provider = termsOnly(
        [
          [GUITAR_DROP, ['想学吉他']],
          [HILL_DROP, ['想学门乐器']],
        ],
        {
          embedByText: vectors(GREY_PAIR_VECTORS),
          judgeLinkByPair: {
            '想学吉他\u0000想学门乐器': { kind: 'verdict', related: true },
          },
        },
      );
      const domain = createDomain({ store, provider });

      await readTerms(domain, (await domain.drop(GUITAR_DROP)).id);
      await readTerms(domain, (await domain.drop(HILL_DROP)).id);
      const links = await readLinks(domain, 1);

      const link = linkBetween(links, '想学吉他', '想学门乐器');
      assert.ok(link !== undefined, 'the judged pair is linked');
      assert.match(link.reason, /灰区/, 'and the reason says it was judged, not merely scored');
      assert.ok(
        link.strength !== undefined && link.strength > 0.85 && link.strength < 0.87,
        'its strength is the score it actually got — inside the calibrated grey zone',
      );

      const [pair] = provider.judged;
      assert.equal(provider.judged.length, 1, 'exactly one pair was put to the judge');
      assert.deepEqual(
        [pair?.from, pair?.to].sort(),
        ['想学吉他', '想学门乐器'].sort(),
        'and it was the grey pair, by both names',
      );
    } finally {
      await store.close();
    }
  });
});

await check('a grey pair the judge turns down is not linked', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = termsOnly(
        [
          [GUITAR_DROP, ['想学吉他']],
          [HILL_DROP, ['想学门乐器']],
        ],
        {
          embedByText: vectors(GREY_PAIR_VECTORS),
          judgeLinkFallback: { kind: 'verdict', related: false },
        },
      );
      const domain = createDomain({ store, provider });

      await readTerms(domain, (await domain.drop(GUITAR_DROP)).id);
      await readTerms(domain, (await domain.drop(HILL_DROP)).id);
      await settledUntil(async () => provider.judged.length > 0);

      assert.deepEqual(await domain.listLinks(), [], 'the judge was asked and said no');
    } finally {
      await store.close();
    }
  });
});

await check('the calibrated bands: 0.87 links, 0.85 skips, and the grey zone between them is the only thing asked about', async () => {
  // Ticket 14 measured the real embedding over 42 labelled pairs of this
  // product's own wordings: related pairs 0.861–0.977, unrelated ones
  // 0.810–0.856, and the known false link at 0.851. It also measured that the
  // same pair moves by up to 0.0125 with the size of the batch it was encoded
  // in, so the gates are pinned at the extremes rather than in the middle.
  // `decideLink` is imported here for the same reason `checkConclusion` is:
  // the bands *are* the rule, and a check that had to reach them through a
  // whole drop could only pin them by accident.
  const bands: readonly (readonly [number, LinkDecision])[] = [
    [0.87, 'link'],
    [0.875, 'link'],
    [0.8633, 'ask'],
    [0.861, 'ask'],
    [0.856, 'ask'],
    [0.851, 'ask'],
    [0.85, 'skip'],
    [0.848, 'skip'],
  ];

  for (const [score, expected] of bands) {
    assert.equal(decideLink(score, DEFAULT_LINK_POLICY), expected, `cosine ${score} should be ${expected}`);
  }
});

await check('the measured false link is put to the judge, and turned down it is not an edge', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      // 琴行的帖子 × 下周三交提纲 measured 0.851 — above the old 0.85 gate,
      // which is how it became a direct edge. It now sits in the grey zone, so
      // whether it is a link is the judge's answer rather than the score's.
      const provider = termsOnly(
        [
          [GUITAR_DROP, ['琴行的帖子']],
          [HILL_DROP, ['下周三交提纲']],
        ],
        {
          embedByText: vectors({
            琴行的帖子: [1, 0],
            下周三交提纲: atCosine(0.851),
          }),
          judgeLinkFallback: { kind: 'verdict', related: false },
        },
      );
      const domain = createDomain({ store, provider });

      await readTerms(domain, (await domain.drop(GUITAR_DROP)).id);
      await readTerms(domain, (await domain.drop(HILL_DROP)).id);
      await settledUntil(async () => provider.judged.length > 0);

      const [asked] = provider.judged;
      assert.equal(provider.judged.length, 1, 'this pair is the one that gets asked about');
      assert.deepEqual(
        [asked?.from, asked?.to].sort(),
        ['下周三交提纲', '琴行的帖子'].sort(),
        'and it is that pair, by both names',
      );
      assert.deepEqual(await domain.listLinks(), [], 'the judge said no, so there is no edge');
    } finally {
      await store.close();
    }
  });
});

await check('a related pair measured on the direct side links on its score alone, with nobody asked', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      // 想学吉他 × 琴行的帖子 measured 0.875: above the direct gate, so the
      // judge is not part of this edge at all.
      const provider = termsOnly(
        [
          [GUITAR_DROP, ['想学吉他']],
          [HILL_DROP, ['琴行的帖子']],
        ],
        {
          embedByText: vectors({
            想学吉他: [1, 0],
            琴行的帖子: atCosine(0.875),
          }),
        },
      );
      const domain = createDomain({ store, provider });

      await readTerms(domain, (await domain.drop(GUITAR_DROP)).id);
      await readTerms(domain, (await domain.drop(HILL_DROP)).id);
      const links = await readLinks(domain, 1);

      const link = linkBetween(links, '想学吉他', '琴行的帖子');
      assert.ok(link !== undefined, 'the pair is an edge');
      assert.equal(link.kind, 'similar', 'the semantic kind');
      assert.ok(
        link.strength !== undefined && Math.abs(link.strength - 0.875) < 1e-9,
        'its strength is the score it got',
      );
      assert.doesNotMatch(link.reason, /灰区/, 'and the reason does not claim a judge decided it');
      assert.deepEqual(provider.judged, [], 'because nobody was asked');
    } finally {
      await store.close();
    }
  });
});

await check('the grey-zone policy can be set to leave the pair unlinked without asking', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      // The policy is a value the core is handed, not a branch buried in it:
      // changing the rule later must not mean editing the linking path.
      const provider = termsOnly(
        [
          [GUITAR_DROP, ['想学吉他']],
          [HILL_DROP, ['想学门乐器']],
        ],
        {
          embedByText: vectors({ 想学吉他: [1, 0], 想学门乐器: [0.8, 0.6] }),
          judgeLinkFallback: { kind: 'verdict', related: true },
        },
      );
      const domain = createDomain({
        store,
        provider,
        linkPolicy: { connectAbove: 0.85, skipBelow: 0.7, greyZone: 'skip' },
      });

      await readTerms(domain, (await domain.drop(GUITAR_DROP)).id);
      await readTerms(domain, (await domain.drop(HILL_DROP)).id);
      await settledUntil(async () => false);

      assert.deepEqual(await domain.listLinks(), [], 'the grey pair is left unlinked for now');
      assert.deepEqual(provider.judged, [], 'and nobody was asked about it');
    } finally {
      await store.close();
    }
  });
});

await check('the bands come from the thresholds the core was given, not from fixed numbers', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = termsOnly(
        [
          [GUITAR_DROP, ['想学吉他']],
          [HILL_DROP, ['想学门乐器']],
        ],
        {
          embedByText: vectors({ 想学吉他: [1, 0], 想学门乐器: [0.8, 0.6] }),
          judgeLinkFallback: { kind: 'verdict', related: false },
        },
      );
      const domain = createDomain({
        store,
        provider,
        linkPolicy: { connectAbove: 0.75, skipBelow: 0.5, greyZone: 'judge' },
      });

      await readTerms(domain, (await domain.drop(GUITAR_DROP)).id);
      await readTerms(domain, (await domain.drop(HILL_DROP)).id);
      const links = await readLinks(domain, 1);

      assert.ok(
        linkBetween(links, '想学吉他', '想学门乐器') !== undefined,
        'the same 0.8 pair now connects on its score alone',
      );
      assert.deepEqual(provider.judged, [], 'so the judge is not consulted at all');
    } finally {
      await store.close();
    }
  });
});

await check('strengths are comparable across both kinds of link', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const third = '再想想学琴的事';
      const provider = termsOnly(
        [
          [GUITAR_DROP, ['报个吉他班', '想去爬山']],
          [third, ['想学吉他']],
        ],
        { embedByText: vectors({ 报个吉他班: [1, 0], 想去爬山: [0, 1], 想学吉他: [0.9, 0.4358898943540674] }) },
      );
      const domain = createDomain({ store, provider });

      await readTerms(domain, (await domain.drop(GUITAR_DROP)).id);
      await readTerms(domain, (await domain.drop(third)).id);
      const links = await readLinks(domain, 3);

      const hard = links.find((link) => link.kind === 'same-drop');
      const soft = links.find((link) => link.kind === 'similar');
      assert.ok(hard !== undefined && soft !== undefined, 'both kinds are present');
      assert.ok(
        hard.strength > soft.strength,
        'and a hard edge outranks a merely similar one on the same scale',
      );
      assert.notEqual(hard.reason, soft.reason, 'the two reasons say different things');
    } finally {
      await store.close();
    }
  });
});

await check('a provider that cannot embed costs the semantic link and nothing else', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = termsOnly(
        [
          [GUITAR_DROP, ['报个吉他班', '想去爬山']],
          [HILL_DROP, ['想去爬山']],
        ],
        { embedFallback: { kind: 'fail', reason: 'no embedding endpoint' } },
      );
      const domain = createDomain({ store, provider });

      await readTerms(domain, (await domain.drop(GUITAR_DROP)).id);
      await readTerms(domain, (await domain.drop(HILL_DROP)).id);
      const links = await readLinks(domain, 1);

      assert.deepEqual(
        links.map((link) => link.kind),
        ['same-drop'],
        'the hard edge survives a provider that cannot embed',
      );
      assert.equal(
        (await domain.listDrops()).length,
        2,
        'and both drops are still there, with their terms',
      );
      assert.equal((await domain.listDrops())[1]?.terms.length, 1);
    } finally {
      await store.close();
    }
  });
});

await check('a provider that blows up in the grey zone does not turn the pair into a link', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = termsOnly(
        [
          [GUITAR_DROP, ['想学吉他']],
          [HILL_DROP, ['想学门乐器']],
        ],
        {
          embedByText: vectors(GREY_PAIR_VECTORS),
          judgeLinkFallback: { kind: 'throw', reason: 'judge blew up' },
        },
      );
      const domain = createDomain({ store, provider });

      await readTerms(domain, (await domain.drop(GUITAR_DROP)).id);
      await readTerms(domain, (await domain.drop(HILL_DROP)).id);
      await settledUntil(async () => provider.judged.length > 0);

      // Asked at all is half the claim: if the bands ever move again and this
      // pair stops landing in the grey zone, the check would otherwise pass
      // without ever reaching the failure it exists for.
      assert.equal(provider.judged.length, 1, 'the pair is in the grey zone, so it is asked about');
      assert.deepEqual(
        await domain.listLinks(),
        [],
        'an unanswered question is not an answer, so no link is invented',
      );
    } finally {
      await store.close();
    }
  });
});

await check('terms and their links survive reopening the database', async () => {
  await withDatabase(async (file) => {
    const provider = termsOnly(
      [
        [GUITAR_DROP, ['想学吉他']],
        [HILL_DROP, ['打算学吉他']],
      ],
      { embedByText: vectors({ 想学吉他: [1, 0], 打算学吉他: [1, 0] }) },
    );

    const first = openSqliteStore(file);
    const domain = createDomain({ store: first, provider });
    await readTerms(domain, (await domain.drop(GUITAR_DROP)).id);
    await readTerms(domain, (await domain.drop(HILL_DROP)).id);
    await readLinks(domain, 1);
    await first.close();

    const second = openSqliteStore(file);
    try {
      const links = await createDomain({ store: second }).listLinks();
      assert.equal(links.length, 1, 'the link is on disk, not in memory');
      const [drop] = await createDomain({ store: second }).listDrops();
      assert.deepEqual(drop?.terms.map((term) => term.text), ['想学吉他']);
    } finally {
      await second.close();
    }
  });
});

await check('two things said together outrank an earlier reading of the same pair', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      // The same two terms, met twice: first as words that looked close, then —
      // in a later fragment — actually said together. There is one link between
      // them either way, and it has to end up being the fact rather than the
      // reading, because that is the stronger evidence and ticket 05 word its
      // conclusions from the strength.
      const both = '想学吉他和打算学吉他都还想，先看看琴';
      const provider = termsOnly(
        [
          [GUITAR_DROP, ['想学吉他']],
          [HILL_DROP, ['打算学吉他']],
          [both, ['想学吉他', '打算学吉他']],
        ],
        {
          embedByText: vectors({
            想学吉他: [1, 0],
            打算学吉他: [0.9, 0.4358898943540674],
          }),
        },
      );
      const domain = createDomain({ store, provider });

      await readTerms(domain, (await domain.drop(GUITAR_DROP)).id);
      await readTerms(domain, (await domain.drop(HILL_DROP)).id);
      const read = await readLinks(domain, 1);
      assert.equal(linkBetween(read, '想学吉他', '打算学吉他')?.kind, 'similar', 'the reading came first');

      await readTerms(domain, (await domain.drop(both)).id);
      await settledUntil(async () => false);

      const links = await domain.listLinks();
      const link = linkBetween(links, '想学吉他', '打算学吉他');
      assert.equal(links.length, 1, 'saying them together did not add a second link');
      assert.equal(link?.kind, 'same-drop', 'it took the pair over from the similarity');
      assert.equal(link?.strength, 1, 'with the strength of something that certainly happened');
      assert.match(link?.reason ?? '', /同一次投递/, 'and a reason that says so');
    } finally {
      await store.close();
    }
  });
});

await check('terms whose vectors were both missing are compared once they arrive', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      // A provider that is down cannot embed anything, and a term with no vector
      // is a pair that cannot be decided. Both of these were left behind by that
      // outage, from different drops; the round that finally encodes them has to
      // compare them with each other, not only with the term that happens to be
      // being dropped today — otherwise the pair waits for a repeat that may
      // never come.
      const down = termsOnly(
        [
          [GUITAR_DROP, ['想学吉他']],
          [HILL_DROP, ['打算学吉他']],
        ],
        { embedFallback: { kind: 'fail', reason: 'embedding endpoint is down' } },
      );
      const backUp = termsOnly([[THIRD_DROP, ['想去爬山']]], {
        embedByText: vectors({ 想学吉他: [1, 0], 打算学吉他: [1, 0], 想去爬山: [0, 1] }),
      });

      const before = createDomain({ store, provider: down });
      await readTerms(before, (await before.drop(GUITAR_DROP)).id);
      await readTerms(before, (await before.drop(HILL_DROP)).id);
      await settledUntil(async () => false);
      assert.deepEqual(await before.listLinks(), [], 'the outage left both terms uncompared');

      const after = createDomain({ store, provider: backUp });
      await readTerms(after, (await after.drop(THIRD_DROP)).id);
      const links = await readLinks(after, 1);

      const link = linkBetween(links, '想学吉他', '打算学吉他');
      assert.ok(link !== undefined, 'the two stranded terms were compared with each other');
      assert.equal(link.kind, 'similar');
      assert.equal(
        linkBetween(links, '想去爬山', '想学吉他'),
        undefined,
        'and the term that arrived today connected to neither of them',
      );
    } finally {
      await store.close();
    }
  });
});

await check('vectors from a different embedding model are never compared', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      // The spec lets the embedding implementation be swapped, and a stored
      // vector then belongs to a model the new one knows nothing about. The two
      // are the same length here on purpose — the point is that a long vector
      // and a short one must not be compared on the part they happen to share,
      // which would read as a perfect match and become a link.
      const wide = termsOnly(
        [
          [GUITAR_DROP, ['想学吉他']],
          [HILL_DROP, ['想去爬山']],
        ],
        { embedByText: vectors({ 想学吉他: [1, 0], 想去爬山: [0, 1] }) },
      );
      const swapped = termsOnly([[SWAP_DROP, ['想学门乐器']]], {
        embedByText: vectors({ 想学门乐器: [1, 0, 0] }),
      });

      const before = createDomain({ store, provider: wide });
      await readTerms(before, (await before.drop(GUITAR_DROP)).id);
      await readTerms(before, (await before.drop(HILL_DROP)).id);

      const after = createDomain({ store, provider: swapped });
      await readTerms(after, (await after.drop(SWAP_DROP)).id);
      await settledUntil(async () => false);

      assert.deepEqual(
        await after.listLinks(),
        [],
        'a vector from another model is not a measurement of anything',
      );
    } finally {
      await store.close();
    }
  });
});

console.log('\ndomain core — what settles into a conclusion');

/**
 * A fragment, the terms it yields, the feeling or decision it is about, and —
 * where a check needs it — what the model judged the drop to be.
 *
 * The fourth element is optional and defaults to an emotional drop, because that
 * is what most checks are about; the ones about the **trigger** have to be able to
 * hand the domain a drop that is read as something else.
 */
type AnchoredReading = readonly [
  body: string,
  terms: readonly string[],
  anchor: string | null,
  inputType?: InputType,
];

/**
 * Script the fake to read those fragments into those terms and anchors, and
 * nothing else. Nothing is scripted for embedding, judging or composing unless
 * the check adds it, which is how a check can tell "code decided this" from "a
 * model said this".
 */
function mattersOnly(
  readings: readonly AnchoredReading[],
  extra: Omit<FakeProviderScript, 'extractByBody'> = {},
): ReturnType<typeof createFakeProvider> {
  const extractByBody: Record<string, ExtractScript> = {};
  for (const [body, terms, anchor, inputType] of readings) {
    extractByBody[body] = {
      kind: 'read',
      reading: { inputType: inputType ?? 'emotion', items: [], terms, anchor },
    };
  }
  return createFakeProvider({ ...extra, extractByBody });
}

/** Wait until at least `count` conclusions exist, then hand back every one. */
async function readConclusions(domain: Domain, count: number): Promise<readonly Conclusion[]> {
  await settledUntil(async () => (await domain.listConclusions()).length >= count);
  return domain.listConclusions();
}

/**
 * One matter said three times, in the demo's own material: the grading scheme,
 * the outline that keeps being rewritten, and the 40% nobody explained.
 *
 * The three fragments share 「好烦」 and almost nothing else, which is what the
 * rarity weighting is for — see the check that pins it.
 */
const EXAM_FIRST = '老师今天讲了期末怎么算分，下周三交提纲，好烦';
const EXAM_SECOND = '今天又在改提纲，好烦';
const EXAM_THIRD = '平时分那 40% 到底怎么算，好烦';
const EXAM_READINGS: readonly AnchoredReading[] = [
  [EXAM_FIRST, ['期末怎么算分', '下周三交提纲', '好烦'], '好烦'],
  [EXAM_SECOND, ['改提纲', '好烦'], '好烦'],
  [EXAM_THIRD, ['平时分 40%', '好烦'], '好烦'],
];

/** Every term the three fragments contributed, in the order they were said. */
const EXAM_SUPPORT = ['期末怎么算分', '下周三交提纲', '好烦', '改提纲', '平时分 40%'];

/**
 * A fourth fragment about the same matter, arriving once a conclusion has been
 * made — the crossing the alternation decides to leave to the quiet window.
 */
const EXAM_FOURTH = '期末考那一项到底考什么，好烦';
const EXAM_FOURTH_READING: AnchoredReading = [EXAM_FOURTH, ['期末考', '好烦'], '好烦'];

/** What the fake says about a matter it is asked to put into a sentence. */
const EXAM_SENTENCE = '你最近好像有几件事堆在一起';

await check('a matter raised three times becomes one conclusion, with the terms that support it', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = mattersOnly(EXAM_READINGS, {
        composeConclusionByAnchor: { 好烦: { kind: 'sentence', text: EXAM_SENTENCE } },
      });
      const domain = createDomain({ store, provider });

      for (const body of [EXAM_FIRST, EXAM_SECOND, EXAM_THIRD]) await domain.drop(body);
      const conclusions = await readConclusions(domain, 1);

      assert.equal(conclusions.length, 1, 'three mentions are enough for one sentence');
      const [conclusion] = conclusions;
      assert.equal(conclusion?.kind, 'claim');
      // Same session, so nothing has spanned yet: the weak band is the one whose
      // frame says outright that it is unsure.
      assert.equal(conclusion?.tier, 'weak');
      assert.equal(
        conclusion?.text,
        '我不太确定：你最近好像有几件事堆在一起。',
        'the sentence is the provider\'s, the frame is the product\'s',
      );
      assert.deepEqual(
        conclusion?.support.map((term) => term.text),
        EXAM_SUPPORT,
        'the whole supporting set, in the user\'s own words',
      );
      assert.equal(conclusion?.mentions, 3);
      assert.equal(conclusion?.relation, 'first');
      assert.equal(conclusion?.supersedes, null);
      assert.equal(conclusion?.supersededBy, null);
      assert.ok(Number.isFinite(Date.parse(conclusion?.createdAt ?? '')));
    } finally {
      await store.close();
    }
  });
});

/**
 * A fragment that carries neither a feeling nor a decision, so there is nothing
 * for an accumulation to be *about*. Its terms are still kept.
 */
const WEATHER_DROP = '今天天气不错，适合出门走走';

/** Wait until every drop has been read, so a look has had its chance to run. */
async function settleReadings(domain: Domain): Promise<void> {
  await settledUntil(async () => (await domain.listDrops()).every((drop) => drop.extracted));
  // A look may still be in flight behind the reading; give the invisible work
  // the same small moment the checks below give it before asserting on absence.
  await new Promise((resolve) => setTimeout(resolve, 50));
}

await check('two mentions are not enough to say anything', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = mattersOnly(EXAM_READINGS.slice(0, 2), {
        composeConclusionByAnchor: { 好烦: { kind: 'sentence', text: EXAM_SENTENCE } },
      });
      const domain = createDomain({ store, provider });

      await domain.drop(EXAM_FIRST);
      await domain.drop(EXAM_SECOND);
      await settleReadings(domain);

      assert.deepEqual(
        await domain.listConclusions(),
        [],
        'the third time is what the threshold is set at',
      );
      assert.equal(provider.composed.length, 0, 'and nobody was asked to phrase anything');
    } finally {
      await store.close();
    }
  });
});

await check('a fragment with no feeling and no decision is kept, and accumulates into nothing', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = mattersOnly(
        [
          [EXAM_FIRST, ['期末怎么算分', '下周三交提纲', '好烦'], '好烦'],
          [WEATHER_DROP, ['天气不错'], null],
        ],
        { composeConclusionByAnchor: { 好烦: { kind: 'sentence', text: EXAM_SENTENCE } } },
      );
      const domain = createDomain({ store, provider });

      await domain.drop(EXAM_FIRST);
      const weather = await domain.drop(WEATHER_DROP);
      // Said three times, so the count alone would have been enough — what is
      // missing is something to be about.
      await domain.drop(WEATHER_DROP);
      await domain.drop(WEATHER_DROP);
      await settleReadings(domain);

      assert.deepEqual(await domain.listConclusions(), [], 'there is no "about" to mark');
      assert.deepEqual(
        (await domain.getDrop(weather.id))?.terms.map((term) => term.text),
        ['天气不错'],
        'and the words said are kept all the same',
      );
    } finally {
      await store.close();
    }
  });
});

/**
 * The policy a check pins, spelled out rather than spread from the default.
 *
 * A check should fail when the rule it is about changes, and a policy built by
 * spreading the default would quietly follow one. The window is a minute unless
 * a check says otherwise, which is "long enough that the timer cannot be what
 * makes this check pass".
 */
function policy(overrides: Partial<ConclusionPolicy> = {}): ConclusionPolicy {
  return {
    threshold: 3,
    quietWindowMs: 60_000,
    pendingLimit: 6,
    judgeTiming: 'alternate',
    claimFloor: 3,
    overlapRatio: 0.5,
    weightSharedBySpread: true,
    overturnedOverlapFactor: 0.3,
    overturnedBandDrop: 1,
    mediumTerms: 3,
    mediumSpanDays: 3,
    strongTerms: 6,
    strongSpanDays: 14,
    strongStrength: 0.8,
    ...overrides,
  };
}

await check('the quiet window holds a crossing back until the fragments stop coming', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = mattersOnly(EXAM_READINGS, {
        composeConclusionByAnchor: { 好烦: { kind: 'sentence', text: EXAM_SENTENCE } },
      });
      const domain = createDomain({
        store,
        provider,
        conclusionPolicy: policy({ judgeTiming: 'quiet', quietWindowMs: 10_000 }),
      });

      for (const body of [EXAM_FIRST, EXAM_SECOND, EXAM_THIRD]) await domain.drop(body);
      await settleReadings(domain);

      assert.deepEqual(
        await domain.listConclusions(),
        [],
        'three sentences in one sitting are one thought, and it is still being had',
      );
      assert.equal(provider.composed.length, 0, 'so nothing was phrased yet either');
    } finally {
      await store.close();
    }
  });
});

await check('once the fragments have gone quiet, the look happens on its own', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = mattersOnly(EXAM_READINGS, {
        composeConclusionByAnchor: { 好烦: { kind: 'sentence', text: EXAM_SENTENCE } },
      });
      // No further drop, and nobody asking: only the quiet window can make this
      // pass, which is what makes it a check on the window rather than on the
      // count trigger.
      const domain = createDomain({
        store,
        provider,
        conclusionPolicy: policy({ judgeTiming: 'quiet', quietWindowMs: 40 }),
      });

      for (const body of [EXAM_FIRST, EXAM_SECOND, EXAM_THIRD]) await domain.drop(body);
      const conclusions = await readConclusions(domain, 1);

      assert.equal(conclusions.length, 1, 'the window ended, so it looked');
    } finally {
      await store.close();
    }
  });
});

await check('the backstop forces a look for someone who never pauses', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = mattersOnly(EXAM_READINGS, {
        composeConclusionByAnchor: { 好烦: { kind: 'sentence', text: EXAM_SENTENCE } },
      });
      // The window is an hour: if anything settles here, it is the backstop.
      const domain = createDomain({
        store,
        provider,
        conclusionPolicy: policy({
          judgeTiming: 'quiet',
          quietWindowMs: 3_600_000,
          pendingLimit: 3,
        }),
      });

      for (const body of [EXAM_FIRST, EXAM_SECOND, EXAM_THIRD]) await domain.drop(body);
      const conclusions = await readConclusions(domain, 1);

      assert.equal(conclusions.length, 1, 'three drops in is where the backstop looks');
    } finally {
      await store.close();
    }
  });
});

await check('the look alternates: the crossing after a spoken one waits for the window', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = mattersOnly(
        [...EXAM_READINGS, EXAM_FOURTH_READING],
        { composeConclusionByAnchor: { 好烦: { kind: 'sentence', text: EXAM_SENTENCE } } },
      );
      // The window is short enough to end inside the check, and long enough that
      // the assertion below cannot race it.
      const domain = createDomain({
        store,
        provider,
        conclusionPolicy: policy({ quietWindowMs: 300 }),
      });

      for (const body of [EXAM_FIRST, EXAM_SECOND, EXAM_THIRD]) await domain.drop(body);
      assert.equal((await readConclusions(domain, 1)).length, 1, 'the first crossing looks now');
      assert.equal(provider.composed.length, 1, 'and it is spoken about immediately');

      // A fourth mention crosses the threshold again, and the turn has turned.
      await domain.drop(EXAM_FOURTH);
      await settleReadings(domain);
      assert.equal(
        (await domain.listConclusions()).length,
        1,
        'this crossing is left to the quiet window, so nothing was said at the drop',
      );
      assert.equal(provider.composed.length, 1, 'and nobody was asked, either');

      assert.equal(
        (await readConclusions(domain, 2)).length,
        2,
        'once it goes quiet, the second conclusion arrives',
      );
      assert.ok(provider.composed.length >= 2, 'and the provider was asked that time');
    } finally {
      await store.close();
    }
  });
});

/** Three fragments about three different things, sharing only the word 好烦. */
const THESIS_DROP = '论文开题被导师打回了，好烦';
const ROOMMATE_DROP = '室友半夜还在打游戏，好烦';
const SLEEP_DROP = '又睡不好，好烦';

await check('the threshold is a value the core was given, not a fixed number', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = mattersOnly([...EXAM_READINGS, EXAM_FOURTH_READING], {
        composeConclusionByAnchor: { 好烦: { kind: 'sentence', text: EXAM_SENTENCE } },
      });
      const strict = createDomain({
        store,
        provider,
        conclusionPolicy: policy({ threshold: 4, judgeTiming: 'count' }),
      });

      for (const body of [EXAM_FIRST, EXAM_SECOND, EXAM_THIRD]) await strict.drop(body);
      await settleReadings(strict);
      assert.deepEqual(await strict.listConclusions(), [], 'three is not enough at a threshold of four');

      // A different value on the same material, and the next drop is the one it
      // governs: the five fragments already read are not rewritten by it.
      const lenient = createDomain({
        store,
        provider,
        conclusionPolicy: policy({ judgeTiming: 'count' }),
      });
      await lenient.drop(EXAM_FOURTH);
      const conclusions = await readConclusions(lenient, 1);

      assert.equal(conclusions.length, 1, 'and the crossing is judged once the value allows it');
      assert.equal(conclusions[0]?.mentions, 4, 'with the count it had when it was judged');
    } finally {
      await store.close();
    }
  });
});

await check('a shared word spread across matters stops counting as evidence, so two things stay two', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = mattersOnly(
        [
          [THESIS_DROP, ['论文开题', '导师', '好烦'], '好烦'],
          [ROOMMATE_DROP, ['打游戏', '室友', '好烦'], '好烦'],
          [SLEEP_DROP, ['睡不好', '好烦'], '好烦'],
        ],
        {
          // 好烦 is the only word the three share, so the weighting is the only
          // thing that can keep them apart.
          composeConclusionByAnchor: { 好烦: { kind: 'sentence', text: '你最近好像有几件事堆在一起' } },
        },
      );
      const domain = createDomain({ store, provider, conclusionPolicy: policy({ judgeTiming: 'count' }) });

      await domain.drop(THESIS_DROP);
      await domain.drop(ROOMMATE_DROP);
      await domain.drop(SLEEP_DROP);
      // 论文开题 said three times, so the threshold is crossed — and what the
      // conclusion is made of is the question this check is about.
      await domain.drop(THESIS_DROP);
      await domain.drop(THESIS_DROP);
      const conclusions = await readConclusions(domain, 1);

      assert.equal(conclusions.length, 1);
      assert.deepEqual(
        conclusions[0]?.support.map((term) => term.text),
        ['论文开题', '导师', '好烦'],
        'only the words that belong to the matter it is about',
      );
    } finally {
      await store.close();
    }
  });
});

await check('with the weighting off, the same three sentences merge — the misfire it prevents', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = mattersOnly(
        [
          [THESIS_DROP, ['论文开题', '导师', '好烦'], '好烦'],
          [ROOMMATE_DROP, ['打游戏', '室友', '好烦'], '好烦'],
          [SLEEP_DROP, ['睡不好', '好烦'], '好烦'],
        ],
        {
          composeConclusionByAnchor: { 好烦: { kind: 'sentence', text: '你最近好像有几件事堆在一起' } },
        },
      );
      const domain = createDomain({
        store,
        provider,
        conclusionPolicy: policy({ judgeTiming: 'count', weightSharedBySpread: false }),
      });

      await domain.drop(THESIS_DROP);
      await domain.drop(ROOMMATE_DROP);
      await domain.drop(SLEEP_DROP);
      // The fourth is what the first matter needs, because 睡不好 joined it and
      // 论文开题 was only said twice.
      await domain.drop(THESIS_DROP);
      const conclusions = await readConclusions(domain, 1);

      // Three mentions is reached by the fourth fragment here, because 打游戏
      // stayed out but 睡不好 was pulled into the first matter on one word.
      assert.equal(conclusions.length, 1);
      assert.deepEqual(
        conclusions[0]?.support.map((term) => term.text),
        ['论文开题', '导师', '好烦', '睡不好'],
        'the roommate fragment is a matter of its own even so; the sleep one is not',
      );
    } finally {
      await store.close();
    }
  });
});

/** A clock a check can move, so a matter may span days without anyone waiting. */
function simulatedClock(start: string): { now: () => string; advanceDays: (days: number) => void } {
  let at = Date.parse(start);
  return {
    now: () => new Date(at).toISOString(),
    advanceDays: (days: number) => {
      at += days * 86_400_000;
    },
  };
}

/** A matter opened by 好烦 that later carries 松了口气: the author's own case. */
const THESIS_REJECT = '论文开题被导师打回了，好烦';
const INTERN_REPORT = '导师让我这周交实习报告，好烦';
const THESIS_PROGRESS = '论文开题又改了一版，导师说方向可以了，松了口气';

/** What the fake says about each feeling it is asked to put into a sentence. */
const SENTENCE_BY_FEELING = {
  好烦: { kind: 'sentence', text: EXAM_SENTENCE },
  松了口气: { kind: 'sentence', text: '论文这条线最近总算松开了一点' },
} as const;

await check('the sentence follows the newest feeling, not the one that opened the matter', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = mattersOnly(
        [
          [THESIS_REJECT, ['论文开题', '导师', '好烦'], '好烦'],
          [INTERN_REPORT, ['实习报告', '导师', '好烦'], '好烦'],
          [THESIS_PROGRESS, ['论文开题', '导师', '松了口气'], '松了口气'],
        ],
        { composeConclusionByAnchor: SENTENCE_BY_FEELING },
      );
      const domain = createDomain({ store, provider });

      for (const body of [THESIS_REJECT, INTERN_REPORT, THESIS_PROGRESS]) await domain.drop(body);
      const conclusions = await readConclusions(domain, 1);

      assert.equal(provider.composed.length, 1);
      assert.equal(
        provider.composed[0]?.anchor,
        '松了口气',
        'the person is in the newest feeling, not the one they opened with',
      );
      assert.equal(conclusions[0]?.text, '我不太确定：论文这条线最近总算松开了一点。');
      assert.deepEqual(
        conclusions[0]?.support.map((term) => term.text),
        ['论文开题', '导师', '好烦', '实习报告', '松了口气'],
        'while the material behind it keeps everything that was said',
      );
    } finally {
      await store.close();
    }
  });
});

await check('how firmly it may speak is read off terms, span and connection — not off the threshold', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const clock = simulatedClock('2026-09-01T09:00:00.000Z');
      const provider = mattersOnly(
        [...EXAM_READINGS, EXAM_FOURTH_READING],
        { composeConclusionByAnchor: SENTENCE_BY_FEELING },
      );
      const domain = createDomain({
        store,
        provider,
        conclusionPolicy: policy({ judgeTiming: 'count' }),
        now: clock.now,
      });

      await domain.drop(EXAM_FIRST);
      clock.advanceDays(1);
      await domain.drop(EXAM_SECOND);
      clock.advanceDays(15);
      await domain.drop(EXAM_THIRD);
      const [medium] = await readConclusions(domain, 1);

      assert.equal(medium?.tier, 'medium', 'five terms over sixteen days is not hedged any more');
      assert.equal(medium?.mentions, 3);
      assert.equal(medium?.spanDays, 16);
      assert.equal(medium?.text, `${EXAM_SENTENCE}。`, 'so the frame adds nothing');

      clock.advanceDays(1);
      await domain.drop(EXAM_FOURTH);
      const conclusions = await readConclusions(domain, 2);
      const strong = conclusions[1];

      assert.equal(strong?.tier, 'strong', 'six terms, seventeen days and tight links');
      assert.equal(strong?.spanDays, 17);
      assert.equal(strong?.averageStrength, 1, 'every term was said in the same breath as the feeling');
      assert.equal(strong?.text, `这段时间我看到一条线：${EXAM_SENTENCE}。`);
      assert.deepEqual(
        provider.composed.map((request) => request.tier),
        ['medium', 'strong'],
        'and the band travels with the sentence, so the provider knows how it will read',
      );
    } finally {
      await store.close();
    }
  });
});

await check('too few terms to claim anything, so it catches the newest feeling instead — at no model cost', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const body = '今天又在改提纲，好烦';
      const provider = mattersOnly([[body, ['改提纲', '好烦'], '好烦']], {
        // The line the drop was answered with. A catch reuses it rather than
        // asking for a sentence: it claims nothing, so there is nothing to phrase.
        byBody: { [body]: { kind: 'reply', reply: '那样真好。' } },
        composeConclusionByAnchor: SENTENCE_BY_FEELING,
      });
      // The window gives the drop's own line its moment to land, which is what
      // makes "the catch is that line" checkable rather than a race.
      const domain = createDomain({
        store,
        provider,
        conclusionPolicy: policy({ judgeTiming: 'quiet', quietWindowMs: 50 }),
      });

      for (let time = 0; time < 3; time += 1) await domain.drop(body);
      const [caught] = await readConclusions(domain, 1);

      assert.equal(caught?.kind, 'catch', 'two terms is not something to make a claim from');
      assert.equal(caught?.tier, null, 'and a catch asserts nothing, so no band applies');
      assert.equal(caught?.text, '那样真好。', 'it says the line the newest feeling was answered with');
      assert.equal(caught?.mentions, 3, 'even though the threshold was crossed');
      assert.deepEqual(provider.composed, [], 'the model was never asked to judge anything');
    } finally {
      await store.close();
    }
  });
});

await check('a sentence that breaks the rules is asked for once more, and told what it broke', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const requests: string[][] = [];
      const provider = mattersOnly(EXAM_READINGS, {
        composeConclusionAttempts: {
          好烦: [
            { kind: 'sentence', text: '你是不是想学吉他？' },
            { kind: 'sentence', text: EXAM_SENTENCE },
          ],
        },
        onComposeConclusion: (request) => {
          requests.push([...(request.violations ?? [])]);
        },
      });
      const domain = createDomain({ store, provider });

      for (const body of [EXAM_FIRST, EXAM_SECOND, EXAM_THIRD]) await domain.drop(body);
      const conclusions = await readConclusions(domain, 1);

      assert.equal(conclusions.length, 1, 'the second attempt passed');
      assert.equal(conclusions[0]?.text, `我不太确定：${EXAM_SENTENCE}。`);
      assert.equal(requests.length, 2, 'one attempt and one retry, no more');
      assert.deepEqual(requests[0], [], 'the first attempt was told nothing');
      assert.ok(
        (requests[1] ?? []).includes('question'),
        'and the retry was told what the first one broke',
      );
    } finally {
      await store.close();
    }
  });
});

await check('a sentence that cannot be composed leaves the matter unspoken rather than invented', async () => {
  await withDatabase(async (file) => {
    const first = openSqliteStore(file);
    const clock = simulatedClock('2026-09-01T09:00:00.000Z');
    try {
      const broken = mattersOnly(EXAM_READINGS, {
        composeConclusionFallback: { kind: 'fail', reason: 'the model is down' },
      });
      const domain = createDomain({
        store: first,
        provider: broken,
        conclusionPolicy: policy({ judgeTiming: 'count' }),
        now: clock.now,
      });

      for (const body of [EXAM_FIRST, EXAM_SECOND, EXAM_THIRD]) await domain.drop(body);
      await settleReadings(domain);
      assert.deepEqual(await domain.listConclusions(), [], 'nothing was said, and nothing invented');
      assert.ok(broken.composed.length > 0, 'it was asked, and it failed every time it was');
    } finally {
      await first.close();
    }

    // A provider that does answer, on the same material: the crossing was never
    // spent, so the next look speaks about it.
    const second = openSqliteStore(file);
    try {
      const working = mattersOnly([...EXAM_READINGS, EXAM_FOURTH_READING], {
        composeConclusionByAnchor: SENTENCE_BY_FEELING,
      });
      const domain = createDomain({
        store: second,
        provider: working,
        conclusionPolicy: policy({ judgeTiming: 'count' }),
        now: clock.now,
      });

      clock.advanceDays(1);
      await domain.drop(EXAM_FOURTH);
      const conclusions = await readConclusions(domain, 1);

      assert.equal(conclusions.length, 1, 'the material was still pending');
      assert.equal(conclusions[0]?.mentions, 4, 'and it carries everything said by then');
    } finally {
      await second.close();
    }
  });
});

await check('a later conclusion carries the chain on, and the earlier one is not replaced', async () => {
  await withDatabase(async (file) => {
    const first = openSqliteStore(file);
    const clock = simulatedClock('2026-09-01T09:00:00.000Z');
    const provider = mattersOnly(
      [...EXAM_READINGS, EXAM_FOURTH_READING],
      { composeConclusionByAnchor: SENTENCE_BY_FEELING },
    );
    try {
      const domain = createDomain({
        store: first,
        provider,
        conclusionPolicy: policy({ judgeTiming: 'count' }),
        now: clock.now,
      });

      for (const body of [EXAM_FIRST, EXAM_SECOND, EXAM_THIRD]) await domain.drop(body);
      const [opened] = await readConclusions(domain, 1);
      clock.advanceDays(1);
      await domain.drop(EXAM_FOURTH);
      const conclusions = await readConclusions(domain, 2);
      const [earlier, later] = conclusions;

      assert.equal(earlier?.relation, 'first');
      assert.equal(later?.relation, 'inherit');
      assert.equal(later?.supersedes?.id, earlier?.id, 'the chain points backwards');
      assert.equal(later?.supersedes?.text, earlier?.text);
      assert.equal(earlier?.supersededBy?.id, later?.id, 'and forwards, without being stored twice');
      assert.equal(opened?.text, earlier?.text, 'the earlier sentence was not rewritten');
    } finally {
      await first.close();
    }

    // The same chain, read from a process that did not make it.
    const second = openSqliteStore(file);
    try {
      const conclusions = await createDomain({ store: second }).listConclusions();
      assert.equal(conclusions.length, 2, 'both conclusions are on disk');
      assert.equal(
        conclusions[0]?.supersededBy?.id,
        conclusions[1]?.id,
        'and so is the relation between them',
      );
      assert.deepEqual(
        Object.keys(conclusions[0] ?? {}).sort(),
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
        'with nothing of the scaffolding it was assembled from',
      );
    } finally {
      await second.close();
    }
  });
});

await check('one rich fragment is still one mention: the threshold counts times, not terms', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      // Six terms in one breath. Counting terms would call this enough to speak
      // on its own; counting times says it has been said once.
      const rich = '期末怎么算分、平时分 40%、下周三交提纲、期末考、提纲格式，还有好烦';
      const provider = mattersOnly(
        [[rich, ['期末怎么算分', '平时分 40%', '下周三交提纲', '期末考', '提纲格式', '好烦'], '好烦']],
        { composeConclusionByAnchor: SENTENCE_BY_FEELING },
      );
      const domain = createDomain({ store, provider });

      await domain.drop(rich);
      await settleReadings(domain);
      assert.deepEqual(await domain.listConclusions(), [], 'said once is said once');

      await domain.drop(rich);
      await domain.drop(rich);
      const [conclusion] = await readConclusions(domain, 1);

      assert.equal(conclusion?.mentions, 3, 'the third time is what the threshold counts');
      assert.equal(conclusion?.support.length, 6, 'and everything it said is behind it');
    } finally {
      await store.close();
    }
  });
});

await check('a catch keeps a conclusion\'s shape, even when the feeling\'s own line does not', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const body = '今天又在改提纲，好烦';
      // A perfectly good *reply*: two sentences, and one of them a question.
      // A conclusion — or a catch standing in for one — may be neither.
      const asking = '听着今天不太好受。要不要说说？';
      const provider = mattersOnly([[body, ['改提纲', '好烦'], '好烦']], {
        byBody: { [body]: { kind: 'reply', reply: asking } },
        composeConclusionByAnchor: SENTENCE_BY_FEELING,
      });
      const domain = createDomain({
        store,
        provider,
        conclusionPolicy: policy({ judgeTiming: 'quiet', quietWindowMs: 50 }),
      });

      const dropped = await domain.drop(body);
      await domain.drop(body);
      await domain.drop(body);
      const [caught] = await readConclusions(domain, 1);

      assert.equal(
        (await domain.getDrop(dropped.id))?.reply,
        asking,
        'the drop itself was answered with that line',
      );
      assert.equal(caught?.kind, 'catch');
      assert.equal(caught?.text, '嗯，我在。', 'and the catch falls back to the line code owns');
    } finally {
      await store.close();
    }
  });
});

console.log('\ndomain core — surfacing');

/**
 * The surfacing rules a check pins, spelled out rather than spread from the
 * default, for the same reason as `policy`: a check should fail when the rule it
 * is about changes. The chance is 1 because a matter that may speak speaks on
 * the first roll — the checks that are about the dice override it.
 *
 * The weighting is deliberately **not** here. A shared word is counted the one
 * way accumulation already counts it, and that switch lives in
 * `ConclusionPolicy`: two switches for one measurement would drift.
 */
function surfacingPolicy(overrides: Partial<SurfacingPolicy> = {}): SurfacingPolicy {
  return {
    cooldownMs: 7 * 86_400_000,
    topicOverlapRatio: 0.5,
    surfaceChance: 1,
    answerFloor: 2,
    answerLimit: 4,
    ...overrides,
  };
}

/** The surfaced payload, or a failed assertion — a `none` result never reaches it. */
function surfacedOf(result: SurfacingResult): Extract<SurfacingResult, { kind: 'surfaced' }> {
  assert.equal(result.kind, 'surfaced', `expected a surfacing, got ${JSON.stringify(result)}`);
  if (result.kind !== 'surfaced') throw new Error('unreachable');
  return result;
}

await check('an emotional drop surfaces the conclusion the material has settled into', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = mattersOnly(EXAM_READINGS, {
        composeConclusionByAnchor: { 好烦: { kind: 'sentence', text: EXAM_SENTENCE } },
      });
      // The window is an hour, so the invisible look cannot be what produced a
      // sentence here: the surfacing's own on-the-spot judgement is the only
      // thing that can, which is what makes this a check on that judgement. The
      // dice are pinned to their first face, so the line is the band's first
      // opening — which is also the frame the portrait shows it in.
      const domain = createDomain({
        store,
        provider,
        conclusionPolicy: policy({ judgeTiming: 'quiet', quietWindowMs: 3_600_000 }),
        surfacingPolicy: surfacingPolicy(),
        random: () => 0,
      });

      const drops: string[] = [];
      for (const body of [EXAM_FIRST, EXAM_SECOND, EXAM_THIRD]) {
        drops.push((await domain.drop(body)).id);
      }
      await settleReadings(domain);
      assert.deepEqual(await domain.listConclusions(), [], 'nothing has been settled yet');

      const surfaced = surfacedOf(await domain.requestSurfacing({ dropId: drops[2] ?? '' }));
      assert.equal(surfaced.text, `我不太确定：${EXAM_SENTENCE}。`);
      assert.equal(surfaced.tier, 'weak', 'said in one sitting, so the frame says outright it is unsure');
      assert.deepEqual(
        surfaced.support.map((term) => term.text),
        EXAM_SUPPORT,
        'the terms behind it, in the user\'s own words',
      );
      assert.equal(surfaced.mentions, 3);
      assert.equal(surfaced.spanDays, 0);
      assert.ok(Number.isFinite(Date.parse(surfaced.surfacedAt)));

      // What surfaced is the conclusion itself, and the portrait is untouched:
      // a surfacing shows what was worked out and never rewrites it.
      const [conclusion] = await domain.listConclusions();
      assert.equal(surfaced.conclusion.id, conclusion?.id, 'the line is one the portrait already holds');
      assert.equal(surfaced.conclusion.text, conclusion?.text, 'and the portrait reads the same afterwards');
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
        'and nothing of the scaffolding it was assembled from comes with it',
      );
    } finally {
      await store.close();
    }
  });
});

await check('a question judges on the spot, and is never rolled for', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = mattersOnly(EXAM_READINGS, {
        composeConclusionByAnchor: { 好烦: { kind: 'sentence', text: EXAM_SENTENCE } },
      });
      // Two dials are turned against the user here: the quiet window is an hour,
      // so nothing has been judged; and the chance is zero, so a die would hold
      // every surfacing back. An asked-for observation is answered anyway —
      // "when the user asks, a judgement is run on the spot and never rolled
      // for". Both halves are asserted in one run, and the die that does still
      // turn — which opening the line carries — is pinned to its first face.
      const domain = createDomain({
        store,
        provider,
        conclusionPolicy: policy({ judgeTiming: 'quiet', quietWindowMs: 3_600_000 }),
        surfacingPolicy: surfacingPolicy({ surfaceChance: 0 }),
        random: () => 0,
      });

      for (const body of [EXAM_FIRST, EXAM_SECOND, EXAM_THIRD]) await domain.drop(body);
      await settleReadings(domain);
      assert.deepEqual(await domain.listConclusions(), [], 'the invisible look has not happened');

      const surfaced = surfacedOf(await domain.requestSurfacing());
      assert.equal(surfaced.text, `我不太确定：${EXAM_SENTENCE}。`);
    } finally {
      await store.close();
    }
  });
});

/** A fragment with nothing to feel about it, and a matter of its own to open. */
const NEUTRAL_DROP = '想把论文改成开题报告，先问问导师';
const NEUTRAL_READING: AnchoredReading = [NEUTRAL_DROP, ['开题报告'], '开题报告', 'decision'];

await check('a drop with no feeling in it is not a moment, and costs no judgement', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = mattersOnly([...EXAM_READINGS, NEUTRAL_READING], {
        composeConclusionByAnchor: { 好烦: { kind: 'sentence', text: EXAM_SENTENCE } },
      });
      const domain = createDomain({
        store,
        provider,
        conclusionPolicy: policy({ judgeTiming: 'count' }),
        surfacingPolicy: surfacingPolicy(),
      });

      const drops: string[] = [];
      for (const body of [EXAM_FIRST, EXAM_SECOND, EXAM_THIRD]) {
        drops.push((await domain.drop(body)).id);
      }
      await readConclusions(domain, 1);
      const composed = provider.composed.length;

      // There is something eligible to surface, and this drop is still not a
      // moment: only a feeling, or a question, is.
      const neutral = await domain.drop(NEUTRAL_DROP);
      await settleReadings(domain);
      assert.deepEqual(
        await domain.requestSurfacing({ dropId: neutral.id }),
        { kind: 'none', reason: 'not-a-moment' },
      );
      assert.equal(provider.composed.length, composed, 'and no look was forced for it');

      assert.deepEqual(
        await domain.requestSurfacing({ dropId: 'no-such-drop' }),
        { kind: 'none', reason: 'not-a-moment' },
        'a drop nobody recorded is not a moment either',
      );
    } finally {
      await store.close();
    }
  });
});

await check('a drop the model read as emotional is a moment, cue words or not', async () => {
  // The same words, read two ways by the model that read the drop. 「心里堵得慌」
  // carries a feeling and none of the words the cue list knows, so the only
  // reading that can hear it is the drop's 输入类型 — and the two runs below say
  // that is what makes the moment. Both readings are of one fact, and either is
  // enough: missing a moment costs a judgement the user earned, while an extra
  // attempt can only ever show what already crossed the threshold and cleared the
  // cooldown.
  const body = '心里堵得慌，胸口发闷，说不上来';
  const said = ['堵得慌', '胸口发闷', '说不上来'];
  for (const [inputType, expected] of [
    ['emotion', 'surfaced'],
    ['decision', 'not-a-moment'],
  ] as const) {
    await withDatabase(async (file) => {
      const store = openSqliteStore(file);
      try {
        const provider = createFakeProvider({
          extractByBody: {
            [body]: {
              kind: 'read',
              reading: { inputType, items: [], terms: said, anchor: '堵得慌' },
            },
          },
          composeConclusionByAnchor: { 堵得慌: { kind: 'sentence', text: EXAM_SENTENCE } },
        });
        const domain = createDomain({
          store,
          provider,
          conclusionPolicy: policy({ judgeTiming: 'count' }),
          surfacingPolicy: surfacingPolicy(),
          random: () => 0,
        });

        const drops: string[] = [];
        for (let time = 0; time < 3; time += 1) drops.push((await domain.drop(body)).id);
        await readConclusions(domain, 1);

        const result = await domain.requestSurfacing({ dropId: drops[2] ?? '' });
        assert.equal(
          result.kind === 'none' ? result.reason : result.kind,
          expected,
          `read as ${inputType}`,
        );
        if (expected === 'surfaced') {
          assert.equal(surfacedOf(result).text, `我不太确定：${EXAM_SENTENCE}。`);
        }
      } finally {
        await store.close();
      }
    });
  }
});

await check('the same topic is not surfaced twice inside the cooldown, and the record is on disk', async () => {
  await withDatabase(async (file) => {
    const clock = simulatedClock('2026-09-01T09:00:00.000Z');
    const provider = mattersOnly([...EXAM_READINGS, EXAM_FOURTH_READING], {
      composeConclusionByAnchor: { 好烦: { kind: 'sentence', text: EXAM_SENTENCE } },
    });

    const first = openSqliteStore(file);
    let fourthId = '';
    try {
      const domain = createDomain({
        store: first,
        provider,
        conclusionPolicy: policy({ judgeTiming: 'count' }),
        surfacingPolicy: surfacingPolicy(),
        now: clock.now,
      });

      const drops: string[] = [];
      for (const body of [EXAM_FIRST, EXAM_SECOND, EXAM_THIRD]) {
        drops.push((await domain.drop(body)).id);
      }
      await readConclusions(domain, 1);
      assert.equal(surfacedOf(await domain.requestSurfacing({ dropId: drops[2] ?? '' })).mentions, 3);

      // A fourth mention brings a word the matter has not heard, so a second
      // sentence is assembled — about the same thing, which is the point.
      clock.advanceDays(1);
      fourthId = (await domain.drop(EXAM_FOURTH)).id;
      const conclusions = await readConclusions(domain, 2);
      assert.equal(conclusions.length, 2, 'there is something new to say, and it is still in cooldown');
      assert.deepEqual(
        await domain.requestSurfacing({ dropId: fourthId }),
        { kind: 'none', reason: 'cooldown' },
      );
    } finally {
      await first.close();
    }

    // A process that did not make the record reads it back: the cooldown is a
    // fact about the user's material, not about this run of the program.
    const second = openSqliteStore(file);
    try {
      const domain = createDomain({
        store: second,
        provider,
        conclusionPolicy: policy({ judgeTiming: 'count' }),
        surfacingPolicy: surfacingPolicy(),
        now: clock.now,
      });
      assert.deepEqual(
        await domain.requestSurfacing({ dropId: fourthId }),
        { kind: 'none', reason: 'cooldown' },
        'the record survived the restart',
      );
    } finally {
      await second.close();
    }
  });
});

/** A fifth mention, once the cooldown has passed: new material to speak about. */
const EXAM_FIFTH = '期末考到底考哪些题型，好烦';
const EXAM_FIFTH_READING: AnchoredReading = [EXAM_FIFTH, ['题型', '好烦'], '好烦'];

await check('once the cooldown has passed, the newer conclusion is surfaced', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    const clock = simulatedClock('2026-09-01T09:00:00.000Z');
    try {
      const provider = mattersOnly([...EXAM_READINGS, EXAM_FOURTH_READING, EXAM_FIFTH_READING], {
        composeConclusionByAnchor: { 好烦: { kind: 'sentence', text: EXAM_SENTENCE } },
      });
      const domain = createDomain({
        store,
        provider,
        conclusionPolicy: policy({ judgeTiming: 'count' }),
        surfacingPolicy: surfacingPolicy(),
        now: clock.now,
        random: () => 0,
      });

      const drops: string[] = [];
      for (const body of [EXAM_FIRST, EXAM_SECOND, EXAM_THIRD]) {
        drops.push((await domain.drop(body)).id);
      }
      await readConclusions(domain, 1);
      surfacedOf(await domain.requestSurfacing({ dropId: drops[2] ?? '' }));

      clock.advanceDays(1);
      await domain.drop(EXAM_FOURTH);
      await readConclusions(domain, 2);

      // Past the window, and the matter has grown meanwhile: what surfaces is
      // the sentence as it stands now, not the one from a week ago.
      clock.advanceDays(8);
      const fifth = await domain.drop(EXAM_FIFTH);
      const conclusions = await readConclusions(domain, 3);
      const surfaced = surfacedOf(await domain.requestSurfacing({ dropId: fifth.id }));

      assert.equal(surfaced.conclusion.id, conclusions[2]?.id, 'the newest sentence is the one shown');
      assert.equal(surfaced.tier, 'medium', 'seven terms over nine days is not hedged by the frame any more');
      assert.equal(surfaced.text, `听起来，${EXAM_SENTENCE}。`);
      assert.equal(surfaced.mentions, 5);
      assert.equal(surfaced.spanDays, 9);
    } finally {
      await store.close();
    }
  });
});

/** Three mentions over four days, so the frame adds no hedge of its own. */
async function mediumBandDrops(
  domain: Domain,
  clock: ReturnType<typeof simulatedClock>,
): Promise<readonly string[]> {
  const drops: string[] = [];
  drops.push((await domain.drop(EXAM_FIRST)).id);
  clock.advanceDays(4);
  drops.push((await domain.drop(EXAM_SECOND)).id);
  drops.push((await domain.drop(EXAM_THIRD)).id);
  await readConclusions(domain, 1);
  return drops;
}

await check('a sentence that reads as a fact is still spoken in the product\'s own uncertainty', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    const clock = simulatedClock('2026-09-01T09:00:00.000Z');
    try {
      // A medium-band sentence carries whatever hedge the model wrote, and this
      // one wrote none: it is a verdict, not an observation. The portrait keeps it
      // as it was written; the surfacing moment puts the band's own opening in
      // front of it. Nothing here checks the sentence for a word — that cannot be
      // read off a string, and `parent-voice-principles.md` says so — the
      // uncertainty is written in.
      const provider = mattersOnly(EXAM_READINGS, {
        composeConclusionByAnchor: { 好烦: { kind: 'sentence', text: '你最近被几件事压着' } },
      });
      const domain = createDomain({
        store,
        provider,
        conclusionPolicy: policy({ judgeTiming: 'count' }),
        surfacingPolicy: surfacingPolicy(),
        now: clock.now,
        random: () => 0,
      });

      const drops = await mediumBandDrops(domain, clock);
      const conclusions = await domain.listConclusions();
      assert.equal(conclusions[0]?.tier, 'medium');
      assert.equal(conclusions[0]?.text, '你最近被几件事压着。', 'the frame added nothing — the model was to hedge');

      const surfaced = surfacedOf(await domain.requestSurfacing({ dropId: drops[2] ?? '' }));
      assert.equal(surfaced.text, '听起来，你最近被几件事压着。', 'the band speaks, and the sentence is still the model\'s');
      assert.equal(
        (await domain.listConclusions())[0]?.text,
        '你最近被几件事压着。',
        'while the portrait is left exactly as it was assembled',
      );
    } finally {
      await store.close();
    }
  });
});

await check('the register is a form, not one phrase: the same band is worded differently twice', async () => {
  // Two rolls of the same dice over the same material, and the same band both
  // times. A check written around one phrase — 「你似乎」, say — could not tell
  // these apart from a product that had stopped choosing.
  for (const [roll, opening] of [
    [0, '听起来，'],
    [0.99, '似乎，'],
  ] as const) {
    await withDatabase(async (file) => {
      const store = openSqliteStore(file);
      const clock = simulatedClock('2026-09-01T09:00:00.000Z');
      try {
        const provider = mattersOnly(EXAM_READINGS, {
          composeConclusionByAnchor: { 好烦: { kind: 'sentence', text: '你最近被几件事压着' } },
        });
        const domain = createDomain({
          store,
          provider,
          conclusionPolicy: policy({ judgeTiming: 'count' }),
          surfacingPolicy: surfacingPolicy(),
          now: clock.now,
          random: () => roll,
        });

        const drops = await mediumBandDrops(domain, clock);
        const surfaced = surfacedOf(await domain.requestSurfacing({ dropId: drops[2] ?? '' }));
        assert.equal(surfaced.tier, 'medium', 'the band never moves with the wording');
        assert.equal(surfaced.text, `${opening}你最近被几件事压着。`);
      } finally {
        await store.close();
      }
    });
  }
});

await check('the dice may hold a surfacing back', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = mattersOnly(EXAM_READINGS, {
        composeConclusionByAnchor: { 好烦: { kind: 'sentence', text: EXAM_SENTENCE } },
      });
      const domain = createDomain({
        store,
        provider,
        conclusionPolicy: policy({ judgeTiming: 'count' }),
        surfacingPolicy: surfacingPolicy({ surfaceChance: 0.5 }),
        random: () => 0.99,
      });

      const drops: string[] = [];
      for (const body of [EXAM_FIRST, EXAM_SECOND, EXAM_THIRD]) {
        drops.push((await domain.drop(body)).id);
      }
      await readConclusions(domain, 1);
      assert.deepEqual(
        await domain.requestSurfacing({ dropId: drops[2] ?? '' }),
        { kind: 'none', reason: 'held-back' },
        'this turn is one the product chose not to use',
      );
    } finally {
      await store.close();
    }
  });
});

await check('too little to claim anything means there is nothing to push', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const body = '今天又在改提纲，好烦';
      const provider = mattersOnly([[body, ['改提纲', '好烦'], '好烦']], {
        byBody: { [body]: { kind: 'reply', reply: '那样真好。' } },
        composeConclusionByAnchor: SENTENCE_BY_FEELING,
      });
      const domain = createDomain({
        store,
        provider,
        conclusionPolicy: policy({ judgeTiming: 'quiet', quietWindowMs: 50 }),
        surfacingPolicy: surfacingPolicy(),
      });

      const drops: string[] = [];
      for (let time = 0; time < 3; time += 1) drops.push((await domain.drop(body)).id);
      const [caught] = await readConclusions(domain, 1);
      assert.equal(caught?.kind, 'catch', 'two terms is not something to make a claim from');

      assert.deepEqual(
        await domain.requestSurfacing({ dropId: drops[2] ?? '' }),
        { kind: 'none', reason: 'nothing-to-say' },
        'a catch asserts nothing, so there is nothing to push at the user',
      );
    } finally {
      await store.close();
    }
  });
});

/**
 * Two matters whose supports share two words that turn up in both, and nothing
 * else. The distinct words are what keep them apart while they accumulate; what
 * the cooldown has to judge is whether sharing 好烦 and 好累 is evidence that
 * these are the same thing.
 */
const SHARED_A1 = '期末怎么算分，好烦，好累';
const SHARED_A2 = '平时分 40% 也搞不清，好烦，好累';
const SHARED_B1 = '室友半夜打游戏，好累';
const SHARED_B2 = '室友打游戏到半夜，好烦，好累';
const SHARED_READINGS: readonly AnchoredReading[] = [
  [SHARED_A1, ['期末怎么算分', '好烦', '好累'], '好烦'],
  [SHARED_A2, ['平时分 40%', '好烦', '好累'], '好烦'],
  [SHARED_B1, ['室友', '打游戏', '好累'], '好累'],
  [SHARED_B2, ['室友', '打游戏', '好烦', '好累'], '好累'],
];
const SHARED_SENTENCES = {
  好烦: { kind: 'sentence', text: EXAM_SENTENCE },
  好累: { kind: 'sentence', text: '听起来你最近一直没缓过来' },
} as const;

/** Both matters raised three times, and surfaced once between them. */
async function surfaceSharedMatters(
  weightSharedBySpread: boolean,
): Promise<{ readonly firstConclusion: string | undefined; readonly second: SurfacingResult }> {
  let second: SurfacingResult = { kind: 'none', reason: 'nothing-to-say' };
  let firstConclusion: string | undefined;
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = mattersOnly(SHARED_READINGS, {
        composeConclusionByAnchor: SHARED_SENTENCES,
      });
      const domain = createDomain({
        store,
        provider,
        conclusionPolicy: policy({ judgeTiming: 'count', weightSharedBySpread }),
        surfacingPolicy: surfacingPolicy(),
        random: () => 0,
      });

      const aDrops: string[] = [];
      for (const body of [SHARED_A1, SHARED_A2, SHARED_A2]) aDrops.push((await domain.drop(body)).id);
      const bDrops: string[] = [];
      for (const body of [SHARED_B1, SHARED_B2, SHARED_B2]) bDrops.push((await domain.drop(body)).id);
      const conclusions = await readConclusions(domain, 2);
      assert.equal(conclusions.length, 2, 'the two matters stay two');

      firstConclusion = surfacedOf(await domain.requestSurfacing({ dropId: aDrops[2] ?? '' })).conclusion.id;
      second = await domain.requestSurfacing({ dropId: bDrops[2] ?? '' });
    } finally {
      await store.close();
    }
  });
  return { firstConclusion, second };
}

await check('a word that turns up in every matter is not evidence that two are the same', async () => {
  const { firstConclusion, second } = await surfaceSharedMatters(true);
  assert.equal(second.kind, 'surfaced', 'the second matter has something of its own to say');
  assert.notEqual(surfacedOf(second).conclusion.id, firstConclusion, 'and it is not the one already shown');
  assert.equal(surfacedOf(second).text, '我不太确定：听起来你最近一直没缓过来。');
});

await check('with the weighting off, the same two words are enough — the misfire it prevents', async () => {
  // The matters still stay two while they accumulate (their own words are what
  // attach a fragment to a matter), so what this pins is the cooldown's rubic:
  // counting a shared word once per matter instead of by its rarity calls two
  // different things the same, and the user never hears the second one.
  const { second } = await surfaceSharedMatters(false);
  assert.deepEqual(second, { kind: 'none', reason: 'cooldown' });
});

console.log('\ndomain core — the answer');

/**
 * Two matters, each raised three times, in each other's words: the exam and the
 * guitar.
 *
 * An **answer** is assembled from several conclusions, so every check in this
 * section needs more than one matter to have crossed the threshold — and two
 * that are genuinely different, which is what the distinct wordings are for.
 * 「好烦」 and 「想学吉他」 are the feelings each matter gathers around, and they
 * are what the fake writes a sentence per, so the two conclusions can be told
 * apart in what the provider was handed.
 */
const ANSWER_EXAM_1 = '期末怎么算分，好烦';
const ANSWER_EXAM_2 = '平时分 40% 到底怎么算，好烦';
const ANSWER_GUITAR_1 = '最近老想着学吉他，想学吉他';
const ANSWER_GUITAR_2 = '看了几个吉他班，想学吉他';
const ANSWER_EXAM_READINGS: readonly AnchoredReading[] = [
  [ANSWER_EXAM_1, ['期末怎么算分', '好烦'], '好烦'],
  [ANSWER_EXAM_2, ['平时分 40%', '好烦'], '好烦'],
];
const ANSWER_GUITAR_READINGS: readonly AnchoredReading[] = [
  [ANSWER_GUITAR_1, ['学吉他', '想学吉他'], '想学吉他'],
  [ANSWER_GUITAR_2, ['吉他班', '想学吉他'], '想学吉他'],
];
const ANSWER_READINGS: readonly AnchoredReading[] = [
  ...ANSWER_EXAM_READINGS,
  ...ANSWER_GUITAR_READINGS,
];

/** Raise the demo's two matters, which most of the checks in this section need. */
async function answerDrops(domain: Domain): Promise<void> {
  await raiseThreeTimes(domain, ANSWER_READINGS);
}

/**
 * A third matter, and one that grows again after being rejected: between them
 * they are what the two dial checks and the band-step check need.
 */
const ANSWER_SLEEP_1 = '最近总是睡不好，白天没精神，晚上也睡不踏实';
const ANSWER_SLEEP_2 = '这周还是睡不好，白天没精神';
const ANSWER_SLEEP_READINGS: readonly AnchoredReading[] = [
  [ANSWER_SLEEP_1, ['睡不好', '没精神', '睡不踏实'], '睡不好'],
  [ANSWER_SLEEP_2, ['睡不好', '没精神'], '睡不好'],
];
const ANSWER_SLEEP_SENTENCE = '你最近好像一直没睡好';

/**
 * A second pair of matters, in words that share nothing with the first pair.
 *
 * Used where the check is "the same code over **different** material hands over
 * different material": the two sets have to stay apart, which is why their
 * wordings share nothing — the exam pair's 「好烦」 turning up here would let a
 * fragment attach to the wrong matter and quietly make the two sets one.
 */
const ANSWER_NOISY_1 = '室友半夜还在打游戏，好吵';
const ANSWER_NOISY_2 = '室友的键盘声一直响，好吵';
const ANSWER_THESIS_1 = '论文开题还没定下来，好焦虑';
const ANSWER_THESIS_2 = '导师又打回了一版，好焦虑';
const ANSWER_OTHER_READINGS: readonly AnchoredReading[] = [
  [ANSWER_NOISY_1, ['室友打游戏', '好吵'], '好吵'],
  [ANSWER_NOISY_2, ['键盘声', '好吵'], '好吵'],
  [ANSWER_THESIS_1, ['论文开题', '好焦虑'], '好焦虑'],
  [ANSWER_THESIS_2, ['导师打回', '好焦虑'], '好焦虑'],
];
const ANSWER_OTHER_SENTENCES = {
  好吵: { kind: 'sentence', text: '你最近好像一直被吵着' },
  好焦虑: { kind: 'sentence', text: '你好像在为论文的事悬着' },
} as const;

/** One more fragment for the exam matter, bringing a word it has not heard. */
const ANSWER_EXAM_3 = '期末考那部分到底考什么，好烦';
const ANSWER_EXAM_3_READING: AnchoredReading = [ANSWER_EXAM_3, ['期末考', '好烦'], '好烦'];

/** What the fake says about each matter those fragments accumulate into. */
const ANSWER_SENTENCES = {
  好烦: { kind: 'sentence', text: '你最近被期末压着' },
  想学吉他: { kind: 'sentence', text: '你好像真的很想学吉他' },
  睡不好: { kind: 'sentence', text: ANSWER_SLEEP_SENTENCE },
} as const;

/**
 * Raise every matter a set of readings describes the way the threshold needs it:
 * each fragment once, then every fragment after the first once more, so every
 * matter ends up raised three times without any fragment being special.
 *
 * @param domain - the domain to drop into.
 * @param readings - the fragments, and what the fake reads out of them.
 */
async function raiseThreeTimes(
  domain: Domain,
  readings: readonly AnchoredReading[],
): Promise<void> {
  const bodies = readings.map(([body]) => body);
  for (const body of [...bodies, ...bodies.slice(1)]) await domain.drop(body);
}

/** What the fake says when several conclusions are brought together. */
const ANSWER_SENTENCE = '你反复提到的那几件事，好像连在一起';

/** The answered payload, or a failed assertion — no other arm reaches it. */
function answeredOf(result: SurfacingResult): Extract<SurfacingResult, { kind: 'answered' }> {
  assert.equal(result.kind, 'answered', `expected an answer, got ${JSON.stringify(result)}`);
  if (result.kind !== 'answered') throw new Error('unreachable');
  return result;
}

await check('an asked-for answer is assembled from several conclusions, not one restated', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = mattersOnly(ANSWER_READINGS, {
        composeConclusionByAnchor: ANSWER_SENTENCES,
        answerFallback: { kind: 'sentence', text: ANSWER_SENTENCE },
      });
      const domain = createDomain({
        store,
        provider,
        conclusionPolicy: policy({ judgeTiming: 'count' }),
        surfacingPolicy: surfacingPolicy(),
        // The opening is rolled for even when the question is not, and this pins
        // it to the weakest band's first — the same face a surfacing would take.
        random: () => 0,
      });

      await answerDrops(domain);
      const conclusions = await readConclusions(domain, 2);

      const answer = answeredOf(await domain.requestSurfacing());
      assert.equal(answer.text, `我不太确定：${ANSWER_SENTENCE}。`);
      assert.equal(answer.tier, 'weak', 'said in one sitting, so it is hedged');
      assert.deepEqual(
        answer.conclusions.map((conclusion) => conclusion.text),
        conclusions.map((conclusion) => conclusion.text),
        'both conclusions it was assembled from, as the portrait words them',
      );
      assert.deepEqual(
        answer.support.map((term) => term.text),
        ['期末怎么算分', '好烦', '平时分 40%', '学吉他', '想学吉他', '吉他班'],
        'and every word behind them, in the order the user said them',
      );

      // What the provider was handed is the user's own material and nothing
      // else: the sentences the product assembled for their matters, and the
      // words those sentences stand on.
      const [asked] = provider.answers;
      assert.deepEqual(asked?.conclusions, ['你最近被期末压着', '你好像真的很想学吉他']);
      assert.deepEqual(asked?.terms, ['期末怎么算分', '好烦', '平时分 40%', '学吉他', '想学吉他', '吉他班']);
      assert.deepEqual(
        Object.keys(answer).sort(),
        [
          'answeredAt',
          'averageStrength',
          'conclusions',
          'kind',
          'mentions',
          'softened',
          'spanDays',
          'support',
          'text',
          'tier',
        ],
        'and nothing of the scaffolding it was assembled from comes with it',
      );
    } finally {
      await store.close();
    }
  });
});

await check('an answer is only ever made of the user\'s own material', async () => {
  // The same code, the same question, three data sets. One has a single thing
  // settled; the other two have two matters each, and they are *different*
  // matters, in different words, with different feelings behind them.
  //
  // What makes "an answer could only have grown out of this user's material" a
  // structural fact rather than a hope about the model is the **handover**: what
  // the provider is given is exactly the conclusions this store holds and exactly
  // the words behind them, and with too little material it is given nothing at
  // all. The two rich runs are what proves the material is read from the data
  // rather than from the code path: same call, different sentences handed over.
  const runs = [
    {
      readings: EXAM_READINGS,
      sentences: { 好烦: { kind: 'sentence', text: EXAM_SENTENCE } } as const,
      expected: 'surfaced',
      settled: 1,
      said: [] as readonly string[],
      terms: [] as readonly string[],
    },
    {
      readings: ANSWER_READINGS,
      sentences: ANSWER_SENTENCES,
      expected: 'answered',
      settled: 2,
      said: ['你最近被期末压着', '你好像真的很想学吉他'],
      terms: ['期末怎么算分', '好烦', '平时分 40%', '学吉他', '想学吉他', '吉他班'],
    },
    {
      readings: ANSWER_OTHER_READINGS,
      sentences: ANSWER_OTHER_SENTENCES,
      expected: 'answered',
      settled: 2,
      said: ['你最近好像一直被吵着', '你好像在为论文的事悬着'],
      terms: ['室友打游戏', '好吵', '键盘声', '论文开题', '好焦虑', '导师打回'],
    },
  ] as const;

  for (const run of runs) {
    await withDatabase(async (file) => {
      const store = openSqliteStore(file);
      try {
        const provider = mattersOnly(run.readings, {
          composeConclusionByAnchor: run.sentences,
          answerFallback: { kind: 'sentence', text: ANSWER_SENTENCE },
        });
        const domain = createDomain({
          store,
          provider,
          conclusionPolicy: policy({ judgeTiming: 'count' }),
          surfacingPolicy: surfacingPolicy(),
          random: () => 0,
        });

        await raiseThreeTimes(domain, run.readings);
        await readConclusions(domain, run.settled);

        const result = await domain.requestSurfacing();
        assert.equal(
          result.kind,
          run.expected,
          `over ${run.settled} conclusion(s)`,
        );
        assert.deepEqual(
          provider.answers.map((asked) => [...asked.conclusions]),
          run.said.length === 0 ? [] : [run.said],
          'the only thing ever handed over is this user\'s own sentences',
        );
        if (result.kind === 'answered') {
          assert.deepEqual(
            provider.answers[0]?.terms,
            run.terms,
            'and their own words, nothing generic beside them',
          );
          assert.deepEqual(
            result.conclusions.map((conclusion) => conclusion.id).length,
            run.said.length,
            'and the answer cites every one of them',
          );
        }
      } finally {
        await store.close();
      }
    });
  }
});

await check('an answer is worded in the band its numbers earn, by the same mapping a surfacing uses', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    const clock = simulatedClock('2026-09-01T09:00:00.000Z');
    try {
      const provider = mattersOnly(ANSWER_READINGS, {
        composeConclusionByAnchor: ANSWER_SENTENCES,
        answerFallback: { kind: 'sentence', text: ANSWER_SENTENCE },
      });
      const domain = createDomain({
        store,
        provider,
        conclusionPolicy: policy({ judgeTiming: 'count' }),
        surfacingPolicy: surfacingPolicy(),
        now: clock.now,
        // The same face a surfacing takes: what is pinned is which opening the
        // band carries, and that it is rolled for rather than written by a model.
        random: () => 0,
      });

      // The exam matter over four days, the guitar one in a sitting: the answer
      // reaches back as far as the furthest of them, so its band is the medium
      // one — a conclusion said in one sitting would be hedged, and this is not.
      await domain.drop(ANSWER_EXAM_1);
      clock.advanceDays(4);
      await domain.drop(ANSWER_EXAM_2);
      await domain.drop(ANSWER_EXAM_2);
      await readConclusions(domain, 1);
      clock.advanceDays(1);
      await domain.drop(ANSWER_GUITAR_1);
      await domain.drop(ANSWER_GUITAR_2);
      await domain.drop(ANSWER_GUITAR_2);
      await readConclusions(domain, 2);

      const answer = answeredOf(await domain.requestSurfacing());
      assert.equal(answer.tier, 'medium', 'six words over four days is not hedged by the band');
      assert.equal(answer.text, `听起来，${ANSWER_SENTENCE}。`, 'the opening is the band\'s own');
      assert.equal(answer.mentions, 6, 'both matters\' times, added up');
      assert.equal(answer.spanDays, 4, 'as far back as the furthest thing behind it goes');
      assert.equal(
        answer.averageStrength,
        1,
        'the mean of the two, each being fully tied to its own feeling — said together',
      );
      assert.equal(
        provider.answers[0]?.tier,
        'medium',
        'and the band travels with the request, as context rather than as a licence',
      );
    } finally {
      await store.close();
    }
  });
});

await check('an answer nobody could compose falls back to one real line, never an invented one', async () => {
  // Two ways for the assembly to come to nothing, asserted in one place because
  // both must end the same way: a provider that fails, and a sentence that breaks
  // the rules twice. What is left standing is the line the moment would have shown
  // anyway — a conclusion from the portrait, which is a real thing the product
  // worked out — rather than a silence at someone who just asked, or worse, the
  // rejected sentence.
  const runs = [
    { name: 'the call fails', script: [{ kind: 'fail', reason: 'down' }] as const },
    {
      name: 'the sentence breaks the rules twice',
      script: [
        { kind: 'sentence', text: '你为什么老是这么想？宝贝。' },
        { kind: 'sentence', text: '你为什么老是这么想？宝贝。' },
      ] as const,
    },
  ];

  for (const run of runs) {
    await withDatabase(async (file) => {
      const store = openSqliteStore(file);
      try {
        const provider = mattersOnly(ANSWER_READINGS, {
          composeConclusionByAnchor: ANSWER_SENTENCES,
          answerAttempts: run.script,
        });
        const domain = createDomain({
          store,
          provider,
          conclusionPolicy: policy({ judgeTiming: 'count' }),
          surfacingPolicy: surfacingPolicy(),
          random: () => 0,
        });

        await answerDrops(domain);
        const conclusions = await readConclusions(domain, 2);

        const result = await domain.requestSurfacing();
        assert.equal(result.kind, 'surfaced', `${run.name}: one line stood in its place`);
        if (result.kind !== 'surfaced') return;
        assert.equal(
          result.text,
          conclusions[0]?.text,
          `${run.name}: and it is a sentence the portrait already holds`,
        );
        assert.ok(
          !result.text.includes('宝贝'),
          `${run.name}: nothing of the rejected attempt reached the user`,
        );
        // One retry, told what the first attempt broke — never a second reroll.
        assert.equal(provider.answers.length, run.script.length, `${run.name}: asked the right number of times`);
        if (run.script.length === 2) {
          assert.ok(
            (provider.answers[1]?.violations?.length ?? 0) > 0,
            'and the retry was told which rules the first attempt broke',
          );
        }
      } finally {
        await store.close();
      }
    });
  }
});

await check('asking and surfacing share one cooldown, and a turn produces one line', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = mattersOnly(ANSWER_READINGS, {
        composeConclusionByAnchor: ANSWER_SENTENCES,
        answerFallback: { kind: 'sentence', text: ANSWER_SENTENCE },
      });
      const domain = createDomain({
        store,
        provider,
        conclusionPolicy: policy({ judgeTiming: 'count' }),
        surfacingPolicy: surfacingPolicy(),
        random: () => 0,
      });

      await answerDrops(domain);
      await readConclusions(domain, 2);
      const answer = answeredOf(await domain.requestSurfacing());

      // One line, and the record says exactly what was heard: every conclusion
      // the answer drew on, and no separate surfacing beside it. That is what
      // "共用同一套冷却与条数上限" means once it is storage rather than prose.
      const records = await store.listSurfacings();
      assert.deepEqual(
        records.map((record) => record.conclusionId).sort(),
        answer.conclusions.map((conclusion) => conclusion.id).sort(),
        'what was recorded is what the answer was made of',
      );

      // The same cooldown answers a drop: two channels that each produced a line
      // here would be two things said in one turn.
      assert.deepEqual(
        await domain.requestSurfacing(),
        { kind: 'none', reason: 'cooldown' },
        'and asking again does not repeat it',
      );

      const again = await domain.drop(ANSWER_EXAM_2);
      assert.deepEqual(
        await domain.requestSurfacing({ dropId: again.id }),
        { kind: 'none', reason: 'cooldown' },
        'nor does a drop about one of the same matters',
      );
    } finally {
      await store.close();
    }
  });
});

await check('a drop is never answered with an assembled one — it gets its own line', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = mattersOnly(ANSWER_READINGS, {
        composeConclusionByAnchor: ANSWER_SENTENCES,
        answerFallback: { kind: 'sentence', text: ANSWER_SENTENCE },
      });
      const domain = createDomain({
        store,
        provider,
        conclusionPolicy: policy({ judgeTiming: 'count' }),
        surfacingPolicy: surfacingPolicy(),
        random: () => 0,
      });

      await answerDrops(domain);
      const conclusions = await readConclusions(domain, 2);

      // Everything an answer would need is there, and this is still a drop: what
      // the user said gets the one line that belongs to the moment they made.
      const dropped = await domain.drop(ANSWER_EXAM_2);
      const result = await domain.requestSurfacing({ dropId: dropped.id });
      assert.equal(result.kind, 'surfaced');
      if (result.kind !== 'surfaced') return;
      assert.equal(result.text, conclusions[0]?.text);
      assert.deepEqual(provider.answers, [], 'and no assembly was asked for');
    } finally {
      await store.close();
    }
  });
});

await check('what the user has already heard is not gathered into a new answer', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = mattersOnly(ANSWER_READINGS, {
        composeConclusionByAnchor: ANSWER_SENTENCES,
        answerFallback: { kind: 'sentence', text: ANSWER_SENTENCE },
      });
      const domain = createDomain({
        store,
        provider,
        conclusionPolicy: policy({ judgeTiming: 'count' }),
        surfacingPolicy: surfacingPolicy(),
        random: () => 0,
      });

      await answerDrops(domain);
      await readConclusions(domain, 2);

      // One of the two is shown on its own first — a drop, so the one line. The
      // other is still eligible, and one eligible conclusion is not an answer:
      // the floor counts what may be said now, not what the portrait holds.
      const dropped = await domain.drop(ANSWER_EXAM_2);
      assert.equal((await domain.requestSurfacing({ dropId: dropped.id })).kind, 'surfaced');

      const result = await domain.requestSurfacing();
      assert.equal(result.kind, 'surfaced', 'the one thing left is shown as itself');
      if (result.kind !== 'surfaced') return;
      assert.equal(result.conclusion.text, '我不太确定：你好像真的很想学吉他。');
      assert.deepEqual(provider.answers, [], 'and nothing was assembled out of it');
    } finally {
      await store.close();
    }
  });
});

await check('a matter the user has marked wrong is not gathered into an answer', async () => {
  // Ticket 10 left the chain holding three kinds of record — a claim, a catch and
  // a correction — and "the newest thing per matter" is not always a judgement.
  // Gathering without looking at the kind would hand the provider the sentence the
  // user has just rejected, which is the product routing around their own
  // correction: the one answer it must not give.
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = mattersOnly(ANSWER_READINGS, {
        composeConclusionByAnchor: ANSWER_SENTENCES,
        answerFallback: { kind: 'sentence', text: ANSWER_SENTENCE },
      });
      const domain = createDomain({
        store,
        provider,
        conclusionPolicy: policy({ judgeTiming: 'count' }),
        surfacingPolicy: surfacingPolicy(),
        random: () => 0,
      });

      await answerDrops(domain);
      const conclusions = await readConclusions(domain, 2);
      const exam = conclusions.find((conclusion) =>
        conclusion.support.some((term) => term.text === '期末怎么算分'),
      );
      assert.ok(exam !== undefined, 'the exam matter has something to reject');
      if (exam === undefined) return;
      await domain.markConclusionWrong(exam.id);

      const result = await domain.requestSurfacing();
      assert.equal(result.kind, 'surfaced', 'one matter is left, and one is not an answer');
      if (result.kind !== 'surfaced') return;
      assert.equal(result.text, '我不太确定：你好像真的很想学吉他。');
      assert.deepEqual(provider.answers, [], 'and the rejected sentence was never handed over');
    } finally {
      await store.close();
    }
  });
});

await check('an answer resting on a matter the user rejected speaks one band softer', async () => {
  // Ticket 10's decision reached the chain: a matter the user marked wrong speaks
  // one band down, and the step is written on the conclusion so the page can say
  // why. An answer is a judgement assembled from those conclusions, so it may not
  // speak more firmly than the thing it rests on — the same step, reported the
  // same way. Both runs raise exactly the same material; only the rejection
  // differs, so what the band does cannot be read off the material.
  for (const rejected of [true, false]) {
    await withDatabase(async (file) => {
      const store = openSqliteStore(file);
      const clock = simulatedClock('2026-09-01T09:00:00.000Z');
      try {
        const provider = mattersOnly([...ANSWER_READINGS, ANSWER_EXAM_3_READING], {
          composeConclusionByAnchor: ANSWER_SENTENCES,
          answerFallback: { kind: 'sentence', text: ANSWER_SENTENCE },
        });
        const domain = createDomain({
          store,
          provider,
          conclusionPolicy: policy({ judgeTiming: 'count' }),
          surfacingPolicy: surfacingPolicy(),
          now: clock.now,
          random: () => 0,
        });

        // The exam matter over four days, so its numbers earn the medium band,
        // and the guitar one in a sitting beside it.
        await domain.drop(ANSWER_EXAM_1);
        clock.advanceDays(4);
        await domain.drop(ANSWER_EXAM_2);
        await domain.drop(ANSWER_EXAM_2);
        const [exam] = await readConclusions(domain, 1);
        assert.ok(exam !== undefined);
        if (exam === undefined) return;
        await raiseThreeTimes(domain, ANSWER_GUITAR_READINGS);

        // The same fragment joins the exam matter either way. Rejected, it has to
        // be **pinned** there — a matter the user called wrong no longer attracts
        // look-alikes by overlap (ticket 10) — and written beside the conclusion
        // is exactly how a person says "this is about that".
        if (rejected) {
          await domain.markConclusionWrong(exam.id);
          await domain.appendToConclusion(exam.id, ANSWER_EXAM_3);
        } else {
          await domain.drop(ANSWER_EXAM_3);
        }
        await readConclusions(domain, rejected ? 4 : 3);

        const answer = answeredOf(await domain.requestSurfacing());
        // Seven words over four days is the medium band's reading of the numbers.
        assert.equal(answer.tier, rejected ? 'weak' : 'medium', 'the band the numbers earn, stepped or not');
        assert.equal(answer.softened, rejected, 'and the step is said out loud rather than left to be inferred');
        assert.equal(
          answer.text,
          `${rejected ? '我不太确定：' : '听起来，'}${ANSWER_SENTENCE}。`,
          'so the wording follows the band that was actually written',
        );
      } finally {
        await store.close();
      }
    });
  }
});

await check('how many conclusions an answer gathers is a dial, and two is a floor', async () => {
  // Three runs of one rule, each turning one dial: the limit takes the newest
  // few, the floor can be raised, and it can never be lowered below two — one
  // conclusion is not a smaller answer, it is the restatement the ticket rules
  // out, so a policy asking for one is read as two.
  const runs = [
    {
      name: 'the limit keeps the newest few',
      readings: [...ANSWER_READINGS, ...ANSWER_SLEEP_READINGS],
      settled: 3,
      policy: { answerLimit: 2 },
      expected: 'answered',
      gathered: ['你好像真的很想学吉他', ANSWER_SLEEP_SENTENCE],
    },
    {
      name: 'the floor can be raised above what is there',
      readings: ANSWER_READINGS,
      settled: 2,
      policy: { answerFloor: 3 },
      expected: 'surfaced',
      gathered: [],
    },
    {
      name: 'and it can never be lowered below two',
      readings: ANSWER_EXAM_READINGS,
      settled: 1,
      policy: { answerFloor: 1 },
      expected: 'surfaced',
      gathered: [],
    },
  ] as const;

  for (const run of runs) {
    await withDatabase(async (file) => {
      const store = openSqliteStore(file);
      try {
        const provider = mattersOnly(run.readings, {
          composeConclusionByAnchor: ANSWER_SENTENCES,
          answerFallback: { kind: 'sentence', text: ANSWER_SENTENCE },
        });
        const domain = createDomain({
          store,
          provider,
          conclusionPolicy: policy({ judgeTiming: 'count' }),
          surfacingPolicy: surfacingPolicy(run.policy),
          random: () => 0,
        });

        await raiseThreeTimes(domain, run.readings);
        await readConclusions(domain, run.settled);

        const result = await domain.requestSurfacing();
        assert.equal(result.kind, run.expected, run.name);
        assert.deepEqual(
          provider.answers.map((asked) => [...asked.conclusions]),
          run.gathered.length === 0 ? [] : [run.gathered],
          `${run.name}: and what it gathered is what it was told to`,
        );
      } finally {
        await store.close();
      }
    });
  }
});

console.log('\ndomain core — recall');
/** The drop the demo's act two asks about, plus one that must not be recalled. */
const GRADING_DROP = '老师今天讲了期末怎么算分：平时分 40%，期末考 60%，下周三交提纲';
const OUTLINE_DROP = '提纲要求下周交，格式和期末怎么算分有关';
const PLANT_DROP = '楼下的咖啡店换了个新豆子';
const ANSWER = '平时分 40%，期末考 60%。';

/**
 * A provider scripted for recall: the question parses to what to look for, and
 * composing an answer is a fixed string. Both ends of recall leave through the
 * port, so scripting them is what makes these checks deterministic.
 */
function recallProvider(): ReturnType<typeof createFakeProvider> {
  return createFakeProvider({
    parseQuestionByQuestion: { 期末怎么算分: { kind: 'match', matchText: ['期末', '算分'] } },
    composeFallback: { kind: 'answer', answer: ANSWER },
  });
}

await check('a question that hits a record answers, and names the drop it came from', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const domain = createDomain({ store, provider: recallProvider() });
      const grading = await domain.drop(GRADING_DROP);
      await domain.drop(PLANT_DROP);

      const result = await domain.recall('期末怎么算分');
      assert.equal(result.kind, 'answered', 'the record covering this question was found');
      if (result.kind !== 'answered') return;
      assert.equal(result.answer, ANSWER);
      assert.deepEqual(
        result.sources.map((source) => source.dropId),
        [grading.id],
        'the answer names the drop it came from',
      );
    } finally {
      await store.close();
    }
  });
});

await check('every matching drop is cited, not just the first', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const domain = createDomain({ store, provider: recallProvider() });
      const grading = await domain.drop(GRADING_DROP);
      const outline = await domain.drop(OUTLINE_DROP);
      await domain.drop(PLANT_DROP);

      const result = await domain.recall('期末怎么算分');
      assert.equal(result.kind, 'answered');
      if (result.kind !== 'answered') return;

      // Two drops cover this question, and the composer was handed both — so
      // both are cited. Showing only one would tell the user the answer came
      // from a drop the composer may not have used.
      assert.deepEqual(
        result.sources.map((source) => source.dropId),
        [grading.id, outline.id],
      );
    } finally {
      await store.close();
    }
  });
});

await check('the answer carries the verbatim originals, not a summary', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const domain = createDomain({ store, provider: recallProvider() });
      await domain.drop(GRADING_DROP);

      const result = await domain.recall('期末怎么算分');
      assert.equal(result.kind, 'answered');
      if (result.kind !== 'answered') return;
      assert.deepEqual(
        result.sources.map((source) => source.body),
        [GRADING_DROP],
        'the user can check the answer against their own words',
      );
    } finally {
      await store.close();
    }
  });
});

await check('a question nothing covers says so, and answers nothing', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      let composed = 0;
      const provider = createFakeProvider({
        parseQuestionByQuestion: { 量子力学考试: { kind: 'match', matchText: ['量子力学'] } },
        composeFallback: { kind: 'answer', answer: '你似乎提过量子力学。' },
        onCompose: () => {
          composed += 1;
        },
      });
      const domain = createDomain({ store, provider });
      await domain.drop(GRADING_DROP);

      const result = await domain.recall('量子力学考试');
      assert.equal(result.kind, 'not-found', 'nothing covers this question');
      assert.equal(composed, 0, 'no answer was generated for a question with no support');
    } finally {
      await store.close();
    }
  });
});

await check('a question that yields nothing to look for answers nothing', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      let composed = 0;
      const provider = createFakeProvider({
        // A blank needle would match every record, since every string contains
        // the empty string. "I have nothing to look for" must not become
        // "everything answers this".
        parseQuestionByQuestion: { 嗯: { kind: 'match', matchText: ['', '   '] } },
        composeFallback: { kind: 'answer', answer: '不该出现。' },
        onCompose: () => {
          composed += 1;
        },
      });
      const domain = createDomain({ store, provider });
      await domain.drop(GRADING_DROP);

      const result = await domain.recall('嗯');
      assert.equal(result.kind, 'not-found');
      assert.equal(composed, 0, 'blank needles must not reach the composer');
    } finally {
      await store.close();
    }
  });
});

await check('an explicit empty result is returned even when records exist', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const domain = createDomain({ store, provider: recallProvider() });
      await domain.drop(PLANT_DROP); // a record exists, but it does not cover the question

      const result = await domain.recall('期末怎么算分');
      assert.equal(
        result.kind,
        'not-found',
        'having some records is not the same as having this answer',
      );
    } finally {
      await store.close();
    }
  });
});

await check('recall on an empty database says it found nothing', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const domain = createDomain({ store, provider: recallProvider() });
      const result = await domain.recall('期末怎么算分');
      assert.equal(result.kind, 'not-found');
    } finally {
      await store.close();
    }
  });
});

await check('the question goes through the provider port', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = recallProvider();
      const domain = createDomain({ store, provider });
      await domain.drop(GRADING_DROP);
      await domain.recall('期末怎么算分');

      assert.deepEqual(provider.askedQuestions, ['期末怎么算分'], 'the question was parsed by the provider');
    } finally {
      await store.close();
    }
  });
});

await check('the answer is composed by the provider, from the records it matched', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const seen: string[] = [];
      const provider = createFakeProvider({
        parseQuestionByQuestion: { 期末怎么算分: { kind: 'match', matchText: ['期末', '算分'] } },
        composeFallback: { kind: 'answer', answer: ANSWER },
        onCompose: (request) => {
          seen.push(...request.records.map((record) => record.body));
        },
      });
      const domain = createDomain({ store, provider });
      await domain.drop(GRADING_DROP);

      await domain.recall('期末怎么算分');
      assert.deepEqual(seen, [GRADING_DROP], 'the composer was handed the matched record');
    } finally {
      await store.close();
    }
  });
});

await check('a pinned time basis changes the wording the composer sees', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const bases: string[] = [];
      const provider = createFakeProvider({
        parseQuestionByQuestion: { 期末怎么算分: { kind: 'match', matchText: ['期末', '算分'] } },
        composeFallback: { kind: 'answer', answer: ANSWER },
        onCompose: (request) => {
          bases.push(request.now);
        },
      });
      const domain = createDomain({ store, provider });
      await domain.drop(GRADING_DROP);

      await domain.recall('期末怎么算分', { now: '2026-09-20T09:00:00.000Z' });
      assert.deepEqual(bases, ['2026-09-20T09:00:00.000Z'], 'the pinned basis reached the composer');
    } finally {
      await store.close();
    }
  });
});

await check('the time basis does not change what is recalled', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const domain = createDomain({ store, provider: recallProvider() });
      const grading = await domain.drop(GRADING_DROP);

      const soon = await domain.recall('期末怎么算分', { now: '2026-09-16T09:00:00.000Z' });
      const later = await domain.recall('期末怎么算分', { now: '2027-03-01T09:00:00.000Z' });

      assert.equal(soon.kind, 'answered');
      assert.equal(later.kind, 'answered');
      if (soon.kind !== 'answered' || later.kind !== 'answered') return;
      assert.deepEqual(
        soon.sources.map((source) => source.dropId),
        later.sources.map((source) => source.dropId),
        'the same records are recalled either way',
      );
      assert.equal(soon.sources[0]?.dropId, grading.id);
    } finally {
      await store.close();
    }
  });
});

await check('recall still works with no pinned basis', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const domain = createDomain({ store, provider: recallProvider() });
      await domain.drop(GRADING_DROP);

      const result = await domain.recall('期末怎么算分');
      assert.equal(result.kind, 'answered', 'pinning a basis is optional');
    } finally {
      await store.close();
    }
  });
});

await check('a provider that cannot read the question says it could not look', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      // The failure is scripted on the call the test names, so the path really
      // is exercised rather than short-circuiting before it.
      const provider = createFakeProvider({
        parseQuestionFallback: { kind: 'fail', reason: 'cloud LLM unreachable' },
      });
      const domain = createDomain({ store, provider });
      await domain.drop(GRADING_DROP);

      const result = await domain.recall('期末怎么算分');
      assert.equal(
        result.kind,
        'unavailable',
        'nothing was searched, so this must not claim that nothing covers the question',
      );
    } finally {
      await store.close();
    }
  });
});

await check('a question parser that throws synchronously is reported the same way', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = createFakeProvider({
        parseQuestionFallback: { kind: 'throw', reason: 'provider constructor blew up' },
      });
      const domain = createDomain({ store, provider });
      await domain.drop(GRADING_DROP);

      const result = await domain.recall('期末怎么算分');
      assert.equal(result.kind, 'unavailable');
    } finally {
      await store.close();
    }
  });
});

await check('a composer that fails reports that the question could not be answered', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = createFakeProvider({
        parseQuestionByQuestion: { 期末怎么算分: { kind: 'match', matchText: ['期末', '算分'] } },
        composeFallback: { kind: 'fail', reason: 'composition refused' },
      });
      const domain = createDomain({ store, provider });
      await domain.drop(GRADING_DROP);

      const result = await domain.recall('期末怎么算分');
      assert.equal(result.kind, 'unavailable');
    } finally {
      await store.close();
    }
  });
});

await check('with no provider at all, recall says it could not look', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const domain = createDomain({ store });
      await domain.drop(GRADING_DROP);

      const result = await domain.recall('期末怎么算分');
      assert.equal(result.kind, 'unavailable');
    } finally {
      await store.close();
    }
  });
});

await check('a blank answer is not accepted as an answer', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = createFakeProvider({
        parseQuestionByQuestion: { 期末怎么算分: { kind: 'match', matchText: ['期末', '算分'] } },
        composeFallback: { kind: 'answer', answer: '   ' },
      });
      const domain = createDomain({ store, provider });
      await domain.drop(GRADING_DROP);

      // An answer of whitespace would render as "answered" with an empty line
      // beside a source — exactly the confusion this result shape exists to
      // prevent, so it must not be reachable.
      const result = await domain.recall('期末怎么算分');
      assert.notEqual(result.kind, 'answered', 'whitespace is not an answer');
    } finally {
      await store.close();
    }
  });
});

await check('the recalled source is the drop the match hit, not merely the newest', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const domain = createDomain({ store, provider: recallProvider() });
      const grading = await domain.drop(GRADING_DROP);
      await domain.drop('今天中午吃了牛肉面');
      await domain.drop('地铁上看到一只很胖的橘猫');

      const result = await domain.recall('期末怎么算分');
      assert.equal(result.kind, 'answered');
      if (result.kind !== 'answered') return;
      assert.deepEqual(
        result.sources.map((source) => source.dropId),
        [grading.id],
        'the newest drop is not the answer to every question',
      );
    } finally {
      await store.close();
    }
  });
});

console.log('\ndomain core — the reply');

/**
 * A drop with no emotion cue, no stop request and no question in it.
 *
 * The whole point of the reply rules is what they do to ordinary input, so the
 * cases below are driven from fragments that carry nothing special.
 */
const PLAIN_DROP = '明天下午三点开会';

// The emotional drop is `MIXED_DROP` (好烦) from the top of this file — the same
// fragment act one of the demo drops.

/** A drop that asks the user to stop, in the doc's own words. */
const STOP_DROP = '算了，不想说了';

/** A drop that explicitly asks what to do — the one licence to advise. */
const ADVICE_DROP = '这件事我该怎么办';

/**
 * Ordinary fragments that merely *look* like they carry a cue.
 *
 * Chinese has no word boundaries, so substring reading finds 「烦」 in 「麻烦」,
 * 「怕」 in 「哪怕」 and 「算了」 in 「算了算」. Each of these has to come back as a
 * plain record confirmation: answering an ordinary drop with a feeling it never
 * had is the one thing this reading must not do, and a false positive here also
 * decides what the provider is told.
 */
const LOOKALIKE_DROPS: readonly string[] = [
  '明天下午三点开会，有点麻烦',
  '哪怕下雨也要去',
  '我算了算时间，还剩三天',
];

/**
 * The lines code itself can vouch for, one per situation.
 *
 * Written out rather than read from the domain, because these are the literals
 * the user is promised: if code ever started emitting something else, these
 * checks have to notice.
 */
const SAFE_EMOTION_REPLY = '听着今天不太好受。';
const SAFE_PRESENCE_REPLY = '嗯，我在。想说了再说。';
const SAFE_RECORDED_REPLY = '接住了。';

/**
 * Replies that each break exactly one mechanical rule.
 *
 * Asserted one at a time rather than all at once, so a rule that stopped firing
 * cannot hide behind another that still does. `body` and `expected` are for the
 * cases whose rule only exists in one situation, or whose fallback line is
 * therefore a different one.
 */
const RULE_BREAKERS: readonly {
  readonly why: string;
  readonly reply: string;
  readonly body?: string;
  readonly expected?: string;
}[] = [
  { why: 'a question that asks why', reply: '你为什么这么想？' },
  { why: 'a second question', reply: '是这样吗？还是那样？' },
  { why: 'a word that judges the user', reply: '别想那么多。' },
  { why: 'a pet name', reply: '亲爱的，我记下了。' },
  { why: 'a contrast ending', reply: '我记下了，不过你也别太累。' },
  { why: 'an order', reply: '你应该早点睡。' },
  { why: 'nothing in it at all', reply: '   ' },
  {
    why: 'four sentences',
    reply: '第一件事是这样。第二件事是那样。第三件事还有别的。第四件事也有。',
  },
  {
    why: 'more than sixty characters',
    reply:
      '今天的事情是这样的一件接着一件地来，先是要交提纲，然后是小组讨论，接着还有一份报告要写，最后还有一次课堂展示要准备，另外还要把英语单词背一遍。',
  },
  { why: 'no Chinese in it at all', reply: 'Got it, noted down.' },
  {
    why: 'a question as its first sentence on an emotional drop',
    reply: '是这样吗？',
    body: MIXED_DROP,
    expected: SAFE_EMOTION_REPLY,
  },
];

await check('an emotional drop is answered at once, and the styled line takes that place', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = createFakeProvider({ fallback: { kind: 'reply', reply: GOOD_REPLY } });
      const domain = createDomain({ store, provider });
      const dropped = await domain.drop(MIXED_DROP);

      assert.equal(
        dropped.reply,
        SAFE_EMOTION_REPLY,
        'a drop carrying a feeling is answered with one before the provider is even asked',
      );

      await settledUntil(async () => (await domain.getDrop(dropped.id))?.reply === GOOD_REPLY);
      assert.equal(
        (await domain.getDrop(dropped.id))?.reply,
        GOOD_REPLY,
        'the checked line replaced the one code could vouch for',
      );
    } finally {
      await store.close();
    }
  });
});

await check('a plain drop is answered with a record confirmation, not an emotion reply', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      // The provider is down, so what is left is the line code chose by itself.
      const provider = createFakeProvider({
        fallback: { kind: 'fail', reason: 'cloud LLM unreachable' },
      });
      const domain = createDomain({ store, provider });
      const dropped = await domain.drop(PLAIN_DROP);

      assert.equal(dropped.reply, SAFE_RECORDED_REPLY, 'nothing in this drop was turned into a feeling');
      assert.equal(
        (await domain.getDrop(dropped.id))?.reply,
        SAFE_RECORDED_REPLY,
        'and the drop keeps that line rather than inventing an emotion for it',
      );
    } finally {
      await store.close();
    }
  });
});

await check('the rules and the situation travel to the provider', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const requests: RespondRequest[] = [];
      const provider = createFakeProvider({
        fallback: { kind: 'reply', reply: GOOD_REPLY },
        onRespond: (request) => requests.push(request),
      });
      const domain = createDomain({ store, provider });
      await domain.drop(MIXED_DROP);
      await domain.drop(PLAIN_DROP);
      await domain.drop(ADVICE_DROP);
      await settledUntil(async () => requests.length >= 3);

      const [emotional, plain, asking] = requests;
      assert.equal(emotional?.brief.emotionPresent, true, 'the feeling in this drop was named');
      assert.equal(plain?.brief.emotionPresent, false, 'and a plain one was not turned into one');
      assert.equal(asking?.brief.adviceRequested, true, 'the explicit question was passed on');
      assert.equal(plain?.brief.adviceRequested, false, 'and a plain one is not licensed to advise');
      assert.ok(
        (emotional?.instructions.length ?? 0) > 0,
        'the rules themselves travel with every request',
      );
      assert.equal(
        emotional?.violations,
        undefined,
        'the first attempt has nothing to answer for',
      );
    } finally {
      await store.close();
    }
  });
});

await check('a rule-breaking reply never reaches the user, and is regenerated exactly once', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const provider = createFakeProvider({
        respondAttempts: {
          [MIXED_DROP]: [REPLY_THAT_BREAKS_THE_RULES, REPLY_THAT_BREAKS_THE_RULES],
        },
      });
      const domain = createDomain({ store, provider });
      const dropped = await domain.drop(MIXED_DROP);
      await settledUntil(async () => provider.seen.length >= 2);

      assert.equal(provider.seen.length, 2, 'the second failure must not become a third attempt');

      const shown = (await domain.getDrop(dropped.id))?.reply ?? '';
      assert.equal(shown, SAFE_EMOTION_REPLY, 'the safe line is what the user keeps');

      // The safe line is asserted against the rules the user can read off it,
      // as literals rather than by re-running the checker.
      assert.ok(!shown.includes('为什么'), 'it does not ask the user why');
      assert.ok(!shown.includes('宝贝'), 'it does not use a pet name');
      assert.ok(!shown.includes('别想那么多'), 'it does not tell the user how to feel');
      assert.ok(!/(但是|不过|至少)/.test(shown), 'it does not undo itself with a contrast');
      assert.ok([...shown.replace(/\s/g, '')].length <= 60, 'it stays within the length limit');
      assert.ok(shown.split(/(?<=[。！？])/u).filter((s) => s.trim().length > 0).length <= 3);
      assert.ok(/[\u4e00-\u9fff]/u.test(shown), 'it is in Chinese');
    } finally {
      await store.close();
    }
  });
});

await check('a rule-breaking first attempt is retried, and the retry is told what was wrong', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const requests: RespondRequest[] = [];
      const provider = createFakeProvider({
        respondAttempts: {
          [MIXED_DROP]: [REPLY_THAT_BREAKS_THE_RULES, { kind: 'reply', reply: GOOD_REPLY }],
        },
        onRespond: (request) => requests.push(request),
      });
      const domain = createDomain({ store, provider });
      const dropped = await domain.drop(MIXED_DROP);

      await settledUntil(async () => (await domain.getDrop(dropped.id))?.reply === GOOD_REPLY);
      assert.equal(provider.seen.length, 2, 'one more attempt, and no more than one');
      assert.ok((requests[1]?.violations?.length ?? 0) > 0, 'the retry was told which rules broke');
    } finally {
      await store.close();
    }
  });
});

for (const { why, reply, body, expected } of RULE_BREAKERS) {
  await check(`a reply with ${why} is refused`, async () => {
    await withDatabase(async (file) => {
      const store = openSqliteStore(file);
      try {
        const provider = createFakeProvider({ fallback: { kind: 'reply', reply } });
        const domain = createDomain({ store, provider });
        const dropped = await domain.drop(body ?? PLAIN_DROP);
        await settledUntil(async () => provider.seen.length >= 2);

        assert.equal(
          (await domain.getDrop(dropped.id))?.reply,
          expected ?? SAFE_RECORDED_REPLY,
          `the user was shown ${reply}, which the rules refuse`,
        );
      } finally {
        await store.close();
      }
    });
  });
}

await check('a request to stop is answered by code, and never reaches the provider', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      // The scripted line is one question and nothing else: it would pass every
      // string check there is. What makes it wrong is that the user asked to be
      // left alone — and the guarantee is structural, not a check: the provider
      // is not consulted at all, so there is no reply of its to refuse.
      const provider = createFakeProvider({ fallback: { kind: 'reply', reply: '你想说说吗？' } });
      const domain = createDomain({ store, provider });
      const dropped = await domain.drop(STOP_DROP);

      assert.equal(dropped.reply, SAFE_PRESENCE_REPLY, 'only presence is left when the user steps back');
      assert.deepEqual(provider.seen, [], 'nothing was asked of the provider for this drop');

      // And it stays that way: give the background work every chance to run.
      await settledUntil(async () => false);
      const shown = (await domain.getDrop(dropped.id))?.reply ?? '';
      assert.equal(shown, SAFE_PRESENCE_REPLY);
      assert.ok(!shown.includes('？'), 'the probing question never reached the user');
      assert.deepEqual(provider.seen, [], 'the provider was never consulted');
    } finally {
      await store.close();
    }
  });
});

await check('a fragment that merely looks like a cue is answered plainly', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      for (const body of LOOKALIKE_DROPS) {
        // The provider fails, so the line the user gets is code's own reading —
        // which is exactly the reading under test here.
        const provider = createFakeProvider({
          fallback: { kind: 'fail', reason: 'cloud LLM unreachable' },
        });
        const domain = createDomain({ store, provider });
        const dropped = await domain.drop(body);

        assert.equal(
          dropped.reply,
          SAFE_RECORDED_REPLY,
          `${body} was answered as though it carried something it does not`,
        );
        assert.deepEqual(
          provider.seen,
          [body],
          `${body} was not put to the provider at all`,
        );
      }
    } finally {
      await store.close();
    }
  });
});

await check('a provider that hangs or throws leaves a line that still obeys the rules', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      const hanging = createFakeProvider({ fallback: { kind: 'hang' } });
      const hung = await createDomain({ store, provider: hanging }).drop(MIXED_DROP);
      assert.equal(
        (await createDomain({ store }).getDrop(hung.id))?.reply,
        SAFE_EMOTION_REPLY,
        'a provider that never answers leaves the line code chose',
      );
      assert.equal(hanging.seen.length, 1, 'and is not asked a second time');

      const throwing = createFakeProvider({ fallback: { kind: 'throw', reason: 'provider blew up' } });
      const threw = await createDomain({ store, provider: throwing }).drop(MIXED_DROP);
      assert.equal((await createDomain({ store }).getDrop(threw.id))?.reply, SAFE_EMOTION_REPLY);
      assert.equal(throwing.seen.length, 1, 'a provider that cannot answer is not retried');
    } finally {
      await store.close();
    }
  });
});

await check('the reply lands in the database, so a refresh shows the same line', async () => {
  await withDatabase(async (file) => {
    const first = openSqliteStore(file);
    const provider = createFakeProvider({ fallback: { kind: 'reply', reply: GOOD_REPLY } });
    const dropped = await createDomain({ store: first, provider }).drop(MIXED_DROP);
    await settledUntil(async () => (await first.findDrop(dropped.id))?.reply === GOOD_REPLY);
    await first.close();

    const second = openSqliteStore(file);
    try {
      assert.equal(
        (await createDomain({ store: second }).getDrop(dropped.id))?.reply,
        GOOD_REPLY,
        'the line is on disk, not in memory',
      );
    } finally {
      await second.close();
    }
  });
});

console.log('\ndomain core — deletion, preview first');

/**
 * One more fragment, about something else entirely.
 *
 * It is what separates "this drop's conclusions went" from "every conclusion
 * went": deletion is the one operation in this product that cannot be undone,
 * so an over-eager delete has to fail a check as loudly as a missed one.
 */
const PASSER_BY = '楼下的橘猫又在晒太阳';
const PASSER_BY_READING: AnchoredReading = [PASSER_BY, ['橘猫'], null];

/** A run of the demo's material: three fragments about the exam, and one that only passes by. */
interface ExamRun {
  readonly domain: Domain;
  readonly store: ReturnType<typeof openSqliteStore>;
  /** The id of each fragment that was dropped, in the order it was dropped. */
  readonly ids: readonly string[];
  /** The id of the fragment that is **not** part of the matter. */
  readonly passerById: string;
}

/**
 * Settle the exam matter, then let one unrelated fragment pass by.
 *
 * The three exam fragments are dropped first and the look is forced, because a
 * fragment that has not been looked at is not in a matter yet — and the whole
 * question this section asks is what happens to a matter a drop belongs to. The
 * passing fragment joins nothing, so it accumulates into no matter and yields no
 * conclusion, which is what makes it a control.
 *
 * @param file - the database to open.
 * @param extra - any further scripts the provider needs for this run.
 * @returns the domain, the store and the ids the checks need.
 */
async function examRun(file: string, extra: Omit<FakeProviderScript, 'extractByBody'> = {}): Promise<ExamRun> {
  const store = openSqliteStore(file);
  const provider = mattersOnly([...EXAM_READINGS, PASSER_BY_READING], extra);
  const domain = createDomain({ store, provider });

  const ids: string[] = [];
  for (const [body] of EXAM_READINGS) ids.push((await domain.drop(body)).id);
  // Waited for rather than forced: the third fragment has to have been read and
  // attached before a look can see the matter it opened, and `requestSurfacing`
  // forces the look *and* records a surfacing — which is a fact this section then
  // has no way to tell apart from the ones it means to test.
  await readConclusions(domain, 1);
  const passerById = (await domain.drop(PASSER_BY)).id;
  await settledUntil(async () => (await domain.getDrop(passerById))?.extracted === true);

  return { domain, store, ids, passerById };
}

/** Script a sentence for a matter so a conclusion exists to be deleted. */
const EXAM_SCRIPT: Omit<FakeProviderScript, 'extractByBody'> = {
  composeConclusionByAnchor: { 好烦: { kind: 'sentence', text: EXAM_SENTENCE } },
};

/**
 * The line the portrait ends up holding for the exam matter.
 *
 * The provider writes the sentence and code writes the frame in front of it
 * (`frameFor`), so this is the weak band's opening plus what the fake was
 * scripted to say — spelled out here rather than composed the way the code
 * composes it, because an expectation rebuilt by the implementation would agree
 * with it by construction.
 */
const EXAM_LINE = `我不太确定：${EXAM_SENTENCE}。`;

await check('a drop that fed conclusions says how many came from it, before anything is removed', async () => {
  await withDatabase(async (file) => {
    const { domain, store, ids } = await examRun(file, EXAM_SCRIPT);
    try {
      const third = ids[2];
      assert.ok(third !== undefined, 'the third fragment was dropped');
      const preview = await domain.previewDeletion(third);
      assert.ok(preview !== null, 'the drop is there to be previewed');

      assert.equal(preview.dropId, third);
      assert.equal(preview.body, EXAM_THIRD, 'the preview names what is about to go');
      assert.equal(preview.conclusions.length, 1, 'one conclusion came out of that fragment');
      assert.equal(
        preview.conclusions[0]?.text,
        EXAM_LINE,
        'and it is the sentence the user would recognize',
      );
      assert.deepEqual(
        preview.terms,
        ['平时分 40%'],
        'the words only it said are listed — 「好烦」 is not, because two other fragments say it too',
      );

      // A preview that changed anything would not be a preview.
      assert.equal((await domain.listDrops()).length, 4, 'nothing was removed by asking');
      assert.equal((await domain.listConclusions()).length, 1, 'and no conclusion went either');
    } finally {
      await store.close();
    }
  });
});

await check('a fragment that fed nothing comes back with an empty preview, not an error', async () => {
  await withDatabase(async (file) => {
    const { domain, store, passerById } = await examRun(file, EXAM_SCRIPT);
    try {
      const preview = await domain.previewDeletion(passerById);
      assert.ok(preview !== null);
      assert.deepEqual(preview.conclusions, [], 'nothing came from it, and that is the honest count');
      assert.deepEqual(preview.terms, ['橘猫'], 'its own words are still listed — they would go with it');
    } finally {
      await store.close();
    }
  });
});

await check('previewing a drop that does not exist is null, not an error', async () => {
  await withDatabase(async (file) => {
    const { domain, store } = await examRun(file, EXAM_SCRIPT);
    try {
      assert.equal(await domain.previewDeletion('no-such-drop'), null);
    } finally {
      await store.close();
    }
  });
});

await check('nothing is deleted unless a choice is made, and "keep" deletes nothing', async () => {
  await withDatabase(async (file) => {
    const { domain, store, ids } = await examRun(file, EXAM_SCRIPT);
    try {
      const third = ids[2];
      assert.ok(third !== undefined);
      // The preview is the only thing that may be called without a choice, and
      // the choice itself is a required argument — so there is no call shape in
      // which a deletion happens by default.
      const kept = await domain.deleteDrop(third, 'keep');
      assert.equal(kept, null, 'keeping is not deleting, and says so');

      assert.equal((await domain.listDrops()).length, 4, 'the fragment is still there');
      assert.equal((await domain.listConclusions()).length, 1, 'and so is what came from it');
      assert.equal((await domain.recall('期末怎么算分')).kind, 'not-found', 'nothing was searched for — no provider');
    } finally {
      await store.close();
    }
  });
});

await check('cascading takes the drop, its conclusions, its terms and its links, and leaves the rest', async () => {
  await withDatabase(async (file) => {
    const { domain, store, ids, passerById } = await examRun(file, EXAM_SCRIPT);
    try {
      const second = ids[1];
      assert.ok(second !== undefined);
      const before = await domain.listLinks();
      assert.ok(before.length > 0, 'the material had grown links to lose');

      const removed = await domain.deleteDrop(second, 'cascade');
      assert.ok(removed !== null, 'the deletion reports what it took');
      assert.deepEqual(removed.conclusions.map((entry) => entry.text), [EXAM_LINE]);

      assert.equal(await domain.getDrop(second), null, 'the drop is gone');
      assert.equal((await domain.listConclusions()).length, 0, 'and so is the conclusion it fed');
      assert.equal((await domain.listDrops()).length, 3, 'the other fragments are untouched');
      assert.equal(
        (await domain.getDrop(passerById))?.body,
        PASSER_BY,
        'the fragment that accumulated into nothing is untouched too',
      );

      // Only the words this drop alone had said. 「好烦」 is still said by two
      // other fragments, so it stays — deleting a fragment must not change what
      // the *other* fragments said.
      const terms = await domain.listDrops();
      const said = terms.flatMap((drop) => drop.terms.map((term) => term.text));
      assert.ok(!said.includes('改提纲'), 'a word only that drop said went with it');
      assert.ok(said.includes('好烦'), 'a word other drops also said stays');
      assert.ok(
        !(await domain.listLinks()).some(
          (link) => link.from.text === '改提纲' || link.to.text === '改提纲',
        ),
        'and no link is left pointing at a word that is gone',
      );
    } finally {
      await store.close();
    }
  });
});

await check('the portrait and the chain keep no trace of a cascaded drop', async () => {
  await withDatabase(async (file) => {
    const { domain, store, ids } = await examRun(file, EXAM_SCRIPT);
    try {
      const second = ids[1];
      assert.ok(second !== undefined);

      // Shown to the user before it is deleted, so that "nothing of it is left"
      // is a claim about a judgement that really was in the portrait — not about
      // one that never existed.
      const surfaced = await domain.requestSurfacing();
      assert.equal(surfaced.kind, 'surfaced', 'the conclusion is in the portrait, and sayable');
      if (surfaced.kind !== 'surfaced') return;

      const removed = await domain.deleteDrop(second, 'cascade');
      assert.ok(removed !== null);
      assert.deepEqual(
        removed.conclusions.map((conclusion) => conclusion.id),
        [surfaced.conclusion.id],
        'the only conclusion in the portrait was the one that came from this fragment',
      );

      // The portrait is the conclusions themselves, so an empty portrait and an
      // empty chain are the same fact — but they are asserted through the reads
      // the page makes, because a chain that survived its conclusions would show
      // the user a "carried on from" pointing at nothing.
      assert.deepEqual(await domain.listConclusions(), []);
      const payload = JSON.stringify(await domain.listConclusions());
      assert.ok(!payload.includes(EXAM_SENTENCE), 'not even the wording is left behind');
      assert.ok(!payload.includes('改提纲'), 'nor a supporting word');

      // And the record of it having been shown goes with it: a judgement that is
      // gone cannot have been shown, and leaving the row would keep a *topic*
      // quiet that no longer exists.
      assert.deepEqual(
        (await store.listSurfacings()).filter((record) => record.conclusionId === surfaced.conclusion.id),
        [],
        'the surfacing record went with the conclusion it was measured on',
      );
    } finally {
      await store.close();
    }
  });
});

await check('after a cascade, recall no longer returns that drop, and still returns the others', async () => {
  await withDatabase(async (file) => {
    const { domain, store, ids } = await examRun(file, {
      ...EXAM_SCRIPT,
      parseQuestionByQuestion: { 期末怎么算分: { kind: 'match', matchText: ['期末'] } },
      composeFallback: { kind: 'answer', answer: ANSWER },
    });
    try {
      const first = ids[0];
      assert.ok(first !== undefined);

      const before = await domain.recall('期末怎么算分');
      assert.equal(before.kind, 'answered');
      if (before.kind !== 'answered') return;
      assert.deepEqual(before.sources.map((source) => source.body), [EXAM_FIRST]);

      await domain.deleteDrop(first, 'cascade');

      // The text is gone, not merely hidden: what matched was the original, and
      // the original no longer exists to be matched.
      const after = await domain.recall('期末怎么算分');
      assert.equal(after.kind, 'not-found', 'the records no longer cover a question only it answered');
    } finally {
      await store.close();
    }
  });
});

await check('keeping the conclusions keeps them whole, and prunes only what pointed at the drop', async () => {
  await withDatabase(async (file) => {
    const { domain, store, ids } = await examRun(file, EXAM_SCRIPT);
    try {
      const second = ids[1];
      const first = ids[0];
      assert.ok(second !== undefined && first !== undefined);

      const preview = await domain.previewDeletion(second);
      assert.ok(preview !== null);
      assert.equal(preview.conclusions.length, 1, 'the preview announces what is at stake');
      assert.deepEqual(preview.terms, ['改提纲'], 'and the word only it said');

      const removed = await domain.deleteDrop(second, 'original-only');
      assert.ok(removed !== null);
      assert.deepEqual(
        removed.conclusions,
        [],
        'nothing came away but the original, so nothing is reported as deleted',
      );
      assert.equal(removed.mode, 'original-only');

      const kept = await domain.listConclusions();
      assert.equal(kept.length, 1, 'the conclusion the user chose to keep is still in the portrait');
      assert.equal(kept[0]?.text, EXAM_LINE, 'word for word — it is not reworded or re-assembled');
      assert.ok(
        kept[0]?.support.every((term) => term.text !== '改提纲'),
        'but it no longer claims a word nobody says any more',
      );

      assert.equal(await domain.getDrop(second), null, 'the fragment itself is gone');
      assert.equal((await domain.getDrop(first))?.body, EXAM_FIRST, 'the other fragments are untouched');

      // Nothing dangles: every prop the portrait still shows is a word that
      // still exists, and every link still joins two words that exist.
      const remaining = await domain.listDrops();
      const alive = new Set(remaining.flatMap((drop) => drop.terms.map((term) => term.text)));
      assert.ok(
        kept.flatMap((conclusion) => conclusion.support).every((term) => alive.has(term.text)),
        'no support names a missing word',
      );
      assert.ok(
        (await domain.listLinks()).every((link) => alive.has(link.from.text) && alive.has(link.to.text)),
        'no link points at a missing word',
      );
    } finally {
      await store.close();
    }
  });
});

await check('a fragment that only passes by is deleted without disturbing anything', async () => {
  await withDatabase(async (file) => {
    const { domain, store, passerById } = await examRun(file, EXAM_SCRIPT);
    try {
      const removed = await domain.deleteDrop(passerById, 'cascade');
      assert.ok(removed !== null);
      assert.deepEqual(removed.conclusions, [], 'it had none to take');
      assert.equal(await domain.getDrop(passerById), null, 'but it went');
      assert.equal((await domain.listConclusions()).length, 1, 'and the matter it was never part of is intact');
    } finally {
      await store.close();
    }
  });
});

await check('deleting a drop that is gone already is null, not an error', async () => {
  await withDatabase(async (file) => {
    const { domain, store, passerById } = await examRun(file, EXAM_SCRIPT);
    try {
      await domain.deleteDrop(passerById, 'cascade');
      assert.equal(await domain.deleteDrop(passerById, 'cascade'), null, 'a second delete is an answer');
      assert.equal(await domain.previewDeletion(passerById), null);
    } finally {
      await store.close();
    }
  });
});

await check('a deletion survives a restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ytwins-domain-'));
  const file = join(dir, 'ytwins.sqlite');
  try {
    const first = await examRun(file, EXAM_SCRIPT);
    const second = first.ids[1];
    assert.ok(second !== undefined);
    await first.domain.deleteDrop(second, 'cascade');
    await first.store.close();

    // Reopening is what a page refresh does to the server's view of the file,
    // and this is the one operation that must not come back.
    const store = openSqliteStore(file);
    try {
      const domain = createDomain({ store });
      assert.equal(await domain.getDrop(second), null, 'the deleted fragment stays deleted');
      assert.equal((await domain.listDrops()).length, 3, 'and the rest is still there');
      assert.deepEqual(await domain.listConclusions(), [], 'nothing of it came back');
    } finally {
      await store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await check('a database written before the schema change migrates with everything intact', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ytwins-domain-'));
  const file = join(dir, 'ytwins.sqlite');
  try {
    // A **complete** file from tickets 01–08, with material already accumulated in
    // it: `term_.origin_drop_id` still cascades, and matters, conclusions and
    // surfacings already hang off those terms.
    //
    // Complete on purpose. An earlier version of this check built only the tables
    // ticket 09 touches, so the migration's real risk went untested: it **drops and
    // rebuilds `term_`**, and the rows that reference a term from other tables are
    // precisely what a rebuild can lose. A user with a used database is in that
    // state, not in the empty one.
    const old = new DatabaseSync(file);
    old.exec('PRAGMA foreign_keys = ON');
    old.exec(`
      CREATE TABLE drop_ (id TEXT PRIMARY KEY, body TEXT NOT NULL, dropped_at TEXT NOT NULL,
        input_type TEXT, reply TEXT NOT NULL, anchor_term_id TEXT REFERENCES term_(id) ON DELETE SET NULL);
      CREATE TABLE term_ (id TEXT PRIMARY KEY, text TEXT NOT NULL UNIQUE,
        origin_drop_id TEXT NOT NULL REFERENCES drop_(id) ON DELETE CASCADE,
        first_seen_at TEXT NOT NULL, vector TEXT);
      CREATE TABLE term_in_drop_ (drop_id TEXT NOT NULL REFERENCES drop_(id) ON DELETE CASCADE,
        term_id TEXT NOT NULL REFERENCES term_(id) ON DELETE CASCADE, said_at TEXT NOT NULL,
        PRIMARY KEY (drop_id, term_id));
      CREATE TABLE item_ (id TEXT PRIMARY KEY, drop_id TEXT NOT NULL REFERENCES drop_(id) ON DELETE CASCADE,
        text TEXT NOT NULL, due_at TEXT, state TEXT NOT NULL DEFAULT 'todo', caught_at TEXT NOT NULL);
      CREATE TABLE link_ (id TEXT PRIMARY KEY, a_term_id TEXT NOT NULL REFERENCES term_(id) ON DELETE CASCADE,
        b_term_id TEXT NOT NULL REFERENCES term_(id) ON DELETE CASCADE, kind TEXT NOT NULL,
        strength REAL NOT NULL, reason TEXT NOT NULL, UNIQUE (a_term_id, b_term_id));
      CREATE TABLE matter_ (id TEXT PRIMARY KEY,
        anchor_term_id TEXT NOT NULL REFERENCES term_(id) ON DELETE CASCADE,
        first_at TEXT NOT NULL, last_at TEXT NOT NULL, raised_count INTEGER NOT NULL);
      CREATE TABLE matter_term_ (matter_id TEXT NOT NULL REFERENCES matter_(id) ON DELETE CASCADE,
        term_id TEXT NOT NULL REFERENCES term_(id) ON DELETE CASCADE, position INTEGER NOT NULL,
        PRIMARY KEY (matter_id, term_id));
      CREATE TABLE matter_drop_ (drop_id TEXT PRIMARY KEY REFERENCES drop_(id) ON DELETE CASCADE,
        matter_id TEXT NOT NULL REFERENCES matter_(id) ON DELETE CASCADE,
        anchor_term_id TEXT REFERENCES term_(id) ON DELETE SET NULL, at TEXT NOT NULL);
      CREATE TABLE conclusion_ (id TEXT PRIMARY KEY,
        matter_id TEXT NOT NULL REFERENCES matter_(id) ON DELETE CASCADE,
        claim TEXT, text TEXT NOT NULL, kind TEXT NOT NULL, tier TEXT, relation TEXT NOT NULL,
        supersedes TEXT REFERENCES conclusion_(id) ON DELETE SET NULL, created_at TEXT NOT NULL,
        mentions INTEGER NOT NULL, span_days INTEGER NOT NULL, avg_strength REAL NOT NULL);
      CREATE TABLE conclusion_support_ (conclusion_id TEXT NOT NULL REFERENCES conclusion_(id) ON DELETE CASCADE,
        term_id TEXT NOT NULL REFERENCES term_(id) ON DELETE CASCADE, position INTEGER NOT NULL,
        PRIMARY KEY (conclusion_id, term_id));
      CREATE TABLE surfacing_ (id TEXT PRIMARY KEY,
        conclusion_id TEXT NOT NULL REFERENCES conclusion_(id) ON DELETE CASCADE, surfaced_at TEXT NOT NULL);
      CREATE TABLE settle_state_ (id INTEGER PRIMARY KEY CHECK (id = 1),
        drops_since INTEGER NOT NULL, look_now_next INTEGER NOT NULL);
    `);

    // One matter raised twice, anchored on 「好烦」 — a word **both** fragments say,
    // so it survives the deletion and the matter keeps standing. The interesting
    // part is not the deletion here but whether the rebuild carried it all over.
    old.exec(`
      INSERT INTO drop_ (id, body, dropped_at, input_type, reply, anchor_term_id)
        VALUES ('d1', '今天又在改提纲，好烦', '2026-09-01T00:00:00.000Z', 'emotion', '记下了。', NULL),
               ('d2', '平时分那 40% 到底怎么算，好烦', '2026-09-02T00:00:00.000Z', 'emotion', '记下了。', NULL);
      INSERT INTO term_ (id, text, origin_drop_id, first_seen_at, vector)
        VALUES ('t_bother', '好烦', 'd1', '2026-09-01T00:00:00.000Z', NULL),
               ('t_outline', '改提纲', 'd1', '2026-09-01T00:00:00.000Z', NULL),
               ('t_percent', '平时分 40%', 'd2', '2026-09-02T00:00:00.000Z', NULL);
      INSERT INTO term_in_drop_ (drop_id, term_id, said_at)
        VALUES ('d1', 't_bother', '2026-09-01T00:00:00.000Z'),
               ('d1', 't_outline', '2026-09-01T00:00:00.000Z'),
               ('d2', 't_bother', '2026-09-02T00:00:00.000Z'),
               ('d2', 't_percent', '2026-09-02T00:00:00.000Z');
      INSERT INTO link_ (id, a_term_id, b_term_id, kind, strength, reason)
        VALUES ('l1', 't_bother', 't_outline', 'same-drop', 1.0, '同一次投递里一起说的');
      INSERT INTO matter_ (id, anchor_term_id, first_at, last_at, raised_count)
        VALUES ('m1', 't_bother', '2026-09-01T00:00:00.000Z', '2026-09-02T00:00:00.000Z', 2);
      INSERT INTO matter_term_ (matter_id, term_id, position)
        VALUES ('m1', 't_bother', 0), ('m1', 't_outline', 1), ('m1', 't_percent', 2);
      INSERT INTO matter_drop_ (drop_id, matter_id, anchor_term_id, at)
        VALUES ('d1', 'm1', 't_bother', '2026-09-01T00:00:00.000Z'),
               ('d2', 'm1', 't_bother', '2026-09-02T00:00:00.000Z');
      INSERT INTO conclusion_ (id, matter_id, claim, text, kind, tier, relation, supersedes,
        created_at, mentions, span_days, avg_strength)
        VALUES ('c1', 'm1', '你最近好像有几件事堆在一起',
                '我不太确定：你最近好像有几件事堆在一起。', 'claim', 'weak', 'first', NULL,
                '2026-09-02T00:00:00.000Z', 2, 1, 1.0);
      INSERT INTO conclusion_support_ (conclusion_id, term_id, position)
        VALUES ('c1', 't_bother', 0), ('c1', 't_outline', 1), ('c1', 't_percent', 2);
      INSERT INTO surfacing_ (id, conclusion_id, surfaced_at)
        VALUES ('s1', 'c1', '2026-09-02T01:00:00.000Z');
      INSERT INTO settle_state_ (id, drops_since, look_now_next) VALUES (1, 0, 1);
    `);
    old.close();

    const store = openSqliteStore(file);
    try {
      // Everything that was in the file is still in it — the rebuild moved the
      // terms without disturbing what pointed at them.
      const terms = (await store.listTerms()).map((term) => term.text);
      assert.deepEqual(terms.sort(), ['好烦', '改提纲', '平时分 40%'].sort(), 'every term survived');

      const matters = await store.listMatters();
      assert.equal(matters.length, 1, 'the matter survived');
      assert.deepEqual(
        matters[0]?.supportTermIds.length,
        3,
        'with its whole support — nothing was orphaned by the rebuild',
      );
      assert.equal(matters[0]?.raisedCount, 2, 'and its count');

      const conclusions = await store.listConclusions();
      assert.equal(conclusions.length, 1, 'the conclusion survived');
      assert.equal(conclusions[0]?.supportTermIds.length, 3, 'still citing all three words');
      assert.equal((await store.listSurfacings()).length, 1, 'and the record of it being shown');

      // The old cascading reference is gone, and nothing it was holding up came
      // loose in the process. `foreign_key_check` is the assertion the rebuild is
      // actually about: a migration that left a dangling reference would still
      // pass every read above, because a dangling reference reads as a missing row.
      const checker = new DatabaseSync(file);
      const violations = checker.prepare('PRAGMA foreign_key_check').all();
      const termForeignKeys = checker.prepare('PRAGMA foreign_key_list(term_)').all() as unknown as {
        readonly from: string;
      }[];
      checker.close();
      assert.deepEqual(violations, [], 'nothing dangles after the rebuild');
      assert.ok(
        !termForeignKeys.some((key) => key.from === 'origin_drop_id'),
        'and a term no longer cascades away with the drop that first said it',
      );

      // And now the behaviour the migration is for: deleting the fragment that
      // first said 「好烦」 must not take the word from the fragment still saying it.
      const domain = createDomain({ store });
      await domain.deleteDrop('d1', 'cascade');
      const said = (await domain.listDrops()).flatMap((drop) => drop.terms.map((term) => term.text));
      assert.ok(said.includes('好烦'), 'a word the remaining fragment still says did not disappear');
      assert.ok(!said.includes('改提纲'), 'and a word only the deleted one said did go');
    } finally {
      await store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await check('keeping works when the deleted fragment is the one the matter was opened around', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      // The shape every other check in this section misses: a matter anchored on
      // a word that the **first** fragment alone said. Everywhere else the anchor
      // is 「好烦」, which all three fragments say, so the anchor survives by
      // accident and the re-anchoring path is never walked — which is exactly how
      // a foreign-key violation lived here until the e2e found it.
      const first = '今天面试没过，心里很慌';
      const rest: [string, string[]][] = [
        ['面试又挂了，心里很慌', ['面试又挂了', '心里很慌']],
        ['面试还是没消息，心里很慌', ['面试没消息', '心里很慌']],
      ];
      const provider = mattersOnly(
        [[first, ['面试没过', '心里很慌'], '心里很慌'], ...rest.map(([body, terms]) => [body, terms, '心里很慌'] as AnchoredReading)],
        { composeConclusionByAnchor: { 心里很慌: { kind: 'sentence', text: '你最近好像在等一个结果' } } },
      );
      const domain = createDomain({ store, provider });

      const droppedFirst = await domain.drop(first);
      for (const [body] of rest) await domain.drop(body);
      assert.equal((await readConclusions(domain, 1)).length, 1, 'the matter crossed');

      const preview = await domain.previewDeletion(droppedFirst.id);
      assert.ok(preview !== null);
      assert.deepEqual(preview.terms, ['面试没过'], 'the word only the first fragment said');

      // The anchor was opened around 「心里很慌」, which all three say, so here the
      // matter keeps standing on it and nothing has to be re-anchored. What this
      // pins is the **whole path** running: reading the facts, carrying the
      // judgement over, deleting, and pruning — none of which may throw.
      const removed = await domain.deleteDrop(droppedFirst.id, 'original-only');
      assert.ok(removed !== null, 'the deletion completed rather than blowing up mid-way');
      assert.equal(await domain.getDrop(droppedFirst.id), null, 'the fragment is gone');

      const kept = await domain.listConclusions();
      assert.equal(kept.length, 1, 'the judgement the user kept is still there');
      assert.ok(
        kept[0]?.support.every((term) => term.text !== '面试没过'),
        'and it no longer cites the word that went',
      );
      assert.ok(
        kept[0]?.support.some((term) => term.text === '心里很慌'),
        'while the feeling all three fragments share is still cited',
      );
    } finally {
      await store.close();
    }
  });
});

await check('keeping works when the anchor itself is the word only that fragment said', async () => {
  await withDatabase(async (file) => {
    const store = openSqliteStore(file);
    try {
      // The branch the check above does not reach, and the one that was actually
      // broken: the matter's **anchor** is a word only the deleted fragment said,
      // so the matter has to be re-opened around a word that survives — or it
      // cascades away and takes the judgement the user asked to keep with it.
      //
      // Built through the store rather than through drops, because a matter only
      // ends up anchored on an orphaned word in a shape the domain's own
      // attachment rules do not produce: the anchor is normally the feeling the
      // fragments keep repeating. This is the state a real database can still be
      // in after an earlier deletion, so it has to work.
      const anchorDrop = await store.appendDrop(
        '今天面试没过，心里很慌',
        '记下了。',
        '2026-09-01T00:00:00.000Z',
        null,
      );
      const otherDrop = await store.appendDrop(
        '面试又挂了，好烦',
        '记下了。',
        '2026-09-02T00:00:00.000Z',
        null,
      );
      const anchorReading = await store.recordExtraction(
        anchorDrop.id,
        { inputType: 'emotion', items: [], terms: ['心里很慌'], anchor: '心里很慌' },
        '2026-09-01T00:00:00.000Z',
      );
      const otherReading = await store.recordExtraction(
        otherDrop.id,
        { inputType: 'emotion', items: [], terms: ['面试又挂了'], anchor: null },
        '2026-09-02T00:00:00.000Z',
      );
      const anchorTerm = anchorReading.terms[0];
      const survivor = otherReading.terms[0];
      assert.ok(anchorTerm !== undefined && survivor !== undefined);

      const matter = await store.openMatter({
        dropId: anchorDrop.id,
        anchorTermId: anchorTerm.id,
        at: '2026-09-01T00:00:00.000Z',
        termIds: [anchorTerm.id],
      });
      await store.growMatter({
        matterId: matter.id,
        dropId: otherDrop.id,
        anchorTermId: null,
        at: '2026-09-02T00:00:00.000Z',
        termIds: [survivor.id],
      });
      await store.appendConclusion({
        matterId: matter.id,
        claim: null,
        text: '我不太确定：你最近好像在等一个结果。',
        kind: 'catch',
        tier: null,
        softened: false,
        relation: 'first',
        supersedes: null,
        createdAt: '2026-09-02T00:00:00.000Z',
        mentions: 2,
        spanDays: 1,
        averageStrength: 1,
        supportTermIds: [anchorTerm.id, survivor.id],
      });

      const domain = createDomain({ store });
      const preview = await domain.previewDeletion(anchorDrop.id);
      assert.ok(preview !== null);
      assert.deepEqual(preview.conclusions.length, 1, 'the judgement came from this fragment');

      // This is the call that used to throw `FOREIGN KEY constraint failed`: the
      // matter was re-opened by inventing a `matter_drop_` row for a drop that
      // does not exist. A deletion that throws here is the worst outcome in the
      // product — the user asked for something reversible-looking and got neither
      // the deletion nor their material left alone.
      const removed = await domain.deleteDrop(anchorDrop.id, 'original-only');
      assert.ok(removed !== null, 'the deletion completed');

      const kept = await domain.listConclusions();
      assert.equal(kept.length, 1, 'the judgement survived its anchor going');
      assert.ok(
        kept[0]?.support.every((term) => term.text !== '心里很慌'),
        'and stopped citing the word that went',
      );
      assert.equal(
        (await domain.listDrops()).length,
        1,
        'only the fragment that was deleted went',
      );
      // The matter is still feedable: it did not quietly lose its ground.
      const matters = await store.listMatters();
      assert.equal(matters.length, 1, 'the matter is still there');
      assert.ok(
        matters[0] !== undefined && !matters[0].supportTermIds.includes(anchorTerm.id),
        'and it no longer counts a word nobody says',
      );
    } finally {
      await store.close();
    }
  });
});

console.log('\ndomain core — revising a conclusion');

/**
 * The line code owns for a correction.
 *
 * Spelled out here rather than imported from the module, for the same reason as
 * every other expectation in this file: a check that reads the constant it is
 * checking would agree with the implementation by construction. What this one
 * buys is that the line the product writes into the portrait stays literally
 * that line.
 */
const CORRECTION_LINE = '你标了这条不对。';

/**
 * The exam matter, settled into its conclusion, with everything a revision
 * check starts from.
 *
 * Every check in this section begins the same way — three fragments, one
 * conclusion — so that what a check does *afterwards* is the only thing that
 * differs between two runs. The provider is scripted for the fourth fragment
 * too, because most of these checks go on to use it.
 */
async function revisionRun(
  file: string,
  options: {
    readonly conclusionPolicy?: ConclusionPolicy;
    readonly now?: () => string;
  } = {},
): Promise<{
  readonly domain: Domain;
  readonly store: ReturnType<typeof openSqliteStore>;
  readonly conclusion: Conclusion;
  readonly provider: ReturnType<typeof createFakeProvider>;
}> {
  const store = openSqliteStore(file);
  const provider = mattersOnly([...EXAM_READINGS, EXAM_FOURTH_READING], {
    composeConclusionByAnchor: { 好烦: { kind: 'sentence', text: EXAM_SENTENCE } },
  });
  const domain = createDomain({
    store,
    provider,
    conclusionPolicy: options.conclusionPolicy ?? policy({ judgeTiming: 'count' }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });

  for (const body of [EXAM_FIRST, EXAM_SECOND, EXAM_THIRD]) await domain.drop(body);
  const [conclusion] = await readConclusions(domain, 1);
  assert.ok(conclusion !== undefined, 'the three fragments settled into one conclusion');
  return { domain, store, conclusion, provider };
}

await check('marking a conclusion wrong keeps it and adds an overturning record beside it', async () => {
  await withDatabase(async (file) => {
    const { domain, store, conclusion, provider } = await revisionRun(file);
    try {
      const asked = provider.composed.length;
      const correction = await domain.markConclusionWrong(conclusion.id);
      assert.ok(correction !== null, 'there was a conclusion to reject');

      assert.equal(correction.kind, 'correction', 'it is a record of the user\'s act, not a judgement');
      assert.equal(correction.tier, null, 'and it asserts nothing, so no band applies to it');
      assert.equal(
        correction.text,
        CORRECTION_LINE,
        'the line is code\'s own — the model is never asked what the user meant',
      );
      assert.deepEqual(
        checkConclusion(CORRECTION_LINE),
        [],
        'and it keeps the shape a conclusion has to keep',
      );
      assert.equal(correction.relation, 'overturn', 'how it stands to the one before it');
      assert.equal(correction.supersedes?.id, conclusion.id, 'and it says which one it replaces');
      assert.equal(correction.supersedes?.text, conclusion.text);
      assert.equal(correction.softened, false, 'and there is no band for anything to be softened from');
      assert.deepEqual(correction.support, [], 'nothing supports it: the tap is the ground');
      assert.deepEqual(
        [correction.mentions, correction.spanDays, correction.averageStrength],
        [0, 0, 0],
        'and nothing was read off any numbers for it',
      );
      assert.equal(provider.composed.length, asked, 'no sentence was composed for it');

      // The chain only grew, and the sentence it grew away from is untouched.
      const conclusions = await domain.listConclusions();
      assert.equal(conclusions.length, 2, 'the old conclusion is still on the chain');
      const [before, after] = conclusions;
      assert.equal(before?.id, conclusion.id);
      assert.equal(before?.text, conclusion.text, 'not rewritten');
      assert.deepEqual(
        before?.support.map((term) => term.text),
        EXAM_SUPPORT,
        'and not edited either — its evidence is what it was assembled from',
      );
      assert.equal(before?.supersededBy?.id, correction.id, 'the chain reads forwards too');
      assert.equal(after?.id, correction.id, 'and the correction is the newest thing on it');
    } finally {
      await store.close();
    }
  });
});

await check('marking the same conclusion wrong twice records one correction, not two', async () => {
  await withDatabase(async (file) => {
    const { domain, store, conclusion } = await revisionRun(file);
    try {
      const first = await domain.markConclusionWrong(conclusion.id);
      const second = await domain.markConclusionWrong(conclusion.id);

      assert.equal(second?.id, first?.id, 'the second tap is the same fact, so it is the same record');
      assert.equal((await domain.listConclusions()).length, 2, 'and the chain did not grow again');
    } finally {
      await store.close();
    }
  });
});

await check('marking a conclusion that does not exist is null, not an error', async () => {
  await withDatabase(async (file) => {
    const { domain, store } = await revisionRun(file);
    try {
      assert.equal(await domain.markConclusionWrong('no-such-conclusion'), null);
      assert.equal(
        (await domain.listConclusions()).length,
        1,
        'and nothing was written for it',
      );
    } finally {
      await store.close();
    }
  });
});

await check('a correction survives a restart, and so does what it overturned', async () => {
  await withDatabase(async (file) => {
    const { domain, store, conclusion } = await revisionRun(file);
    let correctionId: string | undefined;
    try {
      correctionId = (await domain.markConclusionWrong(conclusion.id))?.id;
    } finally {
      await store.close();
    }

    const reopened = openSqliteStore(file);
    try {
      const conclusions = await createDomain({ store: reopened }).listConclusions();
      assert.equal(conclusions.length, 2, 'both records are on disk');
      assert.equal(conclusions[0]?.id, conclusion.id, 'the rejected one first, as it was said');
      assert.equal(conclusions[0]?.supersededBy?.id, correctionId, 'still overturned');
      assert.equal(conclusions[1]?.id, correctionId);
      assert.equal(conclusions[1]?.relation, 'overturn', 'and the relation is on disk, not in memory');
      assert.equal(conclusions[1]?.supersedes?.id, conclusion.id);
    } finally {
      await reopened.close();
    }
  });
});

await check('a sentence added beside a conclusion is a drop, and enters the same chain', async () => {
  await withDatabase(async (file) => {
    const { domain, store, conclusion } = await revisionRun(file);
    try {
      const addition = await domain.appendToConclusion(conclusion.id, EXAM_FOURTH);
      assert.ok(addition !== null, 'there was a conclusion to write beside');
      assert.equal(addition.conclusion.id, conclusion.id, 'it names what it was written beside');
      assert.equal(addition.drop.body, EXAM_FOURTH, 'the wording is kept byte for byte');
      assert.ok(addition.drop.reply.trim().length > 0, 'and it is answered like any other drop');

      await settledUntil(async () => (await domain.getDrop(addition.drop.id))?.extracted === true);
      const drop = await domain.getDrop(addition.drop.id);
      assert.deepEqual(
        drop?.terms.map((term) => term.text),
        ['期末考', '好烦'],
        'its own terms were read out of it',
      );
      assert.equal((await domain.listDrops()).length, 4, 'and it is a drop in the list like any other');

      // What makes it "the same chain" rather than a drop that happened to be
      // nearby: it joined that matter, so what settles next carries on from the
      // conclusion it was written beside.
      const conclusions = await readConclusions(domain, 2);
      assert.equal(conclusions.length, 2);
      assert.equal(conclusions[1]?.relation, 'inherit');
      assert.equal(conclusions[1]?.supersedes?.id, conclusion.id);
      assert.ok(
        conclusions[1]?.support.map((term) => term.text).includes('期末考'),
        'and the new sentence is part of what the new conclusion stands on',
      );
    } finally {
      await store.close();
    }
  });
});

await check('writing beside a conclusion that does not exist is null, and stores nothing', async () => {
  await withDatabase(async (file) => {
    const { domain, store } = await revisionRun(file);
    try {
      assert.equal(await domain.appendToConclusion('no-such-conclusion', '其实不是这样'), null);
      assert.equal((await domain.listDrops()).length, 3, 'no drop was written for it');
    } finally {
      await store.close();
    }
  });
});

await check('a rejected matter stops attracting fragments that merely look like it', async () => {
  /** Drop the fourth fragment and let the invisible settling land. */
  async function fourthFragment(domain: Domain): Promise<void> {
    await domain.drop(EXAM_FOURTH);
    await settleReadings(domain);
  }

  // Nothing was rejected: the fragment shares 「好烦」 with the matter, clears the
  // ratio and joins it — which is the behaviour the rejection has to change.
  await withDatabase(async (file) => {
    const { domain, store, conclusion } = await revisionRun(file);
    try {
      await fourthFragment(domain);
      const conclusions = await readConclusions(domain, 2);
      assert.equal(conclusions.length, 2, 'it was read as the same matter');
      assert.equal(conclusions[1]?.supersedes?.id, conclusion.id);
      assert.equal((await store.listMatters()).length, 1, 'one matter, and it grew');
    } finally {
      await store.close();
    }
  });

  // The same fragment, after the user said the reading was wrong. The overlap is
  // no longer worth what it was, so the matter does not take it in.
  await withDatabase(async (file) => {
    const { domain, store, conclusion } = await revisionRun(file);
    try {
      await domain.markConclusionWrong(conclusion.id);
      await fourthFragment(domain);

      assert.equal(
        (await domain.listConclusions()).length,
        2,
        'the rejected reading is not said a second time in slightly different clothes',
      );
      assert.equal((await store.listMatters()).length, 2, 'the fragment opened a matter of its own');
    } finally {
      await store.close();
    }
  });
});

await check('what a rejection is worth is a value the core was given, not a fixed number', async () => {
  await withDatabase(async (file) => {
    const { domain, store, conclusion } = await revisionRun(file, {
      conclusionPolicy: policy({ judgeTiming: 'count', overturnedOverlapFactor: 1 }),
    });
    try {
      await domain.markConclusionWrong(conclusion.id);
      await domain.drop(EXAM_FOURTH);
      await settleReadings(domain);

      const conclusions = await readConclusions(domain, 3);
      assert.equal(conclusions.length, 3, 'with the dampening at 1 the matter takes it in again');
      assert.equal(conclusions[2]?.supersedes?.id, conclusions[1]?.id);
      assert.equal((await store.listMatters()).length, 1, 'still the one matter');
    } finally {
      await store.close();
    }
  });
});

await check('after a rejection, the next sentence about that matter speaks one band softer', async () => {
  /**
   * A matter over sixteen days, its conclusion rejected, and a note written
   * beside it that carries two words of its own.
   *
   * The note is written beside the conclusion rather than merely dropped, so
   * that both runs reach the same matter whether or not the rejection is in
   * force — what a check compares here is the **band**, not the attachment.
   */
  async function seeded(
    file: string,
    bandDrop: number,
  ): Promise<{
    readonly domain: Domain;
    readonly store: ReturnType<typeof openSqliteStore>;
    readonly conclusions: readonly Conclusion[];
  }> {
    const store = openSqliteStore(file);
    const clock = simulatedClock('2026-09-01T09:00:00.000Z');
    const note = '期末考和提纲格式，还是那两件事';
    const provider = mattersOnly(
      [
        ...EXAM_READINGS,
        // Two terms of its own, and no feeling of its own: nothing links them to
        // the anchor, which is what keeps the matter out of the strong band.
        [note, ['期末考', '提纲格式'], null],
      ],
      { composeConclusionByAnchor: { 好烦: { kind: 'sentence', text: EXAM_SENTENCE } } },
    );
    const domain = createDomain({
      store,
      provider,
      conclusionPolicy: policy({ judgeTiming: 'count', overturnedBandDrop: bandDrop }),
      now: clock.now,
    });

    await domain.drop(EXAM_FIRST);
    clock.advanceDays(1);
    await domain.drop(EXAM_SECOND);
    clock.advanceDays(15);
    await domain.drop(EXAM_THIRD);
    const [settled] = await readConclusions(domain, 1);
    assert.ok(settled !== undefined);

    await domain.markConclusionWrong(settled.id);
    clock.advanceDays(1);
    assert.ok((await domain.appendToConclusion(settled.id, note)) !== null);

    // Three records either way — the rejected conclusion, the correction, and
    // what the note settled into. What the two runs differ on is the band.
    const conclusions = await readConclusions(domain, 3);
    assert.equal(conclusions.length, 3, 'the note settled into the chain it was written beside');
    return { domain, store, conclusions };
  }

  // The rule switched off: the same seven terms over seventeen days earn the
  // medium band, which is what the step is doing rather than what the numbers were.
  await withDatabase(async (file) => {
    const { domain, store, conclusions } = await seeded(file, 0);
    try {
      const newest = conclusions[conclusions.length - 1];
      assert.equal(newest?.tier, 'medium', 'the numbers earn the medium band');
      assert.equal(newest?.text, `${EXAM_SENTENCE}。`, 'and nothing hedges it further');
      assert.equal(newest?.softened, false, 'so nothing was softened, and the record does not say otherwise');
      assert.equal((await domain.listConclusions()).length, 3);
    } finally {
      await store.close();
    }
  });

  await withDatabase(async (file) => {
    const { store, conclusions } = await seeded(file, 1);
    try {
      assert.equal(conclusions.length, 3, 'the rejected one, the correction, and what came after');
      const newest = conclusions[2];
      assert.equal(newest?.tier, 'weak', 'one band softer than the numbers alone would earn');
      assert.equal(newest?.text, `我不太确定：${EXAM_SENTENCE}。`);
      assert.equal(
        newest?.softened,
        true,
        'and the record says so, so the band and the numbers beside it cannot tell two stories',
      );
      assert.equal(
        newest?.supersedes?.id,
        conclusions[1]?.id,
        'and it carries on from the correction, because that is where the matter stands',
      );
    } finally {
      await store.close();
    }
  });
});

await check('the product\'s own note of what the user did cannot itself be rejected', async () => {
  await withDatabase(async (file) => {
    const { domain, store, conclusion } = await revisionRun(file);
    try {
      const correction = await domain.markConclusionWrong(conclusion.id);
      assert.ok(correction !== null);

      // A correction is a fact about the user, not a reading of them: there is
      // nothing in it to disagree with, so nothing is written for one. Refused by
      // the domain rather than by the page, so no caller can reach it.
      assert.equal(
        await domain.markConclusionWrong(correction.id),
        null,
        'there is nothing in a correction to reject',
      );
      assert.equal(
        (await domain.listConclusions()).length,
        2,
        'and the chain did not grow a record about a record',
      );
    } finally {
      await store.close();
    }
  });
});

await check('a correction whose target is gone is still readable', async () => {
  await withDatabase(async (file) => {
    const { domain, store, conclusion } = await revisionRun(file);
    try {
      const correction = await domain.markConclusionWrong(conclusion.id);
      assert.ok(correction !== null);

      // The one edge ticket 09 left open for this ticket: deleting a conclusion
      // sets `supersedes` to null rather than leaving a pointer at nothing. Built
      // by hand because no path through the domain removes a target while its
      // correction survives — which is exactly why the reading has to be pinned
      // rather than assumed.
      await store.deleteConclusion(conclusion.id);

      const conclusions = await domain.listConclusions();
      assert.equal(conclusions.length, 1, 'the correction is still on the chain');
      const [stranded] = conclusions;
      assert.equal(stranded?.id, correction.id);
      assert.equal(stranded?.text, CORRECTION_LINE, 'saying what it said');
      assert.equal(stranded?.relation, 'overturn', 'with the relation it was written under');
      assert.equal(stranded?.supersedes, null, 'and no pointer at something that is no longer there');
    } finally {
      await store.close();
    }
  });
});

console.log('\ndomain core — the three acts, on the preset material');

/**
 * The clock the preset material is read against.
 *
 * Pinned because the material says 「下周三」 rather than carrying a date: the
 * day the demo runs decides which Wednesday that is, exactly as it would if a
 * model read it, and a check that let the real clock decide could not name the
 * day the second act's answer has to mention. 2026-09-17 is a Thursday, so the
 * Wednesday it names is 2026-09-23.
 */
const PRESET_NOW = '2026-09-17T00:00:00.000Z';

/** The "a few days later" viewpoint the second act asks from: exactly three days before the outline. */
const PRESET_ASKED_AT = '2026-09-20T01:00:00.000Z';

/**
 * A library as a demo leaves it: the preset leads already in it, and the chain
 * that read them.
 *
 * The same three things the server wires up for a demo — the one preset
 * provider, the domain's own clock, and the dice pinned to their first face —
 * because a check that ran on different wiring could pass while the demo failed.
 *
 * @param file - the database to open.
 * @returns the store and the domain, with the leads laid down.
 */
async function presetRun(file: string): Promise<{
  readonly store: ReturnType<typeof openSqliteStore>;
  readonly domain: Domain;
}> {
  const store = openSqliteStore(file);
  const now = (): string => PRESET_NOW;
  const domain = createDomain({
    store,
    provider: createPresetProvider({ now }),
    now,
    // Pinned, and this is not a convenience: which of a band's openings a line
    // carries is a roll, and the demo runs with the same roll pinned so that
    // "run it again and it says the same thing" is a fact rather than a hope.
    random: () => 0,
  });
  await seedPreset(domain);
  return { store, domain };
}

/**
 * The answer's shape, rather than one exact day count.
 *
 * The count is read off the moment asked and the material's own 「下周三」, which is
 * resolved in **local** time, so an exact literal here would be a check that only
 * passes in the timezone this machine happens to be in. What the second act
 * promises is the grading scheme restated and the deadline said relative to that
 * moment; that the count moves with the viewpoint is checked on its own.
 */
const PRESET_ANSWER_SHAPE = /^平时分占 40%，期末考占 60%。提纲还有 (\d+) 天到期。$/u;

/** The day count an answer states, or a failed assertion naming what it said. */
function presetDaysLeft(answer: string): number {
  const match = PRESET_ANSWER_SHAPE.exec(answer);
  assert.ok(match !== null, `the answer restates the grading and the deadline: ${answer}`);
  return Number(match[1]);
}

/** What the three acts came to, in the words the page would show. */
interface ThreeActs {
  readonly itemText: string | undefined;
  readonly itemDueAt: string | null | undefined;
  readonly dropReply: string | undefined;
  readonly dropTerms: readonly string[];
  readonly answer: string;
  readonly sources: readonly string[];
  readonly actedOne: string;
  readonly actedOneSupport: readonly string[];
  readonly actedThree: string;
  readonly actedThreeSupport: readonly string[];
}

/**
 * Run the three acts against whatever library this domain holds.
 *
 * Written once and called twice by the repeatability check, because "the same
 * result twice" is only a claim about **this** sequence of acts: a second
 * spelling of the sequence could differ from the first and the comparison would
 * then be checking nothing.
 *
 * Every step mirrors what the page does after a drop — read it back, then ask
 * the product to speak — rather than reaching further into the domain than the
 * page can.
 *
 * @param domain - the library to run against.
 * @returns what a presenter would have seen, in the page's own terms.
 */
async function runThreeActs(domain: Domain): Promise<ThreeActs> {
  // Act one: drop the messy fragment, and wait for it to be read.
  const dropped = await domain.drop(PRESET_ACTS.drop);
  await domain.extract(dropped.id);
  const read = await domain.getDrop(dropped.id);
  const first = await domain.requestSurfacing({ dropId: dropped.id });

  // Act two: ask the question, from the "a few days later" viewpoint.
  const asked = await domain.recall(PRESET_ACTS.question, { now: PRESET_ASKED_AT });

  // Act three: one more feeling, and the moment it makes.
  const felt = await domain.drop(PRESET_ACTS.feeling);
  await domain.extract(felt.id);
  const third = await domain.requestSurfacing({ dropId: felt.id });

  return {
    itemText: read?.items[0]?.text,
    itemDueAt: read?.items[0]?.dueAt,
    dropReply: read?.reply,
    dropTerms: (read?.terms ?? []).map((term) => term.text),
    answer: asked.kind === 'answered' ? asked.answer : `(${asked.kind})`,
    sources: asked.kind === 'answered' ? asked.sources.map((source) => source.body) : [],
    actedOne: first.kind === 'surfaced' ? first.text : `(${first.kind})`,
    actedOneSupport: first.kind === 'surfaced' ? first.support.map((term) => term.text) : [],
    actedThree: third.kind === 'surfaced' ? third.text : `(${third.kind})`,
    actedThreeSupport: third.kind === 'surfaced' ? third.support.map((term) => term.text) : [],
  };
}

await check('the preset material is already in the library when a demo starts', async () => {
  await withDatabase(async (file) => {
    const { store, domain } = await presetRun(file);
    try {
      const drops = await domain.listDrops();
      assert.deepEqual(
        drops.map((drop) => drop.body),
        [...PRESET_LEADS],
        'the leads are ordinary drops, in the order the demo lays them down',
      );
      assert.ok(
        drops.every((drop) => drop.extracted),
        'and each has been read before the demo starts, so the first act does not race them',
      );
      assert.equal(
        (await domain.listConclusions()).length,
        0,
        'nothing has crossed the threshold yet: the acts are what crosses it',
      );
    } finally {
      await store.close();
    }
  });
});

await check('act one: the messy fragment splits into an item and a faithful record', async () => {
  await withDatabase(async (file) => {
    const { store, domain } = await presetRun(file);
    try {
      const dropped = await domain.drop(PRESET_ACTS.drop);
      await domain.extract(dropped.id);
      const read = await domain.getDrop(dropped.id);

      // No type was chosen and no time was filled in: the fragment is one
      // unformatted sentence, and both halves come out of it anyway.
      assert.equal(read?.body, PRESET_ACTS.drop, 'the record is the original, verbatim');
      assert.equal(read?.items.length, 1, 'and one item was read out of it');
      assert.equal(read?.items[0]?.text, PRESET_ITEM_TEXT);
      assert.deepEqual(
        read?.terms.map((term) => term.text),
        [...PRESET_DROP_TERMS],
        'the words it yielded are the user\'s own',
      );

      // 「下周三」 resolved against the day the demo ran, the way a real reader
      // would resolve it — and a Wednesday, which is what the words say.
      const due = new Date(read?.items[0]?.dueAt ?? '');
      assert.equal(due.getDay(), 3, 'the deadline is the Wednesday the fragment named');
      assert.ok(due.getTime() > Date.parse(PRESET_NOW), 'and it is still ahead');
      assert.ok(
        due.getTime() - Date.parse(PRESET_NOW) < 7 * 86_400_000,
        'and it is the next one rather than a later one',
      );
      assert.equal(due.getHours(), 9, 'at the hour a deadline is usually given');
    } finally {
      await store.close();
    }
  });
});

await check('act one is a moment: the preset material speaks once the matter has been raised again', async () => {
  await withDatabase(async (file) => {
    const { store, domain } = await presetRun(file);
    try {
      const dropped = await domain.drop(PRESET_ACTS.drop);
      await domain.extract(dropped.id);

      const surfaced = await domain.requestSurfacing({ dropId: dropped.id });
      assert.equal(surfaced.kind, 'surfaced', 'the third mention is the crossing, and it is a moment');
      assert.equal(surfaced.tier, 'weak', 'said in one sitting, so the line is hedged');
      assert.equal(
        surfaced.text,
        '我不太确定：你最近好像有几件事堆在一起，心里一直不太顺。',
        'the sentence is the provider\'s and the uncertainty in front of it is code\'s',
      );
      assert.deepEqual(
        surfaced.support.map((term) => term.text),
        [...PRESET_EXAM_SUPPORT],
        'with every preset word behind it named',
      );

      const [conclusion] = await domain.listConclusions();
      assert.equal(conclusion?.kind, 'claim', 'and the portrait holds a judgement, not a catch');
      assert.equal(conclusion?.mentions, 3, 'standing on the three times it was raised');
    } finally {
      await store.close();
    }
  });
});

await check('act two: the question is answered, and it names the drop it came from', async () => {
  await withDatabase(async (file) => {
    const { store, domain } = await presetRun(file);
    try {
      const dropped = await domain.drop(PRESET_ACTS.drop);
      await domain.extract(dropped.id);

      const asked = await domain.recall(PRESET_ACTS.question, { now: PRESET_ASKED_AT });
      assert.equal(asked.kind, 'answered');
      const left = presetDaysLeft(asked.kind === 'answered' ? asked.answer : '');
      assert.deepEqual(
        asked.sources.map((source) => source.dropId),
        [dropped.id],
        'the fragment that was just dropped is the one it came from',
      );
      assert.equal(asked.sources[0]?.body, PRESET_ACTS.drop, 'quoted verbatim, so it can be checked');

      // The viewpoint is observable: the same question asked a day nearer leaves
      // exactly one day less. A property rather than a literal, so the check does
      // not hang on which timezone the material's Wednesday was resolved in.
      const nearer = await domain.recall(PRESET_ACTS.question, {
        now: '2026-09-21T01:00:00.000Z',
      });
      assert.equal(nearer.kind, 'answered');
      assert.equal(
        presetDaysLeft(nearer.kind === 'answered' ? nearer.answer : ''),
        left - 1,
        'the deadline is said relative to the moment asked',
      );
    } finally {
      await store.close();
    }
  });
});

await check('act three: one more feeling surfaces its own conclusion, on the preset words', async () => {
  await withDatabase(async (file) => {
    const { store, domain } = await presetRun(file);
    try {
      // The first act has already been run, so the moment this act reaches is a
      // second one rather than a colder one: the exam has been heard, and the
      // sleep material has not.
      const dropped = await domain.drop(PRESET_ACTS.drop);
      await domain.extract(dropped.id);
      const first = await domain.requestSurfacing({ dropId: dropped.id });
      assert.equal(first.kind, 'surfaced', 'act one speaks, so act three is a moment of its own');

      const felt = await domain.drop(PRESET_ACTS.feeling);
      await domain.extract(felt.id);
      const third = await domain.requestSurfacing({ dropId: felt.id });

      assert.equal(third.kind, 'surfaced', 'the second feeling surfaces rather than remaining silent');
      assert.equal(third.tier, 'weak');
      assert.equal(
        third.text,
        '我不太确定：你最近睡得不太好，白天也提不起劲。',
        'one line, in the uncertain register the band earns',
      );
      assert.deepEqual(
        third.support.map((term) => term.text),
        [...PRESET_FEELING_SUPPORT],
        'supported by the preset words, which is what makes it a judgement rather than a guess',
      );
      assert.equal(third.mentions, 3, 'raised three times: twice in the leads, once by the act');
      assert.equal(
        (await domain.listConclusions()).length,
        2,
        'two matters have been judged, and the second act did not restate the first',
      );
    } finally {
      await store.close();
    }
  });
});

await check('the reset leaves an empty library, and one that can be used again', async () => {
  await withDatabase(async (file) => {
    const { store, domain } = await presetRun(file);
    try {
      // Something of every kind the interface can see, so that "empty" means
      // something: the acts are run first, then the reset is asked for.
      await runThreeActs(domain);

      await store.clear();

      assert.deepEqual(await domain.listDrops(), [], 'no fragments left');
      assert.deepEqual(await domain.listItems(), [], 'and nothing to do');
      assert.deepEqual(await domain.listLinks(), [], 'and no links between words that are gone');
      assert.deepEqual(await domain.listConclusions(), [], 'and no judgements');
      assert.deepEqual(
        await domain.upcoming(),
        { due: [], unscheduled: [] },
        'and the timeline is empty in both of its halves',
      );

      // And it is a library again rather than merely blank: the leads go back
      // down, and the acts run on it exactly as they did on a fresh file.
      await seedPreset(domain);
      assert.equal((await domain.listDrops()).length, PRESET_LEADS.length);
      const again = await runThreeActs(domain);
      assert.equal(again.actedThree, '我不太确定：你最近睡得不太好，白天也提不起劲。');

      // Clearing twice is not an error: a demo may be started over twice.
      await store.clear();
      assert.deepEqual(await domain.listDrops(), []);
    } finally {
      await store.close();
    }
  });
});

await check('the three acts run twice over the same library and come back the same', async () => {
  await withDatabase(async (file) => {
    const { store, domain } = await presetRun(file);
    try {
      const first = await runThreeActs(domain);

      // The reset a demo does between runs: the library is emptied and the
      // preset leads are laid down again, on the one chain the acts run on.
      await store.clear();
      await seedPreset(domain);

      // What the acts came to, spelled out rather than read back out of the
      // second run: a comparison between two runs of the same code would agree
      // with itself whatever the lines were, and the script makes promises about
      // what they are.
      assert.equal(first.itemText, PRESET_ITEM_TEXT);
      assert.ok(first.itemDueAt !== null && first.itemDueAt !== undefined, 'the item carries a date');
      assert.deepEqual(first.dropTerms, [...PRESET_DROP_TERMS]);
      assert.equal(first.dropReply, '听着，事情全堆在一起，心里挺堵的。');
      assert.match(first.answer, PRESET_ANSWER_SHAPE);
      assert.equal(first.sources.length, 1, 'one source, and the second act says which');
      assert.equal(first.actedOne, '我不太确定：你最近好像有几件事堆在一起，心里一直不太顺。');
      assert.equal(first.actedThree, '我不太确定：你最近睡得不太好，白天也提不起劲。');
      assert.deepEqual(first.actedThreeSupport, [...PRESET_FEELING_SUPPORT]);

      const second = await runThreeActs(domain);
      assert.deepEqual(
        second,
        first,
        'same material, same chain, same lines — nothing left to luck',
      );
    } finally {
      await store.close();
    }
  });
});

await check('every link a demo makes is a hard edge: its provider scripts no vectors to compare', async () => {
  await withDatabase(async (file) => {
    const { store, domain } = await presetRun(file);
    try {
      await runThreeActs(domain);
      // Wait for the background halves — the acts' own awaits return before the
      // accumulation queue has drained — so "no semantic edge" is a fact about
      // the finished run rather than about timing.
      await settledUntil(async () => false);

      const links = await domain.listLinks();
      assert.ok(links.length > 0, 'the acts do connect terms');
      assert.deepEqual(
        [...new Set(links.map((link) => link.kind))],
        ['same-drop'],
        'and the only kind is the zero-model one',
      );
      // The reason this is a property of the demo rather than of the thresholds:
      // the preset provider has no vectors to hand back, so the semantic half
      // cannot produce a score to compare — which is what makes ticket 14's
      // recalibration invisible here.
      assert.ok(
        links.every((link) => link.strength === 1),
        'each one as strong as saying two things in one breath',
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
