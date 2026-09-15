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
import type { DropStore, StoredDrop } from './storage.ts';

/**
 * The schema.
 *
 * The `drop_` suffix is deliberate: `drop` is a SQL keyword, so the table name
 * carries a trailing underscore to keep every statement free of quoting.
 *
 * A drop's faithful text *is* its record — there is no separate summary table,
 * because the spec stores the original and nothing else. The remaining entities
 * (terms, links, conclusions, the chain, items, surfacing history) arrive with
 * the tickets that need them, and bring their foreign keys with them.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS drop_ (
  id         TEXT PRIMARY KEY,
  body       TEXT NOT NULL,
  dropped_at TEXT NOT NULL
);
`;

/** A row as SQLite hands it back. */
interface DropRow {
  readonly id: string;
  readonly body: string;
  readonly dropped_at: string;
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
  // tickets depend on only holds while they are ON. Nothing references anything
  // yet, but the pragma belongs to opening the connection, not to the first
  // table that needs it — enabling it later would silently leave the gap open
  // for every row written in between.
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);

  const insert = db.prepare('INSERT INTO drop_ (id, body, dropped_at) VALUES (?, ?, ?)');
  const selectAll = db.prepare('SELECT id, body, dropped_at FROM drop_ ORDER BY dropped_at ASC, rowid ASC');

  return {
    async appendDrop(body: string): Promise<StoredDrop> {
      const stored: StoredDrop = {
        id: randomUUID(),
        body,
        droppedAt: new Date().toISOString(),
      };
      insert.run(stored.id, stored.body, stored.droppedAt);
      return stored;
    },

    async listDrops(): Promise<readonly StoredDrop[]> {
      const rows = selectAll.all() as unknown as DropRow[];
      return rows.map((row) => ({
        id: row.id,
        body: row.body,
        droppedAt: row.dropped_at,
      }));
    },

    async close(): Promise<void> {
      db.close();
    },
  };
}
