"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import {
  editionLabel,
  filterEditions,
  matchEdition,
  parseEditionList,
  type LigaEdition,
} from "@/lib/edition-catalog";

const FAIL_MESSAGE = "Download failed. Try again.";
const CHOOSE_COLLECTION = "Choose a collection from the list.";
const UPDATE_FAILED = "Could not update the catalog.";

type Busy = "download" | "update" | null;

export function AddCollectionDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const runningRef = useRef(false);
  const listOpenRef = useRef(false);
  const listId = useId();
  const [editions, setEditions] = useState<LigaEdition[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<LigaEdition | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [busy, setBusy] = useState<Busy>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const filtered = useMemo(
    () => filterEditions(editions, query),
    [editions, query],
  );
  const activeOption = filtered[activeIndex];
  const activeId = activeOption ? `${listId}-option-${activeIndex}` : undefined;

  function setBusyState(next: Busy) {
    runningRef.current = next !== null;
    setBusy(next);
  }

  function setListOpen(next: boolean) {
    listOpenRef.current = next;
    setOpen(next);
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    const onCancel = (event: Event) => {
      if (listOpenRef.current) {
        event.preventDefault();
        setListOpen(false);
        return;
      }
      if (runningRef.current) {
        event.preventDefault();
      }
    };

    dialog.addEventListener("cancel", onCancel);
    return () => dialog.removeEventListener("cancel", onCancel);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    listRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  async function loadEditions() {
    const response = await fetch("/api/editions");
    const payload: unknown = await response.json().catch(() => null);
    const next = parseEditionList(payload);
    if (!response.ok || !next) {
      throw new Error(catalogError(payload));
    }
    setEditions(next);
  }

  async function openDialog() {
    setError(null);
    setStatus(null);
    setListOpen(true);
    dialogRef.current?.showModal();
    if (editions.length > 0) {
      return;
    }
    setLoadingCatalog(true);
    try {
      await loadEditions();
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Could not load the catalog.",
      );
    } finally {
      setLoadingCatalog(false);
    }
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

  function choose(edition: LigaEdition) {
    setSelected(edition);
    setQuery(editionLabel(edition));
    setListOpen(false);
    setError(null);
  }

  function onQueryKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setListOpen(true);
      setActiveIndex((index) =>
        Math.min(index + (open ? 1 : 0), Math.max(filtered.length - 1, 0)),
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setListOpen(true);
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Enter" && open && activeOption) {
      event.preventDefault();
      choose(activeOption);
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setListOpen(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (runningRef.current) {
      return;
    }

    const chosen = selected ?? matchEdition(editions, query);
    if (!chosen) {
      setError(CHOOSE_COLLECTION);
      setListOpen(true);
      return;
    }

    setError(null);
    setStatus(null);
    setListOpen(false);
    setBusyState("download");

    try {
      const response = await fetch("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: chosen.url }),
      });

      if (response.status === 400 || response.status === 409) {
        setError(await readErrorMessage(response));
        setBusyState(null);
        return;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (
        !response.ok ||
        !contentType.includes("text/event-stream") ||
        !response.body
      ) {
        setError(await readErrorMessage(response, FAIL_MESSAGE));
        setBusyState(null);
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
      setBusyState(null);
    } catch {
      setError("Network error. Try again.");
      setBusyState(null);
    }
  }

  async function onUpdateCatalog() {
    if (runningRef.current) {
      return;
    }
    setError(null);
    setStatus(null);
    setListOpen(false);
    setBusyState("update");
    try {
      const response = await fetch("/api/editions", { method: "POST" });
      const payload = (await response.json().catch(() => null)) as
        | { added?: unknown; error?: unknown }
        | null;
      if (!response.ok || typeof payload?.added !== "number") {
        setError(
          typeof payload?.error === "string" ? payload.error : UPDATE_FAILED,
        );
        setBusyState(null);
        return;
      }
      await loadEditions();
      setStatus(addedMessage(payload.added));
      setBusyState(null);
    } catch {
      setError("Network error. Try again.");
      setBusyState(null);
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
          setBusyState(null);
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

  const running = busy !== null;

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
              Choose a collection. Type to filter the list.
            </p>
            <form className="mt-5" onSubmit={onSubmit}>
              <label
                htmlFor="add-collection-query"
                className="font-mono text-[0.65rem] tracking-[0.12em] text-ink-pocket/70"
              >
                Collection
              </label>
              <div className="add-collection-combo">
                <div className="add-collection-query">
                <input
                  id="add-collection-query"
                  role="combobox"
                  className="add-collection-field"
                  value={query}
                  disabled={running}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="Abyss Eye"
                  aria-invalid={error ? true : undefined}
                  aria-expanded={open}
                  aria-controls={listId}
                  aria-autocomplete="list"
                  aria-activedescendant={open ? activeId : undefined}
                  onChange={(event) => {
                    const value = event.target.value;
                    setQuery(value);
                    setSelected((current) =>
                      current && editionLabel(current) === value ? current : null,
                    );
                    setActiveIndex(0);
                    setError(null);
                    setListOpen(true);
                  }}
                  onFocus={() => setListOpen(true)}
                  onKeyDown={onQueryKeyDown}
                />
                <button
                  type="button"
                  className="add-collection-expand"
                  aria-label="Show collections"
                  aria-expanded={open}
                  aria-controls={listId}
                  disabled={running}
                  onClick={() => setListOpen(!open)}
                >
                  ▾
                </button>
                </div>
                {open ? (
                  <ul
                    id={listId}
                    ref={listRef}
                    role="listbox"
                    className="add-collection-options"
                  >
                    {loadingCatalog ? (
                      <li className="add-collection-empty">Loading catalog…</li>
                    ) : filtered.length === 0 ? (
                      <li className="add-collection-empty">No collection matches.</li>
                    ) : (
                      filtered.map((edition, index) => {
                        const label = editionLabel(edition);
                        const english =
                          edition.name_en && edition.name_en !== label
                            ? edition.name_en
                            : null;
                        return (
                          <li key={edition.url} role="presentation">
                            <button
                              type="button"
                              id={`${listId}-option-${index}`}
                              role="option"
                              aria-selected={index === activeIndex}
                              className={
                                index === activeIndex
                                  ? "add-collection-option is-active"
                                  : "add-collection-option"
                              }
                              onMouseDown={(event) => event.preventDefault()}
                              onMouseEnter={() => setActiveIndex(index)}
                              onClick={() => choose(edition)}
                            >
                              <span>
                                <span className="add-collection-option-name">
                                  {label}
                                </span>
                                {english ? (
                                  <span className="add-collection-option-en">
                                    {english}
                                  </span>
                                ) : null}
                              </span>
                              <span className="add-collection-option-code">
                                {edition.set_code}
                              </span>
                            </button>
                          </li>
                        );
                      })
                    )}
                  </ul>
                ) : null}
              </div>
              <div className="add-collection-actions">
                <button
                  type="submit"
                  className="add-collection-go"
                  disabled={running}
                >
                  {busy === "download" ? "Downloading…" : "Download"}
                </button>
                <button
                  type="button"
                  className="add-collection-go add-collection-update"
                  disabled={running}
                  onClick={onUpdateCatalog}
                >
                  {busy === "update" ? "Updating…" : "Update catalog"}
                </button>
              </div>
            </form>
            {running ? (
              <div className="add-collection-wait" role="status">
                <div className="add-collection-sleeve" aria-hidden="true">
                  <span className="add-collection-card is-rest" />
                  <span className="add-collection-card is-incoming" />
                </div>
                <p>
                  {busy === "update" ? "Checking Liga…" : "Sleeving cards…"}
                </p>
              </div>
            ) : null}
            {status ? (
              <p className="add-collection-status" role="status">
                {status}
              </p>
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

function addedMessage(added: number): string {
  if (added === 0) {
    return "Catalog is already up to date.";
  }
  if (added === 1) {
    return "Added 1 collection.";
  }
  return `Added ${added} collections.`;
}

function catalogError(payload: unknown): string {
  if (
    payload !== null &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }
  return "Could not load the catalog.";
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
