import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type Database from "better-sqlite3";
import { addCopyAction, removeCopyAction } from "../app/actions";
import type { Card } from "../lib/catalog";
import { openCatalog } from "../lib/catalog-db";
import { filterCards } from "../lib/filter";
import { setOwnershipActionContextForTests } from "../lib/ownership-action-context";
import { getCopies, getOwnedMap, openOwnership } from "../lib/ownership-db";

const SLUG_A = "Set-A-SA";
const SLUG_B = "Set-B-SB";

type Fixture = {
  catalog: Database.Database;
  ownership: Database.Database;
  setA: number;
  setB: number;
  paths: string[];
  close: () => void;
};

function insertSet(
  catalog: Database.Database,
  setCode: string,
  slug: string,
): number {
  const result = catalog
    .prepare(
      `INSERT INTO sets (
         set_code, name_pt, name_en, slug, source_url, logo_path, card_count
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(setCode, setCode, setCode, slug, `https://example.test/${slug}`, null, 2);
  return Number(result.lastInsertRowid);
}

function insertCard(
  catalog: Database.Database,
  setId: number,
  setCardId: string,
): void {
  catalog
    .prepare(
      `INSERT INTO set_cards (
         id, set_id, name_pt, name_en, element_code, rarity_code,
         image_path, sort_key, illustrator
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      setCardId,
      setId,
      `Carta ${setCardId}`,
      `Card ${setCardId}`,
      "G",
      "C",
      `cards/set-${setId}/${setCardId}.jpg`,
      setCardId,
      null,
    );
}

function openFixture(): Fixture {
  const catalog = openCatalog(":memory:");
  const ownership = openOwnership(":memory:");
  const setA = insertSet(catalog, "SA", SLUG_A);
  const setB = insertSet(catalog, "SB", SLUG_B);
  insertCard(catalog, setA, "001");
  insertCard(catalog, setA, "002");
  insertCard(catalog, setB, "001");
  const paths: string[] = [];
  return {
    catalog,
    ownership,
    setA,
    setB,
    paths,
    close() {
      setOwnershipActionContextForTests(undefined);
      catalog.close();
      ownership.close();
    },
  };
}

function useFixture(fixture: Fixture): void {
  setOwnershipActionContextForTests({
    catalog: fixture.catalog,
    ownership: fixture.ownership,
    revalidate(path: string) {
      fixture.paths.push(path);
    },
  });
}

function ownedRows(
  ownership: Database.Database,
): { set_id: number; set_card_id: string; copies: number }[] {
  return ownership
    .prepare(
      `SELECT set_id, set_card_id, copies FROM owned_cards
       ORDER BY set_id, set_card_id`,
    )
    .all() as { set_id: number; set_card_id: string; copies: number }[];
}

function catalogOwnedTable(catalog: Database.Database): string | undefined {
  const row = catalog
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name = 'owned_cards'`,
    )
    .get() as { name: string } | undefined;
  return row?.name;
}

function binderCard(setId: number, setCardId: string): Card {
  return {
    setId,
    setCardId,
    name: `Card ${setCardId}`,
    element: null,
    rarityCode: null,
    illustrator: null,
    imagePath: `cards/set-${setId}/${setCardId}.jpg`,
    sortKey: setCardId,
  };
}

describe("ownership actions", { concurrency: false }, () => {
  test("add a copy from zero creates (set_id, set_card_id) with copies=1", async () => {
    const fixture = openFixture();
    try {
      assert.equal(getCopies(fixture.setA, "001", fixture.ownership), 0);
      useFixture(fixture);
      await addCopyAction(SLUG_A, fixture.setA, "001");
      assert.deepEqual(ownedRows(fixture.ownership), [
        { set_id: fixture.setA, set_card_id: "001", copies: 1 },
      ]);
      assert.equal(catalogOwnedTable(fixture.catalog), undefined);
    } finally {
      fixture.close();
    }
  });

  test("add twice increments to two", async () => {
    const fixture = openFixture();
    try {
      useFixture(fixture);
      await addCopyAction(SLUG_A, fixture.setA, "001");
      await addCopyAction(SLUG_A, fixture.setA, "001");
      assert.equal(getCopies(fixture.setA, "001", fixture.ownership), 2);
      assert.deepEqual(ownedRows(fixture.ownership), [
        { set_id: fixture.setA, set_card_id: "001", copies: 2 },
      ]);
    } finally {
      fixture.close();
    }
  });

  test("remove from two decrements to one", async () => {
    const fixture = openFixture();
    try {
      useFixture(fixture);
      await addCopyAction(SLUG_A, fixture.setA, "001");
      await addCopyAction(SLUG_A, fixture.setA, "001");
      await removeCopyAction(SLUG_A, fixture.setA, "001");
      assert.equal(getCopies(fixture.setA, "001", fixture.ownership), 1);
      assert.deepEqual(ownedRows(fixture.ownership), [
        { set_id: fixture.setA, set_card_id: "001", copies: 1 },
      ]);
    } finally {
      fixture.close();
    }
  });

  test("remove from one deletes the row", async () => {
    const fixture = openFixture();
    try {
      useFixture(fixture);
      await addCopyAction(SLUG_A, fixture.setA, "001");
      await removeCopyAction(SLUG_A, fixture.setA, "001");
      assert.equal(getCopies(fixture.setA, "001", fixture.ownership), 0);
      assert.deepEqual(ownedRows(fixture.ownership), []);
    } finally {
      fixture.close();
    }
  });

  test("remove from zero is a no-op", async () => {
    const fixture = openFixture();
    try {
      useFixture(fixture);
      await removeCopyAction(SLUG_A, fixture.setA, "001");
      assert.equal(getCopies(fixture.setA, "001", fixture.ownership), 0);
      assert.deepEqual(ownedRows(fixture.ownership), []);
    } finally {
      fixture.close();
    }
  });

  test("unknown set/card pairs do not write ownership", async () => {
    const fixture = openFixture();
    try {
      useFixture(fixture);
      await addCopyAction(SLUG_A, fixture.setA, "999");
      await addCopyAction(SLUG_A, 999, "001");
      await addCopyAction(SLUG_B, fixture.setA, "001");
      await addCopyAction("not a slug", fixture.setA, "001");
      await removeCopyAction(SLUG_A, fixture.setA, "999");
      await removeCopyAction("Set-A-SA/../x", fixture.setB, "001");
      assert.deepEqual(ownedRows(fixture.ownership), []);
      assert.deepEqual(fixture.paths, []);
      assert.equal(catalogOwnedTable(fixture.catalog), undefined);
    } finally {
      fixture.close();
    }
  });

  test("set A card 001 and set B card 001 remain independent", async () => {
    const fixture = openFixture();
    try {
      useFixture(fixture);
      await addCopyAction(SLUG_A, fixture.setA, "001");
      await addCopyAction(SLUG_A, fixture.setA, "001");
      await addCopyAction(SLUG_B, fixture.setB, "001");
      await removeCopyAction(SLUG_A, fixture.setA, "001");
      assert.equal(getCopies(fixture.setA, "001", fixture.ownership), 1);
      assert.equal(getCopies(fixture.setB, "001", fixture.ownership), 1);
      assert.deepEqual(ownedRows(fixture.ownership), [
        { set_id: fixture.setA, set_card_id: "001", copies: 1 },
        { set_id: fixture.setB, set_card_id: "001", copies: 1 },
      ]);

      await removeCopyAction(SLUG_B, fixture.setB, "001");
      assert.equal(getCopies(fixture.setA, "001", fixture.ownership), 1);
      assert.equal(getCopies(fixture.setB, "001", fixture.ownership), 0);
    } finally {
      fixture.close();
    }
  });

  test("missing cards appear in the Missing filter", async () => {
    const fixture = openFixture();
    try {
      useFixture(fixture);
      await addCopyAction(SLUG_A, fixture.setA, "002");
      const cards = [
        binderCard(fixture.setA, "001"),
        binderCard(fixture.setA, "002"),
      ];
      const owned = getOwnedMap(fixture.setA, fixture.ownership);
      assert.deepEqual(
        filterCards(cards, owned, "missing").map((card) => card.setCardId),
        ["001"],
      );
    } finally {
      fixture.close();
    }
  });

  test("owned cards appear in the Owned filter", async () => {
    const fixture = openFixture();
    try {
      useFixture(fixture);
      await addCopyAction(SLUG_A, fixture.setA, "001");
      await addCopyAction(SLUG_B, fixture.setB, "001");
      const cardsA = [
        binderCard(fixture.setA, "001"),
        binderCard(fixture.setA, "002"),
      ];
      const ownedA = getOwnedMap(fixture.setA, fixture.ownership);
      assert.deepEqual(
        filterCards(cardsA, ownedA, "owned").map((card) => card.setCardId),
        ["001"],
      );

      const cardsB = [binderCard(fixture.setB, "001")];
      const ownedB = getOwnedMap(fixture.setB, fixture.ownership);
      assert.deepEqual(
        filterCards(cardsB, ownedB, "owned").map((card) => card.setCardId),
        ["001"],
      );
      assert.equal(ownedA.get("001"), 1);
      assert.equal(ownedB.get("001"), 1);
      assert.equal(ownedA.has("002"), false);
    } finally {
      fixture.close();
    }
  });

  test("server actions revalidate the expected paths", async () => {
    const fixture = openFixture();
    try {
      useFixture(fixture);
      await addCopyAction(SLUG_A, fixture.setA, "001");
      assert.deepEqual(fixture.paths, ["/", `/collections/${SLUG_A}`]);

      await removeCopyAction(SLUG_A, fixture.setA, "001");
      assert.deepEqual(fixture.paths, [
        "/",
        `/collections/${SLUG_A}`,
        "/",
        `/collections/${SLUG_A}`,
      ]);

      fixture.paths.length = 0;
      await addCopyAction(SLUG_B, fixture.setB, "001");
      await removeCopyAction(SLUG_B, fixture.setB, "001");
      assert.deepEqual(fixture.paths, [
        "/",
        `/collections/${SLUG_B}`,
        "/",
        `/collections/${SLUG_B}`,
      ]);
    } finally {
      fixture.close();
    }
  });
});
