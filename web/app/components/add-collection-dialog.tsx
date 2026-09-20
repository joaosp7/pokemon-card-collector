"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from "react";
import { EXAMPLE_COLLECTION_URL } from "@/lib/collection-url";

const FAIL_MESSAGE = "Download failed. Try again.";

export function AddCollectionDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const runningRef = useRef(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setRunningState(next: boolean) {
    runningRef.current = next;
    setRunning(next);
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    const onCancel = (event: Event) => {
      if (runningRef.current) {
        event.preventDefault();
      }
    };

    dialog.addEventListener("cancel", onCancel);
    return () => dialog.removeEventListener("cancel", onCancel);
  }, []);

  function openDialog() {
    setError(null);
    dialogRef.current?.showModal();
  }

  function onDialogClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (runningRef.current) {
      return;
    }
    dialogRef.current?.close();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (runningRef.current) {
      return;
    }

    const url = String(new FormData(event.currentTarget).get("url") ?? "").trim();
    if (!url) {
      return;
    }

    setError(null);
    setRunningState(true);

    try {
      const response = await fetch("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      if (response.status === 400 || response.status === 409) {
        setError(await readErrorMessage(response));
        setRunningState(false);
        return;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (
        !response.ok ||
        !contentType.includes("text/event-stream") ||
        !response.body
      ) {
        setError(await readErrorMessage(response, FAIL_MESSAGE));
        setRunningState(false);
        return;
      }

      const ok = await consumeSse(response.body);

      if (ok) {
        window.location.assign("/");
        return;
      }

      if (ok === false) {
        return;
      }

      setError(FAIL_MESSAGE);
      setRunningState(false);
    } catch {
      setError("Network error. Try again.");
      setRunningState(false);
    }
  }

  async function consumeSse(
    body: ReadableStream<Uint8Array>,
  ): Promise<boolean | null> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result: boolean | null = null;

    const handleFrame = (frame: string) => {
      const done = parseSseDone(frame);
      if (done !== null) {
        result = done.ok;
        if (!done.ok) {
          setError(done.error ?? FAIL_MESSAGE);
          setRunningState(false);
        }
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        handleFrame(frame);
      }
    }

    if (buffer.trim()) {
      handleFrame(buffer);
    }

    return result;
  }

  return (
    <>
      <button type="button" className="add-collection-btn" onClick={openDialog}>
        Add Collection
      </button>
      <dialog
        ref={dialogRef}
        className="add-collection-dialog"
        aria-labelledby="add-collection-title"
        aria-describedby="add-collection-help"
        aria-busy={running || undefined}
        onClick={onDialogClick}
      >
        <div className="pocket">
          <div className="add-collection-paper">
            <h2
              id="add-collection-title"
              className="font-display text-2xl tracking-tight text-ink-pocket"
            >
              Add Collection
            </h2>
            <p
              id="add-collection-help"
              className="mt-2 text-sm leading-relaxed text-ink-pocket/80"
            >
              Paste a Liga Pokémon collection search URL.
            </p>
            <form className="mt-5" onSubmit={onSubmit}>
              <label
                htmlFor="add-collection-url"
                className="font-mono text-[0.65rem] tracking-[0.12em] text-ink-pocket/70"
              >
                URL
              </label>
              <input
                id="add-collection-url"
                type="url"
                name="url"
                required
                disabled={running}
                spellCheck={false}
                autoComplete="off"
                placeholder={EXAMPLE_COLLECTION_URL}
                aria-invalid={error ? true : undefined}
                className="add-collection-field"
              />
              <button
                type="submit"
                className="add-collection-go"
                disabled={running}
              >
                {running ? "Downloading…" : "Download"}
              </button>
            </form>
            {running ? (
              <div className="add-collection-wait" role="status">
                <div className="add-collection-sleeve" aria-hidden="true">
                  <span className="add-collection-card is-rest" />
                  <span className="add-collection-card is-incoming" />
                </div>
                <p>Sleeving cards…</p>
              </div>
            ) : null}
            {error ? (
              <p className="add-collection-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </div>
      </dialog>
    </>
  );
}

async function readErrorMessage(response: Response, fallback = FAIL_MESSAGE) {
  const payload = (await response.json().catch(() => null)) as
    | { error?: unknown }
    | null;
  return typeof payload?.error === "string" ? payload.error : fallback;
}

function parseSseDone(
  frame: string,
): { ok: true } | { ok: false; error?: string } | null {
  let done: { ok: true } | { ok: false; error?: string } | null = null;

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
      };
    }
  }

  return done;
}
