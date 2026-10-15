import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import {
  catalogProcessEnv,
  handleListEditions,
  handleUpdateEditions,
  readEditions,
  resetCatalogLockForTests,
  type SpawnFn,
} from "../lib/liga-editions";

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

describe("liga editions catalog", () => {
  afterEach(() => {
    resetCatalogLockForTests();
  });

  test("an empty Playwright cache path is not passed to the updater", () => {
    const env = catalogProcessEnv({
      PLAYWRIGHT_BROWSERS_PATH: path.join(os.tmpdir(), "missing-playwright-browsers"),
      PATH: "/usr/bin",
    });
    assert.equal(env.PLAYWRIGHT_BROWSERS_PATH, undefined);
    assert.equal(env.PATH, "/usr/bin");
  });

  test("the stored catalog includes Abyss Eye", () => {
    const abyss = readEditions().find((edition) => edition.name === "Abyss Eye");
    assert.equal(abyss?.set_code, "M5");
    assert.equal(
      abyss?.url,
      "https://www.ligapokemon.com.br/?view=cards/search&card=edid=777%20ed=M5",
    );
  });

  test("readEditions rejects a catalog that is not a list of editions", () => {
    const file = path.join(os.tmpdir(), `liga-editions-${process.pid}.json`);
    fs.writeFileSync(file, "{}");
    try {
      assert.throws(() => readEditions(file), /Could not read the catalog/);
    } finally {
      fs.unlinkSync(file);
    }
  });

  test("GET returns the injected catalog", async () => {
    const response = handleListEditions([
      {
        name: "Abyss Eye",
        name_en: "Abyss Eye",
        name_pt: null,
        name_pt_ascii: null,
        set_code: "M5",
        url: "https://www.ligapokemon.com.br/?view=cards/search&card=edid=777%20ed=M5",
      },
    ]);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).length, 1);
  });

  test("update spawns the editions script and returns how many were added", async () => {
    let child: FakeChild | undefined;
    const spawnFn = ((command: string, args: readonly string[], options: { cwd?: string }) => {
      assert.equal(command, "uv");
      assert.deepEqual(args, ["run", "python", "scripts/update_liga_editions.py"]);
      assert.equal(options.cwd, path.resolve(process.cwd(), ".."));
      child = createFakeChild();
      return child;
    }) as SpawnFn;

    const pending = handleUpdateEditions({ spawn: spawnFn });
    assert.ok(child);
    child.stdout.write('{"added":2}\n');
    child.emit("close", 0);

    const response = await pending;
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { added: 2 });
  });

  test("a missing Playwright browser becomes a catalog error", async () => {
    const spawnFn = (() => {
      const child = createFakeChild();
      queueMicrotask(() => {
        child.stderr.write(
          "Error: BrowserType.launch: Executable doesn't exist\n╚════════════════════════════════════════════════════════════╝\n",
        );
        child.emit("close", 1);
      });
      return child;
    }) as SpawnFn;

    const response = await handleUpdateEditions({ spawn: spawnFn });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error:
        "Could not open a browser to read Liga. Install Playwright's Chromium, then try again.",
    });
  });

  test("a failed update returns the script error and releases the lock", async () => {
    const children: FakeChild[] = [];
    const spawnFn = (() => {
      const child = createFakeChild();
      children.push(child);
      return child;
    }) as SpawnFn;

    const pending = handleUpdateEditions({ spawn: spawnFn });
    children[0]?.stderr.write("Could not read Liga editions.\n");
    children[0]?.emit("close", 1);

    const response = await pending;
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: "Could not read Liga editions.",
    });

    const retry = handleUpdateEditions({ spawn: spawnFn });
    children[1]?.stdout.write('{"added":0}\n');
    children[1]?.emit("close", 0);
    assert.equal((await retry).status, 200);
  });

  test("a second update returns 409 while the first is running", async () => {
    const children: FakeChild[] = [];
    const spawnFn = (() => {
      const child = createFakeChild();
      children.push(child);
      return child;
    }) as SpawnFn;

    const first = handleUpdateEditions({ spawn: spawnFn });
    const second = await handleUpdateEditions({ spawn: spawnFn });
    assert.equal(second.status, 409);
    assert.equal(children.length, 1);

    children[0]?.stdout.write('{"added":0}\n');
    children[0]?.emit("close", 0);
    assert.equal((await first).status, 200);
  });
});
