import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type Database from "better-sqlite3";
import { GET, serveCatalogImage } from "../app/api/images/[slug]/[filename]/route";
import { openCatalog } from "../lib/catalog-db";
import { storedLogoFilename } from "../lib/catalog";

const SLUG = "Storm-Emeralda-M6";

function insertSet(
  db: Database.Database,
  slug: string,
  logoPath: string | null,
  setCode = "M6",
): number {
  const result = db
    .prepare(
      `INSERT INTO sets (
         set_code, name_pt, name_en, slug, source_url, logo_path, card_count
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(setCode, "Storm Emeralda", "Storm Emeralda", slug, "https://example.test", logoPath, 1);
  return Number(result.lastInsertRowid);
}

function insertCard(
  db: Database.Database,
  setId: number,
  setCardId: string,
  imagePath: string,
): void {
  db.prepare(
    `INSERT INTO set_cards (
       id, set_id, name_pt, name_en, element_code, rarity_code,
       image_path, sort_key, illustrator
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    setCardId,
    setId,
    "Weedle",
    "Weedle",
    "G",
    "C",
    imagePath,
    setCardId,
    null,
  );
}

async function serveFile(
  db: Database.Database,
  root: string,
  filename: string,
  slug = SLUG,
): Promise<Response> {
  return serveCatalogImage(slug, filename, { db, root });
}

describe("catalog image route", () => {
  test("serves a valid catalog image path and ignores unlisted files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pokemon-images-"));
    try {
      const dir = path.join(root, "cards", SLUG);
      await mkdir(dir, { recursive: true });
      const filename = "001_G_Weedle.jpg";
      await writeFile(path.join(dir, filename), "weedle-bytes");
      await writeFile(path.join(dir, "not-in-catalog.jpg"), "unlisted");

      const db = openCatalog(":memory:");
      const setId = insertSet(db, SLUG, null);
      insertCard(db, setId, "001", `cards/${SLUG}/${filename}`);

      const response = await serveFile(db, root, filename);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Content-Type"), "image/jpeg");
      assert.equal(await response.text(), "weedle-bytes");

      const unlisted = await serveFile(db, root, "not-in-catalog.jpg");
      assert.equal(unlisted.status, 404);
      assert.equal(await unlisted.text(), "Not Found");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a missing or empty catalog image returns 404", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pokemon-images-"));
    try {
      const dir = path.join(root, "cards", SLUG);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "002_G_Empty.jpg"), "");

      const db = openCatalog(":memory:");
      const setId = insertSet(db, SLUG, null);
      insertCard(db, setId, "001", `cards/${SLUG}/001_G_Weedle.jpg`);
      insertCard(db, setId, "002", `cards/${SLUG}/002_G_Empty.jpg`);

      const missing = await serveFile(db, root, "001_G_Weedle.jpg");
      assert.equal(missing.status, 404);
      assert.equal(await missing.text(), "Not Found");

      const empty = await serveFile(db, root, "002_G_Empty.jpg");
      assert.equal(empty.status, 404);
      assert.equal(await empty.text(), "Not Found");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("../ traversal is rejected", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pokemon-images-"));
    const outside = path.join(path.dirname(root), "escaped.jpg");
    try {
      await mkdir(path.join(root, "cards", SLUG), { recursive: true });
      await writeFile(outside, "escaped-bytes");
      await writeFile(path.join(root, "cards", SLUG, "escaped.jpg"), "decoy");

      const parentDb = openCatalog(":memory:");
      const parentId = insertSet(parentDb, SLUG, null);
      insertCard(parentDb, parentId, "001", "../escaped.jpg");

      const stored = await serveFile(parentDb, root, "escaped.jpg");
      assert.equal(stored.status, 403);
      assert.equal(await stored.text(), "Forbidden");

      const nestedDb = openCatalog(":memory:");
      const nestedId = insertSet(nestedDb, SLUG, null);
      insertCard(nestedDb, nestedId, "001", `cards/${SLUG}/../../escaped.jpg`);

      const nested = await serveFile(nestedDb, root, "escaped.jpg");
      assert.equal(nested.status, 403);
      assert.equal(await nested.text(), "Forbidden");

      const requested = await GET(new Request("http://localhost/api/images"), {
        params: Promise.resolve({ slug: SLUG, filename: "..%2Fescaped.jpg" }),
      });
      assert.equal(requested.status, 403);
      assert.equal(await requested.text(), "Forbidden");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { force: true });
    }
  });

  test("an absolute path is rejected", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pokemon-images-"));
    const absoluteFile = path.join(
      os.tmpdir(),
      `pokemon-absolute-${path.basename(root)}.jpg`,
    );
    try {
      await mkdir(path.join(root, "cards", SLUG), { recursive: true });
      await writeFile(absoluteFile, "absolute-bytes");

      const db = openCatalog(":memory:");
      const setId = insertSet(db, SLUG, null);
      insertCard(db, setId, "001", absoluteFile);

      const response = await serveFile(db, root, path.basename(absoluteFile));
      assert.equal(response.status, 403);
      assert.equal(await response.text(), "Forbidden");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(absoluteFile, { force: true });
    }
  });

  test("a path under another repository directory is rejected", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pokemon-images-"));
    try {
      await mkdir(path.join(root, "data"), { recursive: true });
      await mkdir(path.join(root, "cards", SLUG), { recursive: true });
      await writeFile(path.join(root, "data", "secret.jpg"), "secret-bytes");
      await writeFile(path.join(root, "cards", SLUG, "secret.jpg"), "decoy");

      const db = openCatalog(":memory:");
      const setId = insertSet(db, SLUG, null);
      insertCard(db, setId, "001", "data/secret.jpg");

      const response = await serveFile(db, root, "secret.jpg");
      assert.equal(response.status, 403);
      assert.equal(await response.text(), "Forbidden");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a path outside cards/ is rejected", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pokemon-images-"));
    try {
      await mkdir(path.join(root, "web"), { recursive: true });
      await writeFile(path.join(root, "web", "secret.jpg"), "web-bytes");

      const db = openCatalog(":memory:");
      const setId = insertSet(db, SLUG, null);
      insertCard(db, setId, "001", "web/secret.jpg");

      const response = await serveFile(db, root, "secret.jpg");
      assert.equal(response.status, 403);
      assert.equal(await response.text(), "Forbidden");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("png, webp, jpeg, and jpg content types are correct", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pokemon-images-"));
    try {
      const dir = path.join(root, "cards", SLUG);
      await mkdir(dir, { recursive: true });
      const files = [
        ["001_card.png", "image/png", "png-bytes"],
        ["002_card.webp", "image/webp", "webp-bytes"],
        ["003_card.jpeg", "image/jpeg", "jpeg-bytes"],
        ["004_card.jpg", "image/jpeg", "jpg-bytes"],
      ] as const;
      const db = openCatalog(":memory:");
      const setId = insertSet(db, SLUG, null);
      for (const [filename, , bytes] of files) {
        await writeFile(path.join(dir, filename), bytes);
        insertCard(db, setId, filename, `cards/${SLUG}/${filename}`);
      }

      for (const [filename, contentType, bytes] of files) {
        const response = await serveFile(db, root, filename);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("Content-Type"), contentType);
        assert.equal(await response.text(), bytes);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a valid logo_path is used", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pokemon-images-"));
    try {
      const dir = path.join(root, "cards", SLUG);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "logo.png"), "logo-bytes");
      await writeFile(path.join(dir, "001_G_Weedle.jpg"), "card-bytes");

      const logoPath = `cards/${SLUG}/logo.png`;
      const db = openCatalog(":memory:");
      const setId = insertSet(db, SLUG, logoPath);
      insertCard(db, setId, "001", `cards/${SLUG}/001_G_Weedle.jpg`);

      assert.equal(storedLogoFilename(logoPath, root), "logo.png");

      const response = await serveFile(db, root, "logo.png");
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Content-Type"), "image/png");
      assert.equal(await response.text(), "logo-bytes");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a null or missing logo does not scan the folder or use a card image", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pokemon-images-"));
    const originalReaddir = fs.readdirSync;
    let scanned = 0;
    fs.readdirSync = ((...args: Parameters<typeof fs.readdirSync>) => {
      scanned += 1;
      return originalReaddir.apply(fs, args);
    }) as typeof fs.readdirSync;
    try {
      const presentDir = path.join(root, "cards", SLUG);
      const missingDir = path.join(root, "cards", "Missing-Logo-M1");
      await mkdir(presentDir, { recursive: true });
      await mkdir(missingDir, { recursive: true });
      await writeFile(path.join(presentDir, "logo.png"), "logo-bytes");
      await writeFile(path.join(presentDir, "001_G_Weedle.jpg"), "card-bytes");
      await writeFile(path.join(missingDir, "001_G_Weedle.jpg"), "other-card");
      await writeFile(path.join(missingDir, "logo.webp"), "unused-logo");

      const db = openCatalog(":memory:");
      const presentId = insertSet(db, SLUG, null);
      insertCard(db, presentId, "001", `cards/${SLUG}/001_G_Weedle.jpg`);
      const missingId = insertSet(
        db,
        "Missing-Logo-M1",
        "cards/Missing-Logo-M1/logo.png",
        "M1",
      );
      insertCard(db, missingId, "001", "cards/Missing-Logo-M1/001_G_Weedle.jpg");

      scanned = 0;
      assert.equal(storedLogoFilename(null, root), null);
      assert.equal(
        storedLogoFilename("cards/Missing-Logo-M1/logo.png", root),
        null,
      );
      assert.equal(scanned, 0);

      const folderLogo = await serveFile(db, root, "logo.png");
      assert.equal(folderLogo.status, 404);
      assert.equal(await folderLogo.text(), "Not Found");

      const card = await serveFile(db, root, "001_G_Weedle.jpg");
      assert.equal(card.status, 200);
      assert.equal(await card.text(), "card-bytes");

      const missingLogo = await serveCatalogImage("Missing-Logo-M1", "logo.png", {
        db,
        root,
      });
      assert.equal(missingLogo.status, 404);
      assert.notEqual(await missingLogo.text(), "other-card");
      assert.equal(scanned, 0);
    } finally {
      fs.readdirSync = originalReaddir;
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a symlink that leaves cards/ is rejected", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pokemon-images-"));
    const outside = path.join(os.tmpdir(), `pokemon-link-${path.basename(root)}.jpg`);
    try {
      const dir = path.join(root, "cards", SLUG);
      await mkdir(dir, { recursive: true });
      await writeFile(outside, "linked-bytes");
      await symlink(outside, path.join(dir, "001_G_Weedle.jpg"));

      const db = openCatalog(":memory:");
      const setId = insertSet(db, SLUG, null);
      insertCard(db, setId, "001", `cards/${SLUG}/001_G_Weedle.jpg`);

      const response = await serveFile(db, root, "001_G_Weedle.jpg");
      assert.equal(response.status, 403);
      assert.equal(await response.text(), "Forbidden");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { force: true });
    }
  });
});
