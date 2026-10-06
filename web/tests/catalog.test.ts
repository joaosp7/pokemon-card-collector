import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type Database from "better-sqlite3";
import { openCatalog } from "../lib/catalog-db";
import {
  imageBasename,
  isValidSlug,
  listCards,
  listCollections,
  loadCollectionPage,
  storedLogoFilename,
  type Card,
} from "../lib/catalog";

type NoCardKind = "cardKind" extends keyof Card ? never : true;
const cardTypeOmitsCardKind: NoCardKind = true;

function insertSet(
  db: Database.Database,
  slug: string,
  setCode: string,
  namePt: string | null,
  nameEn: string | null,
  logoPath: string | null = null,
): number {
  const result = db
    .prepare(
      `INSERT INTO sets (
         set_code, name_pt, name_en, slug, source_url, logo_path, card_count
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      setCode,
      namePt,
      nameEn,
      slug,
      `https://example.test/${slug}`,
      logoPath,
      0,
    );
  return Number(result.lastInsertRowid);
}

function insertCard(
  db: Database.Database,
  setId: number,
  setCardId: string,
  options: {
    namePt?: string | null;
    nameEn?: string | null;
    elementCode?: string | null;
    rarityCode?: string | null;
    imagePath?: string;
    sortKey?: string;
    illustrator?: string | null;
  } = {},
): void {
  db.prepare(
    `INSERT INTO set_cards (
       id, set_id, name_pt, name_en, element_code, rarity_code,
       image_path, sort_key, illustrator
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    setCardId,
    setId,
    options.namePt === undefined ? `Carta ${setCardId}` : options.namePt,
    options.nameEn === undefined ? `Card ${setCardId}` : options.nameEn,
    options.elementCode === undefined ? "W" : options.elementCode,
    options.rarityCode === undefined ? "C" : options.rarityCode,
    options.imagePath ?? `cards/set-${setId}/${setCardId}_Wrong Name.jpg`,
    options.sortKey ?? setCardId,
    options.illustrator === undefined ? "Ken Sugimori" : options.illustrator,
  );
}

describe("listCollections", () => {
  test("returns rows from a temporary catalog database", () => {
    const db = openCatalog(":memory:");
    const stormId = insertSet(
      db,
      "Storm-Emeralda-M6",
      "M6",
      "Storm Emeralda",
      "Storm Emeralda",
      "cards/Storm-Emeralda-M6/logo.png",
    );
    insertCard(db, stormId, "001", { sortKey: "001" });
    const celebId = insertSet(
      db,
      "Celebracao-de-30-Anos-30C",
      "30C",
      "Celebracao de 30 Anos",
      "30th Celebration",
    );
    insertCard(db, celebId, "001", { sortKey: "001" });

    const collections = listCollections(db);
    assert.deepEqual(
      collections.map((collection) => ({
        slug: collection.slug,
        title: collection.title,
        setCode: collection.setCode,
      })),
      [
        {
          slug: "Celebracao-de-30-Anos-30C",
          title: "Celebracao de 30 Anos",
          setCode: "30C",
        },
        {
          slug: "Storm-Emeralda-M6",
          title: "Storm Emeralda",
          setCode: "M6",
        },
      ],
    );
    assert.equal(collections[1]?.id, stormId);
  });

  test("reflects a title and code change without renaming files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pokemon-catalog-"));
    try {
      const db = openCatalog(":memory:");
      const setId = insertSet(
        db,
        "Storm-Emeralda-M6",
        "M6",
        "Storm Emeralda",
        "Storm Emeralda",
      );
      const imageName = "001_Old Filename.jpg";
      const imageDir = path.join(root, "cards", "Storm-Emeralda-M6");
      await mkdir(imageDir, { recursive: true });
      await writeFile(path.join(imageDir, imageName), "front");
      insertCard(db, setId, "001", {
        imagePath: `cards/Storm-Emeralda-M6/${imageName}`,
        sortKey: "001",
      });

      db.prepare(
        `UPDATE sets SET name_pt = ?, set_code = ? WHERE id = ?`,
      ).run("Tempestade Esmeralda", "ME1", setId);

      const [collection] = listCollections(db);
      assert.equal(collection?.title, "Tempestade Esmeralda");
      assert.equal(collection?.setCode, "ME1");
      assert.equal(collection?.slug, "Storm-Emeralda-M6");
      assert.equal(
        await readFile(path.join(imageDir, imageName), "utf8"),
        "front",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("listCards", () => {
  test("reads sqlite metadata when the filename would parse differently", () => {
    const db = openCatalog(":memory:");
    const setId = insertSet(db, "Storm-Emeralda-M6", "M6", "Storm Emeralda", null);
    insertCard(db, setId, "132", {
      namePt: "Articuno",
      nameEn: "Articuno",
      elementCode: "W",
      rarityCode: "RR",
      imagePath: "cards/Storm-Emeralda-M6/132_Wrong Name.jpg",
      sortKey: "132",
      illustrator: "Mitsuhiro Arita",
    });
    insertCard(db, setId, "050", {
      namePt: null,
      nameEn: "Type: Null",
      elementCode: "N",
      rarityCode: "U",
      imagePath: "cards/Storm-Emeralda-M6/050_Type_ Null.jpg",
      sortKey: "050",
      illustrator: null,
    });

    const cards = listCards(setId, db);
    const articuno = cards.find((card) => card.setCardId === "132");
    assert.ok(articuno);
    assert.equal(articuno.name, "Articuno");
    assert.equal(articuno.element, "Água");
    assert.equal(articuno.rarityCode, "RR");
    assert.equal(articuno.illustrator, "Mitsuhiro Arita");
    assert.equal(
      articuno.imagePath,
      "cards/Storm-Emeralda-M6/132_Wrong Name.jpg",
    );
    assert.equal(imageBasename(articuno.imagePath), "132_Wrong Name.jpg");
    assert.equal(articuno.name.includes("Wrong Name"), false);

    const typeNull = cards.find((card) => card.setCardId === "050");
    assert.equal(typeNull?.name, "Type: Null");
    assert.equal(typeNull?.element, "desconhecido");
  });

  test("orders cards by sort_key", () => {
    const db = openCatalog(":memory:");
    const setId = insertSet(db, "Storm-Emeralda-M6", "M6", "Storm Emeralda", null);
    insertCard(db, setId, "010", { sortKey: "010", namePt: "Ten" });
    insertCard(db, setId, "002", { sortKey: "002", namePt: "Two" });
    insertCard(db, setId, "001", { sortKey: "001", namePt: "One" });

    assert.deepEqual(
      listCards(setId, db).map((card) => card.sortKey),
      ["001", "002", "010"],
    );
  });

  test("orders by sort_key when that differs from card id", () => {
    const db = openCatalog(":memory:");
    const setId = insertSet(db, "Storm-Emeralda-M6", "M6", "Storm Emeralda", null);
    insertCard(db, setId, "010", { sortKey: "002" });
    insertCard(db, setId, "002", { sortKey: "010" });
    insertCard(db, setId, "001", { sortKey: "001" });

    assert.deepEqual(
      listCards(setId, db).map((card) => card.setCardId),
      ["001", "010", "002"],
    );
  });

  test("exposes rarityCode and omits cardKind", () => {
    const db = openCatalog(":memory:");
    const setId = insertSet(db, "Storm-Emeralda-M6", "M6", "Storm Emeralda", null);
    insertCard(db, setId, "001", { rarityCode: "SIR", sortKey: "001" });

    const [card] = listCards(setId, db);
    assert.ok(card);
    assert.equal(card.rarityCode, "SIR");
    assert.equal("cardKind" in card, false);
    assert.equal(cardTypeOmitsCardKind, true);
  });

  test("keeps card 001 independent across two sets", () => {
    const db = openCatalog(":memory:");
    const stormId = insertSet(
      db,
      "Storm-Emeralda-M6",
      "M6",
      "Storm Emeralda",
      null,
    );
    const celebId = insertSet(
      db,
      "Celebracao-de-30-Anos-30C",
      "30C",
      "Celebracao de 30 Anos",
      null,
    );
    insertCard(db, stormId, "001", {
      namePt: "Heracross",
      elementCode: "G",
      sortKey: "001",
      imagePath: "cards/Storm-Emeralda-M6/001_Heracross.jpg",
    });
    insertCard(db, celebId, "001", {
      namePt: "Pikachu",
      elementCode: "L",
      sortKey: "001",
      imagePath: "cards/Celebracao-de-30-Anos-30C/001_Pikachu.jpg",
    });

    const storm = loadCollectionPage("Storm-Emeralda-M6", db);
    const celeb = loadCollectionPage("Celebracao-de-30-Anos-30C", db);
    assert.ok(storm);
    assert.ok(celeb);
    assert.equal(storm.cards.length, 1);
    assert.equal(celeb.cards.length, 1);
    assert.equal(storm.cards[0]?.setCardId, "001");
    assert.equal(celeb.cards[0]?.setCardId, "001");
    assert.equal(storm.cards[0]?.name, "Heracross");
    assert.equal(celeb.cards[0]?.name, "Pikachu");
    assert.equal(storm.cards[0]?.element, "Planta");
    assert.equal(celeb.cards[0]?.element, "Elétrico");
    assert.equal(storm.collection.setCode, "M6");
    assert.equal(celeb.collection.setCode, "30C");
    assert.notEqual(storm.collection.id, celeb.collection.id);
  });
});

describe("loadCollectionPage", () => {
  test("missing set slug is not found", () => {
    const db = openCatalog(":memory:");
    insertSet(db, "Storm-Emeralda-M6", "M6", "Storm Emeralda", null);
    assert.equal(loadCollectionPage("Missing-Set-XX", db), null);
    assert.equal(loadCollectionPage("../etc", db), null);
    assert.equal(loadCollectionPage("foo/bar", db), null);
    assert.equal(loadCollectionPage("has_underscore", db), null);
  });

  test("a set with no cards is not found", () => {
    const db = openCatalog(":memory:");
    insertSet(db, "Empty-Set-E0", "E0", "Empty", "Empty");
    assert.equal(loadCollectionPage("Empty-Set-E0", db), null);
  });

  test("uses the Portuguese set name when it is present", () => {
    const db = openCatalog(":memory:");
    const setId = insertSet(
      db,
      "Storm-Emeralda-M6",
      "M6",
      "Tempestade",
      "Storm Emeralda",
    );
    insertCard(db, setId, "001", { sortKey: "001" });
    const page = loadCollectionPage("Storm-Emeralda-M6", db);
    assert.equal(page?.collection.title, "Tempestade");
    assert.equal(page?.collection.setCode, "M6");
  });

  test("falls back to the English set name", () => {
    const db = openCatalog(":memory:");
    const setId = insertSet(db, "Storm-Emeralda-M6", "M6", null, "Storm Emeralda");
    insertCard(db, setId, "009", {
      namePt: "  ",
      nameEn: "Mega Golisopod ex",
      elementCode: "G",
      sortKey: "009",
    });
    const page = loadCollectionPage("Storm-Emeralda-M6", db);
    assert.equal(page?.collection.title, "Storm Emeralda");
    assert.equal(page?.cards[0]?.name, "Mega Golisopod ex");
    assert.equal(page?.cards[0]?.element, "Planta");
  });
});

describe("isValidSlug", () => {
  test("rejects path traversal and underscores", () => {
    assert.equal(isValidSlug("Storm-Emeralda-M6"), true);
    assert.equal(isValidSlug("../etc"), false);
    assert.equal(isValidSlug("foo/bar"), false);
    assert.equal(isValidSlug("has_underscore"), false);
  });
});

describe("storedLogoFilename", () => {
  test("returns a stored logo basename only when that file exists", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pokemon-logos-"));
    try {
      const cases = ["logo.png", "logo.webp", "logo.jpg", "logo.jpeg"] as const;
      for (const filename of cases) {
        const slug = filename.replace(".", "-");
        const dir = path.join(root, "cards", slug);
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, filename), filename);
        assert.equal(
          storedLogoFilename(`cards/${slug}/${filename}`, root),
          filename,
        );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("skips a missing or empty logo so the set-code badge is used", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pokemon-logos-"));
    try {
      const emptyDir = path.join(root, "cards", "Empty-Logo-E1");
      await mkdir(emptyDir, { recursive: true });
      await writeFile(path.join(emptyDir, "logo.png"), "");
      await writeFile(path.join(emptyDir, "001_Heracross.jpg"), "front");

      assert.equal(storedLogoFilename("cards/Empty-Logo-E1/logo.png", root), null);
      assert.equal(
        storedLogoFilename("cards/Empty-Logo-E1/001_Heracross.jpg", root),
        null,
      );
      assert.equal(storedLogoFilename("cards/Missing-Logo-M1/logo.webp", root), null);
      assert.equal(storedLogoFilename(null, root), null);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
