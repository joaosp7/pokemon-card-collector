import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
  collectionLogo,
  imageContentType,
  isAllowedImageFilename,
  listCards,
  parseCardFilename,
  parseSlug,
} from "../lib/catalog";

describe("parseCardFilename", () => {
  test("parses collector number and name", () => {
    assert.deepEqual(parseCardFilename("018_Articuno.jpg"), {
      collectorNumber: "018",
      name: "Articuno",
      filename: "018_Articuno.jpg",
    });
  });

  test("parses names with spaces", () => {
    assert.deepEqual(parseCardFilename("009_Mega Golisopod ex.jpg"), {
      collectorNumber: "009",
      name: "Mega Golisopod ex",
      filename: "009_Mega Golisopod ex.jpg",
    });
  });

  test("skips dual-face back images", () => {
    assert.equal(parseCardFilename("001_Heracross_back.jpg"), null);
  });
});

describe("parseSlug", () => {
  test("parses Storm-Emeralda-M6", () => {
    assert.deepEqual(parseSlug("Storm-Emeralda-M6"), {
      title: "Storm Emeralda",
      setCode: "M6",
    });
  });

  test("parses Celebracao-de-30-Anos-30C", () => {
    assert.deepEqual(parseSlug("Celebracao-de-30-Anos-30C"), {
      title: "Celebracao de 30 Anos",
      setCode: "30C",
    });
  });

  test("rejects invalid slugs", () => {
    assert.throws(() => parseSlug("../etc"), /Invalid collection slug/);
    assert.throws(() => parseSlug("foo/bar"), /Invalid collection slug/);
    assert.throws(() => parseSlug("has_underscore"), /Invalid collection slug/);
  });
});

describe("listCards", () => {
  let root: string;

  before(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "pokemon-cards-"));
    const collection = path.join(root, "Storm-Emeralda-M6");
    await mkdir(collection);
    await writeFile(path.join(collection, "002_Surskit.jpg"), "front");
    await writeFile(path.join(collection, "001_Heracross.jpg"), "front");
    await writeFile(path.join(collection, "001_Heracross_back.jpg"), "back");
    await writeFile(
      path.join(collection, "009_Mega Golisopod ex.jpg"),
      "front",
    );
    await writeFile(path.join(collection, "logo.jpg"), "logo");
    await writeFile(path.join(collection, "logo.webp"), "logo");
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("lists front images sorted by collector number", () => {
    const cards = listCards("Storm-Emeralda-M6", root);
    assert.deepEqual(
      cards.map((card) => card.filename),
      [
        "001_Heracross.jpg",
        "002_Surskit.jpg",
        "009_Mega Golisopod ex.jpg",
      ],
    );
    assert.equal(cards[0]?.name, "Heracross");
    assert.equal(cards[2]?.name, "Mega Golisopod ex");
  });

  test("ignores logo.jpg and logo.webp", () => {
    const cards = listCards("Storm-Emeralda-M6", root);
    assert.equal(
      cards.some((card) => card.filename.startsWith("logo.")),
      false,
    );
  });

  test("rejects invalid slugs", () => {
    assert.throws(() => listCards("../etc", root), /Invalid collection slug/);
    assert.throws(() => listCards("foo/bar", root), /Invalid collection slug/);
  });
});

describe("collectionLogo", () => {
  let root: string;

  before(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "pokemon-logos-"));
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function seed(slug: string, files: Record<string, string>) {
    const dir = path.join(root, slug);
    await mkdir(dir);
    for (const [filename, contents] of Object.entries(files)) {
      await writeFile(path.join(dir, filename), contents);
    }
  }

  test("finds png, webp, jpg, and jpeg logos", async () => {
    await seed("Logo-Png-P1", { "logo.png": "png" });
    await seed("Logo-Webp-W1", { "logo.webp": "webp" });
    await seed("Logo-Jpg-J1", { "logo.jpg": "jpg" });
    await seed("Logo-Jpeg-J2", { "logo.jpeg": "jpeg" });
    assert.equal(collectionLogo("Logo-Png-P1", root), "logo.png");
    assert.equal(collectionLogo("Logo-Webp-W1", root), "logo.webp");
    assert.equal(collectionLogo("Logo-Jpg-J1", root), "logo.jpg");
    assert.equal(collectionLogo("Logo-Jpeg-J2", root), "logo.jpeg");
  });

  test("prefers png over webp and jpeg when both exist", async () => {
    await seed("Logo-Prefers-P2", {
      "logo.png": "png",
      "logo.webp": "webp",
      "logo.jpeg": "jpeg",
    });
    assert.equal(collectionLogo("Logo-Prefers-P2", root), "logo.png");
  });

  test("skips empty files and continues to the next format", async () => {
    await seed("Logo-Empty-E1", {
      "logo.png": "",
      "logo.webp": "webp",
    });
    assert.equal(collectionLogo("Logo-Empty-E1", root), "logo.webp");
  });
});

describe("isAllowedImageFilename", () => {
  test("allows card jpgs and reserved logos", () => {
    assert.equal(isAllowedImageFilename("018_Articuno.jpg"), true);
    assert.equal(isAllowedImageFilename("001_Heracross_back.jpg"), true);
    assert.equal(isAllowedImageFilename("logo.png"), true);
    assert.equal(isAllowedImageFilename("logo.webp"), true);
    assert.equal(isAllowedImageFilename("logo.jpg"), true);
    assert.equal(isAllowedImageFilename("logo.jpeg"), true);
  });

  test("rejects other images and path traversal", () => {
    assert.equal(isAllowedImageFilename("evil.png"), false);
    assert.equal(isAllowedImageFilename("logo.gif"), false);
    assert.equal(isAllowedImageFilename("../logo.png"), false);
  });
});

describe("imageContentType", () => {
  test("maps png, webp, jpg, and jpeg", () => {
    assert.equal(imageContentType("logo.png"), "image/png");
    assert.equal(imageContentType("logo.webp"), "image/webp");
    assert.equal(imageContentType("018_Articuno.jpg"), "image/jpeg");
    assert.equal(imageContentType("logo.jpeg"), "image/jpeg");
  });
});
