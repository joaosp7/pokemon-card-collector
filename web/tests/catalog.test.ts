import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
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

  test("rejects invalid slugs", () => {
    assert.throws(() => listCards("../etc", root), /Invalid collection slug/);
    assert.throws(() => listCards("foo/bar", root), /Invalid collection slug/);
  });
});
