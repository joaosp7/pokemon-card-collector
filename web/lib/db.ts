import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS owned_cards (
  collection_slug TEXT NOT NULL,
  collector_number TEXT NOT NULL,
  copies INTEGER NOT NULL CHECK (copies >= 1),
  PRIMARY KEY (collection_slug, collector_number)
);
`;

type GlobalDb = typeof globalThis & {
  __collectionDb?: Database.Database;
};

export function migrate(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
}

export function createDatabase(filename: string): Database.Database {
  if (filename !== ":memory:") {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }
  const db = new Database(filename);
  migrate(db);
  return db;
}

export function getDb(): Database.Database {
  const globalForDb = globalThis as GlobalDb;
  if (!globalForDb.__collectionDb) {
    const dbPath = path.join(process.cwd(), "data", "collection.db");
    globalForDb.__collectionDb = createDatabase(dbPath);
  }
  return globalForDb.__collectionDb;
}
