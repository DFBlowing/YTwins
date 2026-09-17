/*
 * End-to-end check of **deletion** — announce first, then cascade — over real HTTP.
 *
 * Runs the real server handler against a real SQLite file with a scripted
 * provider, so it exercises what the domain tests cannot: the JSON the page
 * actually receives for the preview, the route that carries out a choice, the
 * refusal of a choice nobody made, and whether a deletion is still a deletion
 * after a restart.
 *
 * Deletion is the one operation in this product that cannot be undone, so most of
 * the claims here are **negative** ones — the checks are written to catch an
 * over-eager delete as loudly as a missed one:
 *
 *  - Asking what a deletion would take removes nothing, and the answer names the
 *    sentences rather than a tally, so the user can recognize what is at stake.
 *  - There is no request that deletes without a named choice, and an unrecognised
 *    choice is refused rather than defaulted — the one place where "the API
 *    guessed" would be unrecoverable.
 *  - `cascade` leaves nothing: not the fragment, not its conclusions, not the
 *    words only it said, not a link pointing at one of them.
 *  - `original-only` keeps the judgements **word for word** and still takes the
 *    fragment, so neither choice leaves a dangling reference.
 *  - What is deleted stays deleted across a restart.
 *
 *   node tools/e2e-ticket-09.mjs
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

/** One matter, said three times, in the demo's own material. */
const MIXED = '老师今天讲了期末怎么算分，下周三交提纲，好烦';
const OUTLINE = '今天又在改提纲，好烦';
const PERCENT = '平时分那 40% 到底怎么算，好烦';
/** A fourth fragment about something else entirely: the control. */
const PLANT = '楼下的橘猫又在晒太阳';
/**
 * Two fragments for phase four-b, where the matter is anchored on a word only
 * the first of them says.
 *
 * Deliberately a different feeling from 「好烦」: the matter has to be opened
 * around 「心里很慌」 and kept alive by it, which is the one shape that forces
 * the matter to be re-opened around a surviving word.
 */
const ANCHORED = '今天面试没过，心里很慌';
const AFTER_ANCHOR = '面试还是没消息，心里很慌';
/** A third fragment, so the anchored matter has a word left to stand on. */
const ANCHOR_JUDGEMENT = '面试又挂了，心里很慌';

const READINGS = {
  [MIXED]: { terms: ['期末怎么算分', '下周三交提纲', '好烦'], anchor: '好烦' },
  [OUTLINE]: { terms: ['改提纲', '好烦'], anchor: '好烦' },
  [PERCENT]: { terms: ['平时分 40%', '好烦'], anchor: '好烦' },
  [PLANT]: { terms: ['橘猫'], anchor: null },
  [ANCHORED]: { terms: ['面试没过', '心里很慌'], anchor: '心里很慌' },
  [AFTER_ANCHOR]: { terms: ['面试没消息', '心里很慌'], anchor: '心里很慌' },
  [ANCHOR_JUDGEMENT]: { terms: ['面试又挂了', '心里很慌'], anchor: '心里很慌' },
};

/** What the stand-in says about the matter, so a conclusion exists to delete. */
const SENTENCE = '你最近好像有几件事堆在一起';
const LINE = `我不太确定：${SENTENCE}。`;

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
    composeConclusionByAnchor: {
      好烦: { kind: 'sentence', text: SENTENCE },
      心里很慌: { kind: 'sentence', text: '你最近好像在等一个结果' },
    },
    parseQuestionByQuestion: { 期末怎么算分: { kind: 'match', matchText: ['期末'] } },
    composeFallback: { kind: 'answer', answer: '平时分 40%，期末考 60%。' },
  });
}

const dir = mkdtempSync(join(tmpdir(), 'ytwins-e2e-deletion-'));
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

console.log('end to end — deletion, announce first');

let server = await listen(dbFile);
// The ids the later checks act on. Kept outside the `try` so phase two can use
// them after the process's first server has been taken down.
let outlineId;
let mixedId;
let plantId;

try {
  await check('the material settles into exactly one conclusion', async () => {
    mixedId = await dropAndSettle(server.base, MIXED);
    outlineId = await dropAndSettle(server.base, OUTLINE);
    await dropAndSettle(server.base, PERCENT);
    plantId = await dropAndSettle(server.base, PLANT);

    // Forced the way the page's act three forces it, rather than waiting out the
    // quiet window: what this script is about is the wire, not the timing.
    await post(server.base, '/api/surface', {});
    const conclusions = await pollConclusions(server.base, 1);
    assert.equal(conclusions.length, 1, 'one matter crossed, so one conclusion exists');
    assert.equal(conclusions[0].text, LINE, 'and it carries the band frame in front of the sentence');
  });

  await check('the preview names the sentences, and removes nothing by asking', async () => {
    const before = (await get(server.base, '/api/drops')).body.drops.length;
    const { status, body } = await get(server.base, `/api/deletions/${outlineId}`);

    assert.equal(status, 200);
    assert.equal(body.preview.body, OUTLINE, 'the preview names what is at stake');
    assert.equal(body.preview.conclusions.length, 1, 'one conclusion came from this fragment');
    assert.equal(body.preview.conclusions[0].text, LINE, 'and it is shown as the sentence itself');
    assert.deepEqual(body.preview.terms, ['改提纲'], 'and the word only this fragment said');

    // A preview that changed anything would not be a preview.
    assert.equal(
      (await get(server.base, '/api/drops')).body.drops.length,
      before,
      'nothing was removed by asking',
    );
    assert.equal(
      (await get(server.base, '/api/conclusions')).body.conclusions.length,
      1,
      'and no conclusion went either',
    );
  });

  await check('previewing a fragment that does not exist is a 404, not a silent preview', async () => {
    const { status } = await get(server.base, '/api/deletions/no-such-drop');
    assert.equal(status, 404, 'the client asked about a specific row, and it is not there');
  });

  await check('there is no request that deletes without a named choice', async () => {
    // The whole point of the mode being required: on the one operation that
    // cannot be undone, "the API defaulted" must not be reachable.
    const missing = await post(server.base, '/api/delete', { dropId: outlineId });
    assert.equal(missing.status, 400, 'a deletion with no choice is refused');

    const nonsense = await post(server.base, '/api/delete', { dropId: outlineId, mode: 'everything' });
    assert.equal(nonsense.status, 400, 'and so is a choice nobody offered');

    const noDrop = await post(server.base, '/api/delete', { mode: 'cascade' });
    assert.equal(noDrop.status, 400, 'and a deletion that does not say what to delete');

    assert.equal(
      (await get(server.base, '/api/drops')).body.drops.length,
      4,
      'nothing of the material was touched by any of the refusals',
    );
  });

  await check('keeping is a choice, and it deletes nothing', async () => {
    const { status, body } = await post(server.base, '/api/delete', {
      dropId: outlineId,
      mode: 'keep',
    });
    assert.equal(status, 200, 'keeping is not a failure');
    assert.equal(body.deleted, null, 'and the answer says plainly that nothing was deleted');
    assert.equal((await get(server.base, '/api/drops')).body.drops.length, 4);
    assert.equal((await get(server.base, '/api/conclusions')).body.conclusions.length, 1);
  });

  await check('what crosses the wire is the preview and the outcome, and no columns', async () => {
    const preview = JSON.stringify((await get(server.base, `/api/deletions/${outlineId}`)).body);
    assert.deepEqual(
      Object.keys(JSON.parse(preview).preview).sort(),
      ['body', 'conclusions', 'dropId', 'terms'],
      'the page gets the announcement, not the row',
    );
    assert.ok(!/matter|vector|column|term_id|drop_id/.test(preview), 'no scaffolding leaks out');
  });
} finally {
  await server.close();
}

// Phase two: `cascade` on the fragment that only passes by, then on a fragment
// that fed the judgement. Deliberately not the first fragment: the cascade has to
// reach a conclusion through a matter the drop did **not** open, which is the case
// where "let the foreign key handle it" quietly deletes nothing.
server = await listen(dbFile);
try {
  await check('cascading a fragment that fed nothing takes only the fragment', async () => {
    const { status, body } = await post(server.base, '/api/delete', {
      dropId: plantId,
      mode: 'cascade',
    });
    assert.equal(status, 200);
    assert.deepEqual(body.deleted.conclusions, [], 'it had no conclusions to take');
    assert.equal(
      (await get(server.base, '/api/drops')).body.drops.length,
      3,
      'but the fragment itself went',
    );
    assert.equal(
      (await get(server.base, '/api/conclusions')).body.conclusions.length,
      1,
      'and the matter it was never part of is intact',
    );
    // Deleting the same fragment again is an answer, not an error.
    const again = await post(server.base, '/api/delete', { dropId: plantId, mode: 'cascade' });
    assert.equal(again.status, 200);
    assert.equal(again.body.deleted, null, 'a second delete reports that nothing was there');
  });

  await check('after a cascade, recall no longer returns that fragment', async () => {
    const before = await post(server.base, '/api/recall', { question: '期末怎么算分' });
    assert.equal(before.body.kind, 'answered', 'the records covered this question to begin with');
    assert.deepEqual(
      before.body.sources.map((source) => source.body),
      [MIXED],
      'and the fragment about to be deleted is the one that answered it',
    );
  });

  await check('cascading takes the fragment, its conclusion, its words and its links', async () => {
    const { status, body } = await post(server.base, '/api/delete', {
      dropId: mixedId,
      mode: 'cascade',
    });
    assert.equal(status, 200);
    assert.deepEqual(
      body.deleted.conclusions.map((entry) => entry.text),
      [LINE],
      'the deletion reports the sentence it took',
    );

    assert.equal((await get(server.base, '/api/drops')).body.drops.length, 2, 'the fragment is gone');
    assert.deepEqual(
      (await get(server.base, '/api/conclusions')).body.conclusions,
      [],
      'and so is the conclusion it fed',
    );

    // The words: 「期末怎么算分」 and 「下周三交提纲」 were only ever said there.
    // 「好烦」 was not, so it stays — deleting a fragment must not edit what the
    // other fragments said.
    const said = (await get(server.base, '/api/drops')).body.drops.flatMap((drop) =>
      drop.terms.map((term) => term.text),
    );
    assert.ok(!said.includes('期末怎么算分'), 'a word only that fragment said went with it');
    assert.ok(!said.includes('下周三交提纲'), 'and so did the other one');
    assert.ok(said.includes('好烦'), 'a word the other fragments also say stays');

    const links = (await get(server.base, '/api/links')).body.links;
    // Only the two words this fragment was the last to say. The other words on
    // this matter are still said by fragments that remain, so their links stay —
    // asserting on all four would be asserting that deleting one fragment stripped
    // links out of the others, which is the mistake in the opposite direction.
    assert.ok(
      !links.some((link) =>
        ['期末怎么算分', '下周三交提纲'].includes(link.from.text) ||
        ['期末怎么算分', '下周三交提纲'].includes(link.to.text),
      ),
      'no link is left pointing at a word that is gone',
    );
  });

  await check('nothing of the cascade is left anywhere, and it stays that way', async () => {
    const everything = JSON.stringify({
      drops: (await get(server.base, '/api/drops')).body,
      conclusions: (await get(server.base, '/api/conclusions')).body,
      links: (await get(server.base, '/api/links')).body,
      items: (await get(server.base, '/api/items')).body,
      upcoming: (await get(server.base, '/api/upcoming')).body,
    });
    assert.ok(!everything.includes('期末怎么算分'), 'the text itself appears in no read');
    assert.ok(!everything.includes('下周三交提纲'), 'not even as a supporting word');
    assert.ok(!everything.includes(SENTENCE), 'and the judgement it supported is gone too');

    // Recall searched, and the records no longer cover it — which is a different
    // fact from "the question could not be put to them".
    const answer = await post(server.base, '/api/recall', { question: '期末怎么算分' });
    assert.equal(answer.body.kind, 'not-found', 'the deleted fragment answers nothing');
  });

  await check('what is said after a cascade is built only from what is left', async () => {
    // The matter did **not** vanish with the fragment: two of the fragments that
    // raised it remain, and the words they still say still support a judgement. So
    // the product may speak again — and this check is about **what it speaks
    // from**, not about whether it stays silent. Silence here would be the wrong
    // behaviour in the other direction: it would mean the user's remaining
    // material had been quietly discounted along with the fragment.
    //
    // What must not happen is the deleted fragment coming back through the side
    // door — as a supporting word, or as the sentence it was once worded from.
    const { body } = await post(server.base, '/api/surface', {});
    const conclusions = (await get(server.base, '/api/conclusions')).body.conclusions;
    const everything = JSON.stringify({ body, conclusions });

    assert.ok(!everything.includes('期末怎么算分'), 'the deleted word supports nothing');
    assert.ok(!everything.includes('下周三交提纲'), 'and neither does the other one');
    assert.ok(
      conclusions.every((conclusion) =>
        conclusion.support.every((term) => ['好烦', '改提纲', '平时分 40%'].includes(term.text)),
      ),
      'every judgement on the portrait stands only on words that are still said',
    );
  });
} finally {
  await server.close();
}

// Phase three: `cascade` on the last fragment that fed the matter. The judgement
// has nothing left under it, so it goes — a conclusion whose evidence is entirely
// withdrawn has nothing to stand on.
server = await listen(dbFile);
try {
  await check('cascade takes the last fragment, leaving no trace of the matter', async () => {
    const { status } = await post(server.base, '/api/delete', { dropId: outlineId, mode: 'cascade' });
    assert.equal(status, 200);
    assert.deepEqual(
      (await get(server.base, '/api/conclusions')).body.conclusions,
      [],
      'the matter is empty, so its judgement is not left standing on nothing',
    );
  });
} finally {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
}

// Phase four: a fresh database, so `original-only` can be checked from a clean
// state rather than from whatever the checks above left behind.
const secondDir = mkdtempSync(join(tmpdir(), 'ytwins-e2e-keep-'));
const secondFile = join(secondDir, 'ytwins.sqlite');
server = await listen(secondFile);
try {
  await check('keeping the judgement takes only the original, word for word', async () => {
    const mixed = await dropAndSettle(server.base, MIXED);
    const outline = await dropAndSettle(server.base, OUTLINE);
    await dropAndSettle(server.base, PERCENT);
    await post(server.base, '/api/surface', {});
    await pollConclusions(server.base, 1);

    const { status, body } = await post(server.base, '/api/delete', {
      dropId: outline,
      mode: 'original-only',
    });
    assert.equal(status, 200);
    assert.deepEqual(body.deleted.conclusions, [], 'nothing was deleted but the original');
    assert.equal(body.deleted.mode, 'original-only');

    assert.equal((await get(server.base, `/api/drops/${outline}`)).status, 404, 'the fragment is gone');
    assert.equal(
      (await get(server.base, `/api/drops/${mixed}`)).status,
      200,
      'and the fragments it was accumulated with are untouched',
    );

    const conclusions = (await get(server.base, '/api/conclusions')).body.conclusions;
    assert.equal(conclusions.length, 1, 'the judgement the user kept is still in the portrait');
    assert.equal(conclusions[0].text, LINE, 'word for word — it is not reworded or re-assembled');
    assert.ok(
      conclusions[0].support.every((term) => term.text !== '改提纲'),
      'but it no longer cites a word nobody says any more',
    );
    assert.ok(
      !conclusions[0].support.some((term) => term.text === undefined || term.text === ''),
      'and nothing took the missing word’s place',
    );

    // Nothing dangles: every prop the portrait still shows is a word that still
    // exists, and every link still joins two words that exist.
    const alive = new Set(
      (await get(server.base, '/api/drops')).body.drops.flatMap((drop) =>
        drop.terms.map((term) => term.text),
      ),
    );
    assert.ok(
      conclusions[0].support.every((term) => alive.has(term.text)),
      'no support names a missing word',
    );
    assert.ok(
      (await get(server.base, '/api/links')).body.links.every(
        (link) => alive.has(link.from.text) && alive.has(link.to.text),
      ),
      'no link points at a missing word',
    );

    // And the words that went with the fragment are no longer offered as
    // something to delete: there is nothing left saying them.
    const leftovers = JSON.stringify((await get(server.base, '/api/drops')).body);
    assert.ok(!leftovers.includes('改提纲'), 'the word only that fragment said is gone');
    assert.ok(leftovers.includes('好烦'), 'the ones the others also say are not');
  });
} finally {
  await server.close();
}

// Phase four-b: a shape the demo's material does not produce, and the one that
// was broken until this script found it. Every fragment above shares the anchor
// 「好烦」, so the matter keeps standing on it by accident. Here the matter is
// anchored on a word the deleted fragment alone says, which forces the matter to
// be **re-opened around a surviving word** — and that path used to throw a
// foreign-key violation, turning "keep the judgement" into a 500.
server = await listen(secondFile);
try {
  await check('keeping a judgement whose own anchor is going does not blow up', async () => {
    // A third fragment feeds the same matter, so it has something to keep
    // standing behind once the anchored one goes. Without it the matter has no
    // surviving word of its own and nothing to re-open around — a different case,
    // pinned in the domain tests rather than here.
    const anchored = await dropAndSettle(server.base, ANCHORED);
    await dropAndSettle(server.base, AFTER_ANCHOR);
    await dropAndSettle(server.base, ANCHOR_JUDGEMENT);
    await post(server.base, '/api/surface', {});
    // Two matters now: the exam one from phase four, and this one. The second
    // conclusion is this matter crossing.
    const settled = await pollConclusions(server.base, 2);
    assert.equal(settled.length, 2, 'the anchored matter crossed too');

    const { status, body } = await post(server.base, '/api/delete', {
      dropId: anchored,
      mode: 'original-only',
    });
    assert.equal(status, 200, 'the deletion completed rather than failing half-way');
    assert.equal(body.deleted.mode, 'original-only');

    const conclusions = (await get(server.base, '/api/conclusions')).body.conclusions;
    assert.equal(conclusions.length, 2, 'nothing was lost but the original — that is the choice');
    assert.ok(
      conclusions.every((conclusion) => !JSON.stringify(conclusion.support).includes('面试没过')),
      'and no judgement cites the word that went',
    );
    assert.equal(
      (await get(server.base, `/api/drops/${anchored}`)).status,
      404,
      'while the fragment itself is gone',
    );
  });
} finally {
  await server.close();
}

// Phase five: reopen the file the fourth phase wrote, in a fresh process's view
// of it. Nothing may come back.
server = await listen(secondFile);
try {
  await check('a deletion survives a restart, with nothing coming back', async () => {
    const drops = (await get(server.base, '/api/drops')).body.drops;
    // Four were left before phase four-b added three, and one of those three was
    // the fragment deleted there: two of phase four's, two of four-b's.
    assert.equal(drops.length, 4, 'the deleted fragments are still gone');
    assert.ok(
      drops.every((drop) => drop.body !== OUTLINE && drop.body !== ANCHORED),
      'and neither came back under another id',
    );

    const conclusions = (await get(server.base, '/api/conclusions')).body.conclusions;
    assert.equal(conclusions.length, 2, 'both kept judgements are still on disk');
    assert.ok(
      conclusions.some((conclusion) => conclusion.text === LINE),
      'including the one from the exam matter, still word for word',
    );

    const everything = JSON.stringify({
      drops: (await get(server.base, '/api/drops')).body,
      conclusions: (await get(server.base, '/api/conclusions')).body,
    });
    assert.ok(!everything.includes('改提纲'), 'no trace of what was deleted came back');
    assert.ok(!everything.includes('面试没过'), 'nor of the other one');
  });
} finally {
  await server.close();
  rmSync(secondDir, { recursive: true, force: true });
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exitCode = 1;
