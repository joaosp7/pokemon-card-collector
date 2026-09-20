import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Card } from "../lib/catalog";
import { filterCards, parseFilter } from "../lib/filter";

const cards: Card[] = [
  { collectorNumber: "001", name: "Heracross", filename: "001_Heracross.jpg" },
  { collectorNumber: "002", name: "Surskit", filename: "002_Surskit.jpg" },
  { collectorNumber: "003", name: "Masquerain", filename: "003_Masquerain.jpg" },
];

function numbers(list: Card[]): string[] {
  return list.map((card) => card.collectorNumber);
}

describe("parseFilter", () => {
  test("accepts all, missing, and owned", () => {
    assert.equal(parseFilter("all"), "all");
    assert.equal(parseFilter("missing"), "missing");
    assert.equal(parseFilter("owned"), "owned");
  });

  test("unknown or empty values become all", () => {
    assert.equal(parseFilter(undefined), "all");
    assert.equal(parseFilter("nope"), "all");
    assert.equal(parseFilter(""), "all");
  });
});

describe("filterCards", () => {
  test("all returns every card in collector-number order", () => {
    const owned = new Map([["002", 3]]);
    assert.deepEqual(numbers(filterCards(cards, owned, "all")), [
      "001",
      "002",
      "003",
    ]);
  });

  test("missing is copies === 0, including no map entry", () => {
    const owned = new Map([
      ["002", 1],
      ["003", 0],
    ]);
    assert.deepEqual(numbers(filterCards(cards, owned, "missing")), [
      "001",
      "003",
    ]);
  });

  test("owned is copies >= 1", () => {
    const owned = new Map([
      ["001", 1],
      ["003", 4],
    ]);
    assert.deepEqual(numbers(filterCards(cards, owned, "owned")), [
      "001",
      "003",
    ]);
  });

  test("does not reorder cards", () => {
    const owned = new Map([
      ["003", 1],
      ["001", 2],
    ]);
    assert.deepEqual(numbers(filterCards(cards, owned, "owned")), [
      "001",
      "003",
    ]);
    assert.deepEqual(numbers(filterCards(cards, owned, "missing")), ["002"]);
  });

  test("unknown filter is treated as all", () => {
    const owned = new Map([["001", 1]]);
    assert.deepEqual(numbers(filterCards(cards, owned, "wishlist")), [
      "001",
      "002",
      "003",
    ]);
  });

  test("empty owned map: all missing, none owned", () => {
    const owned = new Map<string, number>();
    assert.deepEqual(numbers(filterCards(cards, owned, "missing")), [
      "001",
      "002",
      "003",
    ]);
    assert.deepEqual(numbers(filterCards(cards, owned, "owned")), []);
  });
});
