export type SseDone =
  | { ok: true }
  | { ok: false; error?: string; reason?: string };

export function parseSseDone(frame: string): SseDone | null {
  let done: SseDone | null = null;

  for (const line of frame.split("\n")) {
    if (!line.startsWith("data:")) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line.slice("data:".length).trim());
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") {
      continue;
    }
    const event = parsed as {
      type?: unknown;
      ok?: unknown;
      error?: unknown;
      reason?: unknown;
    };
    if (event.type !== "done") {
      continue;
    }
    if (event.ok === true) {
      done = { ok: true };
    } else if (event.ok === false) {
      done = {
        ok: false,
        error: typeof event.error === "string" ? event.error : undefined,
        reason: typeof event.reason === "string" ? event.reason : undefined,
      };
    }
  }

  return done;
}
