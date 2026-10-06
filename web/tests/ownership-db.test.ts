import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import type Database from "better-sqlite3";
import { openCatalog, setCardExists } from "../lib/catalog-db";
import {
  addCopy,
  countOwned,
  getCopies,
  getOwnedMap,
  openOwnership,
  removeCopy,
} from "../lib/ownership-db";

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function updatedAt(
  db: Database.Database,
  setId: number,
  setCardId: string,
): string | undefined {
  const row = db
    .prepare(
      `SELECT updated_at FROM owned_cards
       WHERE set_id = ? AND set_card_id = ?`,
    )
    .get(setId, setCardId) as { updated_at: string } | undefined;
  return row?.updated_at;
}

describe("ownership database", () => {
  test("adds, increments, decrements, and deletes rows with updated_at set", () => {
    const db = openOwnership(":memory:");
    assert.equal(getCopies(1, "001", db), 0);
    assert.equal(countOwned(1, db), 0);

    addCopy(1, "001", db);
    const insertedAt = updatedAt(db, 1, "001");
    assert.equal(getCopies(1, "001", db), 1);
    assert.equal(countOwned(1, db), 1);
    assert.match(insertedAt ?? "", ISO_TIMESTAMP);

    addCopy(1, "001", db);
    const incrementedAt = updatedAt(db, 1, "001");
    assert.equal(getCopies(1, "001", db), 2);
    assert.match(incrementedAt ?? "", ISO_TIMESTAMP);
    assert.ok(insertedAt);
    assert.ok(incrementedAt);
    assert.ok(incrementedAt >= insertedAt);
    assert.deepEqual([...getOwnedMap(1, db).entries()], [["001", 2]]);

    removeCopy(1, "001", db);
    assert.equal(getCopies(1, "001", db), 1);
    assert.equal(countOwned(1, db), 1);
    const decrementedAt = updatedAt(db, 1, "001");
    assert.match(decrementedAt ?? "", ISO_TIMESTAMP);

    removeCopy(1, "001", db);
    assert.equal(getCopies(1, "001", db), 0);
    assert.equal(countOwned(1, db), 0);
    assert.equal(getOwnedMap(1, db).size, 0);
    assert.equal(updatedAt(db, 1, "001"), undefined);

    removeCopy(1, "001", db);
    assert.equal(getCopies(1, "001", db), 0);
    db.close();
  });

  test("ownership for one set does not change another set", () => {
    const db = openOwnership(":memory:");
    addCopy(1, "001", db);
    addCopy(1, "001", db);
    addCopy(1, "002", db);
    addCopy(2, "001", db);

    assert.equal(getCopies(1, "001", db), 2);
    assert.equal(getCopies(2, "001", db), 1);
    assert.equal(countOwned(1, db), 2);
    assert.equal(countOwned(2, db), 1);

    removeCopy(1, "001", db);
    assert.equal(getCopies(1, "001", db), 1);
    assert.equal(getCopies(2, "001", db), 1);
    assert.deepEqual([...getOwnedMap(2, db).entries()], [["001", 1]]);

    removeCopy(2, "001", db);
    assert.equal(getCopies(1, "001", db), 1);
    assert.equal(getCopies(1, "002", db), 1);
    assert.equal(getCopies(2, "001", db), 0);
    assert.equal(countOwned(2, db), 0);
    db.close();
  });

  test("does not write ownership when the caller rejects an unknown set-card pair", () => {
    const catalog = openCatalog(":memory:");
    const ownership = openOwnership(":memory:");
    catalog
      .prepare(
        `INSERT INTO sets (
           set_code, name_pt, name_en, slug, source_url, logo_path, card_count
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "M6",
        "Tempestade",
        "Storm",
        "Storm-Emeralda-M6",
        "https://example.test/m6",
        null,
        1,
      );
    catalog
      .prepare(
        `INSERT INTO set_cards (
           id, set_id, name_pt, name_en, element_code, rarity_code,
           image_path, sort_key, illustrator
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "001",
        1,
        "Weedle",
        "Weedle",
        "G",
        "C",
        "cards/Storm-Emeralda-M6/001.jpg",
        "001",
        null,
      );

    let addCopyCalls = 0;
    function addOwnedIfCataloged(setId: number, setCardId: string): boolean {
      if (!setCardExists(setId, setCardId, catalog)) {
        return false;
      }
      addCopyCalls += 1;
      addCopy(setId, setCardId, ownership);
      return true;
    }

    assert.equal(addOwnedIfCataloged(1, "999"), false);
    assert.equal(addCopyCalls, 0);
    assert.equal(getCopies(1, "999", ownership), 0);
    assert.equal(countOwned(1, ownership), 0);

    assert.equal(addOwnedIfCataloged(1, "001"), true);
    assert.equal(addCopyCalls, 1);
    assert.equal(getCopies(1, "001", ownership), 1);
    catalog.close();
    ownership.close();
  });

  test("creates the parent directory for a file database and keeps memory databases isolated", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ownership-db-"));
    const dbPath = path.join(root, "nested", "data", "ownership.db");
    try {
      assert.equal(fs.existsSync(path.dirname(dbPath)), false);
      const fileDb = openOwnership(dbPath);
      assert.equal(fs.existsSync(dbPath), true);
      addCopy(4, "010", fileDb);
      assert.equal(getCopies(4, "010", fileDb), 1);
      fileDb.close();

      const memoryDb = openOwnership(":memory:");
      assert.equal(getCopies(4, "010", memoryDb), 0);
      memoryDb.close();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
