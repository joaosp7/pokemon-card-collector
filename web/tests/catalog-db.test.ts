import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type Database from "better-sqlite3";
import {
  findSetById,
  findSetBySlug,
  findSetCard,
  listSetCards,
  listSets,
  openCatalog,
  setCardExists,
  type Card,
} from "../lib/catalog-db";

function insertSet(
  db: Database.Database,
  slug: string,
  setCode: string,
  cardCount: number,
): number {
  const result = db
    .prepare(
      `INSERT INTO sets (
         set_code, name_pt, name_en, slug, source_url, logo_path, card_count
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      setCode,
      `Nome ${setCode}`,
      `Name ${setCode}`,
      slug,
      `https://example.test/${slug}`,
      `cards/${slug}/logo.png`,
      cardCount,
    );
  return Number(result.lastInsertRowid);
}

function insertCard(
  db: Database.Database,
  setId: number,
  setCardId: string,
  sortKey: string,
  rarityCode: string,
): void {
  db.prepare(
    `INSERT INTO set_cards (
       id, set_id, name_pt, name_en, element_code, rarity_code,
       image_path, sort_key, illustrator
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    setCardId,
    setId,
    `Carta ${setCardId}`,
    `Card ${setCardId}`,
    "W",
    rarityCode,
    `cards/set-${setId}/${setCardId}.jpg`,
    sortKey,
    "Ken Sugimori",
  );
}

describe("catalog database", () => {
  test("reads a set by slug and lists sets in slug order", () => {
    const db = openCatalog(":memory:");
    insertSet(db, "zeta-set-Z", "Z", 1);
    const stormId = insertSet(db, "Storm-Emeralda-M6", "M6", 113);
    insertSet(db, "alpha-set-A", "A", 2);

    const storm = findSetBySlug("Storm-Emeralda-M6", db);
    assert.ok(storm);
    assert.equal(storm.id, stormId);
    assert.equal(storm.setCode, "M6");
    assert.equal(storm.namePt, "Nome M6");
    assert.equal(storm.nameEn, "Name M6");
    assert.equal(storm.slug, "Storm-Emeralda-M6");
    assert.equal(storm.sourceUrl, "https://example.test/Storm-Emeralda-M6");
    assert.equal(storm.logoPath, "cards/Storm-Emeralda-M6/logo.png");
    assert.equal(storm.cardCount, 113);
    assert.equal(findSetBySlug("missing", db), null);

    assert.deepEqual(
      listSets(db).map((set) => set.slug),
      ["Storm-Emeralda-M6", "alpha-set-A", "zeta-set-Z"],
    );
    assert.deepEqual(findSetById(stormId, db), storm);
    assert.equal(findSetById(999, db), null);
    db.close();
  });

  test("reads cards in sort_key order, including when that differs from card id order", () => {
    const db = openCatalog(":memory:");
    const ligaId = insertSet(db, "Liga-Sort-M6", "M6", 3);
    insertCard(db, ligaId, "010", "010", "C");
    insertCard(db, ligaId, "001", "001", "U");
    insertCard(db, ligaId, "002", "002", "R");

    assert.deepEqual(
      listSetCards(ligaId, db).map((card) => card.setCardId),
      ["001", "002", "010"],
    );
    assert.deepEqual(
      listSetCards(ligaId, db).map((card) => card.sortKey),
      ["001", "002", "010"],
    );

    const customId = insertSet(db, "Custom-Sort-X", "X", 3);
    insertCard(db, customId, "001", "c", "C");
    insertCard(db, customId, "002", "b", "U");
    insertCard(db, customId, "010", "a", "R");

    const custom = listSetCards(customId, db);
    assert.deepEqual(
      custom.map((card) => card.setCardId),
      ["010", "002", "001"],
    );
    assert.deepEqual(
      custom.map((card) => card.sortKey),
      ["a", "b", "c"],
    );
    db.close();
  });

  test("reads card 001 from two sets as separate rows", () => {
    const db = openCatalog(":memory:");
    const setA = insertSet(db, "Set-A-AA", "AA", 1);
    const setB = insertSet(db, "Set-B-BB", "BB", 1);
    insertCard(db, setA, "001", "001", "R");
    db.prepare(
      `INSERT INTO set_cards (
         id, set_id, name_pt, name_en, element_code, rarity_code,
         image_path, sort_key, illustrator
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "001",
      setB,
      "Outra carta",
      "Other card",
      "R",
      "SR",
      "cards/Set-B-BB/001.jpg",
      "001",
      "Mitsuhiro Arita",
    );

    const cardsA = listSetCards(setA, db);
    const cardsB = listSetCards(setB, db);
    assert.deepEqual(
      cardsA.map((card) => card.setCardId),
      ["001"],
    );
    assert.deepEqual(
      cardsB.map((card) => card.setCardId),
      ["001"],
    );
    assert.equal(cardsA[0].setId, setA);
    assert.equal(cardsB[0].setId, setB);
    assert.equal(cardsA[0].nameEn, "Card 001");
    assert.equal(cardsB[0].nameEn, "Other card");
    assert.equal(setCardExists(setA, "001", db), true);
    assert.equal(setCardExists(setB, "001", db), true);
    assert.equal(setCardExists(setA, "002", db), false);
    db.close();
  });

  test("reads one card by set id and set card id", () => {
    const db = openCatalog(":memory:");
    const setId = insertSet(db, "Storm-Emeralda-M6", "M6", 2);
    insertCard(db, setId, "001", "001", "R");
    insertCard(db, setId, "018", "018", "SR");

    const card = findSetCard(setId, "018", db);
    assert.ok(card);
    assert.equal(card.setId, setId);
    assert.equal(card.setCardId, "018");
    assert.equal(card.namePt, "Carta 018");
    assert.equal(card.nameEn, "Card 018");
    assert.equal(card.elementCode, "W");
    assert.equal(card.imagePath, `cards/set-${setId}/018.jpg`);
    assert.equal(card.illustrator, "Ken Sugimori");
    assert.equal(findSetCard(setId, "999", db), null);
    assert.equal(findSetCard(setId + 1, "018", db), null);
    db.close();
  });

  test("returned cards include rarityCode and sortKey and omit cardKind", () => {
    const db = openCatalog(":memory:");
    const setId = insertSet(db, "Storm-Emeralda-M6", "M6", 1);
    insertCard(db, setId, "001", "001", "RR");

    const card = findSetCard(setId, "001", db);
    assert.ok(card);
    assert.equal(card.rarityCode, "RR");
    assert.equal(card.sortKey, "001");
    assert.equal(Object.hasOwn(card, "cardKind"), false);
    assert.equal(Object.hasOwn(card, "rarityCode"), true);
    assert.equal(Object.hasOwn(card, "sortKey"), true);

    const listed = listSetCards(setId, db)[0];
    assert.equal(listed.rarityCode, "RR");
    assert.equal(listed.sortKey, "001");
    assert.equal(Object.hasOwn(listed, "cardKind"), false);

    const keys: (keyof Card)[] = [
      "setId",
      "setCardId",
      "namePt",
      "nameEn",
      "elementCode",
      "rarityCode",
      "imagePath",
      "sortKey",
      "illustrator",
    ];
    assert.deepEqual(Object.keys(card).sort(), [...keys].sort());
    db.close();
  });
});
