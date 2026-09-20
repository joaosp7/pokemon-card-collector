import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createDatabase } from "../lib/db";
import { addCopy, getCopies, getOwnedMap, removeCopy } from "../lib/ownership";

describe("ownership", () => {
  test("addCopy from 0 to 1 then increments to 2", () => {
    const db = createDatabase(":memory:");
    assert.equal(getCopies("Storm-Emeralda-M6", "001", db), 0);

    addCopy("Storm-Emeralda-M6", "001", db);
    assert.equal(getCopies("Storm-Emeralda-M6", "001", db), 1);

    addCopy("Storm-Emeralda-M6", "001", db);
    assert.equal(getCopies("Storm-Emeralda-M6", "001", db), 2);
    assert.deepEqual(
      [...getOwnedMap("Storm-Emeralda-M6", db).entries()],
      [["001", 2]],
    );
  });

  test("removeCopy from 1 deletes the row", () => {
    const db = createDatabase(":memory:");
    addCopy("Storm-Emeralda-M6", "001", db);
    removeCopy("Storm-Emeralda-M6", "001", db);
    assert.equal(getCopies("Storm-Emeralda-M6", "001", db), 0);
    assert.equal(getOwnedMap("Storm-Emeralda-M6", db).size, 0);
  });

  test("removeCopy from 0 is a no-op", () => {
    const db = createDatabase(":memory:");
    removeCopy("Storm-Emeralda-M6", "001", db);
    assert.equal(getCopies("Storm-Emeralda-M6", "001", db), 0);
  });
});
