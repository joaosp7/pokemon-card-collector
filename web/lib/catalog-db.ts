import Database from "better-sqlite3";
import { catalogDbPath } from "./data-paths";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  set_code TEXT NOT NULL UNIQUE,
  name_pt TEXT,
  name_en TEXT,
  slug TEXT NOT NULL UNIQUE,
  source_url TEXT NOT NULL,
  logo_path TEXT,
  card_count INTEGER NOT NULL CHECK (card_count >= 0)
);

CREATE TABLE IF NOT EXISTS set_cards (
  id TEXT NOT NULL,
  set_id INTEGER NOT NULL,
  name_pt TEXT,
  name_en TEXT,
  element_code TEXT,
  rarity_code TEXT,
  image_path TEXT NOT NULL,
  sort_key TEXT NOT NULL,
  illustrator TEXT,
  PRIMARY KEY (set_id, id),
  FOREIGN KEY (set_id) REFERENCES sets(id)
);
`;

export type Collection = {
  id: number;
  setCode: string;
  namePt: string | null;
  nameEn: string | null;
  slug: string;
  sourceUrl: string;
  logoPath: string | null;
  cardCount: number;
};

export type Card = {
  setId: number;
  setCardId: string;
  namePt: string | null;
  nameEn: string | null;
  elementCode: string | null;
  rarityCode: string | null;
  imagePath: string;
  sortKey: string;
  illustrator: string | null;
};

type SetRow = {
  id: number;
  set_code: string;
  name_pt: string | null;
  name_en: string | null;
  slug: string;
  source_url: string;
  logo_path: string | null;
  card_count: number;
};

type CardRow = {
  set_id: number;
  id: string;
  name_pt: string | null;
  name_en: string | null;
  element_code: string | null;
  rarity_code: string | null;
  image_path: string;
  sort_key: string;
  illustrator: string | null;
};

type GlobalDb = typeof globalThis & {
  __catalogDb?: Database.Database;
};

const SET_COLUMNS = `
  id,
  set_code,
  name_pt,
  name_en,
  slug,
  source_url,
  logo_path,
  card_count
`;

const CARD_COLUMNS = `
  set_id,
  id,
  name_pt,
  name_en,
  element_code,
  rarity_code,
  image_path,
  sort_key,
  illustrator
`;

export function openCatalog(
  filename: string = catalogDbPath(),
): Database.Database {
  const db = new Database(filename);
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

function useDb(db?: Database.Database): Database.Database {
  if (db) {
    return db;
  }
  const globalForDb = globalThis as GlobalDb;
  if (!globalForDb.__catalogDb) {
    globalForDb.__catalogDb = openCatalog();
  }
  return globalForDb.__catalogDb;
}

function mapSet(row: SetRow): Collection {
  return {
    id: row.id,
    setCode: row.set_code,
    namePt: row.name_pt,
    nameEn: row.name_en,
    slug: row.slug,
    sourceUrl: row.source_url,
    logoPath: row.logo_path,
    cardCount: row.card_count,
  };
}

function mapCard(row: CardRow): Card {
  return {
    setId: row.set_id,
    setCardId: row.id,
    namePt: row.name_pt,
    nameEn: row.name_en,
    elementCode: row.element_code,
    rarityCode: row.rarity_code,
    imagePath: row.image_path,
    sortKey: row.sort_key,
    illustrator: row.illustrator,
  };
}

export function listSets(db?: Database.Database): Collection[] {
  const rows = useDb(db)
    .prepare(`SELECT ${SET_COLUMNS} FROM sets ORDER BY slug ASC`)
    .all() as SetRow[];
  return rows.map(mapSet);
}

export function findSetBySlug(
  slug: string,
  db?: Database.Database,
): Collection | null {
  const row = useDb(db)
    .prepare(`SELECT ${SET_COLUMNS} FROM sets WHERE slug = ?`)
    .get(slug) as SetRow | undefined;
  return row ? mapSet(row) : null;
}

export function findSetById(
  id: number,
  db?: Database.Database,
): Collection | null {
  const row = useDb(db)
    .prepare(`SELECT ${SET_COLUMNS} FROM sets WHERE id = ?`)
    .get(id) as SetRow | undefined;
  return row ? mapSet(row) : null;
}

export function listSetCards(setId: number, db?: Database.Database): Card[] {
  const rows = useDb(db)
    .prepare(
      `SELECT ${CARD_COLUMNS} FROM set_cards
       WHERE set_id = ?
       ORDER BY sort_key ASC`,
    )
    .all(setId) as CardRow[];
  return rows.map(mapCard);
}

export function findSetCard(
  setId: number,
  setCardId: string,
  db?: Database.Database,
): Card | null {
  const row = useDb(db)
    .prepare(
      `SELECT ${CARD_COLUMNS} FROM set_cards
       WHERE set_id = ? AND id = ?`,
    )
    .get(setId, setCardId) as CardRow | undefined;
  return row ? mapCard(row) : null;
}

export function setCardExists(
  setId: number,
  setCardId: string,
  db?: Database.Database,
): boolean {
  const row = useDb(db)
    .prepare(
      `SELECT 1 AS present FROM set_cards
       WHERE set_id = ? AND id = ?`,
    )
    .get(setId, setCardId) as { present: number } | undefined;
  return row !== undefined;
}
