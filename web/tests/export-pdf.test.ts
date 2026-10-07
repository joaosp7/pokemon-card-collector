import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inflateSync } from "node:zlib";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import type Database from "better-sqlite3";
import {
  GET,
  exportCollectionPdf,
} from "../app/api/collections/[slug]/pdf/route";
import { openCatalog } from "../lib/catalog-db";
import type { Card } from "../lib/catalog";
import {
  CARDS_PER_PAGE,
  buildCollectionPdf,
  entriesForExport,
  loadCardJpeg,
  pageCountForExport,
} from "../lib/export-pdf";
import { openOwnership } from "../lib/ownership-db";

const SLUG = "Storm-Emeralda-M6";

function card(setCardId: string, name = "Card"): Card {
  return {
    setId: 1,
    setCardId,
    name,
    element: null,
    rarityCode: null,
    illustrator: null,
    imagePath: `cards/${SLUG}/${setCardId}_G_${name}.jpg`,
    sortKey: setCardId,
  };
}

function pdfCard(setCardId: string, copies: number, image: Uint8Array | null = null) {
  return { setCardId, copies, image };
}

async function pageCount(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPageCount();
}

function pdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes);
  const parts: string[] = [];
  const marker = Buffer.from("stream\n");
  const end = Buffer.from("\nendstream");
  let offset = 0;
  while (offset < raw.length) {
    const start = raw.indexOf(marker, offset);
    if (start < 0) {
      break;
    }
    const dataStart = start + marker.length;
    const dataEnd = raw.indexOf(end, dataStart);
    if (dataEnd < 0) {
      break;
    }
    const chunk = raw.subarray(dataStart, dataEnd);
    let content: string;
    try {
      content = inflateSync(chunk).toString("latin1");
    } catch {
      content = chunk.toString("latin1");
    }
    for (const match of content.matchAll(/<([0-9A-Fa-f]+)> Tj/g)) {
      parts.push(Buffer.from(match[1], "hex").toString("latin1"));
    }
    offset = dataEnd + end.length;
  }
  return parts.join("\n");
}

async function tinyJpeg(): Promise<Buffer> {
  return sharp({
    create: {
      width: 12,
      height: 16,
      channels: 3,
      background: { r: 180, g: 30, b: 40 },
    },
  })
    .jpeg()
    .toBuffer();
}

describe("entriesForExport", () => {
  const cards = [card("010", "Heracross"), card("002", "Surskit"), card("003", "Masquerain")];

  test("keeps catalog order and uses 0 when the ownership map has no row", () => {
    const owned = new Map([["002", 4]]);
    assert.deepEqual(
      entriesForExport(cards, owned, "all").map((entry) => [
        entry.setCardId,
        entry.copies,
      ]),
      [
        ["010", 0],
        ["002", 4],
        ["003", 0],
      ],
    );
  });

  test("missing is copies === 0 and owned is copies >= 1", () => {
    const owned = new Map([
      ["002", 1],
      ["003", 2],
    ]);
    assert.deepEqual(
      entriesForExport(cards, owned, "missing").map((entry) => entry.setCardId),
      ["010"],
    );
    assert.deepEqual(
      entriesForExport(cards, owned, "owned").map((entry) => [
        entry.setCardId,
        entry.copies,
      ]),
      [
        ["002", 1],
        ["003", 2],
      ],
    );
  });
});

describe("buildCollectionPdf", () => {
  test("page count follows a 12-card grid, including an empty one-pager", async () => {
    assert.equal(CARDS_PER_PAGE, 12);
    assert.equal(pageCountForExport(0), 1);
    assert.equal(pageCountForExport(12), 1);
    assert.equal(pageCountForExport(13), 2);

    const empty = await buildCollectionPdf({
      title: "Celebração de 30 Anos",
      setCode: "30C",
      filter: "missing",
      entries: [],
    });
    assert.equal(Buffer.from(empty).subarray(0, 5).toString(), "%PDF-");
    assert.equal(await pageCount(empty), 1);
    assert.match(pdfText(empty), /No cards on this tab/);
    assert.match(pdfText(empty), /Celebração de 30 Anos/);
    assert.match(pdfText(empty), /Missing/);

    const jpeg = new Uint8Array(await tinyJpeg());
    const full = await buildCollectionPdf({
      title: "Storm Emeralda",
      setCode: "M6",
      filter: "all",
      entries: Array.from({ length: 13 }, (_, index) =>
        pdfCard(String(index + 1).padStart(3, "0"), index, index === 0 ? jpeg : null),
      ),
    });
    assert.equal(await pageCount(full), 2);
    assert.match(pdfText(full), /#001/);
    assert.match(pdfText(full), /#013/);
  });

  test("a card with no image still keeps its copy count", async () => {
    const bytes = await buildCollectionPdf({
      title: "Storm Emeralda",
      setCode: "M6",
      filter: "all",
      entries: [pdfCard("018", 0, null)],
    });
    assert.equal(await pageCount(bytes), 1);
    assert.match(pdfText(bytes), /#018\s+×0/);
  });
});

function insertSet(db: Database.Database, cardCount: number): number {
  const result = db
    .prepare(
      `INSERT INTO sets (
         set_code, name_pt, name_en, slug, source_url, logo_path, card_count
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run("M6", "Storm Emeralda", "Storm Emeralda", SLUG, "https://example.test", null, cardCount);
  return Number(result.lastInsertRowid);
}

function insertCard(
  db: Database.Database,
  setId: number,
  setCardId: string,
  imagePath: string,
  sortKey = setCardId,
): void {
  db.prepare(
    `INSERT INTO set_cards (
       id, set_id, name_pt, name_en, element_code, rarity_code,
       image_path, sort_key, illustrator
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(setCardId, setId, "Weedle", "Weedle", "G", "C", imagePath, sortKey, null);
}

function insertCopies(
  db: Database.Database,
  setId: number,
  setCardId: string,
  copies: number,
): void {
  db.prepare(
    `INSERT INTO owned_cards (set_id, set_card_id, copies, updated_at)
     VALUES (?, ?, ?, ?)`,
  ).run(setId, setCardId, copies, "2026-10-06T00:00:00.000Z");
}

describe("collection pdf route", () => {
  test("downloads the owned view and keeps a card whose image is missing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pokemon-pdf-"));
    const catalog = openCatalog(":memory:");
    const ownership = openOwnership(":memory:");
    try {
      const dir = path.join(root, "cards", SLUG);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "001_G_Weedle.jpg"), await tinyJpeg());

      const setId = insertSet(catalog, 3);
      insertCard(catalog, setId, "002", `cards/${SLUG}/002_G_Missing.jpg`, "002");
      insertCard(catalog, setId, "001", `cards/${SLUG}/001_G_Weedle.jpg`, "001");
      insertCard(catalog, setId, "003", `cards/${SLUG}/003_G_Absent.jpg`, "003");
      insertCopies(ownership, setId, "001", 2);

      const owned = await exportCollectionPdf(SLUG, "owned", {
        catalog,
        ownership,
        root,
      });
      assert.equal(owned.status, 200);
      assert.equal(owned.headers.get("Content-Type"), "application/pdf");
      assert.equal(
        owned.headers.get("Content-Disposition"),
        `attachment; filename="${SLUG}-owned.pdf"`,
      );
      const ownedBytes = new Uint8Array(await owned.arrayBuffer());
      assert.equal(Buffer.from(ownedBytes).subarray(0, 5).toString(), "%PDF-");
      const ownedText = pdfText(ownedBytes);
      assert.match(ownedText, /#001\s+×2/);
      assert.doesNotMatch(ownedText, /#002/);
      assert.doesNotMatch(ownedText, /#003/);

      const all = await exportCollectionPdf(SLUG, "all", {
        catalog,
        ownership,
        root,
      });
      const allBytes = new Uint8Array(await all.arrayBuffer());
      const allText = pdfText(allBytes);
      assert.match(allText, /#001/);
      assert.match(allText, /#002\s+×0/);
      assert.match(allText, /#003\s+×0/);
      assert.equal(await pageCount(allBytes), 1);
    } finally {
      catalog.close();
      ownership.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("an unknown slug is not found", async () => {
    const catalog = openCatalog(":memory:");
    try {
      const ownership = openOwnership(":memory:");
      try {
        const response = await exportCollectionPdf("No-Such-Set-ZZZ", "all", {
          catalog,
          ownership,
        });
        assert.equal(response.status, 404);
        assert.equal(await response.text(), "Not Found");
      } finally {
        ownership.close();
      }
    } finally {
      catalog.close();
    }
  });

  test("GET rejects a slug that cannot be a collection", async () => {
    const response = await GET(new Request("http://localhost/api/collections/x/pdf?filter=owned"), {
      params: Promise.resolve({ slug: "not a slug" }),
    });
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "Not Found");
  });

  test("loadCardJpeg returns bytes for a catalog jpeg and null when the file is missing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pokemon-pdf-jpeg-"));
    try {
      const dir = path.join(root, "cards", SLUG);
      await mkdir(dir, { recursive: true });
      const filename = "001_G_Weedle.jpg";
      await writeFile(path.join(dir, filename), await tinyJpeg());

      const loaded = await loadCardJpeg(`cards/${SLUG}/${filename}`, root);
      assert.ok(loaded);
      assert.ok(loaded.length > 0);

      const missing = await loadCardJpeg(`cards/${SLUG}/002_G_Missing.jpg`, root);
      assert.equal(missing, null);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
