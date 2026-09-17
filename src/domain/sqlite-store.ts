/**
 * SQLite storage adapter — a local file database.
 *
 * Uses Node's built-in `node:sqlite`, so the project keeps zero runtime
 * dependencies. Foreign keys are switched on per connection: SQLite defaults
 * them OFF, and the cascade-delete guarantee later tickets depend on only
 * holds when they are ON.
 *
 * The schema is created on open and is written to be re-runnable, so a second
 * launch against an existing file is a no-op rather than an error.
 *
 * @module domain/sqlite-store
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { INPUT_TYPES, LINK_KINDS, CONCLUSION_KINDS, CONCLUSION_RELATIONS, CONCLUSION_TIERS } from './interface.ts';
import type { ConclusionKind, ConclusionRelation, ConclusionTier, InputType, ItemState, LinkKind } from './interface.ts';
import { orderedPair } from './linking.ts';
import { DEFAULT_ITEM_STATE, readItemState } from './scheduling.ts';
import type {
  DropStore,
  ExtractOutcome,
  MatterDrop,
  MatterGrowth,
  NewConclusion,
  NewLink,
  NewMatter,
  RecordedReading,
  StoredConclusion,
  StoredDrop,
  StoredItem,
  StoredLink,
  StoredMatter,
  StoredSettlement,
  StoredSurfacing,
  StoredTerm,
  SupportPrune,
  TermRemoval,
  TermVector,
} from './storage.ts';

/**
 * The schema.
 *
 * The `drop_` suffix is deliberate: `drop` is a SQL keyword, so the table name
 * carries a trailing underscore to keep every statement free of quoting.
 *
 * A drop's faithful text *is* its record — there is no separate summary table,
 * because the spec stores the original and nothing else. The remaining entities
 * (terms, links, conclusions, the chain, surfacing history) arrive with the
 * tickets that need them, and bring their foreign keys with them.
 *
 * `input_type` is nullable and that null is load-bearing: it is the only way to
 * tell "this drop has been read and had no items" from "this drop has not been
 * read yet". Without it, extraction could not be re-run without either
 * duplicating items or refusing forever.
 *
 * `reply` is written with the drop and may be replaced once. It is NOT NULL for
 * a database created here; a database written before ticket 03 has it added as a
 * nullable column, and null there means "the line code falls back to" — see
 * `StoredDrop.reply`.
 *
 * `item_.drop_id` cascades. Deleting a drop takes its items with it; ticket 09
 * relies on this to leave no orphan rows behind.
 *
 * `item_.state` is where an item stands — `'todo'` or `'done'` — and it is the
 * one thing in this schema the **user** writes. It defaults to `'todo'` rather
 * than being nullable, because an item exists because something was asked of the
 * user: there is no reading on which a freshly caught one is anything else.
 * Ticket 08 adds it, and a database written before that gets the column added
 * with the same default — see the migration below.
 *
 * `term_` holds one row per **wording**, unique on the text. That is the whole
 * deduplication rule, and it is deliberately the literal one: "想学吉他" said
 * twice is one term, while "想学吉他" and "打算学吉他" are two terms that a
 * link may later join. Anything cleverer would need the model to be consulted
 * about identity, and a term the model renamed would stop being the user's own
 * words. `term_in_drop_` is what makes "this drop said it" a fact of its own,
 * so a repeat mention is recorded without pretending the term is new.
 *
 * `origin_drop_id` is which fragment **first** said the wording, and it carries
 * **no foreign key on purpose** — ticket 09's lesson, learned the hard way. It
 * used to cascade, which read as harmless ("nothing exists without a source") and
 * was not: a word is one row per wording, so 「好烦」 first said on Monday is a
 * single term that Monday's, Tuesday's and Wednesday's fragments all mention.
 * Deleting Monday's fragment then took the term by cascade, and Tuesday's and
 * Wednesday's fragments silently lost a word they had said and still say. A
 * cascade along a reference is only correct when the reference is the **only**
 * thing holding the row up; here it is one of many, and which of them is left is
 * exactly what the domain worked out before calling the delete. It writes NULL
 * there instead when the origin goes.
 *
 * `link_` stores a pair once, under a canonical order of the two ids (the
 * smaller first), which is what the unique constraint enforces. `a_term_id`
 * cascades, so deleting the material a link rests on takes the link too.
 *
 * `vector` is the term's embedding as JSON, or NULL when nothing has needed to
 * compare it yet. Embedding is deferred until there is something to compare
 * against, which is why NULL is the ordinary state for the first term ever said.
 *
 * Ticket 05 adds four: what a drop is *about* (`drop_.anchor_term_id`), the
 * accumulation itself (`matter_` with its support and its member drops), what it
 * settled into (`conclusion_` with its support), and how far the invisible
 * settling has got (`settle_state_`, one row by construction).
 *
 * Two of those tables exist because the decisions in them are **inferences the
 * domain makes once**: which fragments are the same matter, and what a matter
 * settled into. They are written when the decision is made and never recomputed,
 * which is what keeps "changing a value affects only what happens next" true.
 * Their keys cascade so ticket 09's deletion leaves no orphan behind: deleting a
 * drop takes its place in a matter, and deleting the term a matter was opened
 * around takes the matter and every conclusion that came out of it.
 *
 * Ticket 06 adds one more, and it is a record rather than an inference:
 * `surfacing_` remembers that a conclusion was **shown**, which is what keeps a
 * topic quiet for a week — across restarts, and on the user's own terms rather
 * than the running process's. It cascades with its conclusion: a judgement that
 * is gone cannot have been shown. The same ticket adds `conclusion_.claim`: the
 * sentence the provider wrote, kept beside the framed line rather than recovered
 * from it, because the surfacing moment writes its own opening in front of it.
 *
 * Ticket 10 adds one nullable column, `drop_.pinned_matter_id`, and it is the
 * same shape of choice as `anchor_term_id`: a fact about *this drop* that only
 * this drop can know. It records a sentence written beside a conclusion, which
 * the user has thereby attached to that matter themselves — so it is deliberately
 * set-null rather than cascading: a matter that goes away must not take the drop
 * with it, and a drop whose pin no longer resolves is read by the ordinary
 * attachment rules. Nothing else in the schema changes for the chain's
 * overturned relation; a correction is a `conclusion_` row like any other, and
 * `relation` / `supersedes` already had the values it needs.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS drop_ (
  id               TEXT PRIMARY KEY,
  body             TEXT NOT NULL,
  dropped_at       TEXT NOT NULL,
  input_type       TEXT,
  reply            TEXT NOT NULL,
  anchor_term_id   TEXT REFERENCES term_(id) ON DELETE SET NULL,
  pinned_matter_id TEXT REFERENCES matter_(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS item_ (
  id        TEXT PRIMARY KEY,
  drop_id   TEXT NOT NULL REFERENCES drop_(id) ON DELETE CASCADE,
  text      TEXT NOT NULL,
  due_at    TEXT,
  state     TEXT NOT NULL DEFAULT 'todo',
  caught_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS item_by_drop ON item_ (drop_id);

CREATE TABLE IF NOT EXISTS term_ (
  id             TEXT PRIMARY KEY,
  text           TEXT NOT NULL UNIQUE,
  origin_drop_id TEXT,
  first_seen_at  TEXT NOT NULL,
  vector         TEXT
);

CREATE TABLE IF NOT EXISTS term_in_drop_ (
  drop_id TEXT NOT NULL REFERENCES drop_(id) ON DELETE CASCADE,
  term_id TEXT NOT NULL REFERENCES term_(id) ON DELETE CASCADE,
  said_at TEXT NOT NULL,
  PRIMARY KEY (drop_id, term_id)
);

CREATE TABLE IF NOT EXISTS link_ (
  id         TEXT PRIMARY KEY,
  a_term_id  TEXT NOT NULL REFERENCES term_(id) ON DELETE CASCADE,
  b_term_id  TEXT NOT NULL REFERENCES term_(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  strength   REAL NOT NULL,
  reason     TEXT NOT NULL,
  UNIQUE (a_term_id, b_term_id)
);

CREATE INDEX IF NOT EXISTS link_by_a ON link_ (a_term_id);
CREATE INDEX IF NOT EXISTS link_by_b ON link_ (b_term_id);

CREATE TABLE IF NOT EXISTS matter_ (
  id             TEXT PRIMARY KEY,
  anchor_term_id TEXT NOT NULL REFERENCES term_(id) ON DELETE CASCADE,
  first_at       TEXT NOT NULL,
  last_at        TEXT NOT NULL,
  raised_count   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS matter_term_ (
  matter_id TEXT NOT NULL REFERENCES matter_(id) ON DELETE CASCADE,
  term_id   TEXT NOT NULL REFERENCES term_(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  PRIMARY KEY (matter_id, term_id)
);

CREATE INDEX IF NOT EXISTS matter_term_by_term ON matter_term_ (term_id);

CREATE TABLE IF NOT EXISTS matter_drop_ (
  drop_id        TEXT PRIMARY KEY REFERENCES drop_(id) ON DELETE CASCADE,
  matter_id      TEXT NOT NULL REFERENCES matter_(id) ON DELETE CASCADE,
  anchor_term_id TEXT REFERENCES term_(id) ON DELETE SET NULL,
  at             TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS matter_drop_by_matter ON matter_drop_ (matter_id);

CREATE TABLE IF NOT EXISTS conclusion_ (
  id           TEXT PRIMARY KEY,
  matter_id    TEXT NOT NULL REFERENCES matter_(id) ON DELETE CASCADE,
  claim        TEXT,
  text         TEXT NOT NULL,
  kind         TEXT NOT NULL,
  tier         TEXT,
  softened     INTEGER NOT NULL DEFAULT 0,
  relation     TEXT NOT NULL,
  supersedes   TEXT REFERENCES conclusion_(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL,
  mentions     INTEGER NOT NULL,
  span_days    INTEGER NOT NULL,
  avg_strength REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS conclusion_by_matter ON conclusion_ (matter_id);

CREATE TABLE IF NOT EXISTS conclusion_support_ (
  conclusion_id TEXT NOT NULL REFERENCES conclusion_(id) ON DELETE CASCADE,
  term_id       TEXT NOT NULL REFERENCES term_(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,
  PRIMARY KEY (conclusion_id, term_id)
);

CREATE INDEX IF NOT EXISTS conclusion_support_by_term ON conclusion_support_ (term_id);

CREATE TABLE IF NOT EXISTS surfacing_ (
  id            TEXT PRIMARY KEY,
  conclusion_id TEXT NOT NULL REFERENCES conclusion_(id) ON DELETE CASCADE,
  surfaced_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS surfacing_by_conclusion ON surfacing_ (conclusion_id);

CREATE TABLE IF NOT EXISTS settle_state_ (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  drops_since   INTEGER NOT NULL,
  look_now_next INTEGER NOT NULL
);

INSERT OR IGNORE INTO settle_state_ (id, drops_since, look_now_next)
VALUES (1, 0, 1);
`;

/** A row as SQLite hands it back. */
interface DropRow {
  readonly id: string;
  readonly body: string;
  readonly dropped_at: string;
  readonly input_type: string | null;
  readonly reply: string | null;
  readonly anchor_term_id: string | null;
  readonly pinned_matter_id: string | null;
}

/** A matter row as SQLite hands it back. */
interface MatterRow {
  readonly id: string;
  readonly anchor_term_id: string;
  readonly first_at: string;
  readonly last_at: string;
  readonly raised_count: number;
}

/** One row of a matter's support. */
interface MatterTermRow {
  readonly matter_id: string;
  readonly term_id: string;
}

/** One drop that fed a matter. */
interface MatterDropRow {
  readonly matter_id: string;
  readonly drop_id: string;
  readonly anchor_term_id: string | null;
  readonly at: string;
}

/** A conclusion row as SQLite hands it back. */
interface ConclusionRow {
  readonly id: string;
  readonly matter_id: string;
  readonly claim: string | null;
  readonly text: string;
  readonly kind: string;
  readonly tier: string | null;
  readonly softened: number;
  readonly relation: string;
  readonly supersedes: string | null;
  readonly created_at: string;
  readonly mentions: number;
  readonly span_days: number;
  readonly avg_strength: number;
}

/** One row of a conclusion's support. */
interface ConclusionSupportRow {
  readonly conclusion_id: string;
  readonly term_id: string;
}

/** A surfacing row as SQLite hands it back. */
interface SurfacingRow {
  readonly id: string;
  readonly conclusion_id: string;
  readonly surfaced_at: string;
}

/** The settlement state row. */
interface SettlementRow {
  readonly drops_since: number;
  readonly look_now_next: number;
}

/** An item row as SQLite hands it back. */
interface ItemRow {
  readonly id: string;
  readonly drop_id: string;
  readonly text: string;
  readonly due_at: string | null;
  readonly state: string | null;
}

/** A term row as SQLite hands it back. */
interface TermRow {
  readonly id: string;
  readonly text: string;
  readonly origin_drop_id: string;
  readonly first_seen_at: string;
  readonly vector: string | null;
}

/** A term row that came back alongside the drop that said it. */
interface MentionRow extends TermRow {
  readonly drop_id: string;
}

/** A link row as SQLite hands it back. */
interface LinkRow {
  readonly id: string;
  readonly a_term_id: string;
  readonly b_term_id: string;
  readonly kind: string;
  readonly strength: number;
  readonly reason: string;
}

/**
 * Read a stored input type back as a domain value.
 *
 * Anything unrecognised reads as null rather than as a made-up type: the column
 * is written only by this adapter, so an unknown value means the file was
 * edited by hand or written by an older version, and "unread" is the safe
 * reading — it lets extraction run again instead of inventing a category.
 */
function readInputType(raw: string | null): InputType | null {
  return INPUT_TYPES.find((type) => type === raw) ?? null;
}

function toStoredDrop(row: DropRow): StoredDrop {
  return {
    id: row.id,
    body: row.body,
    droppedAt: row.dropped_at,
    inputType: readInputType(row.input_type),
    anchorTermId: row.anchor_term_id,
    reply: row.reply,
    pinnedMatterId: row.pinned_matter_id,
  };
}

function toStoredItem(row: ItemRow): StoredItem {
  return {
    id: row.id,
    dropId: row.drop_id,
    text: row.text,
    dueAt: row.due_at,
    state: readItemState(row.state),
  };
}

/**
 * Read a stored vector back.
 *
 * Anything that is not a list of finite numbers reads as "not embedded yet"
 * rather than as a vector: the column is written only by this adapter, so a
 * value it cannot parse means the file was edited by hand or written by an
 * older version, and asking for the embedding again is the safe reading.
 */
function readVector(raw: string | null): readonly number[] | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    if (!parsed.every((value) => typeof value === 'number' && Number.isFinite(value))) return null;
    return parsed as number[];
  } catch {
    return null;
  }
}

function toStoredTerm(row: TermRow): StoredTerm {
  return {
    id: row.id,
    text: row.text,
    dropId: row.origin_drop_id,
    firstSeenAt: row.first_seen_at,
    vector: readVector(row.vector),
  };
}

function toStoredLink(row: LinkRow): StoredLink | null {
  const kind = LINK_KINDS.find((known) => known === row.kind);
  if (kind === undefined) return null;
  return {
    id: row.id,
    fromTermId: row.a_term_id,
    toTermId: row.b_term_id,
    kind,
    strength: row.strength,
    reason: row.reason,
  };
}

/**
 * Read a stored conclusion back, or null when a value cannot be named.
 *
 * Null rather than a made-up reading, for the same reason as `readInputType`:
 * these columns are written only by this adapter, so a value it does not know
 * means the file was written by a newer version or edited by hand. For a
 * conclusion the choice is between showing the user something the domain cannot
 * describe — a band nobody can explain, a claim that might be a catch — and not
 * showing it; not showing it is the honest half of that pair.
 */
function toStoredConclusion(
  row: ConclusionRow,
  supportTermIds: readonly string[],
): StoredConclusion | null {
  const kind = CONCLUSION_KINDS.find((known): known is ConclusionKind => known === row.kind);
  const relation = CONCLUSION_RELATIONS.find(
    (known): known is ConclusionRelation => known === row.relation,
  );
  if (kind === undefined || relation === undefined) return null;

  // A null tier is ordinary — a catch asserts nothing, so there is no band for
  // it to be in — while an unrecognised one is not something to invent.
  let tier: ConclusionTier | null = null;
  if (row.tier !== null) {
    const known = CONCLUSION_TIERS.find((candidate) => candidate === row.tier);
    if (known === undefined) return null;
    tier = known;
  }

  return {
    id: row.id,
    matterId: row.matter_id,
    claim: row.claim,
    text: row.text,
    kind,
    tier,
    softened: row.softened !== 0,
    relation,
    supersedes: row.supersedes,
    createdAt: row.created_at,
    mentions: row.mentions,
    spanDays: row.span_days,
    averageStrength: row.avg_strength,
    supportTermIds,
  };
}

/**
 * Add a column to an existing table when it is missing.
 *
 * `CREATE TABLE IF NOT EXISTS` does nothing to a table that already exists, so
 * a database created by an earlier version would keep its old columns and every
 * query naming the new one would fail. There is no migration framework here and
 * this is a single-user local file, so the check is done directly: ask what
 * columns exist, add the missing one. Adding a nullable column needs no rewrite
 * and cannot lose data.
 */
function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as {
    readonly name: string;
  }[];
  if (columns.some((existing) => existing.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/**
 * Rebuild `term_` without the cascading reference ticket 09 removed.
 *
 * `ALTER TABLE` cannot drop a foreign key, so a database written before ticket 09
 * would keep the old one and go on losing words when a fragment that first said
 * them is deleted — the exact silent edit the schema change exists to stop. SQLite
 * cannot disable foreign keys inside a transaction, so the rebuild runs with them
 * off: the rename would otherwise be checked against `term_in_drop_` and `link_`,
 * which reference `term_` by name and would briefly be pointing at nothing.
 *
 * It only runs on a database that still has the old shape; a file created from
 * `SCHEMA` above is already right, and the check costs one `PRAGMA`.
 */
function dropTermOriginCascade(db: DatabaseSync): void {
  const foreignKeys = db
    .prepare('PRAGMA foreign_key_list(term_)')
    .all() as unknown as { readonly from: string }[];
  if (!foreignKeys.some((key) => key.from === 'origin_drop_id')) return;

  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN');
    db.exec(`
      CREATE TABLE term_rebuilt (
        id             TEXT PRIMARY KEY,
        text           TEXT NOT NULL UNIQUE,
        origin_drop_id TEXT,
        first_seen_at  TEXT NOT NULL,
        vector         TEXT
      );
      INSERT INTO term_rebuilt (id, text, origin_drop_id, first_seen_at, vector)
        SELECT id, text, origin_drop_id, first_seen_at, vector FROM term_;
      DROP TABLE term_;
      ALTER TABLE term_rebuilt RENAME TO term_;
    `);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  // Asked for and discarded, so the check cannot be optimised away and a
  // violation introduced by the rebuild would surface here rather than later.
  db.prepare('PRAGMA foreign_key_check').all();
}

/**
 * Open (creating if needed) a SQLite-backed store.
 *
 * @param file - path to the database file, or `':memory:'` for a throwaway one.
 * @returns the store, backed by that file.
 */
export function openSqliteStore(file: string): DropStore {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });

  const db = new DatabaseSync(file);
  // SQLite defaults foreign keys OFF, and the cascade-delete guarantee later
  // tickets depend on only holds while they are ON. Nothing referenced anything
  // before ticket 02; items do now, so this pragma became load-bearing rather
  // than merely forward-looking. It belongs to opening the connection, not to
  // the first table that needs it.
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  // Bring a database written by ticket 01 up to date. `SCHEMA` above cannot do
  // it: `CREATE TABLE IF NOT EXISTS` leaves an existing table alone.
  ensureColumn(db, 'drop_', 'input_type', 'TEXT');
  // Ticket 03's column, for a file written by tickets 01 or 02.
  ensureColumn(db, 'drop_', 'reply', 'TEXT');
  // Ticket 05's column, for a file written by tickets 01–04. The reference is
  // carried here too so a migrated file behaves like a fresh one: deleting the
  // term a drop was about leaves the drop, with nothing to accumulate around.
  ensureColumn(db, 'drop_', 'anchor_term_id', 'TEXT REFERENCES term_(id) ON DELETE SET NULL');
  // Ticket 06's column, for a file written by ticket 05. Null is ordinary: a
  // catch has no sentence of its own, and a conclusion assembled before this
  // column existed has none either — such a conclusion is simply never surfaced,
  // which is the honest reading of a sentence nobody kept the words of.
  ensureColumn(db, 'conclusion_', 'claim', 'TEXT');
  // Ticket 08's column, for a file written by tickets 02–07. Added WITH a
  // default, unlike the others: this is the one column a rule reads
  // (`upcomingFrom` counts only what is still to do), so leaving it null in an
  // old file would make every item it already holds invisible to the list.
  // A dropped item is "to do" — that is what it was when it was caught.
  ensureColumn(db, 'item_', 'state', `TEXT NOT NULL DEFAULT '${DEFAULT_ITEM_STATE}'`);
  // Ticket 09's schema change, for a file written by tickets 01–08. Not a column
  // this time but a dropped reference, which `ALTER TABLE` cannot do.
  dropTermOriginCascade(db);
  // Ticket 10's column, for a file written by tickets 01–09. Nullable and
  // null by default, which is what makes it addable without a rewrite — and the
  // reference is carried here too, so a migrated file behaves like a fresh one
  // rather than keeping a pin pointing at a matter that was deleted since.
  ensureColumn(db, 'drop_', 'pinned_matter_id', 'TEXT REFERENCES matter_(id) ON DELETE SET NULL');
  // Ticket 10's other column, and this one is read by a rule (the page says why a
  // sentence was hedged), so like `item_.state` it is added **with** a default: an
  // old file's conclusions were written before a rejection could soften anything,
  // and "not softened" is what each of them is.
  ensureColumn(db, 'conclusion_', 'softened', 'INTEGER NOT NULL DEFAULT 0');

  const insertDrop = db.prepare(
    `INSERT INTO drop_ (id, body, dropped_at, reply, pinned_matter_id) VALUES (?, ?, ?, ?, ?)`,
  );
  const selectDrops = db.prepare(
    `SELECT id, body, dropped_at, input_type, reply, anchor_term_id, pinned_matter_id
       FROM drop_ ORDER BY dropped_at ASC, rowid ASC`,
  );
  const selectDrop = db.prepare(
    `SELECT id, body, dropped_at, input_type, reply, anchor_term_id, pinned_matter_id
       FROM drop_ WHERE id = ?`,
  );
  const setInputType = db.prepare('UPDATE drop_ SET input_type = ? WHERE id = ?');
  const setAnchor = db.prepare('UPDATE drop_ SET anchor_term_id = ? WHERE id = ?');
  const setReply = db.prepare('UPDATE drop_ SET reply = ? WHERE id = ?');
  const deleteItemsForDrop = db.prepare('DELETE FROM item_ WHERE drop_id = ?');
  const insertItem = db.prepare(
    'INSERT INTO item_ (id, drop_id, text, due_at, state, caught_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const selectItems = db.prepare(
    'SELECT id, drop_id, text, due_at, state FROM item_ ORDER BY caught_at ASC, rowid ASC',
  );
  const selectItemsForDrop = db.prepare(
    'SELECT id, drop_id, text, due_at, state FROM item_ WHERE drop_id = ? ORDER BY caught_at ASC, rowid ASC',
  );
  const selectItem = db.prepare(
    'SELECT id, drop_id, text, due_at, state FROM item_ WHERE id = ?',
  );
  const updateItemState = db.prepare('UPDATE item_ SET state = ? WHERE id = ?');
  const insertTerm = db.prepare(
    `INSERT INTO term_ (id, text, origin_drop_id, first_seen_at, vector)
     VALUES (?, ?, ?, ?, NULL)
     ON CONFLICT(text) DO NOTHING`,
  );
  const selectTermByText = db.prepare(
    'SELECT id, text, origin_drop_id, first_seen_at, vector FROM term_ WHERE text = ?',
  );
  const insertMention = db.prepare(
    'INSERT INTO term_in_drop_ (drop_id, term_id, said_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
  );
  const deleteMentionsForDrop = db.prepare('DELETE FROM term_in_drop_ WHERE drop_id = ?');
  const selectTerms = db.prepare(
    'SELECT id, text, origin_drop_id, first_seen_at, vector FROM term_ ORDER BY first_seen_at ASC, rowid ASC',
  );
  const selectTermsForDrop = db.prepare(
    `SELECT t.id, t.text, t.origin_drop_id, t.first_seen_at, t.vector
       FROM term_ t JOIN term_in_drop_ m ON m.term_id = t.id
      WHERE m.drop_id = ?
      ORDER BY m.rowid ASC`,
  );
  const selectMentions = db.prepare(
    `SELECT m.drop_id AS drop_id, t.id, t.text, t.origin_drop_id, t.first_seen_at, t.vector
       FROM term_in_drop_ m JOIN term_ t ON t.id = m.term_id
      ORDER BY m.rowid ASC`,
  );
  const setTermVector = db.prepare('UPDATE term_ SET vector = ? WHERE id = ?');
  // One row per pair, replaced rather than duplicated: which link a pair *has*
  // is the domain's decision (a hard edge outranks a similarity), and this is
  // how the newer decision takes the pair's place. See `recordLinks` in
  // `storage.ts` — the domain is what keeps the two from disagreeing.
  const upsertLink = db.prepare(
    `INSERT INTO link_ (id, a_term_id, b_term_id, kind, strength, reason)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(a_term_id, b_term_id) DO UPDATE
       SET kind = excluded.kind, strength = excluded.strength, reason = excluded.reason`,
  );
  const selectLinks = db.prepare(
    'SELECT id, a_term_id, b_term_id, kind, strength, reason FROM link_ ORDER BY rowid ASC',
  );

  // Ticket 05's statements. The matter's support and membership are read whole
  // and grouped in memory, the same way drops' items and terms are: the page's
  // reads are per load, not per row.
  const insertMatter = db.prepare(
    'INSERT INTO matter_ (id, anchor_term_id, first_at, last_at, raised_count) VALUES (?, ?, ?, ?, ?)',
  );
  const selectMatters = db.prepare(
    `SELECT id, anchor_term_id, first_at, last_at, raised_count
       FROM matter_ ORDER BY first_at ASC, rowid ASC`,
  );
  const selectMatterTerms = db.prepare(
    'SELECT matter_id, term_id FROM matter_term_ ORDER BY matter_id ASC, position ASC',
  );
  const selectMatterDrops = db.prepare(
    `SELECT matter_id, drop_id, anchor_term_id, at
       FROM matter_drop_ ORDER BY at ASC, rowid ASC`,
  );
  const countMatterTerms = db.prepare(
    'SELECT COUNT(*) AS count FROM matter_term_ WHERE matter_id = ?',
  );
  const insertMatterTerm = db.prepare(
    `INSERT INTO matter_term_ (matter_id, term_id, position) VALUES (?, ?, ?)
     ON CONFLICT DO NOTHING`,
  );
  const insertMatterDrop = db.prepare(
    `INSERT INTO matter_drop_ (drop_id, matter_id, anchor_term_id, at) VALUES (?, ?, ?, ?)
     ON CONFLICT(drop_id) DO NOTHING`,
  );
  const growMatterRow = db.prepare(
    'UPDATE matter_ SET raised_count = raised_count + 1, last_at = ? WHERE id = ?',
  );
  const selectMatterForDrop = db.prepare('SELECT matter_id FROM matter_drop_ WHERE drop_id = ?');
  const setMatterAnchor = db.prepare('UPDATE matter_ SET anchor_term_id = ? WHERE id = ?');
  const countMatterDrops = db.prepare('SELECT COUNT(*) AS count FROM matter_drop_ WHERE matter_id = ?');
  const setMatterDropAnchor = db.prepare(
    'UPDATE matter_drop_ SET anchor_term_id = ? WHERE matter_id = ? AND anchor_term_id IS NULL',
  );
  const dropMatterTerm = db.prepare('DELETE FROM matter_term_ WHERE term_id = ?');
  const dropConclusionSupport = db.prepare('DELETE FROM conclusion_support_ WHERE term_id = ?');
  const deleteTerm = db.prepare('DELETE FROM term_ WHERE id = ?');
  const deleteDropRow = db.prepare('DELETE FROM drop_ WHERE id = ?');
  const setConclusionMatter = db.prepare('UPDATE conclusion_ SET matter_id = ? WHERE id = ?');
  const deleteConclusionRow = db.prepare('DELETE FROM conclusion_ WHERE id = ?');

  const insertConclusion = db.prepare(
    `INSERT INTO conclusion_
       (id, matter_id, claim, text, kind, tier, softened, relation, supersedes, created_at, mentions, span_days, avg_strength)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const selectConclusions = db.prepare(
    `SELECT id, matter_id, claim, text, kind, tier, softened, relation, supersedes, created_at, mentions, span_days, avg_strength
       FROM conclusion_ ORDER BY created_at ASC, rowid ASC`,
  );
  const selectConclusionSupport = db.prepare(
    'SELECT conclusion_id, term_id FROM conclusion_support_ ORDER BY conclusion_id ASC, position ASC',
  );
  const insertConclusionSupport = db.prepare(
    `INSERT INTO conclusion_support_ (conclusion_id, term_id, position) VALUES (?, ?, ?)
     ON CONFLICT DO NOTHING`,
  );

  // Ticket 06's statements. A surfacing's support is not stored beside it: it is
  // the support of the conclusion that was shown, and a second copy of that set
  // could only ever disagree with the first.
  const insertSurfacing = db.prepare(
    'INSERT INTO surfacing_ (id, conclusion_id, surfaced_at) VALUES (?, ?, ?)',
  );
  const selectSurfacings = db.prepare(
    'SELECT id, conclusion_id, surfaced_at FROM surfacing_ ORDER BY surfaced_at ASC, rowid ASC',
  );

  const selectSettlement = db.prepare(
    'SELECT drops_since, look_now_next FROM settle_state_ WHERE id = 1',
  );
  const noteAttachmentRow = db.prepare(
    'UPDATE settle_state_ SET drops_since = drops_since + 1 WHERE id = 1',
  );
  const setLookNowNextRow = db.prepare('UPDATE settle_state_ SET look_now_next = ? WHERE id = 1');
  const resetPileRow = db.prepare('UPDATE settle_state_ SET drops_since = 0 WHERE id = 1');

  /** Read the one settlement row, or the state a database without one means. */
  function readSettlementRow(): StoredSettlement {
    const row = selectSettlement.get() as unknown as SettlementRow | undefined;
    // The schema inserts the row on open, so a missing one means a hand-edited
    // file. "Nothing has piled up, and the next crossing looks now" is the state
    // a fresh product is in, which is the safe reading for it.
    if (row === undefined) return { dropsSince: 0, lookNowNext: true };
    return {
      dropsSince: row.drops_since,
      lookNowNext: row.look_now_next !== 0,
    };
  }

  /** A matter's support, grouped by matter, in the order it was first said. */
  function supportByMatter(): ReadonlyMap<string, string[]> {
    const rows = selectMatterTerms.all() as unknown as MatterTermRow[];
    const grouped = new Map<string, string[]>();
    for (const row of rows) {
      const bucket = grouped.get(row.matter_id);
      if (bucket === undefined) grouped.set(row.matter_id, [row.term_id]);
      else bucket.push(row.term_id);
    }
    return grouped;
  }

  /** The drops that fed each matter, oldest first. */
  function dropsByMatter(): ReadonlyMap<string, MatterDrop[]> {
    const rows = selectMatterDrops.all() as unknown as MatterDropRow[];
    const grouped = new Map<string, MatterDrop[]>();
    for (const row of rows) {
      const mention: MatterDrop = {
        dropId: row.drop_id,
        anchorTermId: row.anchor_term_id,
        at: row.at,
      };
      const bucket = grouped.get(row.matter_id);
      if (bucket === undefined) grouped.set(row.matter_id, [mention]);
      else bucket.push(mention);
    }
    return grouped;
  }

  /** A conclusion's support, grouped by conclusion, in the order it was said. */
  function supportByConclusion(): ReadonlyMap<string, string[]> {
    const rows = selectConclusionSupport.all() as unknown as ConclusionSupportRow[];
    const grouped = new Map<string, string[]>();
    for (const row of rows) {
      const bucket = grouped.get(row.conclusion_id);
      if (bucket === undefined) grouped.set(row.conclusion_id, [row.term_id]);
      else bucket.push(row.term_id);
    }
    return grouped;
  }

  /**
   * Bring a matter's count and span back in line with the drops it still holds.
   *
   * Recomputing rather than decrementing, because these two are supposed to be a
   * summary of the `matter_drop_` rows and nothing else. A fragment that is
   * withdrawn must leave the matter counting what is left — a matter that
   * re-crossed the threshold on the strength of a fragment nobody can read any
   * more would have the product speaking about material the user has taken back.
   *
   * A matter nothing is left in is removed outright. It has no evidence, so it
   * has nothing to say, and a judgement assembled from it could only be the
   * product talking to itself.
   *
   * @param matterId - the matter to bring up to date.
   */
  function recomputeMatter(matterId: string): void {
    // Scoped in SQL rather than filtered in JS: this runs inside the deletion
    // loop, and reading every mention in the database once per matter would make
    // deleting one fragment cost more as the user's material grows.
    const mine = (
      db
        .prepare('SELECT drop_id, anchor_term_id, at FROM matter_drop_ WHERE matter_id = ? ORDER BY at ASC, rowid ASC')
        .all(matterId) as unknown as MatterDropRow[]
    );
    const [first] = mine;
    if (first === undefined) {
      // Cascades to its support and its conclusions: with no fragment behind it
      // there is no evidence, and a judgement with no evidence is not a judgement.
      db.prepare('DELETE FROM matter_ WHERE id = ?').run(matterId);
      return;
    }
    const newest = mine[mine.length - 1];
    if (newest === undefined) return;
    db.prepare('UPDATE matter_ SET raised_count = ?, first_at = ?, last_at = ? WHERE id = ?').run(
      mine.length,
      first.at,
      newest.at,
      matterId,
    );
  }

  return {
    async appendDrop(
      body: string,
      reply: string,
      at: string,
      pinnedMatterId: string | null,
    ): Promise<StoredDrop> {
      const stored: StoredDrop = {
        id: randomUUID(),
        body,
        droppedAt: at,
        inputType: null,
        // Nothing has been read out of it yet, so nothing says what it is about.
        anchorTermId: null,
        reply,
        // What the user said by writing it where they did, kept as they said it.
        pinnedMatterId,
      };
      insertDrop.run(stored.id, stored.body, stored.droppedAt, reply, pinnedMatterId);
      return stored;
    },

    async recordReply(dropId: string, reply: string): Promise<void> {
      setReply.run(reply, dropId);
    },

    async recordExtraction(
      dropId: string,
      outcome: ExtractOutcome,
      at: string,
    ): Promise<RecordedReading> {
      const saidAt = at;

      // One transaction, because this writes several kinds of row that only mean
      // something together: a drop marked as read with half its terms written is
      // a state the domain could not recover from, and `recordExtraction` is the
      // step whose failure is promised to be harmless.
      db.exec('BEGIN');
      try {
        // Clear first, then write. Re-running extraction must converge on one
        // set of items rather than accumulating a duplicate per attempt, and a
        // single delete-then-insert cannot leave the drop marked as read while
        // its items are half-written.
        deleteItemsForDrop.run(dropId);
        for (const item of outcome.items) {
          // An item is caught **to do**: re-running extraction after the user has
          // ticked something off replaces the items, and it would be wrong to
          // quietly carry a decision of theirs across onto a row the drop just
          // produced. What is re-read is what the drop contained, which is not
          // what they have since done about it.
          insertItem.run(randomUUID(), dropId, item.text, item.dueAt, DEFAULT_ITEM_STATE, saidAt);
        }
        setInputType.run(outcome.inputType, dropId);

        // The terms this drop said, in the order it said them. Blank entries
        // are dropped rather than stored: a term the user can never mean is not
        // a term, and an empty string would match everything later. The mentions
        // are cleared first so a re-run converges rather than accumulating.
        deleteMentionsForDrop.run(dropId);

        const said: StoredTerm[] = [];
        const alreadySaid = new Set<string>();
        for (const raw of outcome.terms) {
          const text = raw.trim();
          if (text.length === 0 || alreadySaid.has(text)) continue;
          alreadySaid.add(text);

          // `DO NOTHING` on the unique text, then read back: a term said again
          // keeps its id and the drop it first came from, which is what makes
          // repetition accumulate instead of forking.
          insertTerm.run(randomUUID(), text, dropId, saidAt);
          const row = selectTermByText.get(text) as unknown as TermRow | undefined;
          if (row === undefined) continue;
          insertMention.run(dropId, row.id, saidAt);
          said.push(toStoredTerm(row));
        }

        // What the drop is *about*, if anything. Resolved against the terms this
        // drop actually said rather than trusted as a string: an anchor naming
        // something the reading did not list is a reading that contradicts
        // itself, and the honest record of that is "no anchor" — inventing a term
        // the user never said would be worse than losing one reading.
        const anchorText = outcome.anchor?.trim() ?? '';
        const anchor = said.find((term) => term.text === anchorText);
        setAnchor.run(anchor?.id ?? null, dropId);

        db.exec('COMMIT');
        return { terms: said, anchorTermId: anchor?.id ?? null };
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },

    async listTerms(): Promise<readonly StoredTerm[]> {
      const rows = selectTerms.all() as unknown as TermRow[];
      return rows.map(toStoredTerm);
    },

    async listTermsForDrop(dropId: string): Promise<readonly StoredTerm[]> {
      const rows = selectTermsForDrop.all(dropId) as unknown as TermRow[];
      return rows.map(toStoredTerm);
    },

    async listTermsByDrop(): Promise<ReadonlyMap<string, readonly StoredTerm[]>> {
      const rows = selectMentions.all() as unknown as MentionRow[];
      const grouped = new Map<string, StoredTerm[]>();
      for (const row of rows) {
        const bucket = grouped.get(row.drop_id);
        if (bucket === undefined) grouped.set(row.drop_id, [toStoredTerm(row)]);
        else bucket.push(toStoredTerm(row));
      }
      return grouped;
    },

    async recordTermVectors(vectors: readonly TermVector[]): Promise<void> {
      for (const entry of vectors) {
        setTermVector.run(JSON.stringify(entry.vector), entry.termId);
      }
    },

    async listLinks(): Promise<readonly StoredLink[]> {
      const rows = selectLinks.all() as unknown as LinkRow[];
      return rows
        .map(toStoredLink)
        .filter((link): link is StoredLink => link !== null);
    },

    async recordLinks(links: readonly NewLink[]): Promise<void> {
      for (const link of links) {
        if (link.fromTermId === link.toTermId) continue;
        const [a, b] = orderedPair(link.fromTermId, link.toTermId);
        upsertLink.run(randomUUID(), a, b, link.kind, link.strength, link.reason);
      }
    },

    async listMatters(): Promise<readonly StoredMatter[]> {
      const rows = selectMatters.all() as unknown as MatterRow[];
      const support = supportByMatter();
      const drops = dropsByMatter();
      return rows.map((row) => ({
        id: row.id,
        anchorTermId: row.anchor_term_id,
        firstAt: row.first_at,
        lastAt: row.last_at,
        raisedCount: row.raised_count,
        supportTermIds: support.get(row.id) ?? [],
        drops: drops.get(row.id) ?? [],
      }));
    },

    async openMatter(matter: NewMatter): Promise<StoredMatter> {
      const id = randomUUID();
      db.exec('BEGIN');
      try {
        insertMatter.run(id, matter.anchorTermId, matter.at, matter.at, 1);
        for (const [position, termId] of matter.termIds.entries()) {
          insertMatterTerm.run(id, termId, position);
        }
        insertMatterDrop.run(matter.dropId, id, matter.anchorTermId, matter.at);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      const support = supportByMatter().get(id) ?? [];
      return {
        id,
        anchorTermId: matter.anchorTermId,
        firstAt: matter.at,
        lastAt: matter.at,
        raisedCount: 1,
        supportTermIds: support,
        drops: [{ dropId: matter.dropId, anchorTermId: matter.anchorTermId, at: matter.at }],
      };
    },

    async growMatter(growth: MatterGrowth): Promise<void> {
      db.exec('BEGIN');
      try {
        // The drop's membership is claimed first, and a drop that is already a
        // member stops here: the raised count is the threshold's unit, and a
        // re-run that counted the same fragment twice would lower it. The
        // `ON CONFLICT` makes that claim atomic with the rest of the write.
        const claimed = insertMatterDrop.run(
          growth.dropId,
          growth.matterId,
          growth.anchorTermId,
          growth.at,
        );
        if (claimed.changes === 0) {
          db.exec('COMMIT');
          return;
        }
        let position = (countMatterTerms.get(growth.matterId) as unknown as { count: number }).count;
        for (const termId of growth.termIds) {
          insertMatterTerm.run(growth.matterId, termId, position);
          position += 1;
        }
        growMatterRow.run(growth.at, growth.matterId);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },

    async matterForDrop(dropId: string): Promise<string | null> {
      const row = selectMatterForDrop.get(dropId) as unknown as { matter_id: string } | undefined;
      return row?.matter_id ?? null;
    },

    async listConclusions(): Promise<readonly StoredConclusion[]> {
      const rows = selectConclusions.all() as unknown as ConclusionRow[];
      const support = supportByConclusion();
      return rows
        .map((row) => toStoredConclusion(row, support.get(row.id) ?? []))
        .filter((conclusion): conclusion is StoredConclusion => conclusion !== null);
    },

    async appendConclusion(conclusion: NewConclusion): Promise<StoredConclusion> {
      const id = randomUUID();
      db.exec('BEGIN');
      try {
        insertConclusion.run(
          id,
          conclusion.matterId,
          conclusion.claim,
          conclusion.text,
          conclusion.kind,
          conclusion.tier,
          conclusion.softened ? 1 : 0,
          conclusion.relation,
          conclusion.supersedes,
          conclusion.createdAt,
          conclusion.mentions,
          conclusion.spanDays,
          conclusion.averageStrength,
        );
        // In the order they were said: that order is what the page shows, and a
        // support list that reordered itself between reads could not be compared
        // with the material it came from.
        for (const [position, termId] of conclusion.supportTermIds.entries()) {
          insertConclusionSupport.run(id, termId, position);
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return { ...conclusion, id };
    },

    async listSurfacings(): Promise<readonly StoredSurfacing[]> {
      const rows = selectSurfacings.all() as unknown as SurfacingRow[];
      const support = supportByConclusion();
      return rows.map((row) => ({
        id: row.id,
        conclusionId: row.conclusion_id,
        surfacedAt: row.surfaced_at,
        // The support of the conclusion that was shown, in the order it was
        // said: the cooldown is measured on what stood behind the line the user
        // actually read, and this is that set.
        supportTermIds: support.get(row.conclusion_id) ?? [],
      }));
    },

    async recordSurfacing(conclusionId: string, at: string): Promise<StoredSurfacing> {
      const id = randomUUID();
      insertSurfacing.run(id, conclusionId, at);
      return {
        id,
        conclusionId,
        surfacedAt: at,
        supportTermIds: supportByConclusion().get(conclusionId) ?? [],
      };
    },

    async readSettlement(): Promise<StoredSettlement> {
      return readSettlementRow();
    },

    async noteAttachment(): Promise<void> {
      noteAttachmentRow.run();
    },

    async setLookNowNext(lookNowNext: boolean): Promise<void> {
      setLookNowNextRow.run(lookNowNext ? 1 : 0);
    },

    async resetPile(): Promise<void> {
      resetPileRow.run();
    },

    /**
     * The deletes of ticket 09, each in one transaction.
     *
     * A transaction is not tidiness here: a half-finished deletion would leave
     * the user's material in a state the product has no word for — a judgement
     * whose evidence is partly gone, or a matter counting a fragment that is no
     * longer there. There is no way back from a deletion, so there is nothing to
     * be gained by allowing one to stop halfway.
     */
    async deleteTerms(removal: TermRemoval): Promise<void> {
      if (removal.termIds.length === 0) return;
      const placeholders = removal.termIds.map(() => '?').join(', ');
      db.exec('BEGIN');
      try {
        // Hand every matter these words hold up over to a word that survives,
        // and do it **before** the delete. A matter whose anchor goes cascades
        // away with it — which is what `cascade` means and emphatically not what
        // "this supporting word is no longer said" means.
        if (removal.anchorTermId !== null) {
          db.prepare(
            `UPDATE matter_ SET anchor_term_id = ?
              WHERE anchor_term_id IN (${placeholders})`,
          ).run(removal.anchorTermId, ...removal.termIds);
          // Only the mentions that had no feeling of their own: one that brought
          // a feeling still points at a term nobody says, and is cleared first so
          // this cannot be read as erasing a fact about the material.
          db.prepare(
            `UPDATE matter_drop_ SET anchor_term_id = ?
              WHERE anchor_term_id IN (${placeholders})`,
          ).run(removal.anchorTermId, ...removal.termIds);
        }

        // A matter's support must not name a word that is about to go, or the
        // matter would carry evidence nobody can read. What it counts as raised
        // is untouched: deleting one word the user said is not deleting the
        // fragment they said it in.
        for (const termId of removal.termIds) dropMatterTerm.run(termId);

        // What a judgement cites is the evidence behind it. A prop that cannot be
        // read back is not evidence, so it goes — and nothing takes its place:
        // the store does not know what the user meant instead.
        for (const termId of removal.termIds) dropConclusionSupport.run(termId);

        for (const termId of removal.termIds) deleteTerm.run(termId);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },

    async deleteDrop(dropId: string): Promise<boolean> {
      // One transaction, because two things have to happen together: the drop
      // goes, and the words that survive it stop claiming it as where they came
      // from. `term_` deliberately does **not** cascade on `origin_drop_id` (see
      // the schema) — a word is one row per wording, so the fragment that first
      // said it is one of several that say it, and deleting that fragment must
      // not take the word out of the others' mouths.
      db.exec('BEGIN');
      try {
        db.prepare('UPDATE term_ SET origin_drop_id = NULL WHERE origin_drop_id = ?').run(dropId);
        // Everything else goes by itself: the mentions, the items, and the drop's
        // place in its matter all reference `drop_` with `ON DELETE CASCADE`, and
        // foreign keys are on for this connection. Writing those deletes out by
        // hand would be a second, weaker copy of the schema.
        const removed = deleteDropRow.run(dropId);
        db.exec('COMMIT');
        return removed.changes > 0;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },

    async reopenMatter(matterId: string, anchorTermId: string): Promise<readonly MatterDrop[]> {
      // Only the anchor moves. No membership row is written: the matter is
      // re-opened **around a word**, and a word is not a fragment — inventing a
      // row in `matter_drop_` for it would be claiming a drop arrived, which is a
      // fact about the user's material that did not happen. (It would also throw:
      // that column references `drop_`, and there is no such drop to point at.)
      //
      // The mentions that brought no feeling of their own are re-pointed, so the
      // support a later judgement is worded from still reads as one history.
      db.exec('BEGIN');
      try {
        setMatterAnchor.run(anchorTermId, matterId);
        setMatterDropAnchor.run(anchorTermId, matterId);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return dropsByMatter().get(matterId) ?? [];
    },

    async forgetMatterDrop(matterId: string, dropId: string): Promise<boolean> {
      const removed = db
        .prepare('DELETE FROM matter_drop_ WHERE matter_id = ? AND drop_id = ?')
        .run(matterId, dropId);
      if (removed.changes === 0) return false;
      recomputeMatter(matterId);
      return true;
    },

    async detachConclusion(conclusionId: string, matterId: string): Promise<void> {
      setConclusionMatter.run(matterId, conclusionId);
    },

    async deleteConclusion(conclusionId: string): Promise<boolean> {
      // One statement. The surfacings that recorded it being shown go by cascade
      // — a judgement that is gone cannot have been shown — and the conclusions
      // that carried on from it are repaired to "opened the chain" rather than
      // left pointing at a row nobody can read.
      return deleteConclusionRow.run(conclusionId).changes > 0;
    },

    async pruneConclusionSupport(prune: SupportPrune): Promise<void> {
      if (prune.conclusionIds.length === 0 || prune.termIds.length === 0) return;
      // Bound per conclusion rather than as one `IN`-list for both: the statement
      // is small, the lists are small, and a single statement taking two variadic
      // lists would be unreadable for no gain at this size.
      const drop = db.prepare(
        'DELETE FROM conclusion_support_ WHERE conclusion_id = ? AND term_id = ?',
      );
      db.exec('BEGIN');
      try {
        for (const conclusionId of prune.conclusionIds) {
          for (const termId of prune.termIds) drop.run(conclusionId, termId);
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },

    async listDrops(): Promise<readonly StoredDrop[]> {
      const rows = selectDrops.all() as unknown as DropRow[];
      return rows.map(toStoredDrop);
    },

    async findDrop(dropId: string): Promise<StoredDrop | null> {
      const row = selectDrop.get(dropId) as unknown as DropRow | undefined;
      return row === undefined ? null : toStoredDrop(row);
    },

    async listItems(): Promise<readonly StoredItem[]> {
      const rows = selectItems.all() as unknown as ItemRow[];
      return rows.map(toStoredItem);
    },

    async listItemsForDrop(dropId: string): Promise<readonly StoredItem[]> {
      const rows = selectItemsForDrop.all(dropId) as unknown as ItemRow[];
      return rows.map(toStoredItem);
    },

    async setItemState(itemId: string, state: ItemState): Promise<StoredItem | null> {
      const changed = updateItemState.run(state, itemId);
      // Not found is an answer, not a failure — the same reading `findDrop`
      // takes. Reading the row back afterwards rather than assembling it from
      // the arguments keeps the two from drifting: what a caller gets is what
      // the store now holds.
      if (changed.changes === 0) return null;
      const row = selectItem.get(itemId) as unknown as ItemRow | undefined;
      return row === undefined ? null : toStoredItem(row);
    },

    async clear(): Promise<void> {
      // The tables to empty are read from the schema itself rather than listed
      // here: a hand-kept list would be a second copy of the schema, and the day
      // somebody adds a table is the day the demo's reset starts leaving material
      // behind. `settle_state_` is the one exclusion — it holds no material, and
      // its single row is put back below instead of being deleted.
      const tables = db
        .prepare(
          `SELECT name FROM sqlite_master
             WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'settle_state_'
             ORDER BY name`,
        )
        .all() as unknown as { readonly name: string }[];

      // One transaction, because a half-emptied library is a state neither the
      // demo nor the product has a reading for. The order is whatever the schema
      // returned: every reference in it carries an `ON DELETE` action (cascade or
      // set-null), so no delete can be blocked by a row another table still
      // points at — and a table added later *without* one fails loudly here
      // rather than being quietly skipped.
      db.exec('BEGIN');
      try {
        for (const table of tables) db.exec(`DELETE FROM "${table.name}"`);
        db.exec(
          `INSERT INTO settle_state_ (id, drops_since, look_now_next) VALUES (1, 0, 1)
             ON CONFLICT (id) DO UPDATE SET drops_since = 0, look_now_next = 1`,
        );
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },

    async close(): Promise<void> {
      db.close();
    },
  };
}
