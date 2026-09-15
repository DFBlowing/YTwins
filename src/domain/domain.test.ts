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
import type { RespondRequest } from './ai-provider.ts';
import {
  REPLY_THAT_BREAKS_THE_RULES,
  createFakeProvider,
  type EmbedScript,
  type ExtractScript,
  type FakeProviderScript,
} from './fake-provider.ts';
import type { Domain, Term, TermLink } from './interface.ts';
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
          embedByText: vectors({ 想学吉他: [1, 0], 想学门乐器: [0.8, 0.6] }),
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
        link.strength !== undefined && link.strength > 0.7 && link.strength < 0.85,
        'its strength is the score it actually got',
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
          embedByText: vectors({ 想学吉他: [1, 0], 想学门乐器: [0.8, 0.6] }),
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
          embedByText: vectors({ 想学吉他: [1, 0], 想学门乐器: [0.8, 0.6] }),
          judgeLinkFallback: { kind: 'throw', reason: 'judge blew up' },
        },
      );
      const domain = createDomain({ store, provider });

      await readTerms(domain, (await domain.drop(GUITAR_DROP)).id);
      await readTerms(domain, (await domain.drop(HILL_DROP)).id);
      await settledUntil(async () => false);

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

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exitCode = 1;
}
