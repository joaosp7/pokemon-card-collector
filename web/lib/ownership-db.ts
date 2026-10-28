import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { ownershipDbPath } from "./data-paths";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS owned_cards (
  set_card_id TEXT NOT NULL,
  set_id INTEGER NOT NULL,
  copies INTEGER NOT NULL CHECK (copies >= 1),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (set_id, set_card_id)
);
`;

type GlobalDb = typeof globalThis & {
  __ownershipDb?: Database.Database;
};

export function openOwnership(
  filename: string = ownershipDbPath(),
): Database.Database {
  if (filename !== ":memory:") {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }
  const db = new Database(filename);
  db.exec(SCHEMA);
  return db;
}

function useDb(db?: Database.Database): Database.Database {
  if (db) {
    return db;
  }
  const globalForDb = globalThis as GlobalDb;
  if (!globalForDb.__ownershipDb) {
    globalForDb.__ownershipDb = openOwnership();
  }
  return globalForDb.__ownershipDb;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function getCopies(
  setId: number,
  setCardId: string,
  db?: Database.Database,
): number {
  const row = useDb(db)
    .prepare(
      `SELECT copies FROM owned_cards
       WHERE set_id = ? AND set_card_id = ?`,
    )
    .get(setId, setCardId) as { copies: number } | undefined;
  return row?.copies ?? 0;
}

export function getOwnedMap(
  setId: number,
  db?: Database.Database,
): Map<string, number> {
  const rows = useDb(db)
    .prepare(
      `SELECT set_card_id, copies FROM owned_cards
       WHERE set_id = ?`,
    )
    .all(setId) as { set_card_id: string; copies: number }[];
  return new Map(rows.map((row) => [row.set_card_id, row.copies]));
}

export function addCopy(
  setId: number,
  setCardId: string,
  db?: Database.Database,
): void {
  const updatedAt = nowIso();
  useDb(db)
    .prepare(
      `INSERT INTO owned_cards (set_id, set_card_id, copies, updated_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(set_id, set_card_id)
       DO UPDATE SET copies = copies + 1, updated_at = excluded.updated_at`,
    )
    .run(setId, setCardId, updatedAt);
}

export function removeCopy(
  setId: number,
  setCardId: string,
  db?: Database.Database,
): void {
  const conn = useDb(db);
  const updatedAt = nowIso();
  const txn = conn.transaction(() => {
    const updated = conn
      .prepare(
        `UPDATE owned_cards
         SET copies = copies - 1, updated_at = ?
         WHERE set_id = ? AND set_card_id = ? AND copies > 1`,
      )
      .run(updatedAt, setId, setCardId);
    if (updated.changes === 0) {
      conn
        .prepare(
          `DELETE FROM owned_cards
           WHERE set_id = ? AND set_card_id = ? AND copies = 1`,
        )
        .run(setId, setCardId);
    }
  });
  txn();
}

export function countOwned(setId: number, db?: Database.Database): number {
  const row = useDb(db)
    .prepare(`SELECT COUNT(*) AS count FROM owned_cards WHERE set_id = ?`)
    .get(setId) as { count: number };
  return row.count;
}

export type OwnershipSummary = {
  cards: number;
  copies: number;
};

export function summarizeOwnership(
  setId: number,
  db?: Database.Database,
): OwnershipSummary {
  const row = useDb(db)
    .prepare(
      `SELECT COUNT(*) AS cards, COALESCE(SUM(copies), 0) AS copies
       FROM owned_cards
       WHERE set_id = ?`,
    )
    .get(setId) as { cards: number; copies: number };
  return { cards: Number(row.cards), copies: Number(row.copies) };
}

export type OwnedRow = {
  setCardId: string;
  copies: number;
  updatedAt: string;
};

export function listOwnedForSet(
  setId: number,
  db?: Database.Database,
): OwnedRow[] {
  const rows = useDb(db)
    .prepare(
      `SELECT set_card_id, copies, updated_at FROM owned_cards
       WHERE set_id = ?
       ORDER BY set_card_id`,
    )
    .all(setId) as { set_card_id: string; copies: number; updated_at: string }[];
  return rows.map((row) => ({
    setCardId: row.set_card_id,
    copies: row.copies,
    updatedAt: row.updated_at,
  }));
}

export function deleteOwnedForSet(
  setId: number,
  db?: Database.Database,
): number {
  const result = useDb(db)
    .prepare(`DELETE FROM owned_cards WHERE set_id = ?`)
    .run(setId);
  return result.changes;
}

export function restoreOwnedForSet(
  setId: number,
  rows: readonly OwnedRow[],
  db?: Database.Database,
): void {
  const conn = useDb(db);
  const insert = conn.prepare(
    `INSERT INTO owned_cards (set_id, set_card_id, copies, updated_at)
     VALUES (?, ?, ?, ?)`,
  );
  const txn = conn.transaction(() => {
    conn.prepare(`DELETE FROM owned_cards WHERE set_id = ?`).run(setId);
    for (const row of rows) {
      insert.run(setId, row.setCardId, row.copies, row.updatedAt);
    }
  });
  txn();
}
