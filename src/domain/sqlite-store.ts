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
import { INPUT_TYPES, LINK_KINDS, type InputType, type LinkKind } from './interface.ts';
import { orderedPair } from './linking.ts';
import type {
  DropStore,
  ExtractOutcome,
  NewLink,
  StoredDrop,
  StoredItem,
  StoredLink,
  StoredTerm,
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
 * `term_` holds one row per **wording**, unique on the text. That is the whole
 * deduplication rule, and it is deliberately the literal one: "想学吉他" said
 * twice is one term, while "想学吉他" and "打算学吉他" are two terms that a
 * link may later join. Anything cleverer would need the model to be consulted
 * about identity, and a term the model renamed would stop being the user's own
 * words. `term_in_drop_` is what makes "this drop said it" a fact of its own,
 * so a repeat mention is recorded without pretending the term is new.
 *
 * `link_` stores a pair once, under a canonical order of the two ids (the
 * smaller first), which is what the unique constraint enforces. `a_term_id`
 * cascades, so deleting the material a link rests on takes the link too.
 *
 * `vector` is the term's embedding as JSON, or NULL when nothing has needed to
 * compare it yet. Embedding is deferred until there is something to compare
 * against, which is why NULL is the ordinary state for the first term ever said.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS drop_ (
  id         TEXT PRIMARY KEY,
  body       TEXT NOT NULL,
  dropped_at TEXT NOT NULL,
  input_type TEXT,
  reply      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS item_ (
  id        TEXT PRIMARY KEY,
  drop_id   TEXT NOT NULL REFERENCES drop_(id) ON DELETE CASCADE,
  text      TEXT NOT NULL,
  due_at    TEXT,
  caught_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS item_by_drop ON item_ (drop_id);

CREATE TABLE IF NOT EXISTS term_ (
  id             TEXT PRIMARY KEY,
  text           TEXT NOT NULL UNIQUE,
  origin_drop_id TEXT NOT NULL REFERENCES drop_(id) ON DELETE CASCADE,
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
`;

/** A row as SQLite hands it back. */
interface DropRow {
  readonly id: string;
  readonly body: string;
  readonly dropped_at: string;
  readonly input_type: string | null;
  readonly reply: string | null;
}

/** An item row as SQLite hands it back. */
interface ItemRow {
  readonly id: string;
  readonly drop_id: string;
  readonly text: string;
  readonly due_at: string | null;
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
    reply: row.reply,
  };
}

function toStoredItem(row: ItemRow): StoredItem {
  return {
    id: row.id,
    dropId: row.drop_id,
    text: row.text,
    dueAt: row.due_at,
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

  const insertDrop = db.prepare('INSERT INTO drop_ (id, body, dropped_at, reply) VALUES (?, ?, ?, ?)');
  const selectDrops = db.prepare(
    'SELECT id, body, dropped_at, input_type, reply FROM drop_ ORDER BY dropped_at ASC, rowid ASC',
  );
  const selectDrop = db.prepare(
    'SELECT id, body, dropped_at, input_type, reply FROM drop_ WHERE id = ?',
  );
  const setInputType = db.prepare('UPDATE drop_ SET input_type = ? WHERE id = ?');
  const setReply = db.prepare('UPDATE drop_ SET reply = ? WHERE id = ?');
  const deleteItemsForDrop = db.prepare('DELETE FROM item_ WHERE drop_id = ?');
  const insertItem = db.prepare(
    'INSERT INTO item_ (id, drop_id, text, due_at, caught_at) VALUES (?, ?, ?, ?, ?)',
  );
  const selectItems = db.prepare(
    'SELECT id, drop_id, text, due_at FROM item_ ORDER BY caught_at ASC, rowid ASC',
  );
  const selectItemsForDrop = db.prepare(
    'SELECT id, drop_id, text, due_at FROM item_ WHERE drop_id = ? ORDER BY caught_at ASC, rowid ASC',
  );
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

  return {
    async appendDrop(body: string, reply: string): Promise<StoredDrop> {
      const stored: StoredDrop = {
        id: randomUUID(),
        body,
        droppedAt: new Date().toISOString(),
        inputType: null,
        reply,
      };
      insertDrop.run(stored.id, stored.body, stored.droppedAt, reply);
      return stored;
    },

    async recordReply(dropId: string, reply: string): Promise<void> {
      setReply.run(reply, dropId);
    },

    async recordExtraction(dropId: string, outcome: ExtractOutcome): Promise<readonly StoredTerm[]> {
      const saidAt = new Date().toISOString();

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
          insertItem.run(randomUUID(), dropId, item.text, item.dueAt, saidAt);
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

        db.exec('COMMIT');
        return said;
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

    async close(): Promise<void> {
      db.close();
    },
  };
}
