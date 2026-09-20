import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  COLLECTION_URL_ERROR,
  EXAMPLE_COLLECTION_URL,
  collectionUrlError,
} from "../lib/collection-url";

describe("collectionUrlError", () => {
  test("accepts EXAMPLE_COLLECTION_URL", () => {
    assert.equal(collectionUrlError(EXAMPLE_COLLECTION_URL), null);
  });

  test("accepts decoded space in card query", () => {
    assert.equal(
      collectionUrlError(
        "https://www.ligapokemon.com.br/?view=cards/search&card=edid=806 ed=M6",
      ),
      null,
    );
  });

  test("accepts ligapokemon.com.br without www", () => {
    assert.equal(
      collectionUrlError(
        "https://ligapokemon.com.br/?view=cards/search&card=edid=804",
      ),
      null,
    );
  });

  test("rejects empty, whitespace, and non-strings", () => {
    assert.equal(collectionUrlError(""), COLLECTION_URL_ERROR);
    assert.equal(collectionUrlError("  "), COLLECTION_URL_ERROR);
    assert.equal(collectionUrlError(1), COLLECTION_URL_ERROR);
    assert.equal(collectionUrlError(null), COLLECTION_URL_ERROR);
    assert.equal(collectionUrlError(undefined), COLLECTION_URL_ERROR);
  });

  test("rejects other hosts and lookalike hostnames", () => {
    assert.equal(
      collectionUrlError(
        "https://example.com/?view=cards/search&card=edid=1",
      ),
      COLLECTION_URL_ERROR,
    );
    assert.equal(
      collectionUrlError(
        "https://www.ligapokemon.com.br.evil.com/?view=cards/search&card=edid=1",
      ),
      COLLECTION_URL_ERROR,
    );
  });

  test("rejects missing view, missing edid, ftp, and javascript", () => {
    assert.equal(
      collectionUrlError("https://www.ligapokemon.com.br/?card=edid=1"),
      COLLECTION_URL_ERROR,
    );
    assert.equal(
      collectionUrlError(
        "https://www.ligapokemon.com.br/?view=cards/search&card=hello",
      ),
      COLLECTION_URL_ERROR,
    );
    assert.equal(
      collectionUrlError(
        "https://www.ligapokemon.com.br/?view=cards/search",
      ),
      COLLECTION_URL_ERROR,
    );
    assert.equal(
      collectionUrlError(
        "ftp://www.ligapokemon.com.br/?view=cards/search&card=edid=1",
      ),
      COLLECTION_URL_ERROR,
    );
    assert.equal(collectionUrlError("javascript:alert(1)"), COLLECTION_URL_ERROR);
  });
});
