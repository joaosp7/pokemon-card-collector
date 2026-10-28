import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type Database from "better-sqlite3";
import { deleteSetAction } from "../app/actions";
import { deleteSetBySlug, findSetBySlug, listSetCards, openCatalog } from "../lib/catalog-db";
import { removeSetImageDirectory } from "../lib/delete-set-files";
import {
  isDownloadLocked,
  releaseDownloadLock,
  resetDownloadLockForTests,
  tryAcquireDownloadLock,
} from "../lib/download-collection";
import { setOwnershipActionContextForTests } from "../lib/ownership-action-context";
import {
  addCopy,
  deleteOwnedForSet,
  getCopies,
  openOwnership,
  summarizeOwnership,
} from "../lib/ownership-db";

const SLUG_A = "Storm-Emeralda-M6";
const SLUG_B = "Celebracao-de-30-Anos-30C";

type Fixture = {
  catalog: Database.Database;
  ownership: Database.Database;
  setA: number;
  setB: number;
  paths: string[];
  root?: string;
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
    .run(
      setCode,
      `Nome ${setCode}`,
      `Name ${setCode}`,
      slug,
      `https://example.test/${slug}`,
      `cards/${slug}/logo.png`,
      2,
    );
  return Number(result.lastInsertRowid);
}

function insertCard(
  catalog: Database.Database,
  setId: number,
  slug: string,
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
      `cards/${slug}/${setCardId}.jpg`,
      setCardId,
      null,
    );
}

function openFixture(): Fixture {
  const catalog = openCatalog(":memory:");
  const ownership = openOwnership(":memory:");
  const setA = insertSet(catalog, "M6", SLUG_A);
  const setB = insertSet(catalog, "30C", SLUG_B);
  insertCard(catalog, setA, SLUG_A, "001");
  insertCard(catalog, setA, SLUG_A, "002");
  insertCard(catalog, setB, SLUG_B, "001");
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

function useFixture(fixture: Fixture, root?: string): void {
  fixture.root = root;
  setOwnershipActionContextForTests({
    catalog: fixture.catalog,
    ownership: fixture.ownership,
    root,
    revalidate(nextPath: string) {
      fixture.paths.push(nextPath);
    },
  });
}

function setRows(catalog: Database.Database): string[] {
  return (
    catalog.prepare(`SELECT slug FROM sets ORDER BY slug`).all() as {
      slug: string;
    }[]
  ).map((row) => row.slug);
}

function cardRows(
  catalog: Database.Database,
): { set_id: number; id: string }[] {
  return catalog
    .prepare(`SELECT set_id, id FROM set_cards ORDER BY set_id, id`)
    .all() as { set_id: number; id: string }[];
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

async function writeSetDir(root: string, slug: string): Promise<void> {
  const dir = path.join(root, "cards", slug);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "001.jpg"), `${slug}-card`);
  await writeFile(path.join(dir, "logo.png"), `${slug}-logo`);
}

describe("delete set", { concurrency: false }, () => {
  test("deleting one set removes its rows and leaves the other set intact", () => {
    const fixture = openFixture();
    try {
      addCopy(fixture.setA, "001", fixture.ownership);
      addCopy(fixture.setA, "001", fixture.ownership);
      addCopy(fixture.setA, "002", fixture.ownership);
      addCopy(fixture.setB, "001", fixture.ownership);
      addCopy(fixture.setB, "001", fixture.ownership);
      addCopy(fixture.setB, "001", fixture.ownership);
      addCopy(fixture.setB, "001", fixture.ownership);

      assert.deepEqual(summarizeOwnership(fixture.setA, fixture.ownership), {
        cards: 2,
        copies: 3,
      });
      assert.deepEqual(summarizeOwnership(fixture.setB, fixture.ownership), {
        cards: 1,
        copies: 4,
      });
      assert.deepEqual(summarizeOwnership(999, fixture.ownership), {
        cards: 0,
        copies: 0,
      });

      assert.equal(deleteOwnedForSet(fixture.setA, fixture.ownership), 2);
      assert.deepEqual(ownedRows(fixture.ownership), [
        { set_id: fixture.setB, set_card_id: "001", copies: 4 },
      ]);
      assert.equal(getCopies(fixture.setB, "001", fixture.ownership), 4);

      const removed = deleteSetBySlug(SLUG_A, fixture.catalog);
      assert.ok(removed);
      assert.equal(removed.slug, SLUG_A);
      assert.equal(removed.id, fixture.setA);
      assert.equal(removed.setCode, "M6");
      assert.equal(findSetBySlug(SLUG_A, fixture.catalog), null);
      assert.deepEqual(setRows(fixture.catalog), [SLUG_B]);
      assert.deepEqual(cardRows(fixture.catalog), [
        { set_id: fixture.setB, id: "001" },
      ]);
      assert.equal(listSetCards(fixture.setB, fixture.catalog).length, 1);
      assert.equal(deleteSetBySlug(SLUG_A, fixture.catalog), null);
      assert.deepEqual(ownedRows(fixture.ownership), [
        { set_id: fixture.setB, set_card_id: "001", copies: 4 },
      ]);
    } finally {
      fixture.close();
    }
  });

  test("image deletion removes that set folder and leaves the sibling", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pokemon-delete-set-"));
    try {
      await writeSetDir(root, SLUG_A);
      await writeSetDir(root, SLUG_B);
      await writeFile(path.join(root, "cards", SLUG_A, "002.jpg"), "extra");

      removeSetImageDirectory(root, SLUG_A);

      assert.equal(fs.existsSync(path.join(root, "cards", SLUG_A)), false);
      assert.equal(
        fs.readFileSync(path.join(root, "cards", SLUG_B, "001.jpg"), "utf8"),
        `${SLUG_B}-card`,
      );
      assert.equal(
        fs.readFileSync(path.join(root, "cards", SLUG_B, "logo.png"), "utf8"),
        `${SLUG_B}-logo`,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("invalid slugs, parent segments, and symlinks are not deleted", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pokemon-delete-set-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "pokemon-delete-outside-"));
    const parentSecret = path.join(path.dirname(root), "delete-set-parent-secret.txt");
    try {
      await writeFile(path.join(root, "secret.txt"), "root-secret");
      await writeFile(parentSecret, "parent-secret");
      await writeSetDir(root, SLUG_B);
      await mkdir(path.join(outside, SLUG_A), { recursive: true });
      await writeFile(path.join(outside, SLUG_A, "001.jpg"), "outside-card");
      await writeFile(path.join(outside, SLUG_A, "logo.png"), "outside-logo");
      await symlink(path.join(outside, SLUG_A), path.join(root, "cards", SLUG_A));

      assert.equal(removeSetImageDirectory(root, ".."), "refused");
      assert.equal(removeSetImageDirectory(root, "../.."), "refused");
      assert.equal(removeSetImageDirectory(root, "foo/../../secret"), "refused");
      assert.equal(removeSetImageDirectory(root, `${SLUG_B}/../${SLUG_A}`), "refused");
      assert.equal(removeSetImageDirectory(root, ""), "refused");
      assert.equal(removeSetImageDirectory(root, "not a slug"), "refused");
      assert.equal(removeSetImageDirectory(root, SLUG_A), "refused");

      assert.equal(fs.readFileSync(path.join(root, "secret.txt"), "utf8"), "root-secret");
      assert.equal(fs.readFileSync(parentSecret, "utf8"), "parent-secret");
      assert.equal(
        fs.readFileSync(path.join(outside, SLUG_A, "001.jpg"), "utf8"),
        "outside-card",
      );
      assert.equal(
        fs.readFileSync(path.join(outside, SLUG_A, "logo.png"), "utf8"),
        "outside-logo",
      );
      assert.equal(fs.lstatSync(path.join(root, "cards", SLUG_A)).isSymbolicLink(), true);
      assert.equal(
        fs.readFileSync(path.join(root, "cards", SLUG_B, "logo.png"), "utf8"),
        `${SLUG_B}-logo`,
      );

      const cardsLinkRoot = path.join(root, "linked-repo");
      await mkdir(cardsLinkRoot);
      await symlink(outside, path.join(cardsLinkRoot, "cards"));
      assert.equal(removeSetImageDirectory(cardsLinkRoot, SLUG_A), "refused");
      assert.equal(
        fs.readFileSync(path.join(outside, SLUG_A, "001.jpg"), "utf8"),
        "outside-card",
      );
      assert.equal(fs.lstatSync(path.join(cardsLinkRoot, "cards")).isSymbolicLink(), true);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
      await rm(parentSecret, { force: true });
    }
  });

  test("a missing folder does not throw", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pokemon-delete-set-"));
    try {
      assert.doesNotThrow(() => removeSetImageDirectory(root, SLUG_A));
      await mkdir(path.join(root, "cards"), { recursive: true });
      assert.doesNotThrow(() => removeSetImageDirectory(root, SLUG_A));
      assert.equal(fs.existsSync(path.join(root, "cards")), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("deleteSetAction revalidates, rejects an unknown slug, and removes files under the injected root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pokemon-delete-set-"));
    const fixture = openFixture();
    try {
      await writeSetDir(root, SLUG_A);
      await writeSetDir(root, SLUG_B);
      await writeSetDir(root, "Missing-Folder-Set");
      await writeFile(path.join(root, "keep.txt"), "keep");
      addCopy(fixture.setA, "001", fixture.ownership);
      addCopy(fixture.setA, "001", fixture.ownership);
      addCopy(fixture.setA, "002", fixture.ownership);
      addCopy(fixture.setB, "001", fixture.ownership);
      useFixture(fixture, root);

      const deleted = await deleteSetAction(SLUG_A);
      assert.deepEqual(deleted, { ok: true });
      assert.deepEqual(fixture.paths, ["/", `/collections/${SLUG_A}`]);
      assert.equal(findSetBySlug(SLUG_A, fixture.catalog), null);
      assert.deepEqual(cardRows(fixture.catalog), [
        { set_id: fixture.setB, id: "001" },
      ]);
      assert.deepEqual(ownedRows(fixture.ownership), [
        { set_id: fixture.setB, set_card_id: "001", copies: 1 },
      ]);
      assert.equal(fs.existsSync(path.join(root, "cards", SLUG_A)), false);
      assert.equal(
        fs.readFileSync(path.join(root, "cards", SLUG_B, "001.jpg"), "utf8"),
        `${SLUG_B}-card`,
      );
      assert.equal(
        fs.readFileSync(path.join(root, "cards", SLUG_B, "logo.png"), "utf8"),
        `${SLUG_B}-logo`,
      );

      const unknown = await deleteSetAction("Missing-Folder-Set");
      assert.deepEqual(unknown, { ok: false, error: "This set is gone." });
      assert.equal(
        fs.readFileSync(
          path.join(root, "cards", "Missing-Folder-Set", "001.jpg"),
          "utf8",
        ),
        "Missing-Folder-Set-card",
      );
      assert.equal(
        fs.readFileSync(path.join(root, "cards", SLUG_B, "logo.png"), "utf8"),
        `${SLUG_B}-logo`,
      );
      assert.deepEqual(setRows(fixture.catalog), [SLUG_B]);
      assert.deepEqual(fixture.paths, ["/", `/collections/${SLUG_A}`]);

      const invalid = await deleteSetAction("..");
      assert.deepEqual(invalid, { ok: false, error: "This set is gone." });
      assert.equal(fs.readFileSync(path.join(root, "keep.txt"), "utf8"), "keep");
      assert.equal(fs.existsSync(path.join(root, "cards", SLUG_B)), true);

      const noFolder = insertSet(fixture.catalog, "NF", "No-Folder-NF");
      insertCard(fixture.catalog, noFolder, "No-Folder-NF", "001");
      addCopy(noFolder, "001", fixture.ownership);
      const removedWithoutFiles = await deleteSetAction("No-Folder-NF");
      assert.deepEqual(removedWithoutFiles, { ok: true });
      assert.equal(findSetBySlug("No-Folder-NF", fixture.catalog), null);
      assert.equal(getCopies(noFolder, "001", fixture.ownership), 0);
      assert.equal(getCopies(fixture.setB, "001", fixture.ownership), 1);
      assert.deepEqual(fixture.paths.slice(-2), [
        "/",
        "/collections/No-Folder-NF",
      ]);
    } finally {
      fixture.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a catalog failure puts the image folder and ownership rows back", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pokemon-delete-set-"));
    const fixture = openFixture();
    try {
      await writeSetDir(root, SLUG_A);
      await writeSetDir(root, SLUG_B);
      addCopy(fixture.setA, "001", fixture.ownership);
      addCopy(fixture.setA, "001", fixture.ownership);
      addCopy(fixture.setB, "001", fixture.ownership);
      fixture.catalog.exec(
        `CREATE TRIGGER fail_delete_set
         BEFORE DELETE ON sets
         BEGIN
           SELECT RAISE(ABORT, 'catalog delete failed');
         END`,
      );
      useFixture(fixture, root);

      const result = await deleteSetAction(SLUG_A);
      assert.deepEqual(result, {
        ok: false,
        error: "Could not delete this set.",
      });
      assert.equal(findSetBySlug(SLUG_A, fixture.catalog)?.id, fixture.setA);
      assert.deepEqual(cardRows(fixture.catalog), [
        { set_id: fixture.setA, id: "001" },
        { set_id: fixture.setA, id: "002" },
        { set_id: fixture.setB, id: "001" },
      ]);
      assert.deepEqual(ownedRows(fixture.ownership), [
        { set_id: fixture.setA, set_card_id: "001", copies: 2 },
        { set_id: fixture.setB, set_card_id: "001", copies: 1 },
      ]);
      assert.equal(
        fs.readFileSync(path.join(root, "cards", SLUG_A, "001.jpg"), "utf8"),
        `${SLUG_A}-card`,
      );
      assert.equal(
        fs.readFileSync(path.join(root, "cards", SLUG_A, "logo.png"), "utf8"),
        `${SLUG_A}-logo`,
      );
      assert.equal(
        fs.readFileSync(path.join(root, "cards", SLUG_B, "logo.png"), "utf8"),
        `${SLUG_B}-logo`,
      );
      const parked = fs
        .readdirSync(path.join(root, "cards"))
        .filter((name) => name.startsWith("."));
      assert.deepEqual(parked, []);
      assert.deepEqual(fixture.paths, []);
    } finally {
      fixture.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a symlinked set folder leaves the catalog, ownership, and link target", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pokemon-delete-set-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "pokemon-delete-outside-"));
    const fixture = openFixture();
    try {
      await mkdir(path.join(root, "cards"), { recursive: true });
      await writeSetDir(root, SLUG_B);
      await mkdir(path.join(outside, SLUG_A), { recursive: true });
      await writeFile(path.join(outside, SLUG_A, "001.jpg"), "outside-card");
      await symlink(path.join(outside, SLUG_A), path.join(root, "cards", SLUG_A));
      addCopy(fixture.setA, "001", fixture.ownership);
      addCopy(fixture.setB, "001", fixture.ownership);
      useFixture(fixture, root);

      const result = await deleteSetAction(SLUG_A);
      assert.deepEqual(result, {
        ok: false,
        error: "Could not delete the image folder.",
      });
      assert.equal(findSetBySlug(SLUG_A, fixture.catalog)?.id, fixture.setA);
      assert.equal(getCopies(fixture.setA, "001", fixture.ownership), 1);
      assert.equal(getCopies(fixture.setB, "001", fixture.ownership), 1);
      assert.equal(fs.lstatSync(path.join(root, "cards", SLUG_A)).isSymbolicLink(), true);
      assert.equal(
        fs.readFileSync(path.join(outside, SLUG_A, "001.jpg"), "utf8"),
        "outside-card",
      );
      assert.equal(
        fs.readFileSync(path.join(root, "cards", SLUG_B, "logo.png"), "utf8"),
        `${SLUG_B}-logo`,
      );
      assert.deepEqual(fixture.paths, []);
    } finally {
      fixture.close();
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  test("delete is refused while a download holds the lock", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pokemon-delete-set-"));
    const fixture = openFixture();
    resetDownloadLockForTests();
    assert.equal(tryAcquireDownloadLock(), true);
    try {
      await writeSetDir(root, SLUG_A);
      addCopy(fixture.setA, "001", fixture.ownership);
      addCopy(fixture.setB, "001", fixture.ownership);
      useFixture(fixture, root);

      const result = await deleteSetAction(SLUG_A);
      assert.deepEqual(result, {
        ok: false,
        error: "A download is already running.",
      });
      assert.equal(isDownloadLocked(), true);
      assert.equal(findSetBySlug(SLUG_A, fixture.catalog)?.id, fixture.setA);
      assert.equal(getCopies(fixture.setA, "001", fixture.ownership), 1);
      assert.equal(getCopies(fixture.setB, "001", fixture.ownership), 1);
      assert.equal(
        fs.readFileSync(path.join(root, "cards", SLUG_A, "001.jpg"), "utf8"),
        `${SLUG_A}-card`,
      );
      assert.deepEqual(fixture.paths, []);
    } finally {
      releaseDownloadLock();
      fixture.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
