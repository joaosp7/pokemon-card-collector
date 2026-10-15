import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./data-paths";
import { parseEditionList, type LigaEdition } from "./edition-catalog";

export type SpawnFn = typeof spawn;

const UPDATE_FAILED = "Could not update the catalog.";
const UPDATE_IN_PROGRESS = "A catalog update is already running.";
const CATALOG_UNREADABLE = "Could not read the catalog.";

let updateLocked = false;

export function editionsPath(): string {
  return path.join(dataDir(), "liga-editions.json");
}

export function readEditions(file = editionsPath()): LigaEdition[] {
  const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  const editions = parseEditionList(parsed);
  if (!editions) {
    throw new Error(CATALOG_UNREADABLE);
  }
  return editions;
}

export function catalogEdition(
  editions: LigaEdition[],
  url: unknown,
): LigaEdition | null {
  if (typeof url !== "string") {
    return null;
  }
  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }
  return editions.find((edition) => edition.url === trimmed) ?? null;
}

export function tryAcquireCatalogLock(): boolean {
  if (updateLocked) {
    return false;
  }
  updateLocked = true;
  return true;
}

export function releaseCatalogLock(): void {
  updateLocked = false;
}

export function resetCatalogLockForTests(): void {
  updateLocked = false;
}

/** Drop a Playwright cache path that has no Chromium build in it. */
export function catalogProcessEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const browsers = env.PLAYWRIGHT_BROWSERS_PATH;
  if (!browsers) {
    return env;
  }
  let installed = false;
  try {
    installed = fs
      .readdirSync(browsers)
      .some((name) => name.startsWith("chromium"));
  } catch {
    installed = false;
  }
  if (installed) {
    return env;
  }
  const next = { ...env };
  delete next.PLAYWRIGHT_BROWSERS_PATH;
  return next;
}

export function startCatalogUpdate(
  spawnFn: SpawnFn = spawn,
): ChildProcessWithoutNullStreams {
  return spawnFn("uv", ["run", "python", "scripts/update_liga_editions.py"], {
    cwd: path.resolve(dataDir(), ".."),
    env: catalogProcessEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;
}

export function handleListEditions(editions?: LigaEdition[]): Response {
  try {
    return Response.json(editions ?? readEditions());
  } catch {
    return Response.json({ error: CATALOG_UNREADABLE }, { status: 500 });
  }
}

export async function handleUpdateEditions(deps?: {
  spawn?: SpawnFn;
}): Promise<Response> {
  if (!tryAcquireCatalogLock()) {
    return Response.json({ error: UPDATE_IN_PROGRESS }, { status: 409 });
  }

  let child: ChildProcessWithoutNullStreams;
  try {
    child = startCatalogUpdate(deps?.spawn ?? spawn);
  } catch {
    releaseCatalogLock();
    return Response.json({ error: UPDATE_FAILED }, { status: 500 });
  }

  try {
    const result = await waitForChild(child);
    if (result.code !== 0) {
      return Response.json(
        { error: updateError(result.stderr) },
        { status: 500 },
      );
    }
    const added = parseAdded(result.stdout);
    if (added === null) {
      return Response.json({ error: UPDATE_FAILED }, { status: 500 });
    }
    return Response.json({ added });
  } catch {
    return Response.json({ error: UPDATE_FAILED }, { status: 500 });
  } finally {
    releaseCatalogLock();
  }
}

function waitForChild(
  child: ChildProcessWithoutNullStreams,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr.push(Buffer.from(chunk));
    });
    child.once("error", reject);
    child.once("close", (code) => {
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

function parseAdded(stdout: string): number | null {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed: unknown = JSON.parse(lines[index] ?? "");
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        "added" in parsed &&
        typeof parsed.added === "number" &&
        Number.isInteger(parsed.added) &&
        parsed.added >= 0
      ) {
        return parsed.added;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function updateError(stderr: string): string {
  if (/Executable doesn't exist|playwright install/i.test(stderr)) {
    return "Could not open a browser to read Liga. Install Playwright's Chromium, then try again.";
  }
  const line = stderr
    .split("\n")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && !/^[\u2500-\u257F╔╗╚╝║═]/.test(item))
    .at(-1);
  if (!line) {
    return UPDATE_FAILED;
  }
  return line.length > 240 ? `${line.slice(0, 240)}…` : line;
}
