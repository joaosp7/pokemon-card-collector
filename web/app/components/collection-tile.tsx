"use client";

import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { deleteSetAction } from "@/app/actions";
import { cardImageUrl } from "@/app/components/card-pocket";

const MENU_EVENT = "pokemon-db-set-menu";

export function CollectionTile({
  slug,
  title,
  setCode,
  owned,
  total,
  ownedCopies,
  logoFilename,
}: {
  slug: string;
  title: string;
  setCode: string;
  owned: number;
  total: number;
  ownedCopies: number;
  logoFilename: string | null;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pendingRef = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!menu) {
      return;
    }
    const close = () => setMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(null);
      }
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener(MENU_EVENT, close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener(MENU_EVENT, close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    const onCancel = (event: Event) => {
      if (pendingRef.current) {
        event.preventDefault();
      }
    };
    dialog.addEventListener("cancel", onCancel);
    return () => dialog.removeEventListener("cancel", onCancel);
  }, []);

  function onContextMenu(event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    if (dialogRef.current?.open || pendingRef.current) {
      return;
    }
    window.dispatchEvent(new Event(MENU_EVENT));
    setMenu({ x: event.clientX, y: event.clientY });
  }

  function openConfirm(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    setMenu(null);
    setError(null);
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    if (pendingRef.current) {
      return;
    }
    dialogRef.current?.close();
  }

  function onDialogClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target !== event.currentTarget || pendingRef.current) {
      return;
    }
    dialogRef.current?.close();
  }

  async function onConfirm() {
    if (pendingRef.current) {
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await deleteSetAction(slug);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      dialogRef.current?.close();
    } catch {
      setError("Could not delete this set.");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  const cardLabel = total === 1 ? "card image" : "card images";
  const ownedLabel = owned === 1 ? "owned card" : "owned cards";
  const copyLabel = ownedCopies === 1 ? "copy" : "copies";
  const logoLine = logoFilename ? " and the set logo" : "";

  return (
    <div onContextMenu={onContextMenu}>
      <Link href={`/collections/${slug}`} className="block">
        <article className="flex flex-col gap-3">
          <CollectionEmblem
            slug={slug}
            title={title}
            setCode={setCode}
            logoFilename={logoFilename}
          />
          <div className="flex items-start justify-between gap-3 text-ink-navy">
            <div>
              <p className="font-mono text-xs tracking-[0.14em] text-stamp">
                {setCode}
              </p>
              <h2 className="mt-1 font-display text-2xl leading-tight tracking-tight">
                {title}
              </h2>
            </div>
            <p className="font-mono text-sm tabular-nums text-sleeve">
              {owned} / {total}
            </p>
          </div>
        </article>
      </Link>
      {menu ? (
        <div
          className="delete-set-menu"
          role="menu"
          style={{ top: menu.y, left: menu.x }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={openConfirm}
          >
            Delete
          </button>
        </div>
      ) : null}
      <dialog
        ref={dialogRef}
        className="delete-set-dialog"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={pending || undefined}
        onClick={onDialogClick}
      >
        <div className="pocket">
          <div className="add-collection-paper">
            <h2
              id={titleId}
              className="font-display text-2xl tracking-tight text-ink-pocket"
            >
              Delete {title}
            </h2>
            <p
              id={descriptionId}
              className="mt-2 text-sm leading-relaxed text-ink-pocket/80"
            >
              {title} ({setCode}) will be removed from the catalog. Every
              image in <span className="font-mono">cards/{slug}</span> will be
              deleted: {total} {cardLabel}
              {logoLine}. Owned cards for this set will be removed: {owned}{" "}
              {ownedLabel} ({ownedCopies} {copyLabel}).
            </p>
            {error ? (
              <p className="add-collection-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="add-collection-actions">
              <button
                type="button"
                className="add-collection-go"
                disabled={pending}
                onClick={closeDialog}
              >
                Cancel
              </button>
              <button
                type="button"
                className="add-collection-go delete-set-confirm"
                disabled={pending}
                onClick={onConfirm}
              >
                Delete set
              </button>
            </div>
          </div>
        </div>
      </dialog>
    </div>
  );
}

function CollectionEmblem({
  slug,
  title,
  setCode,
  logoFilename,
}: {
  slug: string;
  title: string;
  setCode: string;
  logoFilename: string | null;
}) {
  return (
    <div className="emblem">
      <div className="emblem-face">
        {logoFilename ? (
          <>
            {/* Local filesystem scans; next/image is not used by design. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={cardImageUrl(slug, logoFilename)}
              alt={`${title} emblem`}
            />
          </>
        ) : (
          <span className="emblem-code">{setCode}</span>
        )}
      </div>
    </div>
  );
}
