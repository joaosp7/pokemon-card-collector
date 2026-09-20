import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { collectionUrlError } from "./collection-url";

export type SpawnFn = typeof spawn;

const INVALID_REQUEST = "Invalid request.";
const DOWNLOAD_IN_PROGRESS = "A download is already running.";
const DOWNLOAD_FAILED = "Download failed. Try again.";
const SPAWN_FAILED = "Could not start download-collection. Is uv installed?";

let downloadLocked = false;

export function tryAcquireDownloadLock(): boolean {
  if (downloadLocked) {
    return false;
  }
  downloadLocked = true;
  return true;
}

export function releaseDownloadLock(): void {
  downloadLocked = false;
}

export function resetDownloadLockForTests(): void {
  downloadLocked = false;
}

export function repoRoot(): string {
  return path.resolve(process.cwd(), "..");
}

export function startDownload(
  url: string,
  spawnFn: SpawnFn = spawn,
): ChildProcessWithoutNullStreams {
  return spawnFn("uv", ["run", "download-collection", url], {
    cwd: repoRoot(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;
}

export async function handleAddCollection(
  request: Request,
  deps?: { spawn?: SpawnFn },
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: INVALID_REQUEST }, { status: 400 });
  }

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: INVALID_REQUEST }, { status: 400 });
  }

  const url = (body as { url?: unknown }).url;
  const urlError = collectionUrlError(url);
  if (urlError) {
    return Response.json({ error: urlError }, { status: 400 });
  }

  if (!tryAcquireDownloadLock()) {
    return Response.json({ error: DOWNLOAD_IN_PROGRESS }, { status: 409 });
  }

  try {
    const child = startDownload(url as string, deps?.spawn ?? spawn);
    return streamChild(child);
  } catch {
    releaseDownloadLock();
    return Response.json({ error: SPAWN_FAILED }, { status: 500 });
  }
}

function streamChild(child: ChildProcessWithoutNullStreams): Response {
  const encoder = new TextEncoder();
  const stdoutBuf = { value: "" };
  const stderrBuf = { value: "" };
  const pending: Uint8Array[] = [];
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let settled = false;
  let closed = false;

  const send = (event: Record<string, unknown>): void => {
    const chunk = encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
    if (controller) {
      try {
        controller.enqueue(chunk);
      } catch {
        // Client disconnected; keep draining the child so the lock releases.
      }
      return;
    }
    pending.push(chunk);
  };

  const settle = (done: Record<string, unknown>): void => {
    if (settled) {
      return;
    }
    settled = true;
    try {
      flushLines(stdoutBuf, send);
      flushLines(stderrBuf, send);
      send(done);
      closed = true;
      try {
        controller?.close();
      } catch {
        // Already closed by the client.
      }
    } finally {
      releaseDownloadLock();
    }
  };

  child.stdout.on("data", (chunk: Buffer | string) => {
    emitLines(stdoutBuf, chunk, send);
  });
  child.stderr.on("data", (chunk: Buffer | string) => {
    emitLines(stderrBuf, chunk, send);
  });
  child.once("error", () => {
    settle({ type: "done", ok: false, error: SPAWN_FAILED });
  });
  child.once("close", (code) => {
    if (code === 0) {
      settle({ type: "done", ok: true });
    } else {
      settle({ type: "done", ok: false, error: DOWNLOAD_FAILED });
    }
  });

  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
      for (const chunk of pending) {
        streamController.enqueue(chunk);
      }
      pending.length = 0;
      if (closed) {
        streamController.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}

function emitLines(
  buffer: { value: string },
  chunk: Buffer | string,
  send: (event: Record<string, unknown>) => void,
): void {
  buffer.value += typeof chunk === "string" ? chunk : chunk.toString("utf8");
  const lines = buffer.value.split("\n");
  buffer.value = lines.pop() ?? "";
  for (const line of lines) {
    send({ type: "log", text: stripCR(line) });
  }
}

function flushLines(
  buffer: { value: string },
  send: (event: Record<string, unknown>) => void,
): void {
  if (buffer.value.length === 0) {
    return;
  }
  send({ type: "log", text: stripCR(buffer.value) });
  buffer.value = "";
}

function stripCR(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}
