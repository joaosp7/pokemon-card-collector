import type Database from "better-sqlite3";
import { getDb } from "./db";

function useDb(db?: Database.Database): Database.Database {
  return db ?? getDb();
}

export function getCopies(
  slug: string,
  number: string,
  db?: Database.Database,
): number {
  const row = useDb(db)
    .prepare(
      `SELECT copies FROM owned_cards
       WHERE collection_slug = ? AND collector_number = ?`,
    )
    .get(slug, number) as { copies: number } | undefined;
  return row?.copies ?? 0;
}

export function getOwnedMap(
  slug: string,
  db?: Database.Database,
): Map<string, number> {
  const rows = useDb(db)
    .prepare(
      `SELECT collector_number, copies FROM owned_cards
       WHERE collection_slug = ?`,
    )
    .all(slug) as { collector_number: string; copies: number }[];
  return new Map(rows.map((row) => [row.collector_number, row.copies]));
}

export function addCopy(
  slug: string,
  number: string,
  db?: Database.Database,
): void {
  useDb(db)
    .prepare(
      `INSERT INTO owned_cards (collection_slug, collector_number, copies)
       VALUES (?, ?, 1)
       ON CONFLICT(collection_slug, collector_number)
       DO UPDATE SET copies = copies + 1`,
    )
    .run(slug, number);
}

export function removeCopy(
  slug: string,
  number: string,
  db?: Database.Database,
): void {
  const conn = useDb(db);
  const txn = conn.transaction(() => {
    const updated = conn
      .prepare(
        `UPDATE owned_cards SET copies = copies - 1
         WHERE collection_slug = ? AND collector_number = ? AND copies > 1`,
      )
      .run(slug, number);
    if (updated.changes === 0) {
      conn
        .prepare(
          `DELETE FROM owned_cards
           WHERE collection_slug = ? AND collector_number = ? AND copies = 1`,
        )
        .run(slug, number);
    }
  });
  txn();
}

export function countOwned(slug: string, db?: Database.Database): number {
  const row = useDb(db)
    .prepare(
      `SELECT COUNT(*) AS count FROM owned_cards WHERE collection_slug = ?`,
    )
    .get(slug) as { count: number };
  return row.count;
}
