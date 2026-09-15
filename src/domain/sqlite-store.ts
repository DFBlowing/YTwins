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
import { INPUT_TYPES, type InputType } from './interface.ts';
import type { DropStore, ExtractOutcome, StoredDrop, StoredItem } from './storage.ts';

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

    async recordExtraction(dropId: string, outcome: ExtractOutcome): Promise<void> {
      // Clear first, then write. Re-running extraction must converge on one
      // set of items rather than accumulating a duplicate per attempt, and a
      // single delete-then-insert cannot leave the drop marked as read while
      // its items are half-written.
      deleteItemsForDrop.run(dropId);
      const caughtAt = new Date().toISOString();
      for (const item of outcome.items) {
        insertItem.run(randomUUID(), dropId, item.text, item.dueAt, caughtAt);
      }
      setInputType.run(outcome.inputType, dropId);
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
