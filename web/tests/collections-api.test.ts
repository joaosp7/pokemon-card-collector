import { EventEmitter } from "node:events";
import path from "node:path";
import { PassThrough } from "node:stream";
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { EXAMPLE_COLLECTION_URL } from "../lib/collection-url";
import type { LigaEdition } from "../lib/edition-catalog";
import {
  handleAddCollection,
  repoRoot,
  resetDownloadLockForTests,
  startDownload,
  type SpawnFn,
} from "../lib/download-collection";
import { catalogProcessEnv } from "../lib/liga-editions";

const CATALOG: LigaEdition[] = [
  {
    name: "Storm Emeralda",
    name_en: "Storm Emeralda",
    name_pt: null,
    name_pt_ascii: null,
    set_code: "M6",
    url: EXAMPLE_COLLECTION_URL,
  },
];

type SpawnCall = {
  command: string;
  args: readonly string[];
  cwd: string | URL | undefined;
};

type FakeChild = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
};

function createFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
}

function postJson(body: unknown): Request {
  return new Request("http://localhost/api/collections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readBody(response: Response): Promise<string> {
  return response.text();
}

describe("handleAddCollection", () => {
  test("download spawn drops an empty Playwright browser cache", () => {
    let seen: NodeJS.ProcessEnv | undefined;
    const spawnFn = ((
      _command: string,
      _args: readonly string[],
      options: { env?: NodeJS.ProcessEnv },
    ) => {
      seen = options.env;
      return createFakeChild();
    }) as SpawnFn;

    startDownload(EXAMPLE_COLLECTION_URL, spawnFn);

    assert.equal(
      seen?.PLAYWRIGHT_BROWSERS_PATH,
      catalogProcessEnv().PLAYWRIGHT_BROWSERS_PATH,
    );
  });

  afterEach(() => {
    resetDownloadLockForTests();
  });

  test("a URL outside the catalog returns 400 and does not spawn", async () => {
    let spawned = 0;
    const spawnFn = (() => {
      spawned += 1;
      return createFakeChild();
    }) as SpawnFn;

    const response = await handleAddCollection(
      postJson({ url: "https://example.com/?view=cards/search&card=edid=1" }),
      { spawn: spawnFn, editions: CATALOG },
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Choose a collection from the catalog.",
    });
    assert.equal(spawned, 0);
  });

  test("a Liga URL missing from the catalog returns 400 and does not spawn", async () => {
    let spawned = 0;
    const spawnFn = (() => {
      spawned += 1;
      return createFakeChild();
    }) as SpawnFn;

    const response = await handleAddCollection(
      postJson({
        url: "https://www.ligapokemon.com.br/?view=cards/search&card=edid=1%20ed=XX",
      }),
      { spawn: spawnFn, editions: CATALOG },
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Choose a collection from the catalog.",
    });
    assert.equal(spawned, 0);
  });

  test("malformed JSON returns 400 Invalid request", async () => {
    let spawned = 0;
    const spawnFn = (() => {
      spawned += 1;
      return createFakeChild();
    }) as SpawnFn;

    const response = await handleAddCollection(
      new Request("http://localhost/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      }),
      { spawn: spawnFn, editions: CATALOG },
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Invalid request." });
    assert.equal(spawned, 0);
  });

  test("valid URL streams SSE log and done ok true", async () => {
    const calls: SpawnCall[] = [];
    let child: FakeChild | undefined;
    const spawnFn = ((
      command: string,
      args: readonly string[],
      options: { cwd?: string | URL },
    ) => {
      calls.push({ command, args, cwd: options.cwd });
      child = createFakeChild();
      return child;
    }) as SpawnFn;

    const response = await handleAddCollection(
      postJson({ url: EXAMPLE_COLLECTION_URL }),
      { spawn: spawnFn, editions: CATALOG },
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/event-stream");
    assert.equal(response.headers.get("cache-control"), "no-cache");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.command, "uv");
    assert.deepEqual(calls[0]?.args, [
      "run",
      "download-collection",
      EXAMPLE_COLLECTION_URL,
    ]);
    assert.equal(calls[0]?.cwd, repoRoot());
    assert.equal(calls[0]?.cwd, path.resolve(process.cwd(), ".."));

    assert.ok(child);
    child.stdout.write("Found 2 cards\n");
    child.emit("close", 0);

    const body = await readBody(response);
    assert.equal(
      body.includes('data: {"type":"log","text":"Found 2 cards"}\n\n'),
      true,
    );
    assert.equal(body.includes('data: {"type":"done","ok":true}\n\n'), true);
  });

  test("non-zero exit streams done ok false", async () => {
    let child: FakeChild | undefined;
    const spawnFn = (() => {
      child = createFakeChild();
      return child;
    }) as SpawnFn;

    const response = await handleAddCollection(
      postJson({ url: EXAMPLE_COLLECTION_URL }),
      { spawn: spawnFn, editions: CATALOG },
    );

    assert.ok(child);
    child.emit("close", 1);

    const body = await readBody(response);
    assert.equal(
      body.includes(
        'data: {"type":"done","ok":false,"error":"Download failed. Try again."}\n\n',
      ),
      true,
    );
  });

  test("concurrent POST returns 409 until the first download ends", async () => {
    const children: FakeChild[] = [];
    const spawnFn = (() => {
      const child = createFakeChild();
      children.push(child);
      return child;
    }) as SpawnFn;

    const first = await handleAddCollection(
      postJson({ url: EXAMPLE_COLLECTION_URL }),
      { spawn: spawnFn, editions: CATALOG },
    );
    const second = await handleAddCollection(
      postJson({ url: EXAMPLE_COLLECTION_URL }),
      { spawn: spawnFn, editions: CATALOG },
    );

    assert.equal(first.status, 200);
    assert.equal(second.status, 409);
    assert.deepEqual(await second.json(), {
      error: "A download is already running.",
    });
    assert.equal(children.length, 1);

    children[0]?.emit("close", 0);
    await readBody(first);

    const third = await handleAddCollection(
      postJson({ url: EXAMPLE_COLLECTION_URL }),
      { spawn: spawnFn, editions: CATALOG },
    );
    assert.equal(third.status, 200);
    assert.equal(children.length, 2);
    children[1]?.emit("close", 0);
    await readBody(third);
  });

  test("spawn error streams uv-installed message and releases the lock", async () => {
    const children: FakeChild[] = [];
    const spawnFn = (() => {
      const child = createFakeChild();
      children.push(child);
      return child;
    }) as SpawnFn;

    const response = await handleAddCollection(
      postJson({ url: EXAMPLE_COLLECTION_URL }),
      { spawn: spawnFn, editions: CATALOG },
    );

    assert.ok(children[0]);
    children[0].emit("error", new Error("spawn uv ENOENT"));

    const body = await readBody(response);
    assert.equal(
      body.includes(
        'data: {"type":"done","ok":false,"error":"Could not start download-collection. Is uv installed?"}\n\n',
      ),
      true,
    );

    const retry = await handleAddCollection(
      postJson({ url: EXAMPLE_COLLECTION_URL }),
      { spawn: spawnFn, editions: CATALOG },
    );
    assert.equal(retry.status, 200);
    assert.equal(children.length, 2);
    children[1]?.emit("close", 0);
    await readBody(retry);
  });
});
