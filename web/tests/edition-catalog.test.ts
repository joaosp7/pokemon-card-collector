import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  filterEditions,
  matchEdition,
  parseEditionList,
  type LigaEdition,
} from "../lib/edition-catalog";

const ABYSS: LigaEdition = {
  name: "Abyss Eye",
  name_en: "Abyss Eye",
  name_pt: null,
  name_pt_ascii: null,
  set_code: "M5",
  url: "https://www.ligapokemon.com.br/?view=cards/search&card=edid=777%20ed=M5",
};

const CELEBRATION: LigaEdition = {
  name: "Celebração de 30 Anos",
  name_en: "30th Celebration",
  name_pt: "Celebração de 30 Anos",
  name_pt_ascii: "Celebracao de 30 Anos",
  set_code: "30C",
  url: "https://www.ligapokemon.com.br/?view=cards/search&card=edid=804%20ed=30C",
};

const EDITIONS = [ABYSS, CELEBRATION];

describe("edition catalog search", () => {
  test("filters by english name, ascii portuguese name, and set code", () => {
    assert.deepEqual(filterEditions(EDITIONS, "abyss"), [ABYSS]);
    assert.deepEqual(filterEditions(EDITIONS, "celebracao"), [CELEBRATION]);
    assert.deepEqual(filterEditions(EDITIONS, "30th"), [CELEBRATION]);
    assert.deepEqual(filterEditions(EDITIONS, "m5"), [ABYSS]);
  });

  test("empty query returns every edition", () => {
    assert.deepEqual(filterEditions(EDITIONS, "   "), EDITIONS);
  });

  test("exact match is unique, a partial query is not a match", () => {
    assert.equal(matchEdition(EDITIONS, "Abyss Eye"), ABYSS);
    assert.equal(matchEdition(EDITIONS, "30C"), CELEBRATION);
    assert.equal(matchEdition(EDITIONS, "Celebracao de 30 Anos"), CELEBRATION);
    assert.equal(matchEdition(EDITIONS, "abyss"), null);
  });

  test("parseEditionList rejects a missing url", () => {
    assert.equal(
      parseEditionList([{ ...ABYSS, url: "" }]),
      null,
    );
    assert.deepEqual(parseEditionList([ABYSS]), [ABYSS]);
  });
});
